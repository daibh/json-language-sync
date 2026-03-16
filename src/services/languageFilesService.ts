import * as fs from 'fs/promises';
import * as path from 'path';
import type { LanguageItem, LanguageSyncConfig, SyncStats } from '../models';
import { Logger } from '../utils/logger';
import { TranslationService } from './translationService';

const UTF8_BOM = '\uFEFF';

interface FieldTranslationTask {
  sourceText: string;
  apply: (translatedText: string) => void;
}

export class LanguageFilesService {
  constructor(
    private readonly config: LanguageSyncConfig,
    private readonly translator: TranslationService,
    private readonly logger: Logger
  ) {}

  async removeUtf8BomAll(): Promise<number> {
    const files = await this.listLanguageFiles();
    let updated = 0;

    for (const filePath of files) {
      const raw = await fs.readFile(filePath, 'utf8');
      if (raw.startsWith(UTF8_BOM)) {
        await fs.writeFile(filePath, raw.slice(1), 'utf8');
        updated += 1;
        this.logger.info(`Removed UTF-8 BOM: ${filePath}`);
      }
    }

    return updated;
  }

  async syncMissingToDefault(): Promise<SyncStats> {
    await this.resolveDefaultSourceFile();
    const defaultItems = await this.loadDefaultItemsUnion();
    const defaultMap = this.toMap(defaultItems);

    const files = await this.listLanguageFiles();
    let added = 0;
    let filesProcessed = 0;

    // Collect missing items from other language files
    for (const filePath of files) {
      if (this.isDefaultFile(filePath)) {
        continue;
      }

      const items = await this.readLanguageArray(filePath);
      for (const item of items) {
        const key = this.getItemKey(item);
        if (!defaultMap.has(key)) {
          // Add missing item to defaultMap
          defaultMap.set(key, this.applyTemplate(item));
          added += 1;
        }
      }
      filesProcessed += 1;
    }

    // Preserve current default ordering, append only newly discovered keys.
    const existingKeys = new Set(defaultItems.map((item) => this.getItemKey(item)));
    const newKeys = Array.from(defaultMap.keys()).filter((key) => !existingKeys.has(key));
    const mergedDefault = [
      ...defaultItems,
      ...newKeys
        .map((key) => defaultMap.get(key))
        .filter((item): item is LanguageItem => item !== undefined),
    ];

    await this.syncDefaultFiles(mergedDefault);

    return {
      filesProcessed,
      itemsAdded: added,
      itemsTranslated: 0,
    };
  }

  async syncMissingAndTranslate(): Promise<SyncStats> {
    await this.resolveDefaultSourceFile();
    const defaultItems = await this.loadDefaultItemsUnion();
    const defaultMap = this.toMap(defaultItems);
    const files = await this.listLanguageFiles();

    let filesProcessed = 0;
    let itemsAdded = 0;
    let itemsTranslated = 0;

    for (const filePath of files) {
      if (this.isDefaultFile(filePath)) {
        continue;
      }

      const languageCode = path.basename(filePath, '.json');
      const targetItems = await this.readLanguageArray(filePath);
      const targetMap = this.toMap(targetItems);
      const translatedItemKeys = new Set<string>();

      const missing = Array.from(defaultMap.values()).filter((item) => {
        const key = this.getItemKey(item);
        return !targetMap.has(key);
      });

      const translatedMissing = await this.translateMissingItems(missing, languageCode);
      for (const item of translatedMissing) {
        const key = this.getItemKey(item);
        targetMap.set(key, item);
        translatedItemKeys.add(key);
      }

      const updatedExistingKeys = await this.fillMissingTranslatedFields(
        defaultMap,
        targetMap,
        languageCode
      );
      for (const key of updatedExistingKeys) {
        translatedItemKeys.add(key);
      }

      await this.writeLanguageArray(
        filePath,
        Array.from(targetMap.values()),
        this.config.sortOnSave
      );

      filesProcessed += 1;
      itemsAdded += translatedMissing.length;
      itemsTranslated += translatedItemKeys.size;
      this.logger.info(
        `Synchronized ${translatedMissing.length} new items and updated ${updatedExistingKeys.size} existing items in ${languageCode}.json`
      );
    }

    await this.syncDefaultFiles(defaultItems);

    return {
      filesProcessed,
      itemsAdded,
      itemsTranslated,
    };
  }

