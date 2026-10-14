import { computeLayout } from './layout.js';

// Draws the graph on one <canvas>. SVG needed a DOM element per link (10k for a real crawl);
// every zoom step rewrote their styles and repainted them all. Here a frame is a few batched
// paths, redrawn at most once per animation frame.
//
// graph: { nodes: [{ id }], links: [{ source: id, target: id }] }, ids sorted for a stable layout
// options:
//   hidden:            ids drawn only once a selected person's links reach them (loners)
//   groupOf:           Map id -> friend group index (colours the dot), see groups.js
//   theme:             colours, see themeFromCss in viewer.js; setTheme() swaps it later
//   insets():          { right, bottom } px covered by the panel, so focus centres in what is left
//   onViewChange(byUser) on every zoom/pan; byUser is false for programmatic moves
//   onSelectionChange() when a click selects or clears someone
// returns a controller; `ready` resolves once the layout is in and the first frame is drawn.
export function drawGraph(
  canvas,
  graph,
  { hidden = new Set(), groupOf = new Map(), theme, insets = () => ({ right: 0, bottom: 0 }), onViewChange, onSelectionChange } = {}
) {
  const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const nodeRadius = mobile ? 3.5 : 2;
  const maxRadius = nodeRadius * 5;
  const textSize = mobile ? 13 : 12;
  const linkWidth = mobile ? 1.5 : 1;
  const nodeStroke = mobile ? 1.5 : 1;
  const textDx = 6;
  // ~0.04 for a few thousand links (where they pile up into clusters); small graphs need
  // their few lines visible
  const linkOpacity = Math.min(0.35, Math.max(0.04, 4 / Math.sqrt(graph.links.length || 1)));
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let colors = theme;

  let ctx = canvas.getContext('2d');
  const canvasSel = d3.select(canvas);
  let width = 0;
  let height = 0;
  let dpr = 1;
  function resize() {
    // phones report 3x; 2x looks the same on a graph and is 44% fewer pixels to fill
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    redraw();
  }

  // ---- data -------------------------------------------------------------------------
  const nodes = graph.nodes.map((n, index) => ({
    id: n.id,
    index,
    x: 0,
    y: 0,
    hidden: hidden.has(n.id),
    group: groupOf.get(n.id),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const links = graph.links
    .map((l) => ({ source: byId.get(l.source), target: byId.get(l.target) }))
    .filter((l) => l.source && l.target);
  for (const l of links) l.hidden = l.source.hidden || l.target.hidden;
  const outgoing = new Map(nodes.map((n) => [n.id, []]));
  const incoming = new Map(nodes.map((n) => [n.id, []]));
  for (const l of links) {
    outgoing.get(l.source.id).push(l);
    incoming.get(l.target.id).push(l);
  }
  // dot size grows with connections (square root, so hubs stand out without swallowing
  // their neighbours), in screen pixels
  for (const n of nodes) {
    const degree = outgoing.get(n.id).length + incoming.get(n.id).length;
    n.degree = degree;
    n.r = Math.min(maxRadius, nodeRadius * (0.8 + Math.sqrt(degree) / 3.2));
  }

  // ---- selection --------------------------------------------------------------------
  // { node, links: { follower, following, mutual } }; follower = X -> them only,
  // following = them -> X only, mutual = X -> them where they also follow X
  let selection = null;
  let only = null; // one category, or null for all three
  let revealed = new Set(); // people shown at full strength for the current selection
  let hoverGroup = null; // friend group index being pointed at in the key: it takes over the view
  let showSel = null; // the selection as drawn this frame (null while a group is hovered)

  function selectNode(node) {
    if (!node) {
      selection = null;
      revealed = new Set();
      redraw();
      return;
    }
    const outs = outgoing.get(node.id);
    const ins = incoming.get(node.id);
    const followsBack = new Set(outs.map((l) => l.target.id));
    const followedBy = new Set(ins.map((l) => l.source.id));
    selection = {
      node,
      links: {
        follower: ins.filter((l) => !followsBack.has(l.source.id)),
        following: outs.filter((l) => !followedBy.has(l.target.id)),
        mutual: ins.filter((l) => followsBack.has(l.source.id)),
      },
    };
    paint();
  }

  function paint(category = null) {
    only = category;
    revealed = new Set(selection ? [selection.node] : []);
    if (selection) {
      for (const [cat, catLinks] of Object.entries(selection.links)) {
        if (only && only !== cat) continue;
        for (const l of catLinks) revealed.add(l.source === selection.node ? l.target : l.source);
      }
    }
    redraw();
  }

  // ---- drawing ----------------------------------------------------------------------
  let transform = d3.zoomIdentity;
  let laidOut = false;
  let progress = 0;
  let frameRequested = false;

  function redraw() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      draw();
    });
  }

  // On-screen dot size: n.r when zoomed in, shrinking when zoomed out so dots stay smaller
  // than the gaps between them (people sit ~20 graph units apart); hubs are capped by
  // the same gap, or they swallow their neighbours.
  function dotRadius(n) {
    const k = transform.k;
    const shrink = Math.min(1, (8 * k) / nodeRadius);
    return Math.max(1, Math.min(n.r, Math.max(nodeRadius * 1.5, 9 * k)) * shrink);
  }
  const radiusOf = (n) => (n === selection?.node ? Math.max(dotRadius(n) + 3, nodeRadius * 2) : dotRadius(n));
  const labelX = (n, k) => n.x + (radiusOf(n) + textDx) / k;

  function arrowhead(l, k) {
    // tip just short of the followed person's dot
    const dx = l.target.x - l.source.x;
    const dy = l.target.y - l.source.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const back = (radiusOf(l.target) + 2) / k;
    const size = (6 * linkWidth) / k;
    const tipX = l.target.x - ux * back;
    const tipY = l.target.y - uy * back;
    const baseX = tipX - ux * size;
    const baseY = tipY - uy * size;
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(baseX - (uy * size) / 2, baseY + (ux * size) / 2);
    ctx.lineTo(baseX + (uy * size) / 2, baseY - (ux * size) / 2);
    ctx.closePath();
  }

  // Names never overlap: most important first (the selection's people, then by number of
  // connections), and a name that would cover one already placed is skipped. A coarse grid
  // keeps the overlap check cheap.
  function placeLabels(visible, k) {
    const placed = new Set();
    const h = (textSize * 1.15) / k;
    const cell = 40 / k;
    const grid = new Map();
    const keys = (x0, y0, x1, y1) => {
      const out = [];
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
        for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) out.push(`${gx},${gy}`);
      return out;
    };
    const important = (n) => (hoverGroup !== null ? n.group === hoverGroup : revealed.has(n));
    const order = visible
      .filter((n) => n !== showSel?.node)
      .sort((a, b) => important(b) - important(a) || b.degree - a.degree);
    for (const n of order) {
      const x0 = labelX(n, k);
      const y0 = n.y - h / 2;
      const x1 = x0 + (labelWidth(n) + 3) / k;
      const y1 = y0 + h;
      const cells = keys(x0, y0, x1, y1);
      let clash = false;
      for (const key of cells) {
        for (const r of grid.get(key) || []) {
          if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) {
            clash = true;
            break;
          }
        }
        if (clash) break;
      }
      if (clash) continue;
      const rect = [x0, y0, x1, y1];
      for (const key of cells) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rect);
      }
      placed.add(n);
    }
    return placed;
  }

  // ---- gestures: move a picture instead of redrawing 10k lines every frame ----------
  // While a pan, pinch, wheel or animated move is running, frames reuse a snapshot of the
  // scene (rendered once, with a margin around the screen, at 1x) and only move and
  // scale it; the full-quality frame comes back when the gesture ends. A slight blur
  // while moving, but smooth on phones.
  const SNAPSHOT_MARGIN = 0.5; // extra screen size on each side, for panning/zooming out
  let gesture = null; // { start: transform, events, snap }

  function makeSnapshot(t0) {
    const m = SNAPSHOT_MARGIN;
    const w = width * (1 + 2 * m);
    const h = height * (1 + 2 * m);
    const ratio = mobile ? 1 : Math.min(dpr, 1.5);
    const snap = document.createElement('canvas');
    snap.width = Math.round(w * ratio);
    snap.height = Math.round(h * ratio);
    const saved = { ctx, transform, width, height, dpr };
    ctx = snap.getContext('2d');
    transform = d3.zoomIdentity.translate(t0.x + m * width, t0.y + m * height).scale(t0.k);
    width = w;
    height = h;
    dpr = ratio;
    drawScene();
    ({ ctx, transform, width, height, dpr } = saved);
    return { canvas: snap, t0 };
  }

  function draw() {
    const snap = gesture?.snap;
    if (!snap) return drawScene();
    const m = SNAPSHOT_MARGIN;
    const r = transform.k / snap.t0.k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(dpr * r, 0, 0, dpr * r, dpr * (transform.x - r * snap.t0.x), dpr * (transform.y - r * snap.t0.y));
    ctx.drawImage(snap.canvas, -m * width, -m * height, width * (1 + 2 * m), height * (1 + 2 * m));
  }

  function drawScene() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, width, height);
    if (!laidOut) {
      ctx.fillStyle = colors.muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Laying out ${nodes.length} people… ${Math.round(progress * 100)}%`, width / 2, height / 2);
      ctx.textAlign = 'start';
      return;
    }
    showSel = hoverGroup === null ? selection : null;
    const { x, y, k } = transform;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    // what is on screen, in graph coordinates, with a margin for labels
    const pad = 200 / k;
    const left = -x / k - pad;
    const top = -y / k - pad;
    const right = (width - x) / k + pad;
    const bottom = (height - y) / k + pad;
    const onScreen = (n) => n.x >= left && n.x <= right && n.y >= top && n.y <= bottom;

    // every link, faint; on the dark theme they add up into a glow
    // ('lighter' blending is slow on phones, so they get the plain version)
    const glow = colors.glow && !mobile;
    if (glow) ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = glow ? Math.min(0.5, linkOpacity * 3.5) : colors.glow ? linkOpacity * 2 : linkOpacity;
    ctx.strokeStyle = colors.link;
    ctx.lineWidth = linkWidth / k;
    ctx.beginPath();
    for (const l of links) {
      if (l.hidden) continue;
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
    }
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';

    // a hovered friend group: the lines between its people, in its colour
    if (hoverGroup !== null) {
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colors.groups[hoverGroup] || colors.node;
      ctx.lineWidth = (linkWidth * 1.5) / k;
      ctx.beginPath();
      for (const l of links) {
        if (l.source.group !== hoverGroup || l.target.group !== hoverGroup) continue;
        ctx.moveTo(l.source.x, l.source.y);
        ctx.lineTo(l.target.x, l.target.y);
      }
      ctx.stroke();
    }

    // the selected person's links, by category, with arrowheads on the followed end;
    // mutual links are heavier, so the three groups differ by more than colour
    if (showSel) {
      // hundreds of strong lines turn into a solid wash: fade them as their number grows
      const drawn = Object.entries(showSel.links).reduce((sum, [c, l]) => sum + (only && only !== c ? 0 : l.length), 0);
      ctx.globalAlpha = Math.max(0.25, Math.min(0.85, 0.85 * Math.sqrt(40 / Math.max(1, drawn))));
      for (const [cat, catLinks] of Object.entries(showSel.links)) {
        if (only && only !== cat) continue;
        ctx.strokeStyle = ctx.fillStyle = colors[cat];
        ctx.lineWidth = (cat === 'mutual' ? linkWidth * 1.6 : linkWidth) / k;
        ctx.beginPath();
        for (const l of catLinks) {
          ctx.moveTo(l.source.x, l.source.y);
          ctx.lineTo(l.target.x, l.target.y);
        }
        ctx.stroke();
        ctx.beginPath();
        for (const l of catLinks) {
          arrowhead(l, k);
          if (cat === 'mutual') arrowhead({ source: l.target, target: l.source }, k);
        }
        ctx.fill();
      }
    }

    // dots, batched by opacity and colour: with a selection, everyone else fades to 0.1
    const opacity = (n) =>
      hoverGroup !== null ? (n.group === hoverGroup ? 1 : 0.1) : (!showSel ? 1 : n === showSel.node ? 1 : revealed.has(n) ? 0.85 : 0.1);
    const visible = nodes.filter((n) => (!n.hidden || revealed.has(n)) && onScreen(n));
    for (const alpha of [0.1, 0.85, 1]) {
      const batches = new Map();
      for (const n of visible) {
        if (n === showSel?.node || opacity(n) !== alpha) continue;
        const fill = colors.groups[n.group] || colors.node;
        if (!batches.has(fill)) batches.set(fill, []);
        batches.get(fill).push(n);
      }
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = colors.bg;
      ctx.lineWidth = nodeStroke / k;
      for (const [fill, batch] of batches) {
        ctx.beginPath();
        for (const n of batch) {
          const r = radiusOf(n) / k;
          ctx.moveTo(n.x + r, n.y);
          ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
        }
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.stroke();
      }
    }

    // names, decluttered; hidden when zoomed far out (they would be a few unreadable ones)
    if (k > 0.25 || showSel) {
      const placed = placeLabels(visible, k);
      ctx.font = `${textSize / k}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = colors.text;
      for (const alpha of [0.1, 0.85, 1]) {
        ctx.globalAlpha = alpha;
        for (const n of placed) if (opacity(n) === alpha) ctx.fillText(n.id, labelX(n, k), n.y);
      }
    }

    // the selected person on top: bigger, outlined, name with a halo
    if (showSel) {
      const n = showSel.node;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, radiusOf(n) / k, 0, 2 * Math.PI);
      ctx.fillStyle = colors.bg;
      ctx.fill();
      ctx.strokeStyle = colors.text;
      ctx.lineWidth = (nodeStroke * 2) / k;
      ctx.stroke();
      ctx.font = `600 ${(textSize * 1.6) / k}px system-ui, sans-serif`;
      ctx.lineWidth = 4 / k;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(n.id, labelX(n, k), n.y);
      ctx.fillStyle = colors.text;
      ctx.fillText(n.id, labelX(n, k), n.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- interaction ------------------------------------------------------------------
  // Label width in screen pixels at the base font size, measured once per person.
  const measure = document.createElement('canvas').getContext('2d');
  function labelWidth(n) {
    if (n.labelWidth === undefined) {
      measure.font = `${textSize}px system-ui, sans-serif`;
      n.labelWidth = measure.measureText(n.id).width;
    }
    return n.labelWidth;
  }

  // The person under the pointer: their dot (nearest within a few pixels) or their name,
  // which the SVG version treated as part of the same shape.
  function nodeAt(px, py) {
    const gx = transform.invertX(px);
    const gy = transform.invertY(py);
    const k = transform.k;
    let best = null;
    let bestD = Infinity;
    let label = null;
    for (const n of nodes) {
      if (n.hidden && !revealed.has(n)) continue;
      const reach = Math.max(mobile ? 14 : 8, radiusOf(n) + 4) / k;
      const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
      if (d < reach * reach && d < bestD) {
        bestD = d;
        best = n;
      }
      if (!best) {
        const scale = n === selection?.node ? 1.6 : 1;
        const left = labelX(n, k);
        const half = (textSize * scale * 0.6) / k;
        if (gx >= left && gx <= left + (labelWidth(n) * scale) / k && Math.abs(gy - n.y) <= half) label = n;
      }
    }
    return best || label;
  }

  const zoom = d3
    .zoom()
    .scaleExtent([0.01, 40])
    .on('start', () => {
      gesture = { start: transform, events: 0, snap: null };
    })
    .on('end', () => {
      gesture = null;
      redraw();
    })
    .on('zoom', () => {
      transform = d3.event.transform;
      // a one-off jump (fit, restoring a link's view) never needs the snapshot; from the
      // second step of a real gesture on, frames use it
      if (gesture && ++gesture.events === 2 && laidOut) gesture.snap = makeSnapshot(gesture.start);
      redraw();
      onViewChange?.(!!d3.event.sourceEvent);
    });

  // Dragging a person nudges the layout like before. The settled layout comes from the
  // worker; a main-thread simulation is built only when someone is dragged.
  let simulation = null;
  function liveSimulation() {
    if (!simulation) {
      const idx = links.map((l) => ({ source: l.source.index, target: l.target.index }));
      simulation = self.buildSimulation(d3, nodes, idx).alpha(0).stop().on('tick', redraw);
    }
    return simulation;
  }
  const drag = d3
    .drag()
    .container(canvas)
    .subject(() => {
      if (!laidOut) return null;
      const n = nodeAt(d3.event.x, d3.event.y);
      return n ? { node: n, x: d3.event.x, y: d3.event.y } : null;
    })
    .on('start', () => {
      if (!d3.event.active) liveSimulation().alphaTarget(0.01).restart();
      const { node } = d3.event.subject;
      node.fx = node.x;
      node.fy = node.y;
    })
    .on('drag', () => {
      const { node } = d3.event.subject;
      node.fx = transform.invertX(d3.event.x);
      node.fy = transform.invertY(d3.event.y);
    })
    .on('end', () => {
      if (!d3.event.active) liveSimulation().alphaTarget(0);
      const { node } = d3.event.subject;
      node.fx = null;
      node.fy = null;
    });
  // drag first: when it finds a person under the pointer it stops the event, so the
  // zoom behaviour does not pan at the same time
  canvasSel.call(drag).call(zoom);

  function onClick(e) {
    if (!laidOut) return;
    const rect = canvas.getBoundingClientRect();
    const n = nodeAt(e.clientX - rect.left, e.clientY - rect.top);
    selectNode(n);
    onSelectionChange?.();
    if (n) keepClearOfPanel(n);
  }

  // The panel opens over the right edge (bottom on phones): someone clicked there would
  // end up under their own panel, so pan them to the middle of the free area, same zoom.
  function keepClearOfPanel(n) {
    const { right, bottom } = insets();
    const margin = 24 + (n.r + textDx) * 2;
    const sx = transform.applyX(n.x);
    const sy = transform.applyY(n.y);
    if (sx < width - right - margin && sy < height - bottom - margin) return;
    const k = transform.k;
    canvasSel
      .transition()
      .duration(reduceMotion.matches ? 0 : 400)
      .call(zoom.transform, d3.zoomIdentity.translate((width - right) / 2 - k * n.x, (height - bottom) / 2 - k * n.y).scale(k));
  }
  canvas.addEventListener('click', onClick);
  window.addEventListener('resize', resize);
  resize();

  // ---- layout + view ----------------------------------------------------------------
  let centroid = { x: 0, y: 0 };
  function fitToView() {
    const shown = nodes.filter((n) => !n.hidden);
    const xs = shown.map((d) => d.x);
    const ys = shown.map((d) => d.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = Math.min(4, 0.9 * Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1)));
    canvasSel.call(
      zoom.transform,
      d3.zoomIdentity.translate(width / 2 - (k * (minX + maxX)) / 2, height / 2 - (k * (minY + maxY)) / 2).scale(k)
    );
  }

  const linkIndexes = new Int32Array(links.length * 2);
  links.forEach((l, i) => {
    linkIndexes[2 * i] = l.source.index;
    linkIndexes[2 * i + 1] = l.target.index;
  });
  const layout = computeLayout(
    nodes.map((n) => n.id),
    linkIndexes,
    (p) => {
      progress = p;
      redraw();
    }
  );
  let destroyed = false;
  const ready = layout.positions.then((positions) => {
    if (destroyed) return;
    nodes.forEach((n, i) => {
      n.x = positions[2 * i];
      n.y = positions[2 * i + 1];
    });
    // Views are stored relative to the layout's centroid, so a view saved on one screen
    // size lands on the same spot on another.
    centroid = {
      x: nodes.reduce((sum, d) => sum + d.x, 0) / nodes.length,
      y: nodes.reduce((sum, d) => sum + d.y, 0) / nodes.length,
    };
    laidOut = true;
    canvas.dataset.ready = '1';
    fitToView();
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  });

  const selectedGroups = () =>
    selection &&
    Object.fromEntries(
      Object.entries(selection.links).map(([cat, catLinks]) => [
        cat,
        catLinks.map((l) => (l.source === selection.node ? l.target : l.source).id),
      ])
    );

  return {
    ready,
    cached: layout.cached,
    hasSelection: () => selection !== null,
    selected: () => selection?.node.id ?? null,
    ids: () => nodes.map((n) => n.id),
    // null shows all three categories again
    showOnly: (category) => selection && paint(category),
    counts: () =>
      selection && Object.fromEntries(Object.entries(selection.links).map(([c, l]) => [c, l.length])),
    // usernames per category for the selected person
    people: selectedGroups,
    clear: () => selectNode(null),
    // null when the pointer leaves the group in the key
    highlightGroup: (index) => {
      hoverGroup = index ?? null;
      redraw();
    },
    setTheme: (next) => {
      colors = next;
      redraw();
    },
    // Selects a person as if clicked, without moving the view.
    select: (username) => {
      const n = byId.get(username);
      if (!n) return false;
      selectNode(n);
      return true;
    },
    // Selects a person and pans to them, zooming in enough to read names; centres in the
    // part of the screen the panel leaves free.
    focus: (username) => {
      const n = byId.get(username);
      if (!n) return false;
      selectNode(n);
      if (!laidOut) return true;
      // zoom so most of their people fit around them (the farthest 10% may stay off
      // screen: loners sit far out), between a wide view and a close one
      const { right, bottom } = insets();
      const free = Math.min(width - right, height - bottom - 60);
      const distances = [...revealed]
        .filter((m) => m !== n)
        .map((m) => Math.hypot(m.x - n.x, m.y - n.y))
        .sort((a, b) => a - b);
      const reach = distances.length ? distances[Math.floor((distances.length - 1) * 0.9)] : 0;
      const k = reach ? Math.max(0.3, Math.min(2.5, (0.45 * free) / reach)) : Math.max(transform.k, 2);
      const cx = (width - right) / 2;
      const cy = (height - bottom) / 2;
      canvasSel
        .transition()
        .duration(reduceMotion.matches ? 0 : 600)
        .call(zoom.transform, d3.zoomIdentity.translate(cx - k * n.x, cy - k * n.y).scale(k));
      return true;
    },
    view: () =>
      laidOut
        ? {
            x: (width / 2 - transform.x) / transform.k - centroid.x,
            y: (height / 2 - transform.y) / transform.k - centroid.y,
            k: transform.k,
          }
        : null,
    setView: ({ x, y, k }) => {
      if (!laidOut) return;
      canvasSel.call(
        zoom.transform,
        d3.zoomIdentity.translate(width / 2 - k * (x + centroid.x), height / 2 - k * (y + centroid.y)).scale(k)
      );
    },
    destroy: () => {
      destroyed = true;
      layout.cancel();
      simulation?.stop();
      canvasSel.interrupt().on('.zoom', null).on('.drag', null);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('resize', resize);
      delete canvas.dataset.ready;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
