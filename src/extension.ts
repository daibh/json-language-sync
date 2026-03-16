import * as vscode from 'vscode';
import { registerLanguageSyncCommands } from './commands/languageSyncCommands';
import { Logger } from './utils/logger';
import { ValidationService } from './services/validationService';
import { ActionViewProvider } from './providers/actionViewProvider';
import { LanguageFilesViewProvider } from './providers/languageFilesViewProvider';
import { getConfig } from './utils/config';
import { TokenService } from './services/tokenService';

/**
 * Determines whether translation is ready:
 * - Always true when the provider is MCP (no AI token needed).
 * - True for the AI provider only when a decryptable token is present.
 * Updates the VS Code context key `languageSync.translationReady` and
 * the action panel accordingly.
 */
async function updateTranslationReady(
  tokenService: TokenService,
  actionProvider: ActionViewProvider
): Promise<void> {
  let ready = false;
  try {
    const config = getConfig();
    ready = config.translationProvider !== 'ai' || (await tokenService.isConfigured());
  } catch {
    ready = false;
  }
  await vscode.commands.executeCommand('setContext', 'languageSync.translationReady', ready);
  actionProvider.setTranslationReady(ready);
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Language Sync', { log: true });
  const logger = new Logger(output);
  context.subscriptions.push(output);

  const validationService = new ValidationService(logger);
  context.subscriptions.push(validationService);

  const tokenService = new TokenService();
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
    vscode.commands.registerCommand('languageSync.configureAiToken', async () => {
      const input = await vscode.window.showInputBox({
        title: 'Configure AI Access Token',
        prompt:
          'Enter your AI access token. On Windows it is encrypted with DPAPI (current-user scope) before being saved.',
        password: true,
        placeHolder: 'Paste your AI access token here',
        validateInput: (value) => (!value.trim() ? 'Token cannot be empty.' : undefined),
      });

      if (!input) {
        return;
      }

      try {
        await tokenService.storeToken(input.trim());
        await updateTranslationReady(tokenService, actionProvider);
        void vscode.window.showInformationMessage('AI access token configured successfully.');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(`Failed to configure AI token: ${message}`);
      }
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
        void updateTranslationReady(tokenService, actionProvider);
      }
    })
  );

  logger.info('Language Sync extension activated.');
  registerLanguageSyncCommands(context, logger, validationService, tokenService);
  void validationService.refresh();
  void filesProvider.refresh();
  void updateTranslationReady(tokenService, actionProvider);
}

export function deactivate(): void {
  // No-op: resources are disposed via context subscriptions.
}
