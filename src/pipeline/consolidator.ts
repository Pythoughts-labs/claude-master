// src/pipeline/consolidator.ts
import type { Finding, FindingSeverity, RawFinding, ReviewReport } from "./report-types.js";

const SEVERITY_ORDER: Record<FindingSeverity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };

export interface ConsolidationResult {
  findings: Finding[];
  contradictions: string[];
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Dedupe key: same location + same normalized claim = the same finding. */
function dedupeKey(f: RawFinding): string {
  return `${f.location} ${normalize(f.claim)}`;
}

export function consolidate(reports: { reviewer: string; report: ReviewReport }[]): ConsolidationResult {
  const byKey = new Map<string, { finding: RawFinding; reviewers: Set<string> }>();

  // Deterministic: process in sorted reviewer order, findings in given order.
  const sorted = [...reports].sort((a, b) => a.reviewer.localeCompare(b.reviewer));
  for (const { reviewer, report } of sorted) {
    for (const raw of report.findings) {
      const key = dedupeKey(raw);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, { finding: { ...raw }, reviewers: new Set([reviewer]) });
        continue;
      }
      existing.reviewers.add(reviewer);
      // Preserve highest severity; never downgrade.
      if (SEVERITY_ORDER[raw.severity] < SEVERITY_ORDER[existing.finding.severity]) {
        existing.finding.severity = raw.severity;
      }
      existing.finding.confidence = Math.max(existing.finding.confidence, raw.confidence);
    }
  }

  const merged = [...byKey.values()].sort((a, b) =>
    SEVERITY_ORDER[a.finding.severity] - SEVERITY_ORDER[b.finding.severity]
    || a.finding.location.localeCompare(b.finding.location)
    || normalize(a.finding.claim).localeCompare(normalize(b.finding.claim)));

  const findings: Finding[] = merged.map((entry, index) => ({
    ...entry.finding,
    id: `F-${String(index + 1).padStart(3, "0")}`,
    reviewers: [...entry.reviewers].sort(),
  }));

  // Contradiction: distinct findings at the same location demanding different outcomes.
  const contradictions: string[] = [];
  const byLocation = new Map<string, Finding[]>();
  for (const f of findings) {
    const bucket = byLocation.get(f.location) ?? [];
    bucket.push(f);
    byLocation.set(f.location, bucket);
  }
  for (const [location, group] of byLocation) {
    const outcomes = new Set(group.map((f) => normalize(f.requiredOutcome)));
    if (group.length > 1 && outcomes.size > 1) {
      contradictions.push(
        `conflicting required outcomes at ${location}: ${group.map((f) => f.id).join(", ")}`);
    }
  }

  return { findings, contradictions };
}
