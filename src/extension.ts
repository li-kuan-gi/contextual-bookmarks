import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { BookmarkManager } from './bookmarkManager';
import { BookmarkProvider } from './bookmarkProvider';

export function activate(context: vscode.ExtensionContext) {

  const bookmarkManager = BookmarkManager.getInstance(context);
  const bookmarkProvider = new BookmarkProvider(bookmarkManager);

  // --- Helper Functions ---
  const updateTreeViewTitle = (treeView: vscode.TreeView<Bookmark | undefined>) => {
    const activeContext = bookmarkManager.getActiveContextId();
    treeView.title = `Bookmarks: ${activeContext}`;
  };

  // --- TreeView Registration ---
  const bookmarkTreeView = vscode.window.createTreeView('bookmarks', {
    treeDataProvider: bookmarkProvider,
    dragAndDropController: bookmarkProvider,
    canSelectMany: true,
  });
  context.subscriptions.push(bookmarkTreeView);
  updateTreeViewTitle(bookmarkTreeView); // Set initial title

  // --- Event Listeners ---
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

  // --- Command Implementations ---

  // Context Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.createContext', async () => {
      const newContextId = await vscode.window.showInputBox({ 
        prompt: 'Enter a name for the new context',
        validateInput: text => {
            return text && text.length > 0 ? null : 'Context name cannot be empty.';
        }
      });
      if (newContextId) {
        const created = await bookmarkManager.createContext(newContextId);
        if (created) {
            await bookmarkManager.switchContext(newContextId);
            bookmarkProvider.refresh();
            updateTreeViewTitle(bookmarkTreeView);
            vscode.window.showInformationMessage(`Switched to new context: ${newContextId}`);
        } else {
            vscode.window.showErrorMessage(`Context '${newContextId}' already exists.`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.switchContext', async () => {
      const contextIds = bookmarkManager.getAllContextIds();
      const selectedContext = await vscode.window.showQuickPick(contextIds, {
        placeHolder: 'Select a context to switch to'
      });
      if (selectedContext) {
        await bookmarkManager.switchContext(selectedContext);
        bookmarkProvider.refresh();
        updateTreeViewTitle(bookmarkTreeView);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.deleteContext', async () => {
        const activeContextId = bookmarkManager.getActiveContextId();
        const allContextIds = bookmarkManager.getAllContextIds();
        const deletableContexts = allContextIds.filter(id => id !== activeContextId);

        if (deletableContexts.length === 0) {
            vscode.window.showInformationMessage('No other contexts to delete. You cannot delete the active or the only context.');
            return;
        }

        const contextToDelete = await vscode.window.showQuickPick(deletableContexts, {
            placeHolder: 'Select a context to delete'
        });

        if (!contextToDelete) return;

        const confirmation = await vscode.window.showWarningMessage(
            `Are you sure you want to delete the context '${contextToDelete}'? This will delete all its bookmarks and cannot be undone.`,
            { modal: true },
            'Yes'
        );

        if (confirmation === 'Yes') {
            const result = await bookmarkManager.deleteContext(contextToDelete);
            if (result === 'success') {
                vscode.window.showInformationMessage(`Successfully deleted context: ${contextToDelete}`);
            } else {
                // This case should ideally not be hit due to the checks above, but is good for safety.
                vscode.window.showErrorMessage(`Could not delete context. Reason: ${result}`);
            }
        }
    })
  );

  // Bookmark Commands
  const jumpTo = async (bookmark: Bookmark | undefined, endOfListMessage?: string) => {
    if (!bookmark) {
        vscode.window.showInformationMessage(endOfListMessage || 'No bookmarks to navigate to.');
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

  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.jumpToBookmark', (bookmark: Bookmark) => jumpTo(bookmark)));
  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.nextBookmark', () => jumpTo(bookmarkManager.getNextBookmark(), 'You have reached the last bookmark.')));
  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.previousBookmark', () => jumpTo(bookmarkManager.getPreviousBookmark(), 'You have reached the first bookmark.')));
  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.jumpToCurrentBookmark', () => jumpTo(bookmarkManager.getCurrentBookmark())));

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.addBookmark', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const lineNumber = editor.selection.active.line + 1;
        const lineText = editor.document.lineAt(lineNumber - 1).text.trim();
        const fsPath = editor.document.uri.fsPath;
        
        const success = await bookmarkManager.addBookmark(fsPath, lineNumber, lineText);
        if (success) {
            bookmarkProvider.refresh();
            vscode.window.showInformationMessage(`Bookmark added to line ${lineNumber}`);
        } else {
            vscode.window.showInformationMessage(`A bookmark already exists on line ${lineNumber}.`);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.removeBookmark', async (bookmark: Bookmark) => {
      if (bookmark && bookmark.id) {
        await bookmarkManager.removeBookmark(bookmark.id);
      } else {
        const selection = bookmarkTreeView.selection;
        if (selection.length > 0) {
            for (const sel of selection) {
                await bookmarkManager.removeBookmark(sel.id);
            }
        }
      }
      bookmarkProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.clearAllBookmarks', async () => {
        const result = await vscode.window.showWarningMessage(
            `Are you sure you want to clear all bookmarks in the '${bookmarkManager.getActiveContextId()}' context?`,
            { modal: true }, 'Yes'
        );
        if (result === 'Yes') {
            await bookmarkManager.clearAllBookmarks();
            bookmarkProvider.refresh();
        }
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.refreshBookmarks', () => bookmarkProvider.refresh()));
}

export function deactivate() {}