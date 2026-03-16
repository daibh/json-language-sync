import * as fs from 'fs/promises';
import type { Dirent } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { getConfig } from '../utils/config';

const UTF8_BOM = '\uFEFF';
const PREVIEW_LIMIT = 80;

type FilePreviewNode = LanguageFileNode | LanguageEntryNode | EmptyNode;

class LanguageFileNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly fileName: string,
    public readonly itemCount: number
  ) {
    super(fileName, vscode.TreeItemCollapsibleState.Collapsed);
    this.description = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
    this.tooltip = filePath;
    this.resourceUri = vscode.Uri.file(filePath);
    this.contextValue = 'languageSyncFile';
    this.command = {
      command: 'vscode.open',
      title: 'Open Language File',
      arguments: [vscode.Uri.file(filePath)],
    };
  }
}

class LanguageEntryNode extends vscode.TreeItem {
  constructor(
    public readonly filePath: string,
    public readonly labelText: string,
    public readonly previewText: string
  ) {
    super(labelText, vscode.TreeItemCollapsibleState.None);
    this.description = previewText;
    this.tooltip = previewText ? `${labelText}\n${previewText}` : labelText;
    this.contextValue = 'languageSyncFileEntry';
    this.command = {
      command: 'vscode.open',
      title: 'Open Language File',
      arguments: [vscode.Uri.file(filePath)],
    };
  }
}

class EmptyNode extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'languageSyncEmptyState';
  }
}

export class LanguageFilesViewProvider implements vscode.TreeDataProvider<FilePreviewNode> {
  private readonly emitter = new vscode.EventEmitter<FilePreviewNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private fileEntries = new Map<string, Array<Record<string, unknown>>>();

  async refresh(): Promise<void> {
    try {
      this.fileEntries = await this.loadFiles();
    } catch {
      this.fileEntries = new Map();
    }

    this.emitter.fire(undefined);
  }

  getTreeItem(element: FilePreviewNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FilePreviewNode): Thenable<FilePreviewNode[]> {
    if (!element) {
      if (this.fileEntries.size === 0) {
        return Promise.resolve([new EmptyNode('No language files found')]);
      }

      return Promise.resolve(
        Array.from(this.fileEntries.entries())
          .sort(([leftPath], [rightPath]) => path.basename(leftPath).localeCompare(path.basename(rightPath)))
          .map(([filePath, items]) => new LanguageFileNode(filePath, path.basename(filePath), items.length))
      );
    }

    if (element instanceof LanguageFileNode) {
      const items = this.fileEntries.get(element.filePath) ?? [];
      if (items.length === 0) {
        return Promise.resolve([new EmptyNode('No items in file')]);
      }

      const config = getConfig();
      return Promise.resolve(
        items.map((item) => {
          const keyValue = String(item[config.keyField] ?? '').trim() || '(missing key)';
          const previewValue = this.buildPreview(item, config.translatableFields);
          return new LanguageEntryNode(element.filePath, keyValue, previewValue);
        })
      );
    }

    return Promise.resolve([]);
  }

  private async loadFiles(): Promise<Map<string, Array<Record<string, unknown>>>> {
    const config = getConfig();
    const folderPath = path.join(config.workspaceRoot, config.languagesFolder);
    const result = new Map<string, Array<Record<string, unknown>>>();

    let entries: Dirent[];
    try {
      entries = await fs.readdir(folderPath, { withFileTypes: true });
    } catch {
      return result;
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.json')) {
        continue;
      }

      const filePath = path.join(folderPath, entry.name);
      const raw = await fs.readFile(filePath, 'utf8');
      const text = raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;

      try {
        const parsed = JSON.parse(text) as unknown;
        result.set(filePath, Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : []);
      } catch {
        result.set(filePath, []);
      }
    }

    return result;
  }

  private buildPreview(item: Record<string, unknown>, fields: string[]): string {
    const combined = fields
      .map((field) => String(item[field] ?? '').trim())
      .filter((value) => value.length > 0)
      .join(' | ');

    if (combined.length <= PREVIEW_LIMIT) {
      return combined;
    }

    return `${combined.slice(0, PREVIEW_LIMIT - 3)}...`;
  }
}