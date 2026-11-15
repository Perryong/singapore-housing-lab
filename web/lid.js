// Footprint of a flat's ceiling from its plan JSON: everything the rooms and walls enclose, as [x0, z0, x1, z1] strips.
// Pure: runs in the browser and in Node. Rooms the extraction lost and doorways are roofed; outdoor notches are not.
export function lidRects(rooms, walls, cell = 0.1) {
  const xs = [], zs = [];
  for (const r of rooms) for (const [x, z] of r.poly) { xs.push(x); zs.push(z); }
  for (const { rect: [x0, z0, x1, z1] } of walls) { xs.push(x0, x1); zs.push(z0, z1); }
  if (!xs.length) return [];
  const ox = Math.min(...xs) - 2 * cell, oz = Math.min(...zs) - 2 * cell;                 // 2 empty cells all round
  const W = Math.ceil((Math.max(...xs) - ox) / cell) + 2, H = Math.ceil((Math.max(...zs) - oz) / cell) + 2;
  const ci = x => Math.floor((x - ox) / cell), cj = z => Math.floor((z - oz) / cell);
  const solid = new Uint8Array(W * H);
  for (const { rect: [x0, z0, x1, z1] } of walls)                                         // any cell a wall touches: thin walls must not leak
    for (let j = cj(Math.min(z0, z1)); j <= cj(Math.max(z0, z1)); j++) for (let i = ci(Math.min(x0, x1)); i <= ci(Math.max(x0, x1)); i++) solid[j * W + i] = 1;
  for (const { poly: P } of rooms) {
    if (P.length < 3) continue;
    const px = P.map(p => p[0]), pz = P.map(p => p[1]);
    for (let j = cj(Math.min(...pz)); j <= cj(Math.max(...pz)); j++) for (let i = ci(Math.min(...px)); i <= ci(Math.max(...px)); i++) {
      const x = ox + (i + 0.5) * cell, z = oz + (j + 0.5) * cell; let inside = false;     // even-odd test at the cell centre
      for (let a = 0, b = P.length - 1; a < P.length; b = a++)
        if ((P[a][1] > z) !== (P[b][1] > z) && x < (P[b][0] - P[a][0]) * (z - P[a][1]) / (P[b][1] - P[a][1]) + P[a][0]) inside = !inside;
      if (inside) solid[j * W + i] = 1;
    }
  }
  const grown = Uint8Array.from(solid);                                                   // grow one cell to seal hairline gaps
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (solid[j * W + i])
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) grown[(j + dj) * W + i + di] = 1;
  const out = new Uint8Array(W * H), todo = [0]; out[0] = 1;                              // flood the open air in from a corner
  while (todo.length) {
    const k = todo.pop(), i = k % W, j = (k - i) / W;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj, n = b * W + a;
      if (a >= 0 && a < W && b >= 0 && b < H && !out[n] && !grown[n]) { out[n] = 1; todo.push(n); }
    }
  }
  const rects = [];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (out[j * W + i]) continue;
    const i0 = i; while (i < W && !out[j * W + i]) i++;
    rects.push([ox + i0 * cell, oz + j * cell, ox + i * cell, oz + (j + 1) * cell]);
  }
  return rects;
}
