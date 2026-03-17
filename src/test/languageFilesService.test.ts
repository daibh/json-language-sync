import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { LanguageFilesService } from '../services/languageFilesService';
import { Logger } from '../utils/logger';
import type { LanguageSyncConfig } from '../models';

class FakeTranslator {
  public batchCalls = 0;

  async translateText(text: string, source: string, target: string): Promise<string> {
    return `[${source}->${target}] ${text}`;
  }

  async translateTexts(texts: string[], source: string, target: string): Promise<string[]> {
    this.batchCalls += 1;
    return texts.map((text) => `[${source}->${target}] ${text}`);
  }
}

function createConfig(workspaceRoot: string): LanguageSyncConfig {
  return {
    workspaceRoot,
    languagesFolder: 'assets/languages',
    defaultLanguageCode: 'en-US',
    defaultAliasFile: 'default.json',
    itemTemplate: {},
    keyField: 'key',
    translatableFields: ['text'],
    sortOnSave: true,
    chunkSize: 2,
    maxParallel: 2,
    translationBatchItems: 2,
    translationProvider: 'ai',
    aiEndpoint: '',
    aiModel: 'test-model',
    copilotModel: 'gpt-4o',
    gitlabAllowInsecure: false,
  };
}

async function readJson(filePath: string): Promise<unknown> {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

test('syncMissingToDefault adds keys from non-default files', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lang-sync-test-'));
  const languagesFolder = path.join(workspaceRoot, 'assets', 'languages');
  await fs.mkdir(languagesFolder, { recursive: true });

  await fs.writeFile(
    path.join(languagesFolder, 'en-US.json'),
    JSON.stringify([{ key: 'hello', text: 'Hello' }], null, 2)
  );
  await fs.writeFile(
    path.join(languagesFolder, 'fr-FR.json'),
    JSON.stringify([{ key: 'bye', text: 'Au revoir' }], null, 2)
  );

  const output = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
  } as unknown as import('vscode').LogOutputChannel;

  const logger = new Logger(output);
  const service = new LanguageFilesService(
    createConfig(workspaceRoot),
    new FakeTranslator() as never,
    logger
  );

  await service.syncMissingToDefault();

  const defaultJson = (await readJson(path.join(languagesFolder, 'en-US.json'))) as Array<{
    key: string;
  }>;
  assert.equal(defaultJson.length, 2);
  assert.deepEqual(
    defaultJson.map((item) => item.key).sort(),
    ['bye', 'hello']
  );

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test('mergeWithRemoteOrdering keeps remote order and local changes', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lang-sync-test-'));

  const output = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
  } as unknown as import('vscode').LogOutputChannel;

  const logger = new Logger(output);
  const service = new LanguageFilesService(
    createConfig(workspaceRoot),
    new FakeTranslator() as never,
    logger
  );

  const remote = [
    { key: 'a', text: 'A remote' },
    { key: 'b', text: 'B remote' },
    { key: 'c', text: 'C remote' },
  ];

  const local = [
    { key: 'c', text: 'C local updated' },
    { key: 'a', text: 'A local updated' },
    { key: 'x', text: 'X local new' },
  ];

  const merged = service.mergeWithRemoteOrdering(remote, local) as Array<{ key: string; text: string }>;

  assert.deepEqual(
    merged.map((item) => item.key),
    ['a', 'c', 'x']
  );
  assert.equal(merged[0].text, 'A local updated');
  assert.equal(merged[1].text, 'C local updated');
  assert.equal(merged[2].text, 'X local new');

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test('syncMissingAndTranslate preserves item shape when itemTemplate is empty', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lang-sync-test-'));
  const languagesFolder = path.join(workspaceRoot, 'assets', 'languages');
  await fs.mkdir(languagesFolder, { recursive: true });

  const customConfig: LanguageSyncConfig = {
    ...createConfig(workspaceRoot),
    defaultLanguageCode: 'default',
    defaultAliasFile: 'default.json',
    keyField: 'term',
    translatableFields: ['content', 'comments'],
    itemTemplate: {},
  };

  await fs.writeFile(
    path.join(languagesFolder, 'default.json'),
    JSON.stringify(
      [
        {
          term: 'Hello',
          content: 'A greeting',
          comments: 'Friendly welcome',
        },
      ],
      null,
      2
    )
  );

  await fs.writeFile(path.join(languagesFolder, 'fr-FR.json'), JSON.stringify([], null, 2));

  const output = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
  } as unknown as import('vscode').LogOutputChannel;

  const logger = new Logger(output);
  const service = new LanguageFilesService(customConfig, new FakeTranslator() as never, logger);

  await service.syncMissingAndTranslate();

  const frenchJson = (await readJson(path.join(languagesFolder, 'fr-FR.json'))) as Array<
    Record<string, unknown>
  >;

  assert.equal(frenchJson.length, 1);
  assert.deepEqual(Object.keys(frenchJson[0]).sort(), ['comments', 'content', 'term']);
  assert.equal(frenchJson[0].term, 'Hello');

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});

test('syncMissingAndTranslate fills missing translatable fields on existing item', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lang-sync-test-'));
  const languagesFolder = path.join(workspaceRoot, 'assets', 'languages');
  await fs.mkdir(languagesFolder, { recursive: true });

  const customConfig: LanguageSyncConfig = {
    ...createConfig(workspaceRoot),
    defaultLanguageCode: 'default',
    defaultAliasFile: 'default.json',
    keyField: 'term',
    translatableFields: ['content', 'comments'],
    itemTemplate: {},
    chunkSize: 10,
  };

  await fs.writeFile(
    path.join(languagesFolder, 'default.json'),
    JSON.stringify(
      [
        {
          term: 'Hello',
          content: 'A greeting',
          comments: 'Friendly welcome',
        },
      ],
      null,
      2
    )
  );

  await fs.writeFile(
    path.join(languagesFolder, 'fr-FR.json'),
    JSON.stringify(
      [
        {
          term: 'Hello',
          content: '',
          comments: 'Salut',
        },
      ],
      null,
      2
    )
  );

  const output = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    show: () => undefined,
  } as unknown as import('vscode').LogOutputChannel;

  const logger = new Logger(output);
  const translator = new FakeTranslator();
  const service = new LanguageFilesService(customConfig, translator as never, logger);

  const stats = await service.syncMissingAndTranslate();

  const frenchJson = (await readJson(path.join(languagesFolder, 'fr-FR.json'))) as Array<
    Record<string, unknown>
  >;

  assert.equal(stats.itemsAdded, 0);
  assert.equal(stats.itemsTranslated, 1);
  assert.equal(frenchJson.length, 1);
  assert.equal(frenchJson[0].content, '[default->fr-FR] A greeting');
  assert.equal(frenchJson[0].comments, 'Salut');
  assert.equal(translator.batchCalls, 1);

  await fs.rm(workspaceRoot, { recursive: true, force: true });
});
