import * as path from 'path';
import * as vscode from 'vscode';
import type { LanguageSyncConfig } from '../models';

export function getConfig(): LanguageSyncConfig {
  const workspace = vscode.workspace.workspaceFolders?.[0];
  if (!workspace) {
    throw new Error('Open a workspace folder before using Language Sync commands.');
  }

  const cfg = vscode.workspace.getConfiguration('languageSync');
  const translatableFieldsRaw = cfg.get<string>('translatableFields', 'text');

  return {
    workspaceRoot: workspace.uri.fsPath,
    languagesFolder: path.normalize(cfg.get<string>('languagesFolder', 'assets/languages')),
    defaultLanguageCode: cfg.get<string>('defaultLanguageCode', 'en-US').trim() || 'en-US',
    defaultAliasFile: cfg.get<string>('defaultAliasFile', 'default.json').trim() || 'default.json',
    itemTemplate: cfg.get<Record<string, unknown>>('itemTemplate', {}),
    keyField: cfg.get<string>('keyField', 'key').trim() || 'key',
    translatableFields: translatableFieldsRaw
      .split('|')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
    sortOnSave: cfg.get<boolean>('sortOnSave', true),
    chunkSize: Math.max(1, cfg.get<number>('processing.chunkSize', 25)),
    maxParallel: Math.max(1, cfg.get<number>('processing.maxParallel', 4)),
    translationBatchItems: Math.max(
      1,
      cfg.get<number>('processing.translationBatchItems', cfg.get<number>('processing.chunkSize', 25))
    ),
    translationProvider: cfg.get<'ai' | 'mcp'>('translation.provider', 'ai'),
    aiEndpoint: cfg.get<string>('ai.endpoint', '').trim(),
    aiTokenEnvVar: cfg.get<string>('ai.accessTokenEnvVar', 'AI_ACCESS_TOKEN').trim() || 'AI_ACCESS_TOKEN',
    aiModel: cfg.get<string>('ai.model', 'gpt-4.1-mini').trim() || 'gpt-4.1-mini',
    mcpCommand: cfg.get<string>('mcp.command', '').trim(),
    mcpArgs: cfg.get<string[]>('mcp.args', []),
    gitlabAllowInsecure: cfg.get<boolean>('gitlab.allowInsecure', false),
  };
}
