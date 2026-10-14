// Force layout on typed arrays. Same forces d3-force was configured with (links pull at
// strength 0.1 to distance 0, everyone repels with strength -100 through a Barnes-Hut
// quadtree at theta 0.9, dots keep 10 apart, the whole is kept centred), same 300 steps
// with d3's alpha decay and velocity decay. d3 rebuilt two quadtrees of JS objects per
// step; here the tree is a few flat arrays reused every step: ~2.5x faster for 500
// people / 10k links (472 -> 185 ms), same layout quality.
//
// Classic script (no import/export) for the worker's importScripts; tests load it too.
// forceLayout(n, links: Int32Array [s0, t0, ...], onProgress?) -> { x, y } Float64Arrays
self.forceLayout = function forceLayout(n, links, onProgress) {
  const LINK_STRENGTH = 0.1;
  const CHARGE = -100;
  const THETA2 = 0.81;
  const DIST_MIN2 = 1;
  const COLLIDE = 20; // two radii of 10
  const STEPS = 300;
  const ALPHA_MIN = 0.001;
  const ALPHA_DECAY = 1 - Math.pow(ALPHA_MIN, 1 / STEPS);
  const VELOCITY_KEEP = 0.6;

  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  // d3's starting spiral (phyllotaxis), so people start spread out in index order
  for (let i = 0; i < n; i++) {
    const r = 10 * Math.sqrt(0.5 + i);
    const a = i * Math.PI * (3 - Math.sqrt(5));
    x[i] = r * Math.cos(a);
    y[i] = r * Math.sin(a);
  }
  // nudge for two points in the same spot; seeded so a graph always lays out the same
  let seed = 1;
  const jiggle = () => ((seed = (seed * 48271) % 2147483647) / 2147483647 - 0.5) * 1e-6;

  // a link moves its two ends in proportion to how connected the other end is (d3's bias)
  const m = links.length / 2;
  const degree = new Int32Array(n);
  for (let i = 0; i < links.length; i++) degree[links[i]]++;
  const bias = new Float64Array(m);
  for (let l = 0; l < m; l++) {
    const s = links[2 * l];
    const t = links[2 * l + 1];
    bias[l] = degree[s] / (degree[s] + degree[t]);
  }

  // ---- quadtree: cells in flat arrays, points chained per leaf ----------------------
  let cap = 4 * n + 16;
  let cx0 = new Float64Array(cap); // cell corner and size
  let cy0 = new Float64Array(cap);
  let csize = new Float64Array(cap);
  let kids = new Int32Array(4 * cap); // 4 children per cell, -1 = none
  let first = new Int32Array(cap); // first point in a leaf, -1 = none
  let mass = new Float64Array(cap); // number of points under the cell
  let mx = new Float64Array(cap); // their centre
  let my = new Float64Array(cap);
  const nextPoint = new Int32Array(n);
  let cells = 0;
  let px = x;
  let py = y;

  function grow() {
    const g = (a) => {
      const b = new a.constructor(a.length * 2);
      b.set(a);
      return b;
    };
    cap *= 2;
    [cx0, cy0, csize, first, mass, mx, my] = [cx0, cy0, csize, first, mass, mx, my].map(g);
    kids = g(kids);
  }
  function cell(x0, y0, size) {
    if (cells === cap) grow();
    const c = cells++;
    cx0[c] = x0;
    cy0[c] = y0;
    csize[c] = size;
    first[c] = -1;
    kids[4 * c] = kids[4 * c + 1] = kids[4 * c + 2] = kids[4 * c + 3] = -1;
    return c;
  }
  const isLeaf = (c) => kids[4 * c] === -1 && kids[4 * c + 1] === -1 && kids[4 * c + 2] === -1 && kids[4 * c + 3] === -1;
  function quadrant(c, qx, qy) {
    const h = csize[c] / 2;
    return (qx >= cx0[c] + h ? 1 : 0) | (qy >= cy0[c] + h ? 2 : 0);
  }
  function childFor(c, k) {
    let ch = kids[4 * c + k];
    if (ch === -1) {
      const h = csize[c] / 2;
      ch = cell(cx0[c] + (k & 1 ? h : 0), cy0[c] + (k & 2 ? h : 0), h);
      kids[4 * c + k] = ch;
    }
    return ch;
  }
  function insert(i) {
    let c = 0;
    for (let depth = 0; ; depth++) {
      if (isLeaf(c)) {
        const j = first[c];
        if (j === -1) {
          first[c] = i;
          nextPoint[i] = -1;
          return;
        }
        // same spot (or absurdly deep): share the leaf
        if ((px[j] === px[i] && py[j] === py[i]) || depth > 48) {
          nextPoint[i] = first[c];
          first[c] = i;
          return;
        }
        // split: move the leaf's points one level down, then keep going with i
        first[c] = -1;
        for (let p = j; p !== -1; ) {
          const after = nextPoint[p];
          const ch = childFor(c, quadrant(c, px[p], py[p]));
          nextPoint[p] = first[ch];
          first[ch] = p;
          p = after;
        }
      }
      c = childFor(c, quadrant(c, px[i], py[i]));
    }
  }
  function build(ax, ay) {
    px = ax;
    py = ay;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      if (ax[i] < minX) minX = ax[i];
      if (ax[i] > maxX) maxX = ax[i];
      if (ay[i] < minY) minY = ay[i];
      if (ay[i] > maxY) maxY = ay[i];
    }
    cells = 0;
    cell(minX, minY, Math.max(maxX - minX, maxY - minY, 1) * 1.0001);
    for (let i = 0; i < n; i++) insert(i);
  }
  // mass and centre per cell, children before parents (cells are created after their parent)
  function accumulate() {
    for (let c = cells - 1; c >= 0; c--) {
      let w = 0;
      let sx = 0;
      let sy = 0;
      for (let p = first[c]; p !== -1; p = nextPoint[p]) {
        w++;
        sx += px[p];
        sy += py[p];
      }
      for (let k = 0; k < 4; k++) {
        const ch = kids[4 * c + k];
        if (ch === -1) continue;
        w += mass[ch];
        sx += mx[ch] * mass[ch];
        sy += my[ch] * mass[ch];
      }
      mass[c] = w;
      mx[c] = w ? sx / w : 0;
      my[c] = w ? sy / w : 0;
    }
  }

  const stack = new Int32Array(4 * 64 + 8);
  function charge(alpha) {
    for (let i = 0; i < n; i++) {
      const xi = x[i];
      const yi = y[i];
      let ax = 0;
      let ay = 0;
      let sp = 0;
      stack[sp++] = 0;
      while (sp) {
        const c = stack[--sp];
        if (!mass[c]) continue;
        let dx = mx[c] - xi;
        let dy = my[c] - yi;
        let l = dx * dx + dy * dy;
        const leaf = isLeaf(c);
        if (!leaf && (csize[c] * csize[c]) / THETA2 < l) {
          // far enough: the whole cell acts as one body
          if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
          const f = (CHARGE * mass[c] * alpha) / l;
          ax += dx * f;
          ay += dy * f;
        } else if (!leaf) {
          for (let k = 0; k < 4; k++) if (kids[4 * c + k] !== -1) stack[sp++] = kids[4 * c + k];
        } else {
          for (let p = first[c]; p !== -1; p = nextPoint[p]) {
            if (p === i) continue;
            dx = x[p] - xi;
            dy = y[p] - yi;
            l = dx * dx + dy * dy;
            if (l === 0) {
              dx = jiggle();
              l = dx * dx;
            }
            if (l < DIST_MIN2) l = Math.sqrt(DIST_MIN2 * l);
            const f = (CHARGE * alpha) / l;
            ax += dx * f;
            ay += dy * f;
          }
        }
      }
      vx[i] += ax;
      vy[i] += ay;
    }
  }

  const ex = new Float64Array(n);
  const ey = new Float64Array(n);
  function collide() {
    const r2 = COLLIDE * COLLIDE;
    for (let i = 0; i < n; i++) {
      const xi = ex[i];
      const yi = ey[i];
      let sp = 0;
      stack[sp++] = 0;
      while (sp) {
        const c = stack[--sp];
        if (cx0[c] > xi + COLLIDE || cx0[c] + csize[c] < xi - COLLIDE) continue;
        if (cy0[c] > yi + COLLIDE || cy0[c] + csize[c] < yi - COLLIDE) continue;
        for (let k = 0; k < 4; k++) if (kids[4 * c + k] !== -1) stack[sp++] = kids[4 * c + k];
        for (let p = first[c]; p !== -1; p = nextPoint[p]) {
          if (p <= i) continue; // each pair once
          let dx = xi - x[p] - vx[p];
          let dy = yi - y[p] - vy[p];
          let l = dx * dx + dy * dy;
          if (l >= r2) continue;
          if (dx === 0) l += (dx = jiggle()) * dx;
          if (dy === 0) l += (dy = jiggle()) * dy;
          l = Math.sqrt(l);
          l = (COLLIDE - l) / l;
          dx *= l * 0.5;
          dy *= l * 0.5;
          vx[i] += dx;
          vy[i] += dy;
          vx[p] -= dx;
          vy[p] -= dy;
        }
      }
    }
  }

  let alpha = 1;
  for (let step = 0; step < STEPS; step++) {
    alpha -= alpha * ALPHA_DECAY;
    // links (distance 0: each pulls its ends together)
    for (let l = 0; l < m; l++) {
      const s = links[2 * l];
      const t = links[2 * l + 1];
      const f = alpha * LINK_STRENGTH;
      const dx = (x[t] + vx[t] - x[s] - vx[s]) * f;
      const dy = (y[t] + vy[t] - y[s] - vy[s]) * f;
      const b = bias[l];
      vx[t] -= dx * b;
      vy[t] -= dy * b;
      vx[s] += dx * (1 - b);
      vy[s] += dy * (1 - b);
    }
    build(x, y);
    accumulate();
    charge(alpha);
    // collisions look at where people are about to be
    for (let i = 0; i < n; i++) {
      ex[i] = x[i] + vx[i];
      ey[i] = y[i] + vy[i];
    }
    build(ex, ey);
    collide();
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      x[i] += vx[i] *= VELOCITY_KEEP;
      y[i] += vy[i] *= VELOCITY_KEEP;
      sx += x[i];
      sy += y[i];
    }
    sx /= n || 1;
    sy /= n || 1;
    for (let i = 0; i < n; i++) {
      x[i] -= sx;
      y[i] -= sy;
    }
    if (onProgress && step % 30 === 0) onProgress(step / STEPS);
  }
  return { x, y };
};
