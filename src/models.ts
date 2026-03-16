export type TranslationProvider = 'ai' | 'mcp';

export interface LanguageSyncConfig {
  workspaceRoot: string;
  languagesFolder: string;
  defaultLanguageCode: string;
  defaultAliasFile: string;
  itemTemplate: Record<string, unknown>;
  keyField: string;
  translatableFields: string[];
  sortOnSave: boolean;
  chunkSize: number;
  maxParallel: number;
  translationBatchItems: number;
  translationProvider: TranslationProvider;
  aiEndpoint: string;
  aiTokenEnvVar: string;
  aiModel: string;
  mcpCommand: string;
  mcpArgs: string[];
  gitlabAllowInsecure: boolean;
}

export interface LanguageItem {
  [field: string]: unknown;
}

export interface SyncStats {
  filesProcessed: number;
  itemsAdded: number;
  itemsTranslated: number;
}
