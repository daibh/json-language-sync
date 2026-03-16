import * as vscode from 'vscode';

class ActionNode extends vscode.TreeItem {
  constructor(label: string, commandId: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'languageSyncAction';
    this.description = description;
    this.command = {
      command: commandId,
      title: label,
    };
  }
}

/** Non-clickable disabled action shown when prerequisites are not met. */
class DisabledActionNode extends vscode.TreeItem {
  constructor(label: string, reason: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'languageSyncActionDisabled';
    this.description = reason;
    this.iconPath = new vscode.ThemeIcon('circle-slash');
  }
}

/** Non-clickable status indicator shown in the Actions panel. */
class StatusNode extends vscode.TreeItem {
  constructor(label: string, detail: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'languageSyncStatus';
    this.description = detail;
    this.iconPath = new vscode.ThemeIcon(
      'warning',
      new vscode.ThemeColor('problemsWarningIcon.foreground')
    );
  }
}

export class ActionViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  /**
   * Set to `true` once translation is ready (AI token configured, or MCP provider in use).
   * Changing this value refreshes the tree.
   */
  private translationReady = false;

  setTranslationReady(ready: boolean): void {
    this.translationReady = ready;
    this.emitter.fire(undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element) {
      return [];
    }

    const nodes: vscode.TreeItem[] = [
      new ActionNode('Open Settings', 'languageSync.openSettings'),
      new ActionNode('Remove UTF-8 BOM', 'languageSync.removeUtf8Bom'),
    ];

    if (this.translationReady) {
      nodes.push(new ActionNode('Sync Missing To Default', 'languageSync.syncMissingToDefault'));
    } else {
      nodes.push(new DisabledActionNode('Sync Missing To Default', 'Requires valid AI token'));
    }

    if (!this.translationReady) {
      nodes.push(
        new StatusNode('AI Token Required', 'Configure before translating'),
        new ActionNode('Configure AI Token', 'languageSync.configureAiToken')
      );
    } else {
      nodes.push(new ActionNode('Sync Missing And Translate', 'languageSync.syncMissingAndTranslate'));
    }

    nodes.push(
      new ActionNode('Merge From Remote Branch', 'languageSync.mergeFromRemoteBranch'),
    );

    if (this.translationReady) {
      nodes.push(new ActionNode('Validate Language Files', 'languageSync.validateFiles'));
    } else {
      nodes.push(new DisabledActionNode('Validate Language Files', 'Requires valid AI token'));
    }

    return nodes;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }
}
