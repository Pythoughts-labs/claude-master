// tests/runtime/consolidator.test.ts
import { describe, expect, it } from "vitest";
import { consolidate } from "../../src/pipeline/consolidator.js";
import type { RawFinding, ReviewReport } from "../../src/pipeline/report-types.js";

function finding(overrides: Partial<RawFinding>): RawFinding {
  return {
    severity: "minor", location: "src/a.ts:10", claim: "off-by-one in loop bound",
    evidence: "loop runs to <= n", reproduction: "n=0", requiredOutcome: "use < n",
    confidence: 0.8, ...overrides,
  };
}
function report(findings: RawFinding[]): ReviewReport {
  return { reportVersion: "1", verdict: findings.length ? "request-changes" : "approve", findings, coverageGaps: [] };
}

describe("consolidate", () => {
  it("dedupes identical findings across reviewers, preserving highest severity", () => {
    const out = consolidate([
      { reviewer: "correctness", report: report([finding({ severity: "major" })]) },
      { reviewer: "systems", report: report([finding({ severity: "blocker", claim: "  OFF-BY-ONE in loop bound " })]) },
    ]);
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].severity).toBe("blocker");
    expect(out.findings[0].reviewers.sort()).toEqual(["correctness", "systems"]);
  });

  it("assigns stable sequential ids ordered by severity then location", () => {
    const out = consolidate([
      { reviewer: "correctness", report: report([
        finding({ location: "src/z.ts:1", severity: "nit", claim: "typo" }),
        finding({ location: "src/a.ts:5", severity: "blocker", claim: "crash on null" }),
      ])},
    ]);
    expect(out.findings.map((f) => [f.id, f.severity])).toEqual([
      ["F-001", "blocker"],
      ["F-002", "nit"],
    ]);
  });

  it("is deterministic regardless of reviewer input order", () => {
    const a = { reviewer: "correctness", report: report([finding({ claim: "x" }), finding({ claim: "y", location: "src/b.ts:2" })]) };
    const b = { reviewer: "systems", report: report([finding({ claim: "z", location: "src/c.ts:3" })]) };
    expect(consolidate([a, b])).toEqual(consolidate([b, a]));
  });

  it("flags contradictions: same location, different required outcomes", () => {
    const out = consolidate([
      { reviewer: "correctness", report: report([finding({ claim: "bound wrong", requiredOutcome: "use < n" })]) },
      { reviewer: "systems", report: report([finding({ claim: "bound is fine but slow", requiredOutcome: "keep <= n, memoize instead" })]) },
    ]);
    expect(out.findings).toHaveLength(2); // different claims → not deduped
    expect(out.contradictions).toHaveLength(1);
    expect(out.contradictions[0]).toContain("src/a.ts:10");
  });

  it("never drops a blocker or major", () => {
    const blockers = [finding({ severity: "blocker", claim: "c1" }), finding({ severity: "major", claim: "c2", location: "src/b.ts:1" })];
    const out = consolidate([{ reviewer: "systems", report: report(blockers) }]);
    expect(out.findings.filter((f) => f.severity === "blocker" || f.severity === "major")).toHaveLength(2);
  });
});
