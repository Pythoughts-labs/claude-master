import { describe, expect, it } from "vitest";
import { planSliceWaves } from "../../src/pipeline/slice-scheduler.js";
import type { Slice } from "../../src/protocol/delegation-spec.js";

function slice(writeAllowlist: string[], dependsOn?: number[]): Slice {
  return {
    objective: "objective",
    context: "context",
    writeAllowlist,
    forbiddenScope: [],
    successCriteria: ["done"],
    verification: [],
    ...(dependsOn === undefined ? {} : { dependsOn }),
  };
}

describe("slice wave planning", () => {
  it("keeps undeclared slices strictly sequential", () => {
    // The default must reproduce today's behaviour byte for byte: parallelism
    // is something the architect opts into, never something inferred.
    const slices = [slice(["a/**"]), slice(["b/**"]), slice(["c/**"])];

    expect(planSliceWaves(slices, 4)).toEqual([
      { indices: [1] },
      { indices: [2] },
      { indices: [3] },
    ]);
  });

  it("runs independent slices with disjoint allowlists together", () => {
    const slices = [
      slice(["src/a/**"], []),
      slice(["src/b/**"], []),
      slice(["src/c/**"], [1, 2]),
    ];

    expect(planSliceWaves(slices, 4)).toEqual([{ indices: [1, 2] }, { indices: [3] }]);
  });

  it("separates independent slices whose allowlists overlap", () => {
    // Nothing here can prove their changes will not collide, so they do not
    // share a wave regardless of what the architect declared.
    const slices = [slice(["src/**"], []), slice(["src/a/thing.ts"], [])];

    expect(planSliceWaves(slices, 4)).toEqual([{ indices: [1] }, { indices: [2] }]);
  });

  it("treats identical allowlists as overlapping", () => {
    const slices = [slice(["src/a.ts"], []), slice(["src/a.ts"], [])];

    expect(planSliceWaves(slices, 4)).toEqual([{ indices: [1] }, { indices: [2] }]);
  });

  it("never exceeds the configured concurrency", () => {
    const slices = [
      slice(["a/**"], []),
      slice(["b/**"], []),
      slice(["c/**"], []),
      slice(["d/**"], []),
    ];

    expect(planSliceWaves(slices, 2)).toEqual([{ indices: [1, 2] }, { indices: [3, 4] }]);
  });

  it("collapses to sequential execution at a concurrency of one", () => {
    const slices = [slice(["a/**"], []), slice(["b/**"], [])];

    expect(planSliceWaves(slices, 1)).toEqual([{ indices: [1] }, { indices: [2] }]);
  });

  it("respects a partial dependency order", () => {
    const slices = [
      slice(["a/**"], []),
      slice(["b/**"], [1]),
      slice(["c/**"], []),
    ];

    // Slice 3 is free to go first; slice 2 waits for slice 1.
    expect(planSliceWaves(slices, 4)).toEqual([{ indices: [1, 3] }, { indices: [2] }]);
  });

  it("makes progress instead of spinning on an unsatisfiable dependency", () => {
    const slices = [slice(["a/**"], [2]), slice(["b/**"], [1])];

    expect(planSliceWaves(slices, 4)).toEqual([{ indices: [1] }, { indices: [2] }]);
  });

  it("plans every slice exactly once", () => {
    const slices = Array.from({ length: 7 }, (_, offset) => slice([`s${offset}/**`], []));
    const planned = planSliceWaves(slices, 3).flatMap(wave => wave.indices);

    expect([...planned].sort((left, right) => left - right)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
