import * as vscode from 'vscode';
import { registerLanguageSyncCommands } from './commands/languageSyncCommands';
import { Logger } from './utils/logger';
import { ValidationService } from './services/validationService';
import { ActionViewProvider } from './providers/actionViewProvider';
import { LanguageFilesViewProvider } from './providers/languageFilesViewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Language Sync', { log: true });
  const logger = new Logger(output);
  context.subscriptions.push(output);

  const validationService = new ValidationService(logger);
  context.subscriptions.push(validationService);

  const actionProvider = new ActionViewProvider();
  const filesProvider = new LanguageFilesViewProvider();
  const treeView = vscode.window.createTreeView('languageSync.actions', {
    treeDataProvider: actionProvider,
    showCollapseAll: false,
  });
  const filesView = vscode.window.createTreeView('languageSync.files', {
    treeDataProvider: filesProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);
  context.subscriptions.push(filesView);

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.refreshFilesView', async () => {
      await filesProvider.refresh();
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.toLowerCase().endsWith('.json')) {
        void validationService.refresh();
        void filesProvider.refresh();
      }
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('languageSync')) {
        void validationService.refresh();
        void filesProvider.refresh();
      }
    })
  );

  logger.info('Language Sync extension activated.');
  registerLanguageSyncCommands(context, logger, validationService);
  void validationService.refresh();
  void filesProvider.refresh();
}

export function deactivate(): void {
  // No-op: resources are disposed via context subscriptions.
}
