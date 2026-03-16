import * as cp from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs/promises';
import { LanguageFilesService } from './languageFilesService';
import { Logger } from '../utils/logger';
import type { LanguageSyncConfig } from '../models';

function spawnGit(
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = cp.spawn('git', args, {
      cwd,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', ...env },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(stderr.trim() || `git exited with code ${code}`));
      }
    });
    proc.on('error', (err) => reject(err));
  });
}

interface RemoteInfo {
  remoteName: string;
  remoteUrl: string;
  host?: string;
  projectPath?: string;
}

export class GitMergeService {
  constructor(
    private readonly config: LanguageSyncConfig,
    private readonly workspaceRoot: string,
    private readonly languageService: LanguageFilesService,
    private readonly logger: Logger
  ) {}

  async listRemoteBranches(): Promise<string[]> {
    const remoteInfo = await this.getWorkspaceRemoteInfo();
    this.logger.info(
      `Detected workspace remote ${remoteInfo.remoteName}: ${remoteInfo.remoteUrl}`
    );
    if (remoteInfo.projectPath) {
      this.logger.info(`Resolved GitLab project from remote URL: ${remoteInfo.projectPath}`);
    }

    await this.runGit(['fetch', '--all', '--prune']);

    const output = await this.runGit(['branch', '-r', '--format=%(refname:short)']);
    const branches = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 && !line.endsWith('/HEAD') && line.startsWith(`${remoteInfo.remoteName}/`)
      );

    return [...new Set(branches)];
  }

  async mergeLanguagesFromRemoteBranch(remoteBranch: string, strategy: string): Promise<number> {
    let mergedCount = 0;
    this.logger.info(`Applying ${strategy} strategy from branch ${remoteBranch}`);

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'language-sync-'));
    const worktreePath = path.join(tempDir, 'remote-worktree');

    try {
      await this.runGit(['fetch', '--all', '--prune']);
      await this.runGit(['worktree', 'add', '--detach', worktreePath, remoteBranch]);

      const localFolder = this.languageService.getLanguagesFolderPath();
      const relativeLanguagesPath = path.relative(this.workspaceRoot, localFolder);
      const remoteLanguagesFolder = path.join(worktreePath, relativeLanguagesPath);

      const localFiles = await this.safeListJsonFiles(localFolder);
      const remoteFiles = await this.safeListJsonFiles(remoteLanguagesFolder);
      const allFileNames = [...new Set([...localFiles, ...remoteFiles])];

      for (const fileName of allFileNames) {
        const localFile = path.join(localFolder, fileName);
        const remoteFile = path.join(remoteLanguagesFolder, fileName);

        const localExists = await this.exists(localFile);
        const remoteExists = await this.exists(remoteFile);

        if (remoteExists && localExists) {
          const localItems = await this.languageService.readLanguageArray(localFile);
          const remoteItems = await this.languageService.readLanguageArray(remoteFile);
          const merged = this.languageService.mergeWithRemoteOrdering(remoteItems, localItems);
          await this.languageService.writeLanguageArray(localFile, merged, false);
          mergedCount += 1;
          this.logger.info(`Merged local changes over remote ordering: ${fileName}`);
          continue;
        }

        if (remoteExists && !localExists) {
          const remoteItems = await this.languageService.readLanguageArray(remoteFile);
          await this.languageService.writeLanguageArray(localFile, remoteItems, false);
          mergedCount += 1;
          this.logger.info(`Added missing local language file from remote: ${fileName}`);
          continue;
        }

        this.logger.info(`Remote branch does not contain file. Keeping local file unchanged: ${fileName}`);
      }

      return mergedCount;
    } finally {
      await this.tryRemoveWorktree(worktreePath);
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  private async runGit(args: string[]): Promise<string> {
    return spawnGit([...this.gitConfigArgs, ...args], this.workspaceRoot, this.gitEnv);
  }

  private async safeListJsonFiles(folderPath: string): Promise<string[]> {
    try {
      const entries = await fs.readdir(folderPath, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async tryRemoveWorktree(worktreePath: string): Promise<void> {
    try {
      await this.runGit(['worktree', 'remove', '--force', worktreePath]);
    } catch (error) {
      this.logger.warn(`Unable to remove temporary worktree: ${String(error)}`);
    }
  }

  private get gitEnv(): NodeJS.ProcessEnv {
    return {
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: 'echo',
      GCM_GITLAB_DEVHTTP_CHECK: 'false',
      ...(this.config.gitlabAllowInsecure ? { GIT_SSL_NO_VERIFY: 'true' } : {}),
    };
  }

  private get gitConfigArgs(): string[] {
    if (!this.config.gitlabAllowInsecure) {
      return [];
    }

    return ['-c', 'credential.gitlabDevHttpCheck=false', '-c', 'http.sslVerify=false'];
  }

  private async getWorkspaceRemoteInfo(): Promise<RemoteInfo> {
    const remoteName = 'origin';
    const remoteUrl = await this.runGit(['remote', 'get-url', remoteName]);
    const parsed = this.parseGitLabRemoteUrl(remoteUrl);
    return {
      remoteName,
      remoteUrl,
      host: parsed?.host,
      projectPath: parsed?.projectPath,
    };
  }

  private parseGitLabRemoteUrl(remoteUrl: string): { host: string; projectPath: string } | undefined {
    const trimmed = remoteUrl.trim();
    const sshMatch = /^ssh:\/\/git@([^/:]+)(?::\d+)?\/(.+?)\.git$/i.exec(trimmed);
    if (sshMatch) {
      return { host: sshMatch[1], projectPath: sshMatch[2] };
    }

    const scpMatch = /^git@([^:]+):(.+?)\.git$/i.exec(trimmed);
    if (scpMatch) {
      return { host: scpMatch[1], projectPath: scpMatch[2] };
    }

    try {
      const parsed = new URL(trimmed);
      return {
        host: parsed.hostname,
        projectPath: parsed.pathname.replace(/^\//, '').replace(/\.git$/i, ''),
      };
    } catch {
      return undefined;
    }
  }
}
