import * as vscode from 'vscode';
import { Bookmark } from './bookmark';
import { BookmarkManager } from './bookmarkManager';
import { BookmarkProvider } from './bookmarkProvider';

export function activate(context: vscode.ExtensionContext) {

  const bookmarkManager = BookmarkManager.getInstance(context);
  const bookmarkProvider = new BookmarkProvider(bookmarkManager);

  // --- Decoration --- 
  const decorationType = vscode.window.createTextEditorDecorationType({
    gutterIconPath: context.asAbsolutePath('resources/bookmark.svg'),
    gutterIconSize: 'contain',
  });

  const updateDecorations = () => {
    const allBookmarks = bookmarkManager.getBookmarks();
    for (const editor of vscode.window.visibleTextEditors) {
        const decorations: vscode.DecorationOptions[] = [];
        const bookmarksInFile = allBookmarks.filter(b => b.fsPath === editor.document.uri.fsPath);

        for (const bookmark of bookmarksInFile) {
            const line = bookmark.lineNumber - 1;
            if (line < editor.document.lineCount) {
                const range = new vscode.Range(line, 0, line, 0);
                decorations.push({ range });
            }
        }
        editor.setDecorations(decorationType, decorations);
    }
  };

  // --- Helper Functions ---
  const updateAll = () => {
    bookmarkProvider.refresh();
    updateDecorations();
  };

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
  updateTreeViewTitle(bookmarkTreeView);
  updateDecorations(); // Initial decoration update

  // --- Event Listeners ---
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.contentChanges.length > 0) {
        const changed = await bookmarkManager.handleTextDocumentChange(event);
        if (changed) {
          updateAll();
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => updateDecorations())
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
            updateAll();
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
        updateAll();
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
                vscode.window.showErrorMessage(`Could not delete context. Reason: ${result}`);
            }
        }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('contextual-bookmark.renameContext', async () => {
        const contextToRename = await vscode.window.showQuickPick(bookmarkManager.getAllContextIds(), {
            placeHolder: 'Select a context to rename'
        });

        if (!contextToRename) return;

        const newContextId = await vscode.window.showInputBox({
            prompt: `Enter a new name for '${contextToRename}'`,
            value: contextToRename,
            validateInput: text => {
                if (!text || text.length === 0) {
                    return 'Context name cannot be empty.';
                }
                if (bookmarkManager.getAllContextIds().includes(text) && text !== contextToRename) {
                    return `Context '${text}' already exists.`;
                }
                return null;
            }
        });

        if (newContextId && newContextId !== contextToRename) {
            const result = await bookmarkManager.renameContext(contextToRename, newContextId);
            if (result === 'success') {
                updateAll();
                updateTreeViewTitle(bookmarkTreeView);
                vscode.window.showInformationMessage(`Context '${contextToRename}' renamed to '${newContextId}'.`);
            } else {
                vscode.window.showErrorMessage(`Could not rename context. Reason: ${result}`);
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
        
        const result = await bookmarkManager.toggleBookmark(fsPath, lineNumber, lineText);
        updateAll();
        if (result === 'added') {
            vscode.window.showInformationMessage(`Bookmark added to line ${lineNumber}`);
        } else {
            vscode.window.showInformationMessage(`Bookmark removed from line ${lineNumber}`);
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
      updateAll();
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
            updateAll();
        }
    })
  );

  context.subscriptions.push(vscode.commands.registerCommand('contextual-bookmark.refreshBookmarks', () => updateAll()));
}

export function deactivate() {}