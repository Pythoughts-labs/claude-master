@AGENTS.md

## Claude Code repository checks

```bash
npx tsc --noEmit
npx vitest run
bash scripts/validate-release.sh
claude plugin validate .
```
