/**
 * Stable per-cell pseudo-randomness, in [0, 1).
 *
 * Deterministic by design, and that determinism is load-bearing in three
 * ways: the renderer and the shadow engine must derive the exact same
 * silhouette from a cell's coordinates, redraws must not shimmer, and tests
 * need to be able to assert an exact shape.
 *
 * `salt` picks an independent stream for the same cell, so one cell can drive
 * several unrelated decisions (lobe count, lobe radius, shadow length) without
 * them correlating.
 */
export function cellNoise(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(salt, 83492791);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The smoothstep fade value noise interpolates with.
 *
 * Not a straight lerp: linear interpolation between lattice points leaves a visible crease at
 * every one of them, because the slope changes abruptly there. `3t² - 2t³` has zero slope at both
 * ends, so the blobs meet smoothly and the lattice stops being findable by eye.
 */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Smooth pseudo-randomness over an *area*, in [0, 1) — blobs a few cells across rather than
 * per-cell static.
 *
 * **The difference from cellNoise, and the reason both exist.** cellNoise is white noise:
 * neighbouring cells are completely uncorrelated, which is exactly right for a decision each cell
 * makes alone (which way this tree faces, how many rocks are scattered here) and exactly wrong for
 * anything that should read as a *patch*. Used for one, it gives salt-and-pepper.
 *
 * This is ordinary value noise built on top of it: sample cellNoise at the lattice points of a
 * coarser grid and interpolate between them. `scale` is the lattice spacing in cells, so it is
 * roughly how wide a blob comes out — 1 degenerates back to per-cell noise, and 3 to 4 gives
 * patches a few squares across.
 *
 * Deterministic and coordinate-only, for every reason cellNoise is: two consumers deriving from
 * the same square must agree, redraws must not shimmer, and a test has to be able to pin an exact
 * value. It draws from no rng, so a generator pass using it moves no seed's map.
 */
export function cellField(x: number, y: number, salt: number, scale: number): number {
  // A lattice finer than one cell would sample the same cell twice and buy nothing but rounding.
  const span = Math.max(1, scale);
  const gx = x / span;
  const gy = y / span;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = fade(gx - x0);
  const ty = fade(gy - y0);

  const n00 = cellNoise(x0, y0, salt);
  const n10 = cellNoise(x0 + 1, y0, salt);
  const n01 = cellNoise(x0, y0 + 1, salt);
  const n11 = cellNoise(x0 + 1, y0 + 1, salt);

  const top = n00 + (n10 - n00) * tx;
  const bottom = n01 + (n11 - n01) * tx;
  return top + (bottom - top) * ty;
}
