import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { PROTOCOL_VERSION, RUNTIME_VERSION } from "../protocol/versions.js";
import {
  handleDecideCandidate,
  handleDelegate,
  handleIntegrateCandidate,
  handleReviewCandidate,
  type ToolDependencies,
} from "./tools.js";

const errorOutputFields = {
  ok: z.literal(false).optional(),
  error: z.string().optional(),
  diagnostic: z.string().optional(),
};
const delegateOutput = z.object({
  ok: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  validationErrors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  diagnostic: z.string().optional(),
  error: z.string().optional(),
});
const reviewOutput = z.object({
  patch: z.string().optional(),
  changedPaths: z.array(z.object({
    path: z.string(),
    changeType: z.enum(["added", "modified", "deleted"]),
    mode: z.string(),
    contentHash: z.string().nullable(),
  })).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  executedVerification: z.array(z.record(z.string(), z.unknown())).optional(),
  ...errorOutputFields,
});
const decisionOutput = z.object({
  recorded: z.literal(true).optional(),
  ...errorOutputFields,
});
const integrationOutput = z.object({
  integration: z.enum(["applied", "conflicted", "aborted"]).optional(),
  detail: z.string().optional(),
  ...errorOutputFields,
});
const doctorOutput = z.object({ issues: z.array(z.string()) });

function toolOutput(value: object) {
  const structuredContent = value as Record<string, unknown>;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent,
  };
}

export async function start(dependencies: ToolDependencies = {}): Promise<void> {
  if (process.env.CLAUDE_ARCHITECT_DELEGATED !== undefined) {
    console.error("Claude Architect MCP startup denied: CLAUDE_ARCHITECT_DELEGATED is present");
    process.exitCode = 1;
    return;
  }

  const server = new McpServer({ name: "claude-architect", version: RUNTIME_VERSION });
  server.registerTool(
    "delegate",
    {
      title: "Delegate an implementation subtask",
      description: "Validate a Delegation Spec and run one verified attempt.",
      inputSchema: {
        checkoutPath: z.string(),
        spec: z.unknown(),
        protocolVersion: z.string().optional(),
      },
      outputSchema: delegateOutput,
    },
    async ({ checkoutPath, spec, protocolVersion }) => toolOutput(await handleDelegate(
      checkoutPath,
      spec,
      {
        ...dependencies,
        skillProtocolVersion: protocolVersion ?? dependencies.skillProtocolVersion ?? PROTOCOL_VERSION,
      },
    )),
  );
  server.registerTool(
    "reviewCandidate",
    {
      title: "Review a verified candidate",
      description: "Regenerate and return the exact candidate patch and verification evidence.",
      inputSchema: { runId: z.string() },
      outputSchema: reviewOutput,
    },
    async ({ runId }) => toolOutput(await handleReviewCandidate(runId, dependencies)),
  );
  server.registerTool(
    "decideCandidate",
    {
      title: "Record a candidate decision",
      description: "Record acceptance, rejection, or a revision request for a candidate.",
      inputSchema: {
        runId: z.string(),
        decision: z.enum(["accepted", "rejected", "revision-requested"]),
      },
      outputSchema: decisionOutput,
    },
    async ({ runId, decision }) => toolOutput(await handleDecideCandidate(
      runId,
      decision,
      dependencies,
    )),
  );
  server.registerTool(
    "integrateCandidate",
    {
      title: "Integrate an accepted candidate",
      description: "Apply an accepted candidate tree after revalidating its artifact hash.",
      inputSchema: {
        runId: z.string(),
        expectedArtifactHash: z.string(),
      },
      outputSchema: integrationOutput,
    },
    async ({ runId, expectedArtifactHash }) => toolOutput(await handleIntegrateCandidate(
      runId,
      expectedArtifactHash,
      dependencies,
    )),
  );
  server.registerTool(
    "doctor",
    {
      title: "Diagnose the Claude Architect runtime",
      description: "Report runtime, Git, and Producer availability diagnostics.",
      inputSchema: {},
      outputSchema: doctorOutput,
    },
    async () => toolOutput({ issues: ["doctor-not-implemented"] }),
  );

  await server.connect(new StdioServerTransport());
  console.error("claude-architect MCP server ready");
}
