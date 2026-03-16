import { execFile } from 'child_process';
import { promisify } from 'util';
import type { LanguageSyncConfig } from '../models';
import { Logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

interface Translator {
  translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string>;
  translateTexts(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
}

class AiTranslator implements Translator {
  constructor(
    private readonly config: LanguageSyncConfig,
    private readonly logger: Logger,
    private readonly token: string | undefined
  ) {}

  async translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
    const [translated] = await this.translateTexts([text], sourceLanguage, targetLanguage);
    return translated;
  }

  async translateTexts(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string[]> {
    if (texts.length === 0) {
      return [];
    }

    const normalizedTexts = texts.map((text) => String(text ?? ''));
    if (sourceLanguage === targetLanguage) {
      return normalizedTexts;
    }

    const hasNonEmptyText = normalizedTexts.some((text) => text.trim().length > 0);
    if (!hasNonEmptyText) {
      return normalizedTexts;
    }

    if (normalizedTexts.length === 1) {
      return [await this.translateSingleText(normalizedTexts[0], sourceLanguage, targetLanguage)];
    }

    return this.translateBatchTexts(normalizedTexts, sourceLanguage, targetLanguage);
  }

  private async translateSingleText(
    content: string,
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string> {
    const normalizedContent = String(content ?? '');
    if (!normalizedContent.trim() || sourceLanguage === targetLanguage) {
      return normalizedContent;
    }

    if (!this.config.aiEndpoint) {
      throw new Error('Missing configuration: languageSync.ai.endpoint');
    }

    if (!this.token) {
      throw new Error(
        'AI access token is not configured. Use the "Language Sync: Configure AI Token" command to set it up.'
      );
    }

    const token = this.token;
    const endpoint = this.resolveAiEndpoint();

    const payload = await this.requestAiCompletion(endpoint, token, [
      {
        role: 'system',
        content: 'You are a translation engine. Return only translated text with no explanations or markdown.',
      },
      {
        role: 'user',
        content: `Translate from ${sourceLanguage} to ${targetLanguage}: ${normalizedContent}`,
      },
    ]);

    const translated =
      payload.choices?.[0]?.message?.content?.trim() ??
      payload.translation?.trim() ??
      payload.text?.trim();

    if (!translated) {
      this.logger.warn('AI response did not include a translated string. Returning source content.');
      return normalizedContent;
    }

    return translated;
  }

  private async translateBatchTexts(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string[]> {
    if (!this.config.aiEndpoint) {
      throw new Error('Missing configuration: languageSync.ai.endpoint');
    }

    if (!this.token) {
      throw new Error(
        'AI access token is not configured. Use the "Language Sync: Configure AI Token" command to set it up.'
      );
    }

    const token = this.token;
    const endpoint = this.resolveAiEndpoint();
    const indexedTexts = texts.map((text, index) => ({ index, text }));
    const payload = await this.requestAiCompletion(endpoint, token, [
      {
        role: 'system',
        content:
          'You are a translation engine. Translate all items and return strict JSON only. ' +
          'No markdown, no commentary.',
      },
      {
        role: 'user',
        content:
          `Translate each item from ${sourceLanguage} to ${targetLanguage}. ` +
          'Return JSON in this exact shape: ' +
          '{"translations":[{"index":0,"text":"..."}]}. ' +
          'Keep item count and indexes unchanged.\n' +
          JSON.stringify(indexedTexts),
      },
    ]);

    const rawText =
      payload.choices?.[0]?.message?.content?.trim() ?? payload.translation?.trim() ?? payload.text?.trim() ?? '';

    const parsed = this.parseBatchTranslationResponse(rawText, texts.length);
    if (parsed) {
      return parsed;
    }

    this.logger.warn('Batch translation response parsing failed. Falling back to per-item translation.');
    const fallbackResults: string[] = [];
    for (const text of texts) {
      fallbackResults.push(await this.translateSingleText(text, sourceLanguage, targetLanguage));
    }
    return fallbackResults;
  }

  private async requestAiCompletion(
    endpoint: string,
    token: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>
  ): Promise<{
    choices?: Array<{ message?: { content?: string } }>;
    text?: string;
    translation?: string;
  }> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: this.config.aiModel,
        temperature: 0,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(
        `AI translation failed: ${response.status} ${response.statusText} (${endpoint}) - ${errorBody}`
      );
    }

    return (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      text?: string;
      translation?: string;
    };
  }

  private parseBatchTranslationResponse(rawText: string, expectedCount: number): string[] | undefined {
    if (!rawText) {
      return undefined;
    }

    const cleaned = rawText
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      const entries = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as { translations?: unknown }).translations)
        ? (parsed as { translations: unknown[] }).translations
        : undefined;

      if (!entries || entries.length !== expectedCount) {
        return undefined;
      }

      const output: Array<string | undefined> = new Array(expectedCount);
      for (const entry of entries) {
        const item = entry as { index?: number; text?: unknown; translation?: unknown };
        const index = item.index;
        if (typeof index !== 'number' || index < 0 || index >= expectedCount) {
          return undefined;
        }

        const value =
          typeof item.text === 'string'
            ? item.text
            : typeof item.translation === 'string'
            ? item.translation
            : '';

        output[index] = value;
      }

      if (output.some((value) => value === undefined)) {
        return undefined;
      }

      return output.map((value) => value ?? '');
    } catch {
      return undefined;
    }
  }

  private resolveAiEndpoint(): string {
    const rawEndpoint = this.config.aiEndpoint.trim();

    try {
      const parsed = new URL(rawEndpoint);
      const normalizedPath = parsed.pathname.replace(/\/+$/, '');

      if (
        parsed.hostname === 'api.openai.com' &&
        (normalizedPath === '' || normalizedPath === '/' || normalizedPath === '/v1')
      ) {
        parsed.pathname = '/v1/chat/completions';
        const normalized = parsed.toString();
        this.logger.info(`Normalized OpenAI endpoint to ${normalized}.`);
        return normalized;
      }

      return parsed.toString();
    } catch {
      throw new Error(
        'Invalid configuration: languageSync.ai.endpoint must be a valid URL. ' +
          'For OpenAI, use either https://api.openai.com/v1 or https://api.openai.com/v1/chat/completions.'
      );
    }
  }

}