  async listLanguageFiles(): Promise<string[]> {
    const folder = this.getLanguagesFolderPath();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(folder, entry.name));
  }

  getLanguagesFolderPath(): string {
    return path.join(this.config.workspaceRoot, this.config.languagesFolder);
  }

  getDefaultLanguageFilePath(): string {
    return path.join(this.getLanguagesFolderPath(), `${this.config.defaultLanguageCode}.json`);
  }

  getDefaultAliasFilePath(): string {
    return path.join(this.getLanguagesFolderPath(), this.config.defaultAliasFile);
  }

  async readLanguageArray(filePath: string): Promise<LanguageItem[]> {
    const raw = await fs.readFile(filePath, 'utf8');
    const text = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
    const parsed = JSON.parse(text) as unknown;

    if (!Array.isArray(parsed)) {
      throw new Error(`Expected language file to contain JSON array: ${filePath}`);
    }

    return parsed.map((entry) => this.applyTemplate(entry as LanguageItem));
  }

  async writeLanguageArray(filePath: string, items: LanguageItem[], sort: boolean): Promise<void> {
    const finalItems = sort ? this.sortByKey(items) : items;
    const content = `${JSON.stringify(finalItems, null, 2)}\n`;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
  }

  mergeWithRemoteOrdering(remoteItems: LanguageItem[], localItems: LanguageItem[]): LanguageItem[] {
    const localMap = this.toMap(localItems);
    const remoteMap = this.toMap(remoteItems);

    const merged: LanguageItem[] = [];

    for (const remoteItem of remoteItems) {
      const key = this.getItemKey(remoteItem);
      const localItem = localMap.get(key);
      if (localItem) {
        merged.push(localItem);
      }
    }

    for (const localItem of localItems) {
      const key = this.getItemKey(localItem);
      if (!remoteMap.has(key)) {
        merged.push(localItem);
      }
    }

    return merged;
  }

  private async resolveDefaultSourceFile(): Promise<string> {
    const codeFile = this.getDefaultLanguageFilePath();
    const aliasFile = this.getDefaultAliasFilePath();

    if (await this.exists(codeFile)) {
      return codeFile;
    }

    if (await this.exists(aliasFile)) {
      const aliasItems = await this.readLanguageArray(aliasFile);
      await this.writeLanguageArray(codeFile, aliasItems, this.config.sortOnSave);
      this.logger.info(`Created missing default language file from alias: ${codeFile}`);
      return codeFile;
    }

    await this.writeLanguageArray(codeFile, [], this.config.sortOnSave);
    await this.writeLanguageArray(aliasFile, [], this.config.sortOnSave);
    this.logger.info('Created empty default language files.');
    return codeFile;
  }

  private async syncDefaultAlias(defaultItems: LanguageItem[]): Promise<void> {
    const aliasFile = this.getDefaultAliasFilePath();
    const normalizedAlias = path.normalize(aliasFile);
    const defaultCodeFile = path.normalize(this.getDefaultLanguageFilePath());

    if (normalizedAlias === defaultCodeFile) {
      return;
    }

    await this.writeLanguageArray(aliasFile, defaultItems, this.config.sortOnSave);
    this.logger.info(`Synchronized default alias file: ${this.config.defaultAliasFile}`);
  }

  private async syncDefaultFiles(defaultItems: LanguageItem[]): Promise<void> {
    const defaultCodeFile = this.getDefaultLanguageFilePath();
    await this.writeLanguageArray(defaultCodeFile, defaultItems, this.config.sortOnSave);
    await this.syncDefaultAlias(defaultItems);
  }

  private async loadDefaultItemsUnion(): Promise<LanguageItem[]> {
    const codeFile = this.getDefaultLanguageFilePath();
    const aliasFile = this.getDefaultAliasFilePath();
    const aliasIsSame = path.normalize(aliasFile) === path.normalize(codeFile);

    const hasCode = await this.exists(codeFile);
    const hasAlias = await this.exists(aliasFile);

    const primaryItems = hasAlias
      ? await this.readLanguageArray(aliasFile)
      : hasCode
      ? await this.readLanguageArray(codeFile)
      : [];

    const merged: LanguageItem[] = [...primaryItems];
    const seen = new Set(primaryItems.map((item) => this.getItemKey(item)));

    if (hasCode && !aliasIsSame) {
      const codeItems = await this.readLanguageArray(codeFile);
      for (const item of codeItems) {
        const key = this.getItemKey(item);
        if (!seen.has(key)) {
          merged.push(item);
          seen.add(key);
        }
      }
    }

    if (hasAlias && !aliasIsSame) {
      const aliasItems = await this.readLanguageArray(aliasFile);
      for (const item of aliasItems) {
        const key = this.getItemKey(item);
        if (!seen.has(key)) {
          merged.push(item);
          seen.add(key);
        }
      }
    }

    return merged;
  }

  private async translateMissingItems(
    missingItems: LanguageItem[],
    targetLanguage: string
  ): Promise<LanguageItem[]> {
    const translatedItems = missingItems.map((item) => ({ ...item }));
    const tasks: FieldTranslationTask[] = [];

    for (let index = 0; index < missingItems.length; index += 1) {
      const defaultItem = missingItems[index];
      const translatedItem = translatedItems[index];

      for (const field of this.config.translatableFields) {
        const sourceText = String(defaultItem[field] ?? '');
        if (!sourceText.trim()) {
          continue;
        }

        tasks.push({
          sourceText,
          apply: (translatedText: string) => {
            translatedItem[field] = translatedText;
          },
        });
      }
    }

    await this.translateFieldTasks(tasks, targetLanguage);
    return translatedItems;
  }

  private async fillMissingTranslatedFields(
    defaultMap: Map<string, LanguageItem>,
    targetMap: Map<string, LanguageItem>,
    targetLanguage: string
  ): Promise<Set<string>> {
    const tasks: FieldTranslationTask[] = [];
    const translatedKeys = new Set<string>();

    for (const [key, targetItem] of targetMap.entries()) {
      const defaultItem = defaultMap.get(key);
      if (!defaultItem) {
        continue;
      }

      for (const field of this.config.translatableFields) {
        const sourceText = String(defaultItem[field] ?? '').trim();
        if (!sourceText) {
          continue;
        }

        const targetText = String(targetItem[field] ?? '').trim();
        if (targetText) {
          continue;
        }

        tasks.push({
          sourceText,
          apply: (translatedText: string) => {
            targetItem[field] = translatedText;
            translatedKeys.add(key);
          },
        });
      }
    }

    await this.translateFieldTasks(tasks, targetLanguage);
    return translatedKeys;
  }

  private async translateFieldTasks(tasks: FieldTranslationTask[], targetLanguage: string): Promise<void> {
    if (tasks.length === 0) {
      return;
    }

    const chunks = this.chunk(tasks, this.config.translationBatchItems);
    const workers = chunks.map((taskChunk) => async () => {
      const sourceTexts = taskChunk.map((task) => task.sourceText);
      const translatedTexts = await this.translator.translateTexts(
        sourceTexts,
        this.config.defaultLanguageCode,
        targetLanguage
      );

      for (let index = 0; index < taskChunk.length; index += 1) {
        taskChunk[index].apply(translatedTexts[index] ?? taskChunk[index].sourceText);
      }
    });

    await this.runWithConcurrency(workers, this.config.maxParallel);
  }

  private async runWithConcurrency<T>(
    tasks: Array<() => Promise<T>>,
    maxParallel: number
  ): Promise<T[]> {
    const results: T[] = [];
    let index = 0;

    const runWorker = async (): Promise<void> => {
      while (index < tasks.length) {
        const current = index;
        index += 1;
        const value = await tasks[current]();
        results[current] = value;
      }
    };

    const workerCount = Math.min(maxParallel, tasks.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      result.push(items.slice(i, i + size));
    }
    return result;
  }

  private isDefaultFile(filePath: string): boolean {
    const fileName = path.basename(filePath).toLowerCase();
    return (
      fileName === `${this.config.defaultLanguageCode.toLowerCase()}.json` ||
      fileName === this.config.defaultAliasFile.toLowerCase()
    );
  }

  private getItemKey(item: LanguageItem): string {
    const value = item[this.config.keyField];
    const key = String(value ?? '').trim();
    if (!key) {
      throw new Error(`Item is missing key field '${this.config.keyField}'.`);
    }

    return key;
  }

  private sortByKey(items: LanguageItem[]): LanguageItem[] {
    return [...items].sort((a, b) =>
      this.getItemKey(a).localeCompare(this.getItemKey(b), undefined, {
        sensitivity: 'base',
        numeric: true,
      })
    );
  }

  private toMap(items: LanguageItem[]): Map<string, LanguageItem> {
    const map = new Map<string, LanguageItem>();
    for (const item of items) {
      const key = this.getItemKey(item);
      map.set(key, this.applyTemplate(item));
    }
    return map;
  }

  private applyTemplate(item: LanguageItem): LanguageItem {
    const normalized = { ...this.config.itemTemplate, ...item };
    const keyValue = normalized[this.config.keyField];
    if (typeof keyValue !== 'string') {
      normalized[this.config.keyField] = String(keyValue ?? '');
    }
    return normalized;
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
