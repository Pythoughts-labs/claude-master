import type { CapabilityReport } from "./producer-adapter.js";

export interface RoutingCandidate {
  producerId: string;
  outcome: "selected" | "unknown-producer" | "authentication-required" | "ineligible";
  detail: string | null;
}

export type RoutingResult =
  | { producerId: string; considered: RoutingCandidate[] }
  | {
    producerId: null;
    reason: "authentication-required" | "no-eligible-producer";
    considered: RoutingCandidate[];
  };

export function route(
  preferences: string[],
  reports: CapabilityReport[],
): RoutingResult {
  const considered: RoutingCandidate[] = [];
  for (const producerId of preferences) {
    const report = reports.find(candidate => candidate.producerId === producerId);
    if (report === undefined) {
      considered.push({ producerId, outcome: "unknown-producer", detail: null });
      continue;
    }
    if (report.reason === "authentication-required") {
      considered.push({ producerId, outcome: "authentication-required", detail: report.reason });
      return { producerId: null, reason: "authentication-required", considered };
    }
    if (report.laneEligibility.edit === true) {
      considered.push({ producerId, outcome: "selected", detail: null });
      return { producerId, considered };
    }
    considered.push({
      producerId,
      outcome: "ineligible",
      detail: report.reason ?? "laneEligibility.edit=false",
    });
  }

  return { producerId: null, reason: "no-eligible-producer", considered };
}
