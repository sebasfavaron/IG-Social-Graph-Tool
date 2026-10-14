import { computeLayout } from './layout.js';

// Draws the graph on one <canvas>. SVG needed a DOM element per link (10k for a real crawl);
// every zoom step rewrote their styles and repainted them all. Here a frame is a few batched
// paths, redrawn at most once per animation frame.
//
// graph: { nodes: [{ id }], links: [{ source: id, target: id }] }, ids sorted for a stable layout
// options:
//   hidden:            ids drawn only once a selected person's links reach them (loners)
//   onViewChange(byUser) on every zoom/pan; byUser is false for programmatic moves
//   onSelectionChange() when a click selects or clears someone
// returns a controller; `ready` resolves once the layout is in and the first frame is drawn.
export function drawGraph(canvas, graph, { hidden = new Set(), onViewChange, onSelectionChange } = {}) {
  const mobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const nodeRadius = mobile ? 6 : 2;
  const textSize = mobile ? 24 : 12;
  const linkWidth = mobile ? 2 : 1;
  const nodeStroke = mobile ? 2 : 1;
  const textDx = 10;
  // ~0.04 for a few thousand links (where they pile up into clusters); small graphs need
  // their few lines visible
  const linkOpacity = Math.min(0.35, Math.max(0.04, 4 / Math.sqrt(graph.links.length || 1)));
  const linkColor = '#868585';
  const colors = { follower: '#ca2d2d', following: 'green', mutual: 'purple' };

  const ctx = canvas.getContext('2d');
  const canvasSel = d3.select(canvas);
  let width = 0;
  let height = 0;
  let dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || window.innerWidth;
    height = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    redraw();
  }

  // ---- data -------------------------------------------------------------------------
  const nodes = graph.nodes.map((n, index) => ({ id: n.id, index, x: 0, y: 0, hidden: hidden.has(n.id) }));
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

  // ---- selection --------------------------------------------------------------------
  // { node, links: { follower, following, mutual } }; follower = X -> them only,
  // following = them -> X only, mutual = X -> them where they also follow X
  let selection = null;
  let only = null; // one category, or null for all three
  let revealed = new Set(); // hidden nodes to show for the current selection

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

  function arrowhead(l, k) {
    // tip just short of the followed person's circle, like the old SVG marker
    const dx = l.target.x - l.source.x;
    const dy = l.target.y - l.source.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const back = (l.target === selection?.node ? nodeRadius * 2 + 2 : nodeRadius + 2) / k;
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

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!laidOut) {
      ctx.fillStyle = '#6b6b6b';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Laying out ${nodes.length} people… ${Math.round(progress * 100)}%`, width / 2, height / 2);
      ctx.textAlign = 'start';
      return;
    }
    const { x, y, k } = transform;
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * x, dpr * y);
    // what is on screen, in graph coordinates, with a margin for labels
    const pad = 200 / k;
    const left = -x / k - pad;
    const top = -y / k - pad;
    const right = (width - x) / k + pad;
    const bottom = (height - y) / k + pad;
    const onScreen = (n) => n.x >= left && n.x <= right && n.y >= top && n.y <= bottom;

    // every link, faint
    ctx.globalAlpha = linkOpacity;
    ctx.strokeStyle = linkColor;
    ctx.lineWidth = linkWidth / k;
    ctx.beginPath();
    for (const l of links) {
      if (l.hidden) continue;
      ctx.moveTo(l.source.x, l.source.y);
      ctx.lineTo(l.target.x, l.target.y);
    }
    ctx.stroke();

    // the selected person's links, by category, with arrowheads on the followed end
    if (selection) {
      ctx.globalAlpha = 0.8;
      for (const [cat, catLinks] of Object.entries(selection.links)) {
        if (only && only !== cat) continue;
        ctx.strokeStyle = ctx.fillStyle = colors[cat];
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

    // nodes, batched by opacity: with a selection, everyone else fades to 0.1
    const opacity = (n) => (!selection ? 1 : n === selection.node ? 1 : revealed.has(n) ? 0.8 : 0.1);
    const visible = nodes.filter((n) => (!n.hidden || revealed.has(n)) && onScreen(n));
    const r = nodeRadius / k;
    for (const alpha of [0.1, 0.8, 1]) {
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (const n of visible) {
        if (n === selection?.node || opacity(n) !== alpha) continue;
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
      }
      ctx.fillStyle = 'black';
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = nodeStroke / k;
      ctx.stroke();
    }

    // labels: when zoomed in, or always while someone is selected (as before)
    if (k > 1 || selection) {
      ctx.font = `${textSize / k}px Arial`;
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'black';
      for (const alpha of [0.1, 0.8, 1]) {
        ctx.globalAlpha = alpha;
        for (const n of visible) {
          if (n === selection?.node || opacity(n) !== alpha) continue;
          ctx.fillText(n.id, n.x + textDx / k, n.y);
        }
      }
    }

    // the selected person on top: bigger, white with a black outline
    if (selection) {
      const n = selection.node;
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, (nodeRadius * 2) / k, 0, 2 * Math.PI);
      ctx.fillStyle = 'white';
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.lineWidth = nodeStroke / k;
      ctx.stroke();
      ctx.font = `${(textSize * 2) / k}px Arial`;
      ctx.lineWidth = 3 / k;
      ctx.lineJoin = 'round';
      ctx.strokeText(n.id, n.x + textDx / k, n.y);
      ctx.fillText(n.id, n.x + textDx / k, n.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- interaction ------------------------------------------------------------------
  // nearest visible person within a few pixels of the pointer
  function nodeAt(px, py) {
    const gx = transform.invertX(px);
    const gy = transform.invertY(py);
    const reach = Math.max(8, nodeRadius * 2 + 4) / transform.k;
    let best = null;
    let bestD = reach * reach;
    for (const n of nodes) {
      if (n.hidden && !revealed.has(n)) continue;
      const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  const zoom = d3
    .zoom()
    .scaleExtent([0.01, 40])
    .on('zoom', () => {
      transform = d3.event.transform;
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
    selectNode(nodeAt(e.clientX - rect.left, e.clientY - rect.top));
    onSelectionChange?.();
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
    // Selects a person as if clicked, without moving the view.
    select: (username) => {
      const n = byId.get(username);
      if (!n) return false;
      selectNode(n);
      return true;
    },
    // Selects a person and pans to them, zooming in enough to read names.
    focus: (username) => {
      const n = byId.get(username);
      if (!n) return false;
      selectNode(n);
      if (!laidOut) return true;
      const k = Math.max(transform.k, 2);
      canvasSel
        .transition()
        .duration(600)
        .call(zoom.transform, d3.zoomIdentity.translate(width / 2 - k * n.x, height / 2 - k * n.y).scale(k));
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
