import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { v4 as uuidv4 } from 'uuid';

// Define the storage structure for all contexts
interface BookmarkStorage {
  [contextId: string]: Bookmark[];
}

const DEFAULT_CONTEXT = 'default';

export class BookmarkManager {
  private static instance: BookmarkManager;
  private storage: BookmarkStorage = {};
  private activeContextId: string = DEFAULT_CONTEXT;
  private currentBookmarkIndex: number = -1;

  private constructor(private context: vscode.ExtensionContext) {
    this.load();
  }

  private load() {
    // Migration from old format
    const oldBookmarks = this.context.workspaceState.get<Bookmark[]>('bookmarks');
    if (Array.isArray(oldBookmarks) && oldBookmarks.length > 0) {
      this.storage[DEFAULT_CONTEXT] = oldBookmarks;
      this.activeContextId = DEFAULT_CONTEXT;
      this.context.workspaceState.update('bookmarks', undefined); // Remove old data
      this.save();
      return;
    }

    // Load new format
    this.storage = this.context.workspaceState.get<BookmarkStorage>('bookmark-storage', { [DEFAULT_CONTEXT]: [] });
    this.activeContextId = this.context.workspaceState.get<string>('bookmark-active-context', DEFAULT_CONTEXT);

    // Ensure active context exists
    if (!this.storage[this.activeContextId]) {
        this.activeContextId = DEFAULT_CONTEXT;
        if (!this.storage[this.activeContextId]) {
            this.storage[this.activeContextId] = [];
        }
    }
  }

  private async save(): Promise<void> {
    await this.context.workspaceState.update('bookmark-storage', this.storage);
    await this.context.workspaceState.update('bookmark-active-context', this.activeContextId);
  }

  public static getInstance(context: vscode.ExtensionContext): BookmarkManager {
    if (!BookmarkManager.instance) {
      BookmarkManager.instance = new BookmarkManager(context);
    }
    return BookmarkManager.instance;
  }

  // --- Context Management ---

  public getActiveContextId(): string {
    return this.activeContextId;
  }

  public getAllContextIds(): string[] {
    return Object.keys(this.storage);
  }

  public async createContext(newContextId: string): Promise<boolean> {
    if (this.storage[newContextId] || !newContextId) {
        return false; // Already exists or empty name
    }
    this.storage[newContextId] = [];
    await this.save();
    return true;
  }

  public async switchContext(contextId: string): Promise<boolean> {
    if (!this.storage[contextId]) {
        return false; // Does not exist
    }
    this.activeContextId = contextId;
    this.currentBookmarkIndex = -1; // Reset navigation index
    await this.save();
    return true;
  }

  public async deleteContext(contextId: string): Promise<'success' | 'not_found' | 'active' | 'last'> {
    if (!this.storage[contextId]) {
        return 'not_found';
    }
    if (contextId === this.activeContextId) {
        return 'active';
    }
    if (Object.keys(this.storage).length <= 1) {
        return 'last';
    }

    delete this.storage[contextId];
    await this.save();
    return 'success';
  }

  // --- Bookmark Operations (now context-aware) ---

  public getBookmarks(): Bookmark[] {
    return this.storage[this.activeContextId] || [];
  }

  public async addBookmark(fsPath: string, lineNumber: number, label: string) {
    const newBookmark: Bookmark = { id: uuidv4(), fsPath, lineNumber, label };
    this.getBookmarks().push(newBookmark);
    await this.save();
  }

  public async removeBookmark(bookmarkId: string) {
    const bookmarks = this.getBookmarks();
    const oldIndex = bookmarks.findIndex(b => b.id === bookmarkId);
    this.storage[this.activeContextId] = bookmarks.filter(b => b.id !== bookmarkId);
    
    if (this.currentBookmarkIndex > oldIndex) {
        this.currentBookmarkIndex--;
    } else if (this.currentBookmarkIndex === oldIndex) {
        this.currentBookmarkIndex = -1;
    }
    await this.save();
  }

  public async clearAllBookmarks() {
    this.storage[this.activeContextId] = [];
    this.currentBookmarkIndex = -1;
    await this.save();
  }

