import { computeLayout } from './layout.js';

// Draws the graph on one <canvas>. SVG needed a DOM element per link (10k for a real crawl);
// every zoom step rewrote their styles and repainted them all. Here a frame is a few batched
// paths, redrawn at most once per animation frame.
//
// graph: { nodes: [{ id }], links: [{ source: id, target: id }] }, ids sorted for a stable layout
// options:
//   hidden:            ids drawn only once a selected person's links reach them (loners)
//   groupOf:           Map id -> friend group index (colours the dot), see groups.js
//   photos:            Map id -> image URL (profile photos, drawn when zoomed in); setPhotos() later
//   names:             Map id -> real name, shown under the username where there is room
//   theme:             colours, see themeFromCss in viewer.js; setTheme() swaps it later
//   insets():          { right, bottom } px covered by the panel, so focus centres in what is left
//   onViewChange(byUser) on every zoom/pan; byUser is false for programmatic moves
//   onSelectionChange() when a click selects or clears someone
// returns a controller; `ready` resolves once the layout is in and the first frame is drawn.
export function drawGraph(
  canvas,
  graph,
  {
    hidden = new Set(),
    groupOf = new Map(),
    photos = new Map(),
    names = new Map(),
    theme,
    insets = () => ({ right: 0, bottom: 0 }),
    onViewChange,
    onSelectionChange,
  } = {}
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
  let pointedGroup = null; // friend group index being pointed at in the key: it takes over the view
  let heldGroup = null; // a group kept on from the key; someone selected shows over it
  let hoverGroup = null; // the group drawn this frame, from the two above
  let showSel = null; // the selection as drawn this frame (null while a group is shown)
  const shownGroup = () => pointedGroup ?? (selection ? null : heldGroup);

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
  let settling = false; // the worker's positions so far are on screen, not the final ones
  let progress = 0;
  let frameRequested = false;

  function redraw() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      // a frame asked for before destroy() would paint this graph over the next one
      if (!destroyed) draw();
    });
  }

  // On-screen dot size: n.r when zoomed in, shrinking when zoomed out so dots stay smaller
  // than the gaps between them (people sit ~20 graph units apart); hubs are capped by
  // the same gap, or they swallow their neighbours.
  function plainRadius(n) {
    const k = transform.k;
    const shrink = Math.min(1, (8 * k) / nodeRadius);
    return Math.max(1, Math.min(n.r, Math.max(nodeRadius * 1.5, 9 * k)) * shrink);
  }
  // Profile photos replace the dot once a face has room to read; the dot's colour stays as
  // a ring around it. Each photo grows into the space around its person: up to 42% of the
  // distance to the nearest neighbour (n.room, so two neighbours' photos never touch), as
  // far as the zoom allows, and PHOTO_MAX at most. People in a crowd stay dots while the
  // ones out on their own get a big face.
  const PHOTO_MIN = 7;
  const PHOTO_MAX = 36;
  const NAME_FROM = 16; // photo radius from which the real name goes under the username
  const NAME_SCALE = 0.9; // real names a little smaller than usernames
  const photoRadius = (n) => Math.min(PHOTO_MAX, 9 * transform.k, 0.42 * (n.room || 20) * transform.k);
  const hasPhoto = (n) => photos.has(n.id) && photoRadius(n) >= PHOTO_MIN;
  // two-line label: the username, and under it the real name
  const twoLines = (n) => names.has(n.id) && photos.has(n.id) && photoRadius(n) >= NAME_FROM;
  const images = new Map(); // id -> Image, created the first time a photo is drawn
  function photo(n) {
    const src = photos.get(n.id);
    if (!src) return null;
    let img = images.get(n.id);
    if (!img) {
      img = new Image();
      img.onload = redraw;
      img.src = src;
      images.set(n.id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }
  function dotRadius(n) {
    const r = plainRadius(n);
    return hasPhoto(n) ? Math.max(r, photoRadius(n)) : r;
  }
  function drawPhoto(n, r, k) {
    if (!hasPhoto(n)) return;
    const img = photo(n);
    if (!img) return;
    // the group's colour stays readable as a ring: a quarter of the radius, 2 to 4 px
    const inner = (r - (n.group === undefined ? 1 : Math.min(4, Math.max(2, r / 4)))) / k;
    ctx.save();
    ctx.beginPath();
    ctx.arc(n.x, n.y, inner, 0, 2 * Math.PI);
    ctx.clip();
    ctx.imageSmoothingQuality = 'high'; // 150 px photos drawn at ~30 px
    ctx.drawImage(img, n.x - inner, n.y - inner, 2 * inner, 2 * inner);
    ctx.restore();
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

  // Names never overlap each other or anyone's photo: most important first (the
  // selection's people, then by number of connections). Each name tries the right of its
  // person, then the left, then below; one that fits nowhere is skipped. A coarse grid
  // keeps the overlap check cheap. Returns Map person -> { box, x, y, align } in graph
  // units: where the text goes, and the box clicks on the name hit.
  let labelSpots = new Map(); // as last drawn, for clicks
  function placeLabels(visible, k) {
    const placed = new Map();
    const cell = 40 / k;
    const grid = new Map();
    const keys = (x0, y0, x1, y1) => {
      const out = [];
      for (let gx = Math.floor(x0 / cell); gx <= Math.floor(x1 / cell); gx++)
        for (let gy = Math.floor(y0 / cell); gy <= Math.floor(y1 / cell); gy++) out.push(`${gx},${gy}`);
      return out;
    };
    const occupy = (rect) => {
      for (const key of keys(...rect)) {
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(rect);
      }
    };
    // photos are in the way too: a name never covers someone's face
    for (const n of visible) {
      if (!hasPhoto(n)) continue;
      const r = radiusOf(n) / k;
      occupy([n.x - r, n.y - r, n.x + r, n.y + r]);
    }
    const important = (n) => (hoverGroup !== null ? n.group === hoverGroup : revealed.has(n));
    const order = visible
      .filter((n) => n !== showSel?.node)
      .sort((a, b) => important(b) - important(a) || b.degree - a.degree);
    const free = ([x0, y0, x1, y1]) => {
      for (const key of keys(x0, y0, x1, y1)) {
        for (const r of grid.get(key) || []) if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
      }
      return true;
    };
    for (const n of order) {
      const h = (textSize * (twoLines(n) ? 2.4 : 1.15)) / k;
      const w = (labelWidth(n) + 3) / k;
      const gap = (radiusOf(n) + textDx) / k;
      const spots = [
        { box: [n.x + gap, n.y - h / 2, n.x + gap + w, n.y + h / 2], x: n.x + gap, y: n.y, align: 'left' },
        { box: [n.x - gap - w, n.y - h / 2, n.x - gap, n.y + h / 2], x: n.x - gap, y: n.y, align: 'right' },
      ];
      // below only for photos: under a dot the name would read as the next person's
      if (hasPhoto(n)) {
        const top = n.y + (radiusOf(n) + 3) / k;
        spots.push({ box: [n.x - w / 2, top, n.x + w / 2, top + h], x: n.x, y: top + h / 2, align: 'center' });
      }
      const spot = spots.find((c) => free(c.box));
      if (!spot) continue;
      occupy(spot.box);
      placed.set(n, spot);
    }
    labelSpots = placed;
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
    if (!laidOut && !settling) {
      ctx.fillStyle = colors.muted;
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Laying out ${nodes.length} people… ${Math.round(progress * 100)}%`, width / 2, height / 2);
      ctx.textAlign = 'start';
      return;
    }
    hoverGroup = shownGroup();
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
      for (const [, batch] of batches) for (const n of batch) drawPhoto(n, radiusOf(n), k);
    }

    // names, decluttered; hidden when zoomed far out (they would be a few unreadable ones)
    labelSpots = new Map();
    if (laidOut && (k > 0.25 || showSel)) {
      const placed = placeLabels(visible, k);
      ctx.textBaseline = 'middle';
      const line = (textSize * 0.62) / k; // half the gap between the two lines' centres
      for (const alpha of [0.1, 0.85, 1]) {
        ctx.globalAlpha = alpha;
        ctx.font = `${textSize / k}px system-ui, sans-serif`;
        ctx.fillStyle = colors.text;
        for (const [n, spot] of placed) {
          if (opacity(n) !== alpha) continue;
          ctx.textAlign = spot.align;
          ctx.fillText(n.id, spot.x, twoLines(n) ? spot.y - line : spot.y);
        }
        ctx.font = `${(textSize * NAME_SCALE) / k}px system-ui, sans-serif`;
        ctx.fillStyle = colors.muted;
        for (const [n, spot] of placed) {
          if (opacity(n) !== alpha || !twoLines(n)) continue;
          ctx.textAlign = spot.align;
          ctx.fillText(names.get(n.id), spot.x, spot.y + line);
        }
      }
      ctx.textAlign = 'start';
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
      drawPhoto(n, radiusOf(n), k);
      ctx.font = `600 ${(textSize * 1.6) / k}px system-ui, sans-serif`;
      ctx.lineWidth = 4 / k;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = colors.bg;
      const name = names.get(n.id);
      const up = name ? (textSize * 0.55) / k : 0;
      ctx.strokeText(n.id, labelX(n, k), n.y - up);
      ctx.fillStyle = colors.text;
      ctx.fillText(n.id, labelX(n, k), n.y - up);
      if (name) {
        // the selected person's real name, always (their panel shows it too)
        ctx.font = `${textSize / k}px system-ui, sans-serif`;
        const y = n.y + (textSize * 0.95) / k;
        ctx.strokeText(name, labelX(n, k), y);
        ctx.fillStyle = colors.muted;
        ctx.fillText(name, labelX(n, k), y);
      }
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
      const name = names.get(n.id);
      n.nameWidth = name ? measure.measureText(name).width * NAME_SCALE : 0;
    }
    return twoLines(n) ? Math.max(n.labelWidth, n.nameWidth) : n.labelWidth;
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
    // with someone selected only the highlighted people respond: a faded one reads as
    // background, so clicking there clears the selection like clicking empty space
    const onlyRevealed = selection !== null && shownGroup() === null;
    for (const n of nodes) {
      if ((n.hidden || onlyRevealed) && !revealed.has(n)) continue;
      const reach = Math.max(mobile ? 14 : 8, radiusOf(n) + 4) / k;
      const d = (n.x - gx) ** 2 + (n.y - gy) ** 2;
      if (d < reach * reach && d < bestD) {
        bestD = d;
        best = n;
      }
      if (!best) {
        // a name hits where it was drawn; the selected person's sits on their right, bigger
        if (n === selection?.node) {
          const left = labelX(n, k);
          const half = (textSize * 1.6 * 0.6) / k;
          if (gx >= left && gx <= left + (labelWidth(n) * 1.6) / k && Math.abs(gy - n.y) <= half) label = n;
        } else {
          const box = labelSpots.get(n)?.box;
          if (box && gx >= box[0] && gx <= box[2] && gy >= box[1] && gy <= box[3]) label = n;
        }
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

  // People can't be dragged: on phones a pinch that started on someone moved them
  // instead of zooming, and it kept a live simulation around for little use.
  canvasSel.call(zoom);

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
  function fitTransform() {
    let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const n of nodes) {
      if (n.hidden) continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.y > maxY) maxY = n.y;
    }
    const k = Math.min(4, 0.9 * Math.min(width / (maxX - minX || 1), height / (maxY - minY || 1)));
    return d3.zoomIdentity.translate(width / 2 - (k * (minX + maxX)) / 2, height / 2 - (k * (minY + maxY)) / 2).scale(k);
  }
  function fitToView() {
    canvasSel.call(zoom.transform, fitTransform());
  }

  const linkIndexes = new Int32Array(links.length * 2);
  links.forEach((l, i) => {
    linkIndexes[2 * i] = l.source.index;
    linkIndexes[2 * i + 1] = l.target.index;
  });
  const layout = computeLayout(
    nodes.map((n) => n.id),
    linkIndexes,
    (p, partial) => {
      progress = p;
      if (partial && !laidOut && !destroyed) {
        // draw the graph settling, fitted to the screen, until the final positions come
        nodes.forEach((n, i) => {
          n.x = partial[2 * i];
          n.y = partial[2 * i + 1];
        });
        transform = fitTransform();
        settling = true;
        if (!canvas.dataset.frame) canvas.dataset.frame = '1';
      }
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
    // Room around each person: distance to the nearest one shown. Plain pairs: ~0.3 M
    // checks for 500 people, once; a grid would be needed for graphs ten times bigger.
    const shownNodes = nodes.filter((d) => !d.hidden);
    for (const n of nodes) {
      let best = Infinity;
      for (const m of shownNodes) {
        if (m === n) continue;
        const d = (m.x - n.x) ** 2 + (m.y - n.y) ** 2;
        if (d < best) best = d;
      }
      n.room = Number.isFinite(best) ? Math.sqrt(best) : 20;
    }
    laidOut = true;
    settling = false;
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
      pointedGroup = index ?? null;
      redraw();
    },
    // keeps a group on while the graph is panned and its people clicked; null lets go
    holdGroup: (index) => {
      heldGroup = index ?? null;
      redraw();
    },
    setPhotos: (next) => {
      photos = next;
      images.clear();
      redraw();
    },
    // real names that arrived after the graph was drawn
    setNames: (next) => {
      names = next;
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
      canvasSel.interrupt().on('.zoom', null);
      canvas.removeEventListener('click', onClick);
      window.removeEventListener('resize', resize);
      delete canvas.dataset.ready;
      delete canvas.dataset.frame;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
