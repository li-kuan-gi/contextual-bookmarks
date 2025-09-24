import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { v4 as uuidv4 } from 'uuid';

export class BookmarkManager {
  private static instance: BookmarkManager;
  private bookmarks: Bookmark[] = [];
  private currentBookmarkIndex: number = -1;

  private constructor(private context: vscode.ExtensionContext) {
    const savedBookmarks = this.context.workspaceState.get<Bookmark[]>('bookmarks', []);
    this.bookmarks = savedBookmarks;
  }

  public static getInstance(context: vscode.ExtensionContext): BookmarkManager {
    if (!BookmarkManager.instance) {
      BookmarkManager.instance = new BookmarkManager(context);
    }
    return BookmarkManager.instance;
  }

  public getBookmarks(): Bookmark[] {
    return this.bookmarks;
  }

  public async handleTextDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<boolean> {
    const changedBookmarks = new Set<string>();
    const deletedBookmarks = new Set<string>();

    const affectedBookmarks = this.bookmarks.filter(b => b.fsPath === event.document.uri.fsPath);
    if (affectedBookmarks.length === 0) {
        return false;
    }

    for (const change of event.contentChanges) {
        const linesAdded = (change.text.match(/\n/g) || []).length;
        const linesRemoved = change.range.end.line - change.range.start.line;
        const lineDelta = linesAdded - linesRemoved;

        // if (lineDelta === 0 && change.range.isSingleLine) continue; // No line changes, but content might change

        for (const bookmark of affectedBookmarks) {
            if (deletedBookmarks.has(bookmark.id)) continue; // Already marked for deletion

            const bookmarkLine = bookmark.lineNumber - 1; // Convert to 0-based index

            if (change.range.end.line < bookmarkLine) {
                // Change is entirely above the bookmark
                bookmark.lineNumber += lineDelta;
                changedBookmarks.add(bookmark.id);
            } else if (change.range.contains(new vscode.Position(bookmarkLine, 0))) {
                // The change range includes the bookmark's line, so delete it
                deletedBookmarks.add(bookmark.id);
            }
        }
    }

    // Filter out deleted bookmarks first
    if (deletedBookmarks.size > 0) {
        this.bookmarks = this.bookmarks.filter(b => !deletedBookmarks.has(b.id));
    }

    // After processing all line shifts and deletions, update labels for remaining bookmarks if their content changed
    for (const bookmark of this.bookmarks.filter(b => b.fsPath === event.document.uri.fsPath && !deletedBookmarks.has(b.id))) {
        // Ensure the line number is still valid after all changes
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

  public async addBookmark(fsPath: string, lineNumber: number, label: string) {
    const newBookmark: Bookmark = { id: uuidv4(), fsPath, lineNumber, label };
    this.bookmarks.push(newBookmark);
    await this.save();
  }

  public async removeBookmark(bookmarkId: string) {
    const oldIndex = this.bookmarks.findIndex(b => b.id === bookmarkId);
    this.bookmarks = this.bookmarks.filter(b => b.id !== bookmarkId);
    if (this.currentBookmarkIndex > oldIndex) {
        this.currentBookmarkIndex--;
    } else if (this.currentBookmarkIndex === oldIndex) {
        this.currentBookmarkIndex = -1;
    }
    await this.save();
  }

  public async clearAllBookmarks() {
    this.bookmarks = [];
    this.currentBookmarkIndex = -1;
    await this.save();
  }

  public async reorderBookmarks(draggedBookmark: Bookmark, targetBookmark: Bookmark | undefined): Promise<void> {
    const sourceIndex = this.bookmarks.findIndex(b => b.id === draggedBookmark.id);
    if (sourceIndex === -1) return;

    const [removed] = this.bookmarks.splice(sourceIndex, 1);

    let newIndex = -1; // Initialize newIndex

    if (targetBookmark) {
        const targetIndex = this.bookmarks.findIndex(b => b.id === targetBookmark.id);
        if (targetIndex !== -1) {
            this.bookmarks.splice(targetIndex, 0, removed);
            newIndex = targetIndex; // New index is where it was inserted
        } else {
            this.bookmarks.push(removed);
            newIndex = this.bookmarks.length - 1;
        }
    } else {
        this.bookmarks.push(removed);
        newIndex = this.bookmarks.length - 1;
    }

    this.currentBookmarkIndex = newIndex;

    await this.save();
  }

  public setCurrentBookmarkById(bookmarkId?: string) {
    if (!bookmarkId) {
        this.currentBookmarkIndex = -1;
        return;
    }
    this.currentBookmarkIndex = this.bookmarks.findIndex(b => b.id === bookmarkId);
  }

  public getCurrentBookmark(): Bookmark | undefined {
    if (this.currentBookmarkIndex < 0 || this.currentBookmarkIndex >= this.bookmarks.length) {
        return undefined;
    }
    return this.bookmarks[this.currentBookmarkIndex];
  }

  public getNextBookmark(): Bookmark | undefined {
    if (this.bookmarks.length === 0) return undefined;
    if (this.currentBookmarkIndex === this.bookmarks.length - 1) {
        return undefined; // Already at the last bookmark, do not loop
    }
    this.currentBookmarkIndex++;
    return this.bookmarks[this.currentBookmarkIndex];
  }

  public getPreviousBookmark(): Bookmark | undefined {
    if (this.bookmarks.length === 0) return undefined;
    if (this.currentBookmarkIndex <= 0) {
        return undefined; // Already at the first bookmark, do not loop
    }
    this.currentBookmarkIndex--;
    return this.bookmarks[this.currentBookmarkIndex];
  }

  private async save() {
    await this.context.workspaceState.update('bookmarks', this.bookmarks);
  }
}
