import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { BookmarkManager } from './bookmarkManager';

export class BookmarkProvider implements vscode.TreeDataProvider<Bookmark>, vscode.TreeDragAndDropController<Bookmark> {
  private _onDidChangeTreeData: vscode.EventEmitter<Bookmark | undefined | null | void> = new vscode.EventEmitter<Bookmark | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Bookmark | undefined | null | void> = this._onDidChangeTreeData.event;

  // --- Drag and Drop Properties ---
  public readonly dropMimeTypes = ['application/vnd.code.tree.bookmarks'];
  public readonly dragMimeTypes = ['application/vnd.code.tree.bookmarks'];

  constructor(private bookmarkManager: BookmarkManager) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Bookmark): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(element.label);
    treeItem.id = element.id;
    treeItem.collapsibleState = vscode.TreeItemCollapsibleState.None;
    treeItem.command = {
      command: 'contextual-bookmark.jumpToBookmark',
      title: 'Jump to Bookmark',
      arguments: [element],
    };
    treeItem.contextValue = 'bookmark'; 
    return treeItem;
  }

  getChildren(element?: Bookmark): Thenable<Bookmark[]> {
    if (element) {
      return Promise.resolve([]);
    } else {
      return Promise.resolve(this.bookmarkManager.getBookmarks());
    }
  }

  // --- Drag and Drop Methods ---

  public async handleDrop(target: Bookmark | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const transferItem = dataTransfer.get('application/vnd.code.tree.bookmarks');
    if (!transferItem) {
      return;
    }

    const draggedBookmarks: Bookmark[] = transferItem.value;
    if (draggedBookmarks.length > 0) {
      await this.bookmarkManager.reorderBookmarks(draggedBookmarks[0], target);
      this.refresh();
    }
  }

  public async handleDrag(source: readonly Bookmark[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    if (source.length > 0) {
      dataTransfer.set('application/vnd.code.tree.bookmarks', new vscode.DataTransferItem(source));
    }
  }
}