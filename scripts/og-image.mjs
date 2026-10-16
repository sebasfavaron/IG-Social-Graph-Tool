// The link-preview card (extension/og.png, 1200x630): the site's front page in dark mode
// without the header, caught when the first friend group is lit. Needs the viewer served
// on :8765 (the "viewer" entry in .claude/launch.json) and Chrome installed.
//   node scripts/og-image.mjs /tmp/og-2x.png && sips -z 630 1200 /tmp/og-2x.png --out extension/og.png
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--remote-debugging-port=9333', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'og-')), '--hide-scrollbars', 'about:blank']);
await new Promise((r) => setTimeout(r, 1500));
const tab = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const waiting = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d.result); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 2, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
await send('Page.navigate', { url: 'http://localhost:8765/viewer.html' });
await new Promise((r) => setTimeout(r, 1200));
await send('Runtime.evaluate', { expression: `
  document.documentElement.dataset.theme = 'dark';
  const s = document.createElement('style');
  s.textContent = 'header, #invite, .hero-points, .hero-note { display: none !important } #hero { padding-left: 80px } #hero h1 { font-size: 64px } .hero-lead { font-size: 21px; max-width: 470px } .hero-text { max-width: 520px; animation: none } .hero-cta { font-size: 19px; padding: 15px 26px }';
  document.head.append(s);` });
// group 0 at its brightest: GROUP_MS 3200, peak at 1600 into the turn; a full cycle is 6 groups
await new Promise((r) => setTimeout(r, 3200 * 6 - 1200 + 1600 - 300));
const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(process.argv[2], Buffer.from(shot.data, 'base64'));
chrome.kill();
process.exit(0);