  public async reorderBookmarks(draggedBookmark: Bookmark, targetBookmark: Bookmark | undefined): Promise<void> {
    const bookmarks = this.getBookmarks();
    const sourceIndex = bookmarks.findIndex(b => b.id === draggedBookmark.id);
    if (sourceIndex === -1) return;

    const [removed] = bookmarks.splice(sourceIndex, 1);
    let newIndex = -1;

    if (targetBookmark) {
        const targetIndex = bookmarks.findIndex(b => b.id === targetBookmark.id);
        if (targetIndex !== -1) {
            bookmarks.splice(targetIndex, 0, removed);
            newIndex = targetIndex;
        } else {
            bookmarks.push(removed);
            newIndex = bookmarks.length - 1;
        }
    } else {
        bookmarks.push(removed);
        newIndex = bookmarks.length - 1;
    }
    this.currentBookmarkIndex = newIndex;
    await this.save();
  }

  public async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<boolean> {
    const bookmarks = this.getBookmarks();
    const affectedBookmarks = bookmarks.filter(b => b.fsPath === event.document.uri.fsPath);
    if (affectedBookmarks.length === 0) return false;

    const changedBookmarks = new Set<string>();
    const deletedBookmarks = new Set<string>();

    for (const change of event.contentChanges) {
        const linesAdded = (change.text.match(/\n/g) || []).length;
        const linesRemoved = change.range.end.line - change.range.start.line;
        const lineDelta = linesAdded - linesRemoved;

        for (const bookmark of affectedBookmarks) {
            if (deletedBookmarks.has(bookmark.id)) continue;
            const bookmarkLine = bookmark.lineNumber - 1;

            if (change.range.end.line < bookmarkLine) {
                bookmark.lineNumber += lineDelta;
                changedBookmarks.add(bookmark.id);
            } else if (change.range.contains(new vscode.Position(bookmarkLine, 0))) {
                deletedBookmarks.add(bookmark.id);
            }
        }
    }

    if (deletedBookmarks.size > 0) {
        this.storage[this.activeContextId] = bookmarks.filter(b => !deletedBookmarks.has(b.id));
    }

    for (const bookmark of this.getBookmarks().filter(b => b.fsPath === event.document.uri.fsPath && !deletedBookmarks.has(b.id))) {
        if (bookmark.lineNumber - 1 < event.document.lineCount) {
            const currentLineText = event.document.lineAt(bookmark.lineNumber - 1).text.trim();
            if (bookmark.label !== currentLineText) {
                bookmark.label = currentLineText;
                changedBookmarks.add(bookmark.id);
            }
        }
    }

    if (changedBookmarks.size > 0 || deletedBookmarks.size > 0) {
        await this.save();
        return true;
    }
    return false;
  }

  // --- Navigation (now context-aware) ---

  public setCurrentBookmarkById(bookmarkId?: string) {
    if (!bookmarkId) {
        this.currentBookmarkIndex = -1;
        return;
    }
    this.currentBookmarkIndex = this.getBookmarks().findIndex(b => b.id === bookmarkId);
  }

  public getCurrentBookmark(): Bookmark | undefined {
    const bookmarks = this.getBookmarks();
    if (this.currentBookmarkIndex < 0 || this.currentBookmarkIndex >= bookmarks.length) {
        return undefined;
    }
    return bookmarks[this.currentBookmarkIndex];
  }

  public getNextBookmark(): Bookmark | undefined {
    const bookmarks = this.getBookmarks();
    if (bookmarks.length === 0 || this.currentBookmarkIndex >= bookmarks.length - 1) {
        return undefined; // No more bookmarks
    }
    this.currentBookmarkIndex++;
    return bookmarks[this.currentBookmarkIndex];
  }

  public getPreviousBookmark(): Bookmark | undefined {
    const bookmarks = this.getBookmarks();
    if (bookmarks.length === 0 || this.currentBookmarkIndex <= 0) {
        return undefined; // No previous bookmarks
    }
    this.currentBookmarkIndex--;
    return bookmarks[this.currentBookmarkIndex];
  }
}