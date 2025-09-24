import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { BookmarkManager } from './bookmarkManager';
import { BookmarkProvider } from './bookmarkProvider';

export function activate(context: vscode.ExtensionContext) {

  const bookmarkManager = BookmarkManager.getInstance(context);
  const bookmarkProvider = new BookmarkProvider(bookmarkManager);

  // 監聽文件變更以自動更新書籤行號
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.contentChanges.length > 0) {
        const changed = await bookmarkManager.handleTextDocumentChange(event);
        if (changed) {
          bookmarkProvider.refresh();
        }
      }
    })
  );

  // 註冊 TreeView 並啟用拖曳功能
  const bookmarkTreeView = vscode.window.createTreeView('bookmarks', {
    treeDataProvider: bookmarkProvider,
    dragAndDropController: bookmarkProvider, // 關鍵：將 provider 設為拖曳控制器
    canSelectMany: true,
  });
  context.subscriptions.push(bookmarkTreeView);

  // Helper function to jump to a bookmark
  const jumpTo = async (bookmark: Bookmark | undefined) => {
    if (!bookmark) {
        vscode.window.showInformationMessage('No bookmarks to navigate to.');
        return;
    }
    try {
        const uri = vscode.Uri.file(bookmark.fsPath);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        
        const position = new vscode.Position(bookmark.lineNumber - 1, 0);
        editor.selection = new vscode.Selection(position, position);
        editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        bookmarkManager.setCurrentBookmarkById(bookmark.id);
    } catch (error) {
        vscode.window.showErrorMessage(`Could not open file: ${bookmark.fsPath}`);
        console.error(error);
    }
  };

  // 註冊 jumpToBookmark 指令 (從 TreeView 點擊時觸發)
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.jumpToBookmark', (bookmark: Bookmark) => {
      jumpTo(bookmark);
    })
  );

  // 註冊 jumpToCurrentBookmark 指令
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.jumpToCurrentBookmark', () => {
        const currentBookmark = bookmarkManager.getCurrentBookmark();
        if (!currentBookmark) {
            vscode.window.showInformationMessage('No current bookmark is set.');
            return;
        }
        jumpTo(currentBookmark);
    })
  );

  // 註冊 nextBookmark 指令
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.nextBookmark', () => {
        const nextBookmark = bookmarkManager.getNextBookmark();
        jumpTo(nextBookmark);
    })
  );

  // 註冊 previousBookmark 指令
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.previousBookmark', () => {
        const prevBookmark = bookmarkManager.getPreviousBookmark();
        jumpTo(prevBookmark);
    })
  );

  // 註冊 clearAllBookmarks 指令
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.clearAllBookmarks', async () => {
        const result = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all bookmarks?',
            { modal: true },
            'Yes'
        );

        if (result === 'Yes') {
            await bookmarkManager.clearAllBookmarks();
            bookmarkProvider.refresh();
            vscode.window.showInformationMessage('All bookmarks cleared.');
        }
    })
  );

  // --- 以下是舊的指令，保持不變 ---

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.refreshBookmarks', () => {
      bookmarkProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.addBookmark', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const lineNumber = editor.selection.active.line + 1;
        const lineText = editor.document.lineAt(lineNumber - 1).text.trim();
        const fsPath = editor.document.uri.fsPath;
        
        await bookmarkManager.addBookmark(fsPath, lineNumber, lineText);
        bookmarkProvider.refresh();
        vscode.window.showInformationMessage(`Bookmark added to line ${lineNumber}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.removeBookmark', async (bookmark: Bookmark) => {
      if (!bookmark || !bookmark.id) {
        // This case can happen if the command is run from the command palette without a selection
        const selection = bookmarkTreeView.selection;
        if (selection.length > 0) {
            for (const sel of selection) {
                await bookmarkManager.removeBookmark(sel.id);
            }
            bookmarkProvider.refresh();
            vscode.window.showInformationMessage(`${selection.length} bookmarks removed.`);
        } else {
            vscode.window.showWarningMessage('No bookmark selected to remove.');
        }
        return;
      }
      // This case is for right-click context menu
      await bookmarkManager.removeBookmark(bookmark.id);
      bookmarkProvider.refresh();
      vscode.window.showInformationMessage('Bookmark removed.');
    })
  );
}

export function deactivate() {}