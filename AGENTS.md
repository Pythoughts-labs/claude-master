# Project Instructions
 This is a CLaude Code Plugin : Claude Architect is a Claude Code plugin that adds /delegate for routing subtasks to Codex, OpenCode, Pi, or      
 Pythinker CLI agents. Claude remains the architect: it writes a structured spec, delegates implementation, then   
 reviews the diff and verification output before accepting changes. It also includes a read-only Claude advisor,   
 process isolation, timeout handling, run logging, and native OpenCode support.
## Releases

- Advance the minor version for every marketplace release: `0.3.0` -> `0.4.0` -> `0.5.0`. Do not publish patch-version tags.
- Keep `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, the README version badge, and `CHANGELOG.md` on the same version.
- Run `bash scripts/validate-release.sh` before every release push.
- Do not commit a release tag or push it when validation fails.
