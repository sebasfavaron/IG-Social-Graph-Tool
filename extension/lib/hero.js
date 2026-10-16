// The site's front page for someone who has not mapped anyone yet: a made-up graph drawn
// behind the headline, slowly turning, lighting one friend group at a time. Nobody real
// is in it: six groups of invented people, laid out by the same forceLayout as a crawl,
// so it looks like what the visitor will get.
import './forceLayout.js'; // classic script: sets self.forceLayout

const GROUPS = [22, 18, 16, 14, 12, 9];
const TURN_MS = 240_000; // one full turn every 4 minutes
const GROUP_MS = 3_200; // each group stays lit this long

// seeded, so the picture is the same on every visit (and in the link preview)
function made(seed = 7) {
  const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const groupOf = [];
  GROUPS.forEach((size, g) => {
    for (let i = 0; i < size; i++) groupOf.push(g);
  });
  const n = groupOf.length;
  const links = [];
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (groupOf[a] === groupOf[b] ? rand() < Math.min(0.75, 8 / GROUPS[groupOf[a]]) : rand() < 0.014) links.push(a, b);
    }
  }
  const { x, y } = self.forceLayout(n, Int32Array.from(links));
  // centred on the middle of the picture, scaled to a radius of 1
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) (cx += x[i]), (cy += y[i]);
  cx /= n;
  cy /= n;
  // by the 95th percentile, so a stray person or two does not shrink everyone else
  const far = Array.from(x, (_, i) => Math.hypot(x[i] - cx, y[i] - cy)).sort((a, b) => a - b);
  const r = far[Math.floor(n * 0.95)];
  for (let i = 0; i < n; i++) (x[i] = (x[i] - cx) / r), (y[i] = (y[i] - cy) / r);
  return { n, x, y, groupOf, links };
}

function colours() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  return { link: v('--link'), groups: GROUPS.map((_, g) => v(`--g${g + 1}`)) };
}

// drawHero(canvas) -> { stop() }. With reduced motion: one still frame, no group lighting.
export function drawHero(canvas) {
  const graph = made();
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ctx = canvas.getContext('2d');
  let palette = colours();
  let lastPalette = 0;
  let frame = 0;
  const start = performance.now();

  function paint(now) {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    if (now - lastPalette > 500) {
      palette = colours(); // follows the theme button without being told
      lastPalette = now;
    }
    const t = still ? 0 : now - start;
    const angle = (t / TURN_MS) * Math.PI * 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    // wide screens: the graph sits to the right of the text; narrow ones: above it
    const wide = w > 820;
    const radius = wide ? Math.min(w * 0.32, h * 0.4) : Math.min(w * 0.42, (h - 70) * 0.42);
    const ox = wide ? w * 0.66 : w / 2;
    const oy = wide ? h / 2 : 60 + (h - 60) / 2; // below the header
    const px = new Float64Array(graph.n), py = new Float64Array(graph.n);
    for (let i = 0; i < graph.n; i++) {
      px[i] = ox + (graph.x[i] * cos - graph.y[i] * sin) * radius;
      py[i] = oy + (graph.x[i] * sin + graph.y[i] * cos) * radius;
    }
    // which group is lit, and how much (fades in and out over each turn of GROUP_MS)
    const step = t / GROUP_MS;
    const lit = still ? -1 : Math.floor(step) % GROUPS.length;
    const glow = still ? 0 : Math.sin((step % 1) * Math.PI);
    const level = (g) => (lit < 0 ? 1 : g === lit ? 1 : 1 - 0.55 * glow);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = 0.8;
    for (let k = 0; k < graph.links.length; k += 2) {
      const a = graph.links[k], b = graph.links[k + 1];
      const same = graph.groupOf[a] === graph.groupOf[b];
      const on = same && graph.groupOf[a] === lit;
      ctx.strokeStyle = on ? palette.groups[lit] : palette.link;
      ctx.globalAlpha = on ? 0.3 + 0.4 * glow : (same ? 0.3 : 0.18) * level(graph.groupOf[a]);
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]);
      ctx.lineTo(px[b], py[b]);
      ctx.stroke();
    }
    const dot = Math.max(3.2, radius / 60);
    for (let i = 0; i < graph.n; i++) {
      const g = graph.groupOf[i];
      ctx.globalAlpha = level(g);
      ctx.fillStyle = palette.groups[g];
      ctx.beginPath();
      ctx.arc(px[i], py[i], dot * (g === lit ? 1 + 0.25 * glow : 1), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!still) frame = requestAnimationFrame(paint);
  }
  const repaint = () => still && paint(performance.now());
  addEventListener('resize', repaint);
  frame = requestAnimationFrame(paint);
  return {
    stop() {
      cancelAnimationFrame(frame);
      removeEventListener('resize', repaint);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
  };
}
