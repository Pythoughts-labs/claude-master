# Domain Context

## Ubiquitous Language

### Host

The environment that coordinates delegated work. The initial architecture has one Host: the Claude Code plugin.

### Lane

The kind of work being delegated, such as implementation, review, investigation, testing, or planning. A Lane does not identify which external runtime performs the work.

### Producer

An external CLI runtime that performs delegated work. Codex, OpenCode, Pi, and Pythinker are Producers.

### Delegation Spec

Machine-readable intent, constraints, success criteria, verification, execution policy, and expected output for delegated work. A Delegation Spec must be valid before routing selects a Producer.

### Delegation Attempt

One execution of a valid Delegation Spec by a selected Producer under an explicit policy. An editing Delegation Attempt runs in its own isolated worktree.

### Attempt Runtime

The provider-neutral module that executes a Delegation Attempt. It owns worktree allocation, environment construction, process supervision, timeout and cancellation, artifact collection, failure classification, and result verification orchestration.

### Producer Adapter

An adapter at the Producer seam. It owns Producer discovery and capability probing, invocation construction, native event parsing, and translation of native failures into canonical failures.

### Attempt Result

The canonical, machine-readable outcome of a Delegation Attempt. It records artifacts, evidence, execution facts, and failure classification. An Attempt Result is a candidate outcome, not an accepted result.

### Acceptance Verification

Independent executable verification of an Attempt Result and its candidate artifacts. Acceptance Verification checks declared tests, changed paths, worktree state, command outcomes, and scope before controlled integration.

### Candidate Artifact

Output produced by an untrusted Producer, such as a patch, report, or review. A Candidate Artifact cannot modify the main checkout until Acceptance Verification succeeds.

## Architectural Decisions In Force

- Claude Code is the only Host in the initial architecture.
- Lanes and Producers are independent dimensions.
- The Attempt Runtime is the primary deep module; Producer Adapters contain only Producer-specific variation.
- Routing occurs only after Delegation Spec validation and capability resolution.
- Each concurrent editing Delegation Attempt receives a separate worktree.
- Producers are untrusted subprocesses; successful exit and self-reported verification do not imply acceptance.
- Agent prose provides guidance, not security enforcement.
- Nested delegation is denied unless an explicit bounded policy permits it.
- The first trusted Attempt Runtime supports macOS and Linux; Windows support is deferred, while the Delegation Spec and Attempt Result remain platform-neutral.
- The Attempt Runtime never modifies the main checkout. After Acceptance Verification, it returns a verified Candidate Artifact for controlled integration by the Host.
- The default Producer configuration policy is controlled configuration plus repository guidance. User-global Producer configuration is excluded; relevant repository instruction paths and hashes are recorded in the Attempt Result.
- Acceptance Verification executes only commands authorized by the Host in the validated Delegation Spec. Producer-suggested commands may be recorded as evidence but are not executed automatically.
- The P0 Attempt Runtime supports the implementation Lane only. Other Lanes may reuse the protocol later but do not broaden the first trusted editing path.
- P0 is complete only when Codex, OpenCode, Pi, and Pythinker run through the shared Attempt Runtime. Four adapters make the Producer seam real and expose Producer-specific assumptions.
- P0 may select a fallback Producer only when capability probing reports pre-launch unavailability. After a Producer process starts, every failure is returned honestly and retry requires a new Host decision and Delegation Attempt.
- P0 allows one active editing Delegation Attempt per base checkout. Parallel candidate generation and queueing are deferred.
- The Attempt Runtime constructs the canonical Attempt Result from observed process facts, normalized Producer events, Candidate Artifacts, and Acceptance Verification evidence. Producer-authored summaries are untrusted fields.
- The P0 Attempt Runtime is a TypeScript/Node executable. Shell is limited to narrow platform helpers and does not define the attempt protocol or process lifecycle.
- P0 requires a clean main checkout before an editing Delegation Attempt starts. Dirty-state snapshotting is deferred.