class McpTranslator implements Translator {
  constructor(private readonly config: LanguageSyncConfig) {}

  async translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
    const content = String(text ?? '');
    if (!content.trim() || sourceLanguage === targetLanguage) {
      return content;
    }

    if (!this.config.mcpCommand) {
      throw new Error('Missing configuration: languageSync.mcp.command');
    }

    const args =
      this.config.mcpArgs.length > 0
        ? this.config.mcpArgs.map((part) =>
            part
              .split('{source}')
              .join(sourceLanguage)
              .split('{target}')
              .join(targetLanguage)
              .split('{text}')
              .join(content)
          )
        : [sourceLanguage, targetLanguage, content];

    const { stdout } = await execFileAsync(this.config.mcpCommand, args, {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024,
    });

    const translated = stdout.trim();
    return translated || content;
  }

  async translateTexts(
    texts: string[],
    sourceLanguage: string,
    targetLanguage: string
  ): Promise<string[]> {
    const results: string[] = [];
    for (const text of texts) {
      results.push(await this.translateText(text, sourceLanguage, targetLanguage));
    }
    return results;
  }
}

export class TranslationService {
  private readonly translator: Translator;

  constructor(config: LanguageSyncConfig, logger: Logger, token?: string) {
    this.translator =
      config.translationProvider === 'mcp'
        ? new McpTranslator(config)
        : new AiTranslator(config, logger, token);
  }

  translateText(text: string, sourceLanguage: string, targetLanguage: string): Promise<string> {
    return this.translator.translateText(text, sourceLanguage, targetLanguage);
  }

  translateTexts(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]> {
    return this.translator.translateTexts(texts, sourceLanguage, targetLanguage);
  }
}
