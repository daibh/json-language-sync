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

export class ActionViewProvider implements vscode.TreeDataProvider<ActionNode> {
  private readonly emitter = new vscode.EventEmitter<ActionNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  private readonly nodes = [
    new ActionNode('Open Settings', 'languageSync.openSettings'),
    new ActionNode('Remove UTF-8 BOM', 'languageSync.removeUtf8Bom'),
    new ActionNode('Sync Missing To Default', 'languageSync.syncMissingToDefault'),
    new ActionNode('Sync Missing And Translate', 'languageSync.syncMissingAndTranslate'),
    new ActionNode('Merge From Remote Branch', 'languageSync.mergeFromRemoteBranch'),
    new ActionNode('Validate Language Files', 'languageSync.validateFiles'),
  ];

  getTreeItem(element: ActionNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ActionNode): ActionNode[] {
    if (element) {
      return [];
    }

    return this.nodes;
  }

  refresh(): void {
    this.emitter.fire(undefined);
  }
}
