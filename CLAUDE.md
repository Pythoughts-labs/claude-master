@AGENTS.md

## Claude Code repository checks

```bash
npx tsc --noEmit   # TypeScript 7 (native Go compiler)
npx vitest run
bash scripts/validate-release.sh
claude plugin validate .
```
