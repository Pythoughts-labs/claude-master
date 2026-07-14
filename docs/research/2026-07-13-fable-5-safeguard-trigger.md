# Why Fable 5 switched during `/delegate`

## Conclusion

Claude Code recorded this occurrence as a **cyber-safeguard fallback on the original user request**, not as a block caused by the `/delegate` skill body.

The client transcript identifies the category and request precisely:

- `apiRefusalCategory: "cyber"`
- `originalModel: "claude-fable-5"`
- `fallbackModel: "claude-opus-4-8"`
- `refusedUserMessageUuid` matches the original request asking to test five Codex CLI subagent delegations

Fable had already fallen back to Opus before Opus invoked the repository's plugin-qualified `delegate` skill. The cached skill content was injected afterward, so it could not have triggered this specific fallback. The exact word or contextual feature that crossed Anthropic's threshold remains unknowable because the transcript contains no classifier explanation or score.

## Anthropic-confirmed behavior

Anthropic says Fable 5 checks every user request and may switch to Opus 4.8 for four broad areas, including offensive cybersecurity. It also says the safeguards are intentionally broad and may flag benign work. Most importantly, the checks review everything the model reads—not only the latest user text—including memory, connectors, search results, and files.

Source: [Anthropic Support, “Why Claude switched models in your conversation with Fable 5”](https://support.claude.com/en/articles/15363606-why-claude-switched-models-in-your-conversation-with-fable-5).

## Local transcript evidence

Source: local Claude project transcript `2f249ed3-41f1-4706-99ce-f509b900f571.jsonl`, captured before the rebrand.

The relevant event sequence is:

1. **Line 7:** user asks to test `/delegate` with five Codex CLI subagent tasks; UUID `320dbc3c-cce9-46de-86c4-b58a6f0b52a7`.
2. **Line 16:** the response stream records fallback from `claude-fable-5` to `claude-opus-4-8`.
3. **Lines 18–19:** Opus says it will load the skill and calls `Skill` with the plugin-qualified `delegate` identifier.
4. **Line 20:** Claude Code records `model_refusal_fallback`, category `cyber`, and points `refusedUserMessageUuid` to line 7.
5. **Lines 21–22:** only then does Claude Code inject the cached `/delegate` skill content.

The initial turn also attached a large Claude Code environment: 178 deferred tool descriptions, 20 agent listings, five MCP instruction blocks, and a 901-name skill listing. The transcript proves those were associated with the initial turn, but it does not expose which portions Anthropic's classifier evaluated or weighted.

## Most likely explanation

This was a **false-positive cyber classification of the benign initial request plus its Claude Code context**.

Ranked trigger candidates:

1. **Initial request wording — medium confidence.** The request repeatedly combined “Codex CLI,” “subagents,” “delegation,” testing, a recent fix, and parallel execution. That is routine software-engineering language, but it is the only authored text directly identified by `refusedUserMessageUuid`.
2. **Attached tool/skill context — low-to-medium confidence.** The same turn exposed extensive shell, agent, MCP, and security-related capability metadata. Anthropic explicitly warns that content a user did not type can trigger a block.
3. **Other persistent conversation or project context — low confidence.** Fable checks everything it reads, but the client log does not identify the classifier's exact input span.

The following are ruled out for this occurrence:

- **The body of `skills/delegate/SKILL.md`:** loaded after fallback.
- **The Codex runner script:** not read before fallback in the recorded event chain.
- **Biology or chemistry:** the client explicitly categorized the refusal as `cyber`.
- **A proven distillation/frontier-LLM trigger:** those are documented fallback areas, but the client categorized this request as `cyber`, not either category.

## What can and cannot be proven

The client log proves the refused turn, fallback model, ordering, and broad category. It cannot reveal the exact matched token, classifier feature, score, or threshold; `apiRefusalExplanation` is `null`. Only Anthropic telemetry can provide that attribution.

A controlled A/B test could narrow the false-positive source by holding the repository and account constant while comparing a plain file-creation request, the same request with `/delegate`, and the same request with “Codex CLI/subagents” removed. Such a test would estimate causality, not expose the classifier's internal feature attribution.
