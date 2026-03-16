# Changelog

All notable changes to this project are documented in this file.

## 0.4.0 - 2026-03-16

### Added

- Secure AI token configuration command to capture token input from the UI.
- Windows DPAPI (CurrentUser scope) encryption for persisted AI tokens.
- Fixed token variable name EXT_LANG_AI_TOKEN for encrypted token storage.

### Changed

- Removed configurable AI token environment variable setting; token storage now uses a fixed secure variable.
- Action availability now depends on translation readiness.
- Actions panel now shows Configure AI Token when token is missing or invalid.

### Fixed

- Disabled Sync Missing To Default and Validate Language Files when AI token is invalid.
- Added runtime guards that block protected commands until token configuration is valid.

## 0.3.0 - 2026-03-16

### Added

- Files view in the Language Sync activity bar to preview language files and item values.
- Refresh Files View command and view title action.
- Configurable translation batch size via languageSync.processing.translationBatchItems.
- Batch translation support for AI provider with JSON parsing and fallback to per-item translation.
- Logic to fill missing translatable field values on existing target items when default item has source text.

### Changed

- languageSync.itemTemplate is now optional by default to preserve source file shape when no template is configured.
- Action view now shows clickable command items instead of a placeholder node.
- AI endpoint handling now normalizes OpenAI base URL to chat completions endpoint automatically.
- AI token resolution is more robust on Windows with environment lookup fallbacks.

### Fixed

- Prevented implicit insertion of key and text fields when itemTemplate is not explicitly configured.
- Improved AI endpoint error details to include resolved endpoint context.

## 0.2.1 - 2026-03-16

### Added

- Language Sync activity bar container and Actions view with command buttons.
- Validation command and diagnostics for invalid JSON, non-array files, missing key field, and duplicate keys.
- Automatic validation refresh on JSON save and languageSync configuration changes.
- Temporary worktree-based remote branch merge workflow for language files.
- Automated tests for missing-item sync and remote-order merge behavior.

### Changed

- Remote branch discovery and merge now use the same non-interactive git credential mechanism as skills-sync-extension.
- GitLab project detection now comes automatically from the current workspace remote URL instead of manual project configuration.
- GitLab settings were reduced to git-focused behavior, primarily remote selection and allowInsecure.
- Package script now emits deterministic VSIX output filename.

### Notes

- For remote language merge action, sort-on-save remains intentionally disabled to preserve remote ordering.
