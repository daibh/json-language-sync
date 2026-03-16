import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from '../utils/config';
import { Logger } from '../utils/logger';

export class ValidationService implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('languageSync');

  constructor(private readonly logger: Logger) {}

  async refresh(): Promise<void> {
    this.diagnostics.clear();

    const workspace = vscode.workspace.workspaceFolders?.[0];
    if (!workspace) {
      return;
    }

    const config = getConfig();
    const pattern = new vscode.RelativePattern(
      workspace,
      `${config.languagesFolder.replace(/\\/g, '/')}/**/*.json`
    );
    const files = await vscode.workspace.findFiles(pattern);

    await Promise.all(files.map((uri) => this.validateFile(uri, config.keyField)));
    this.logger.info(`Validation completed for ${files.length} language file(s).`);
  }

  dispose(): void {
    this.diagnostics.dispose();
  }

  private async validateFile(uri: vscode.Uri, keyField: string): Promise<void> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '');
      const parsed = JSON.parse(text) as unknown;

      if (!Array.isArray(parsed)) {
        this.setDiagnostics(uri, [
          this.errorDiagnostic('Language file must be a JSON array of items.'),
        ]);
        return;
      }

      const diagnostics: vscode.Diagnostic[] = [];
      const seen = new Set<string>();

      parsed.forEach((item, index) => {
        if (!item || typeof item !== 'object') {
          diagnostics.push(
            this.errorDiagnostic(`Item at index ${index} must be a JSON object.`)
          );
          return;
        }

        const keyValue = (item as Record<string, unknown>)[keyField];
        const key = String(keyValue ?? '').trim();
        if (!key) {
          diagnostics.push(
            this.errorDiagnostic(`Item at index ${index} is missing key field '${keyField}'.`)
          );
          return;
        }

        if (seen.has(key)) {
          diagnostics.push(
            this.errorDiagnostic(`Duplicate key '${key}' found at index ${index}.`)
          );
          return;
        }

        seen.add(key);
      });

      this.setDiagnostics(uri, diagnostics);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.setDiagnostics(uri, [this.errorDiagnostic(`Invalid JSON: ${message}`)]);
      this.logger.warn(`Validation failed for ${path.basename(uri.fsPath)}: ${message}`);
    }
  }

  private setDiagnostics(uri: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
    this.diagnostics.set(uri, diagnostics);
  }

  private errorDiagnostic(message: string): vscode.Diagnostic {
    return new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, 1),
      message,
      vscode.DiagnosticSeverity.Error
    );
  }
}
