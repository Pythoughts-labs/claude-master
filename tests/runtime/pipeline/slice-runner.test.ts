import { describe, expect, it, vi } from 'vitest';

import type { VerificationReport } from '../../../src/pipeline/report-types.js';
import { runSlicePhase, type SliceAttempt } from '../../../src/pipeline/slice-runner.js';
import type { Slice } from '../../../src/protocol/delegation-spec.js';

function slice(objective: string): Slice {
  return {
    objective,
    context: '',
    writeAllowlist: [],
    forbiddenScope: [],
    successCriteria: [],
    verification: [],
  };
}

function verification(pass: boolean): VerificationReport {
  return {
    pass,
    testsDeleted: 0,
    testsSkipped: 0,
    workspaceClean: true,
    scopeViolations: [],
  } as unknown as VerificationReport;
}

function attempt(candidateCommit: string, pass: boolean, hardBlocker = false): SliceAttempt {
  return {
    candidateCommit,
    verification: verification(pass),
    hardBlocker,
  };
}

describe('runSlicePhase', () => {
  it('advances through all green slices', async () => {
    const runSlice = vi
      .fn()
      .mockResolvedValueOnce(attempt('slice-1-commit', true))
      .mockResolvedValueOnce(attempt('slice-2-commit', true));

    const result = await runSlicePhase([slice('first'), slice('second')], 'start', {
      runSlice,
      maxRounds: 1,
    });

    expect(result).toMatchObject({
      finalCandidateCommit: 'slice-2-commit',
      haltedSliceIndex: null,
    });
    expect(result.slices).toEqual([
      expect.objectContaining({ index: 1, route: 'advance', roundsUsed: 0 }),
      expect.objectContaining({ index: 2, route: 'advance', roundsUsed: 0 }),
    ]);
    expect(runSlice).toHaveBeenNthCalledWith(1, expect.anything(), 1, 'start', 0);
    expect(runSlice).toHaveBeenNthCalledWith(2, expect.anything(), 2, 'slice-1-commit', 0);
  });

  it('halts a slice that stays red past the maximum rounds', async () => {
    const runSlice = vi
      .fn()
      .mockResolvedValueOnce(attempt('slice-1-commit', true))
      .mockResolvedValueOnce(attempt('slice-2-attempt-0', false))
      .mockResolvedValueOnce(attempt('slice-2-attempt-1', false));

    const result = await runSlicePhase(
      [slice('first'), slice('second'), slice('not run')],
      'start',
      { runSlice, maxRounds: 1 },
    );

    expect(result).toMatchObject({
      finalCandidateCommit: 'slice-1-commit',
      haltedSliceIndex: 2,
    });
    expect(result.slices).toEqual([
      expect.objectContaining({ index: 1, route: 'advance', roundsUsed: 0 }),
      expect.objectContaining({
        index: 2,
        route: 'halt',
        candidateCommit: 'slice-2-attempt-1',
        roundsUsed: 1,
      }),
    ]);
    expect(runSlice).toHaveBeenCalledTimes(3);
  });

  it('retries a red slice and advances a later green attempt', async () => {
    const runSlice = vi
      .fn()
      .mockResolvedValueOnce(attempt('failed-attempt', false))
      .mockResolvedValueOnce(attempt('repaired-commit', true));

    const result = await runSlicePhase([slice('repairable')], 'start', {
      runSlice,
      maxRounds: 2,
    });

    expect(result).toMatchObject({
      finalCandidateCommit: 'repaired-commit',
      haltedSliceIndex: null,
    });
    expect(result.slices).toEqual([
      expect.objectContaining({ route: 'advance', candidateCommit: 'repaired-commit', roundsUsed: 1 }),
    ]);
    expect(runSlice).toHaveBeenNthCalledWith(2, expect.anything(), 1, 'start', 1);
  });

  it('halts immediately on a hard blocker', async () => {
    const runSlice = vi.fn().mockResolvedValue(attempt('blocked-commit', true, true));

    const result = await runSlicePhase([slice('blocked'), slice('not run')], 'start', {
      runSlice,
      maxRounds: 2,
    });

    expect(result).toMatchObject({
      finalCandidateCommit: 'start',
      haltedSliceIndex: 1,
    });
    expect(result.slices).toEqual([
      expect.objectContaining({
        index: 1,
        route: 'halt',
        candidateCommit: 'blocked-commit',
        roundsUsed: 0,
        reasons: ['unrecoverable blocker'],
      }),
    ]);
    expect(runSlice).toHaveBeenCalledTimes(1);
  });
});
