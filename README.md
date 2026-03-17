# JSON Language Sync

VS Code extension to synchronize and translate JSON language files.

## Main capabilities

- Configurable language folder in workspace (example: assets/languages).
- Configurable default language code (default: en-US).
- Configurable default alias file (default.json).
- Optional language item structure template (JSON object).
- Configurable unique key field for item identity.
- Configurable translatable field list separated by |.
- Translation provider selection: AI endpoint or GitHub Copilot Chat.
- AI settings: endpoint and model.
- Secure token setup command with encrypted Windows user-scope storage.
- GitHub Copilot Chat provider: delegates translation to the installed Copilot extension, no separate token required. Configurable model family.
- Git-based GitLab integration aligned with skills-sync-extension behavior.
- UTF-8 BOM cleanup command for all language files.
- Sync missing items from localized files back to default file.
- Sync missing items from default file to localized files with translation.
- Fill missing translatable fields on existing localized items when default fields have source text.
- Optional sort on save.
- Chunked and parallel translation processing.
- Configurable number of translation items per batch request.
- Remote branch merge workflow using temporary git worktree to reduce conflicts.
- Built-in diagnostics for invalid file structure, missing keys, and duplicate keys.
- Auto-deduplication on validate: keeps the first instance of each duplicate key and removes the rest.
- Dedicated output log channel named Language Sync.
- Activity bar files view for previewing language files and translated values.

## Expected language files

- Files are JSON arrays of language items.
- Example filenames: default.json, en-US.json, en-GB.json, fr-FR.json, de-DE.json, ja-JP.json.
- The configured key field must be unique in each file.

## Commands

- Language Sync: Open Settings
- Language Sync: Remove UTF-8 BOM
- Language Sync: Sync Missing Items To Default
- Language Sync: Sync Missing Items And Translate
- Language Sync: Pull/Rebase/Merge Languages From Remote Branch
- Language Sync: Validate Language Files
- Language Sync: Configure AI Access Token
- Language Sync: Refresh Files View

## Sidebar buttons

Open the Language Sync activity bar icon, then use the Actions view buttons to run all commands quickly.

The Files view in the same activity bar shows each language file and its items so you can preview results without leaving the extension panel.
Validate Language Files is always accessible regardless of translation provider state.
When AI provider is selected and token is not ready, translation-dependent actions (Sync Missing And Translate) are disabled until Configure AI Access Token is completed.

## Remote merge workflow

The merge command fetches remotes, creates a temporary git worktree for the selected remote branch, compares remote and local language files, then writes merged results to local files using this rule:

1. Preserve remote item ordering.
2. Override content with local changes for matching keys.
3. Keep local-only new keys.
4. Keep local deletions (keys removed locally stay removed).

For this action, sort-on-save is intentionally ignored to preserve remote ordering.

## GitLab configuration

This extension now uses the same git-based mechanism as skills-sync-extension for remote operations:

- It uses the current workspace git repository.
- It detects the GitLab project from the `origin` remote in the workspace.
- It relies on git credentials already configured on the machine, such as SSH keys or the OS credential manager.
- languageSync.gitlab.allowInsecure applies to git operations.

Relevant settings:

- languageSync.gitlab.allowInsecure

## Validation

Validation diagnostics are produced in Problems for:

- Non-array language file content
- Missing key field values
- Duplicate key values
- Invalid JSON

Validation runs on save, on configuration changes, and when running Validate Language Files.

When Validate Language Files is run explicitly, duplicate key items are automatically removed from all language files (first occurrence kept) before diagnostics are collected. The information message reports how many duplicates were removed and from how many files.

## Build and test

- npm install
- npm run compile
- npm test

## AI endpoint notes

- For OpenAI, `languageSync.ai.endpoint` may be either `https://api.openai.com/v1` or `https://api.openai.com/v1/chat/completions`.
- If the base OpenAI URL is provided, the extension automatically routes requests to the chat completions endpoint.

## AI token notes

- The extension stores the AI token using the fixed environment variable `EXT_LANG_AI_TOKEN`.
- On Windows, the token is encrypted using DPAPI (CurrentUser scope) before being written to User environment variables.
- On startup, token readiness is validated and translation-protected actions are enabled only when a valid token can be decrypted/read.
