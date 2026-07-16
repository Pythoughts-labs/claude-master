// tests/runtime/report-schemas.test.ts
import { describe, expect, it } from "vitest";
import { loadSchemas } from "../../src/protocol/schema-loader.js";

const validReview = {
  reportVersion: "1",
  verdict: "request-changes",
  findings: [
    {
      severity: "blocker",
      location: "src/auth/session.ts:42",
      claim: "Session tokens are compared with ===, allowing timing attacks",
      evidence: "Line 42 uses `token === stored`",
      reproduction: "Call verify() with near-matching tokens and measure timing",
      requiredOutcome: "Use timingSafeEqual",
      confidence: 0.9,
    },
  ],
  coverageGaps: ["Did not review Windows path handling"],
};

const validFix = {
  reportVersion: "1",
  candidateCommit: "a".repeat(40),
  dispositions: [
    { findingId: "F-001", disposition: "fixed", evidence: "Replaced with timingSafeEqual; test added", commit: "a".repeat(40) },
  ],
};

const validVerification = {
  reportVersion: "1",
  pass: true,
  commandResults: [{ id: "unit", exitCode: 0, ok: true }],
  workspaceClean: true,
  testsDeleted: 0,
  testsSkipped: 0,
  scopeViolations: [],
};

describe("pipeline report schemas", () => {
  it("accepts valid reports", () => {
    const s = loadSchemas();
    expect(s.reviewReport(validReview)).toBe(true);
    expect(s.fixReport(validFix)).toBe(true);
    expect(s.verificationReport(validVerification)).toBe(true);
  });

  it("rejects unknown severity", () => {
    const s = loadSchemas();
    const bad = structuredClone(validReview);
    bad.findings[0].severity = "catastrophic";
    expect(s.reviewReport(bad)).toBe(false);
  });

  it("rejects unknown disposition and missing evidence", () => {
    const s = loadSchemas();
    const bad = structuredClone(validFix);
    bad.dispositions[0].disposition = "wontfix";
    expect(s.fixReport(bad)).toBe(false);
    const bad2 = structuredClone(validFix);
    delete (bad2.dispositions[0] as Record<string, unknown>).evidence;
    expect(s.fixReport(bad2)).toBe(false);
  });

  it("rejects additional properties (fail closed)", () => {
    const s = loadSchemas();
    const bad = { ...validVerification, extra: true };
    expect(s.verificationReport(bad)).toBe(false);
  });
});
