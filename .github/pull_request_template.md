## Summary

<!-- What changed, why, and what user-visible behavior results? -->

## Related issue

<!-- Link the issue/specification, or explain why none is needed. -->

## Verification

<!-- List exact commands and results. Include relevant unhappy-path coverage. -->

- [ ] `npx tsc --noEmit`
- [ ] `npx vitest run`
- [ ] I added or updated the narrowest tests that prove the change.

## Trust boundary and platform impact

- [ ] I identified whether this change affects a trust boundary, and if it does, documented the impact below.

<!-- Discuss Producers, process execution, confinement, paths, environment/secrets, redaction, schemas, verification, candidate identity, decisions, integration, and macOS/Linux/Windows behavior as applicable. Write "None" if there is no impact. -->

## Contributor checklist

- [ ] The change is narrowly scoped and contains no unrelated refactoring.
- [ ] Documentation and generated runtime assets are current where required.
- [ ] Schema/protocol changes are backward-compatible, or include the required version increment and mismatch diagnostic.
- [ ] I did not add AI co-author trailers or generated-by footers.
- [ ] Release-facing changes pass `bash scripts/validate-release.sh` and keep all version surfaces synchronized.

