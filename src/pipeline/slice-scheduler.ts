import { resolveSliceDependencies, type Slice } from "../protocol/delegation-spec.js";
import { globMatches } from "../util/glob.js";

/**
 * Slices run together only when the architect has said they may — an omitted
 * `dependsOn` means "after everything before me", which reproduces sequential
 * execution exactly — and only when their write allowlists are pairwise
 * disjoint.
 *
 * Disjoint allowlists matter for more than tidiness: structural verification
 * confines every slice's changes to its own allowlist, so disjoint allowlists
 * mean disjoint changed paths, which means composing a wave by union cannot
 * conflict. Anything that does not provably satisfy that runs on its own.
 *
 * This scheduling is an efficiency decision, never a correctness one. A slice
 * that under-declares its dependencies observes a base without the work it
 * actually needed; nothing here can detect that, and nothing here has to —
 * the composed candidate still faces the same full verification the sequential
 * path runs, and the gate fails closed on it.
 */
export interface SliceWave {
  /** 1-based slice indices, ascending. */
  indices: number[];
}

function allowlistsOverlap(left: Slice, right: Slice): boolean {
  // Two globs overlap when either matches a literal prefix of the other. Without
  // a general glob-intersection test, treat any pattern that is not provably
  // separable as overlapping, so ambiguity serializes rather than racing.
  return left.writeAllowlist.some(leftGlob =>
    right.writeAllowlist.some(rightGlob =>
      leftGlob === rightGlob
      || globMatches(leftGlob, literalPrefix(rightGlob))
      || globMatches(rightGlob, literalPrefix(leftGlob))
      || literalPrefix(leftGlob).startsWith(literalPrefix(rightGlob))
      || literalPrefix(rightGlob).startsWith(literalPrefix(leftGlob))));
}

function literalPrefix(glob: string): string {
  const wildcard = glob.search(/[*?[]/u);
  return wildcard === -1 ? glob : glob.slice(0, wildcard);
}

export function planSliceWaves(slices: Slice[], concurrency: number): SliceWave[] {
  const waves: SliceWave[] = [];
  const completed = new Set<number>();
  const pending = slices.map((_, offset) => offset + 1);

  while (pending.length > 0) {
    const wave: number[] = [];
    for (const index of pending) {
      if (wave.length >= Math.max(1, concurrency)) break;
      const dependencies = resolveSliceDependencies(slices, index);
      if (!dependencies.every(dependency => completed.has(dependency))) continue;
      const slice = slices[index - 1]!;
      if (wave.some(member => allowlistsOverlap(slices[member - 1]!, slice))) continue;
      wave.push(index);
    }
    if (wave.length === 0) {
      // Unsatisfiable dependencies would otherwise spin forever; run the next
      // slice on its own and let verification judge the result.
      wave.push(pending[0]!);
    }
    for (const index of wave) {
      completed.add(index);
      pending.splice(pending.indexOf(index), 1);
    }
    waves.push({ indices: wave });
  }
  return waves;
}
