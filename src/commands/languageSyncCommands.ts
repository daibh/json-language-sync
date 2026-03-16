import * as vscode from 'vscode';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';
import { LanguageFilesService } from '../services/languageFilesService';
import { TranslationService } from '../services/translationService';
import { GitMergeService } from '../services/gitMergeService';
import { ValidationService } from '../services/validationService';
import { TokenService } from '../services/tokenService';

export function registerLanguageSyncCommands(
  context: vscode.ExtensionContext,
  logger: Logger,
  validationService: ValidationService,
  tokenService: TokenService
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.openSettings', async () => {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'languageSync'
      );
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.removeUtf8Bom', async () => {
      await runGuarded(logger, async () => {
        const service = await createLanguageService(logger, tokenService);
        const updated = await service.removeUtf8BomAll();
        await validationService.refresh();
        const message = `UTF-8 BOM cleanup done. Updated ${updated} file(s).`;
        logger.info(message);
        void vscode.window.showInformationMessage(message);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.syncMissingToDefault', async () => {
      await runGuarded(logger, async () => {
        await ensureTranslationReady(tokenService);
        const service = await createLanguageService(logger, tokenService);
        const stats = await service.syncMissingToDefault();
        await validationService.refresh();
        const message = `Sync to default completed. Files scanned: ${stats.filesProcessed}, items added: ${stats.itemsAdded}.`;
        logger.info(message);
        void vscode.window.showInformationMessage(message);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.syncMissingAndTranslate', async () => {
      await runGuarded(logger, async () => {
        const service = await createLanguageService(logger, tokenService);
        const stats = await service.syncMissingAndTranslate();
        await validationService.refresh();
        const message = `Translation sync completed. Files updated: ${stats.filesProcessed}, items added: ${stats.itemsAdded}, items translated: ${stats.itemsTranslated}.`;
        logger.info(message);
        void vscode.window.showInformationMessage(message);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.mergeFromRemoteBranch', async () => {
      await runGuarded(logger, async () => {
        const config = getConfig();
        const service = await createLanguageService(logger, tokenService);
        const gitMergeService = new GitMergeService(config, config.workspaceRoot, service, logger);

        const strategy = await vscode.window.showQuickPick(['pull', 'rebase', 'merge'], {
          title: 'Select language merge strategy',
          placeHolder: 'This affects logging only. File merge behavior is conflict-safe language merge.',
        });
        if (!strategy) {
          return;
        }

        const branches = await gitMergeService.listRemoteBranches();
        if (branches.length === 0) {
          throw new Error('No remote branches found. Check git remotes and fetch status.');
        }

        const branch = await vscode.window.showQuickPick(branches, {
          title: 'Select remote branch to merge language files from',
        });

        if (!branch) {
          return;
        }

        const mergedCount = await gitMergeService.mergeLanguagesFromRemoteBranch(branch, strategy);
        await validationService.refresh();
        const message = `Remote language merge finished. Merged ${mergedCount} file(s) from ${branch}.`;
        logger.info(message);
        void vscode.window.showInformationMessage(message);
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('languageSync.validateFiles', async () => {
      await runGuarded(logger, async () => {
        await ensureTranslationReady(tokenService);
        await validationService.refresh();
        const message = 'Language file validation completed.';
        logger.info(message);
        void vscode.window.showInformationMessage(message);
      });
    })
  );
}

async function ensureTranslationReady(tokenService: TokenService): Promise<void> {
  const config = getConfig();
  if (config.translationProvider !== 'ai') {
    return;
  }

  const isReady = await tokenService.isConfigured();
  if (!isReady) {
    throw new Error(
      'AI token is not configured or invalid. Run "Language Sync: Configure AI Access Token" first.'
    );
  }
}

function createLanguageService(logger: Logger, tokenService: TokenService): Promise<LanguageFilesService> {
  const config = getConfig();
  return tokenService.readToken().then((token) => {
    const translator = new TranslationService(config, logger, token);
    return new LanguageFilesService(config, translator, logger);
  });
}

async function runGuarded(logger: Logger, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Command failed: ${message}`, error);
    logger.show(false);
    void vscode.window.showErrorMessage(`Language Sync failed: ${message}`);
  }
}
