import type { Slice } from '../protocol/delegation-spec.js';
import type { VerificationReport } from './report-types.js';
import { routeSlice, type SliceRoute } from './wayfinder.js';

export interface PipelineSlice {
  index: number;
  objective: string;
  route: SliceRoute;
  candidateCommit: string;
  roundsUsed: number;
  verification: VerificationReport | null;
  reasons: string[];
}

export interface SliceAttempt {
  candidateCommit: string;
  verification: VerificationReport | null;
  hardBlocker?: boolean;
}

export interface SlicePhaseDeps {
  runSlice: (
    slice: Slice,
    index: number,
    base: string,
    attempt: number,
  ) => Promise<SliceAttempt>;
  maxRounds: number;
  onSlice?: (result: PipelineSlice) => Promise<void>;
}

export interface SlicePhaseResult {
  slices: PipelineSlice[];
  finalCandidateCommit: string;
  haltedSliceIndex: number | null;
}

export async function runSlicePhase(
  slices: Slice[],
  startCommit: string,
  deps: SlicePhaseDeps,
): Promise<SlicePhaseResult> {
  let currentCommit = startCommit;
  const results: PipelineSlice[] = [];

  for (const [offset, slice] of slices.entries()) {
    const index = offset + 1;
    let roundsUsed = 0;

    while (true) {
      const attempt = await deps.runSlice(slice, index, currentCommit, roundsUsed);
      const route = routeSlice({
        verification: attempt.verification,
        perSliceReview: null,
        roundsUsed,
        maxRounds: deps.maxRounds,
        hardBlocker: attempt.hardBlocker ?? false,
      });
      const pipelineSlice: PipelineSlice = {
        index,
        objective: slice.objective,
        route: route.route,
        candidateCommit: attempt.candidateCommit,
        roundsUsed,
        verification: attempt.verification,
        reasons: route.reasons,
      };

      if (route.route === 'advance') {
        results.push(pipelineSlice);
        if (deps.onSlice) {
          await deps.onSlice(pipelineSlice);
        }
        currentCommit = attempt.candidateCommit;
        break;
      }

      if (route.route === 'repair') {
        roundsUsed += 1;
        continue;
      }

      results.push(pipelineSlice);
      if (deps.onSlice) {
        await deps.onSlice(pipelineSlice);
      }
      return {
        slices: results,
        finalCandidateCommit: currentCommit,
        haltedSliceIndex: index,
      };
    }
  }

  return {
    slices: results,
    finalCandidateCommit: currentCommit,
    haltedSliceIndex: null,
  };
}
