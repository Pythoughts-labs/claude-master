# Operations

## Update during an active attempt

The previously installed `${CLAUDE_PLUGIN_ROOT}` remains live for a running MCP server until `/reload-plugins`. After an update and reload, startup recovery on the next server start owns and cancels any unfinished run left by the old plugin root. Runtime state is stored under `${CLAUDE_PLUGIN_DATA}`, which remains stable across plugin versions.

Checkout locks are JSON records containing both `pid` and `processToken`. Recovery requires the process token to establish owner identity and never treats a PID alone as proof of ownership. A dead owner or a live PID whose start token differs from the recorded token is stale; only a live owner with a matching token retains its lock. Missing or malformed identity data fails closed rather than authorizing PID-only signalling or reclamation.

For a live unfinished process with a matching token, startup recovery requests cooperative termination first and waits for a grace period. If the process remains alive, recovery forcibly terminates its process tree and records whether cancellation completed cooperatively or required forced escalation. Dead processes and recycled PIDs with mismatched tokens are never signalled.
