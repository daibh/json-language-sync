import * as vscode from 'vscode';

export class Logger {
  constructor(private readonly output: vscode.LogOutputChannel) {}

  info(message: string): void {
    this.output.info(message);
  }

  warn(message: string): void {
    this.output.warn(message);
  }

  error(message: string, error?: unknown): void {
    const detail = error instanceof Error ? `\n${error.stack ?? error.message}` : '';
    this.output.error(`${message}${detail}`);
  }

  show(preserveFocus = true): void {
    this.output.show(preserveFocus);
  }
}
