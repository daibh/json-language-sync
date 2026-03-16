import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Fixed environment variable name used to store the DPAPI-encrypted AI access token.
 * On Windows, the stored value is a Base64-encoded DPAPI blob encrypted under the current user.
 */
export const TOKEN_ENV_VAR = 'EXT_LANG_AI_TOKEN';

/**
 * Service for securely storing and retrieving the AI access token.
 *
 * On Windows the token is encrypted with DPAPI (CurrentUser scope) before
 * being persisted to the User environment variable EXT_LANG_AI_TOKEN.
 * Only the same Windows user account can decrypt the stored value.
 *
 * On non-Windows platforms the value is read from the process environment
 * as plain text (the user sets the variable themselves).
 */
export class TokenService {
  /** Returns true when a valid, decryptable token is present. */
  async isConfigured(): Promise<boolean> {
    const token = await this.readToken();
    return typeof token === 'string' && token.length > 0;
  }

  /**
   * Reads and decrypts the token.
   * Returns `undefined` when the variable is absent or cannot be decrypted.
   */
  async readToken(): Promise<string | undefined> {
    if (process.platform !== 'win32') {
      // Non-Windows: treat the env var value as plain text.
      return process.env[TOKEN_ENV_VAR]?.trim() || undefined;
    }

    const encrypted = await this.getWindowsUserEnvVar(TOKEN_ENV_VAR);
    if (!encrypted) {
      return undefined;
    }

    return this.decryptWithDpapi(encrypted);
  }

  /**
   * Encrypts `plainToken` with DPAPI and stores the result in the
   * Windows User-scope environment variable EXT_LANG_AI_TOKEN.
   *
   * @throws When called on non-Windows or when PowerShell encryption fails.
   */
  async storeToken(plainToken: string): Promise<void> {
    if (!plainToken.trim()) {
      throw new Error('Token cannot be empty.');
    }

    if (process.platform !== 'win32') {
      throw new Error(
        'Secure token storage with DPAPI is only supported on Windows. ' +
          `Set the ${TOKEN_ENV_VAR} environment variable manually on this platform.`
      );
    }

    const encrypted = await this.encryptWithDpapi(plainToken.trim());
    await this.setWindowsUserEnvVar(TOKEN_ENV_VAR, encrypted);
  }

  // -------------------------------------------------------------------------
  // Private – DPAPI helpers via PowerShell
  // -------------------------------------------------------------------------

  private async encryptWithDpapi(plainText: string): Promise<string> {
    // Encode the plain text as Base64 before embedding it in the PowerShell
    // command string to avoid any quoting or escaping issue with special chars.
    const inputBase64 = Buffer.from(plainText, 'utf8').toString('base64');

    const { stdout } = await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.Security; ` +
          `$bytes = [Convert]::FromBase64String('${inputBase64}'); ` +
          `$protected = [System.Security.Cryptography.ProtectedData]::Protect(` +
          `$bytes, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
          `[Convert]::ToBase64String($protected)`,
      ],
      { windowsHide: true }
    );

    const result = stdout.trim();
    if (!result) {
      throw new Error(
        'DPAPI encryption produced no output. ' +
          'Ensure the System.Security assembly is available on this machine.'
      );
    }

    return result;
  }

  private async decryptWithDpapi(encryptedBase64: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Add-Type -AssemblyName System.Security; ` +
            `$protected = [Convert]::FromBase64String('${encryptedBase64}'); ` +
            `$bytes = [System.Security.Cryptography.ProtectedData]::Unprotect(` +
            `$protected, $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser); ` +
            `[System.Text.Encoding]::UTF8.GetString($bytes)`,
        ],
        { windowsHide: true }
      );

      return stdout.trim() || undefined;
    } catch {
      // Decryption failure (wrong user, corrupted blob, etc.) – treat as not configured.
      return undefined;
    }
  }

  private async getWindowsUserEnvVar(name: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `[Environment]::GetEnvironmentVariable('${name.replace(/'/g, "''")}', 'User')`,
        ],
        { windowsHide: true }
      );

      return stdout.trim() || undefined;
    } catch {
      return undefined;
    }
  }

  private async setWindowsUserEnvVar(name: string, value: string): Promise<void> {
    // `value` is a Base64-encoded DPAPI blob – it contains only [A-Za-z0-9+/=]
    // so no single-quote escaping is needed for the value, but we include it for safety.
    await execFileAsync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `[Environment]::SetEnvironmentVariable(` +
          `'${name.replace(/'/g, "''")}', '${value.replace(/'/g, "''")}', 'User')`,
      ],
      { windowsHide: true }
    );
  }
}
