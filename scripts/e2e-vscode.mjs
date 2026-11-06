// Release check in a real VS Code: installs the .vsix into an isolated profile, opens the generated samples,
// drives the webview with real mouse and key events, records every network request made by the webview,
// saves screenshots and a JSON report.
// usage: node scripts/e2e-vscode.mjs <work> <port> <vsix> <samplesDir> <shotDir> <outJson>
import { launch, installVsix, sleep } from './vsc.mjs';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';

const [work0, port, vsix, ws0, shotDir, outJson] = process.argv.slice(2);
const work = path.resolve(work0), ws = path.resolve(ws0);
const R = { install: null, steps: [], console: [], hashes: {}, unchanged: null, network: [] };
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex');
for (const f of fs.readdirSync(ws)) if (f.endsWith('.har')) R.hashes[f] = hash(path.join(ws, f));
fs.rmSync(path.join(work, 'ud'), { recursive: true, force: true });
R.install = installVsix(work, vsix);
const clipBefore = (() => { try { return execSync('pbpaste', { encoding: 'utf8' }); } catch { return null; } })();
const vs = await launch(work, Number(port), ws, { 'files.simpleDialog.enable': true, 'window.dialogStyle': 'custom', 'workbench.secondarySideBar.defaultVisibility': 'hidden', 'workbench.auxiliaryBar.visible': false, 'window.titleBarStyle': 'custom', 'workbench.sideBar.location': 'left' });
const netEnabled = new Set();
vs.s.on(m => {
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url;
    if (/^https?:/.test(u) && !/vscode-cdn\.net|vscode-resource/.test(u)) R.network.push({ url: u.slice(0, 200), t: Date.now(), step: R.steps.length });
  }
});
const enableNet = async () => { for (const [sid, info] of vs.attached) if (info.type === 'iframe' && !netEnabled.has(sid)) { netEnabled.add(sid); await vs.s.send('Network.enable', {}, sid).catch(() => {}); } };
const shots = [];
const clearNotes = async () => { await vs.wbEval(`[...document.querySelectorAll('.notifications-toasts .codicon-notifications-clear, .notifications-toasts .codicon-close')].forEach(b => b.click()); 1`).catch(() => {}); await sleep(300); };
const shot = async name => { await clearNotes(); const f = path.join(shotDir, `har-${String(shots.length + 1).padStart(2, '0')}-${name}.png`); await vs.shot(f); shots.push(f); return f; };
const step = async (name, fn) => {
  const t0 = Date.now();
  try { const v = await fn(); R.steps.push({ name, ok: v !== false, value: v, ms: Date.now() - t0 }); }
  catch (e) { R.steps.push({ name, ok: false, error: String(e.message || e).slice(0, 600), ms: Date.now() - t0 }); try { await shot('FAIL-' + name.replace(/\W+/g, '_').slice(0, 40)); } catch {} }
};
let wv;
const E = expr => vs.wvEval(wv, expr);
const getWv = async title => vs.waitFor(async () => (await vs.webviews()).find(w => w.title === title && w.w > 0), 20000);
const open = async file => { const t0 = Date.now(); vs.open(path.join(ws, file)); await sleep(600); wv = await getWv(file); if (!wv) throw new Error('no webview for ' + file); await enableNet(); return Date.now() - t0; };
const rowsShown = (min = 1) => vs.waitFor(() => E(`document.querySelectorAll('.list .row').length >= ${min} && document.querySelectorAll('.list .row').length`), 30000, 100);
const countText = () => E(`(document.querySelector('.statusbar .count') || {}).textContent || ''`);
const rowByUrl = part => `[...document.querySelectorAll('.list .row')].find(r => (r.querySelector('.c-name') || {}).title && r.querySelector('.c-name').title.includes(${JSON.stringify(part)}))`;
const btn = t => `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(t)})`;
const tab = async id => { await vs.wvClick(wv, `document.querySelector('.dtab[data-tab="${id}"]')`); await sleep(300); };
const detailText = () => E(`(document.querySelector('.detail .dbody') || {}).innerText || ''`);
const saveDialog = async target => {
  await sleep(1200);
  const ib = JSON.parse(await vs.wbEval(`JSON.stringify(document.querySelector('.quick-input-widget input').getBoundingClientRect())`));
  await vs.click(ib.x + ib.width / 2, ib.y + ib.height / 2); await vs.key('a', 'KeyA', 4, 65); await vs.type(target);
  await sleep(300); await vs.key('Enter', 'Enter'); await sleep(1500);
};
const outDir = path.join(work, 'out');
fs.mkdirSync(outDir, { recursive: true });

try {
  await sleep(2500);
  await vs.command('View: Close Primary Side Bar').catch(() => {});
  await step('shop-checkout.har opens as the default editor: table, waterfall, totals, secrets banner, no network', async () => {
    const ms = await open('shop-checkout.har');
    const n = await rowsShown(30); if (!n) throw new Error('no rows');
    await sleep(500);
    const stats = await E(`document.querySelector('.stats').innerText`);
    const banner = await E(`(() => { const b = document.querySelector('.banner'); return b && !b.hidden ? b.querySelector('.text').textContent : ''; })()`);
    const bars = await E(`document.querySelectorAll('.list .wf .bar .ph').length`);
    const count = await countText();
    const net = R.network.filter(x => x.step === R.steps.length);
    if (!/41 requests/.test(stats) || !/4 failed/.test(stats) || !/2 slow/.test(stats) || !/Authorization headers/.test(banner) || bars < 40 || net.length) throw new Error(JSON.stringify({ stats, banner, bars, net }));
    await vs.wvClick(wv, rowByUrl('shipping/quotes')); await sleep(700);
    await tab('timing');
    const timing = await detailText();
    await shot('table-waterfall-banner');
    if (!/Waiting \(TTFB\)\s*2\.31 s/.test(timing)) throw new Error(timing.slice(0, 400));
    return { openMs: ms, rowsInDom: n, stats, banner: banner.slice(0, 160), waterfallSegments: bars, count, timing: timing.split('\n').slice(0, 8).join(' / ') };
  });
  await step('details: headers with secret badges, pretty JSON response, form payload, image response', async () => {
    await vs.wvClick(wv, rowByUrl('payment/intent')); await sleep(600);
    await tab('headers');
    const h = await detailText();
    const badges = await E(`document.querySelectorAll('.detail tr.secret').length`);
    await tab('response');
    const json = await E(`(() => { const p = document.querySelector('.detail pre.json'); return p ? { keys: p.querySelectorAll('.j-key').length, text: p.textContent.slice(0, 80) } : null; })()`);
    await shot('details-json-response');
    await vs.wvClick(wv, rowByUrl('oauth/token')); await sleep(600);
    await tab('payload');
    const form = await detailText();
    await vs.wvClick(wv, rowByUrl('lamp-96.png')); await sleep(600);
    await tab('response');
    const img = await E(`(() => { const i = document.querySelector('.detail img.preview'); return i ? i.naturalWidth + 'x' + i.naturalHeight : ''; })()`);
    if (!/Request URL/.test(h) || badges < 2 || !json || json.keys < 3 || !/refresh_token/.test(form) || img !== '96x96') throw new Error(JSON.stringify({ badges, json, form: form.slice(0, 200), img }));
    return { secretRows: badges, json, formHasFields: true, image: img };
  });
  await step('Copy as cURL puts a curl command on the clipboard', async () => {
    await vs.wvClick(wv, rowByUrl('payment/intent')); await sleep(500);
    await vs.wvClick(wv, btn('Copy as cURL')); await sleep(700);
    const clip = execSync('pbpaste', { encoding: 'utf8' });
    const toast = await E(`document.querySelector('.statusbar .toast').textContent`);
    if (!clip.startsWith("curl 'https://api.shop.example.com/v2/payment/intent'") || !/--data-raw/.test(clip) || !/Copied as cURL/.test(toast)) throw new Error(clip.slice(0, 200));
    await vs.wvClick(wv, btn('Copy as fetch')); await sleep(600);
    const f = execSync('pbpaste', { encoding: 'utf8' });
    if (!f.startsWith('await fetch("https://api.shop.example.com/v2/payment/intent"')) throw new Error(f.slice(0, 200));
    return { curlLines: clip.split('\n').length, fetchStart: f.slice(0, 60) };
  });
  await step('Failed filter from the summary, then Export filtered writes a 4-entry HAR', async () => {
    await vs.wvClick(wv, `document.querySelector('.detail .close')`); await sleep(300);
    await vs.wvClick(wv, `document.querySelector('.stat-link.bad')`); await sleep(500);
    const n = await E(`document.querySelectorAll('.list .row').length`);
    const statuses = await E(`[...document.querySelectorAll('.list .row .c-status')].map(c => c.textContent).join(',')`);
    await shot('failed-filter');
    const target = path.join(outDir, 'failed-only.har');
    await vs.wvClick(wv, btn('Export filtered...'));
    await saveDialog(target);
    const ok = fs.existsSync(target) && JSON.parse(fs.readFileSync(target, 'utf8')).log.entries.length;
    if (n !== 4 || ok !== 4) throw new Error(JSON.stringify({ n, statuses, ok }));
    return { rows: n, statuses, exported: ok };
  });
  await step('text, type and domain filters; sort by time', async () => {
    await vs.wvClick(wv, `document.querySelector('.status-sel')`); await sleep(200); await vs.key('Escape', 'Escape');
    await E(`(() => { const s = document.querySelector('.status-sel'); s.value = 'all'; s.dispatchEvent(new Event('change')); })()`); await sleep(300);
    await vs.wvClick(wv, `document.querySelector('input.search')`); await vs.type('stock -lamp'); await sleep(600);
    const t1 = await E(`document.querySelectorAll('.list .row').length`);
    await vs.wvClick(wv, `document.querySelector('input.search')`); await vs.key('a', 'KeyA', 4, 65); await vs.key('Backspace', 'Backspace'); await sleep(500);
    await vs.wvClick(wv, `[...document.querySelectorAll('.chip')].find(c => c.dataset.type === 'img')`); await sleep(400);
    const imgs = await E(`[...document.querySelectorAll('.list .row .c-type')].map(c => c.textContent)`);
    await vs.wvClick(wv, `[...document.querySelectorAll('.chip')].find(c => c.textContent === 'All')`); await sleep(300);
    await E(`(() => { const s = document.querySelector('.domain-sel'); s.value = 'cdn.example.net'; s.dispatchEvent(new Event('change')); })()`); await sleep(300);
    const hosts = await E(`[...document.querySelectorAll('.list .row .c-domain')].map(c => c.textContent)`);
    await E(`(() => { const s = document.querySelector('.domain-sel'); s.value = ''; s.dispatchEvent(new Event('change')); })()`); await sleep(300);
    await vs.wvClick(wv, `document.querySelector('.head .c-time')`); await sleep(400);
    const first = await E(`document.querySelector('.list .row .c-name').title`);
    if (t1 !== 9 || !imgs.length || imgs.some(x => x !== 'Img') || hosts.some(h => h !== 'cdn.example.net') || !first.includes('shipping/quotes')) throw new Error(JSON.stringify({ t1, imgs, hosts, first }));
    await vs.wvClick(wv, rowByUrl('shipping/quotes')); await sleep(500); await tab('headers');
    await shot('sorted-by-time-details');
    return { stockMinusLamp: t1, images: imgs.length, cdnRows: hosts.length, slowestFirst: first };
  });
  await step('Save redacted copy from the banner; the copy opens without the banner and without secrets', async () => {
    const target = path.join(ws, 'shop-checkout.redacted.har');
    await vs.wvClick(wv, `document.querySelector('.banner button.primary')`);
    await saveDialog(target);
    const text = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    const leaks = ['sess_4f1c', 'eyJ', 'rt_FAKE', 'at_FAKE', 'csrf_9a8b', 'secret_FAKE'].filter(s => text.includes(s));
    const notes = await vs.notifications();
    await open('shop-checkout.redacted.har'); await rowsShown(30); await sleep(500);
    const banner = await E(`!document.querySelector('.banner').hidden`);
    await vs.wvClick(wv, rowByUrl('/v2/me')); await sleep(600); await tab('headers');
    const auth = await E(`[...document.querySelectorAll('.detail tr')].map(r => r.innerText).find(t => /^authorization/.test(t)) || ''`);
    await shot('redacted-copy');
    if (!text || leaks.length || banner || !/\[REDACTED\]/.test(auth)) throw new Error(JSON.stringify({ size: text.length, leaks, banner, auth, notes }));
    fs.rmSync(target);
    return { size: text.length, leaks: 0, bannerOnCopy: banner, auth: auth.replace(/\s+/g, ' '), notification: notes.find(n => /Saved/.test(n)) || notes[0] };
  });
  await step('docs-site.har (Firefox, no secrets): no banner, 301 and 304 rows', async () => {
    await open('docs-site.har'); await rowsShown(10); await sleep(300);
    const banner = await E(`!document.querySelector('.banner').hidden`);
    const st = await E(`[...document.querySelectorAll('.list .row .c-status')].map(c => c.textContent).join(',')`);
    if (banner || !/301/.test(st) || !/304/.test(st)) throw new Error(JSON.stringify({ banner, st }));
    return { banner, statuses: st };
  });
  await step('large-capture.har (30,000 requests, 47 MB): first rows, scroll, filter, workbench stays responsive', async () => {
    const t0 = Date.now();
    vs.open(path.join(ws, 'large-capture.har'));
    let worst = 0;
    const probe = (async () => { while (Date.now() - t0 < 12000) { const a = Date.now(); await vs.wbEval('1'); worst = Math.max(worst, Date.now() - a); await sleep(50); } })();
    wv = await getWv('large-capture.har'); await enableNet();
    const n = await rowsShown(10);
    const first = Date.now() - t0;
    await vs.waitFor(async () => /30,000 requests/.test(await countText()) && !/loading/.test(await countText()), 30000, 200);
    const all = Date.now() - t0;
    await E(`document.querySelector('.viewport').scrollTop = 22 * 25000`); await sleep(400);
    const mid = await E(`document.querySelector('.list .row .c-name').textContent`);
    const tf = Date.now();
    await E(`(() => { const s = document.querySelector('.status-sel'); s.value = '5xx'; s.dispatchEvent(new Event('change')); })()`); await sleep(200);
    const c5 = await countText();
    const topAfterFilter = await E(`document.querySelector('.viewport').scrollTop`);
    if (topAfterFilter !== 0) throw new Error('filter kept the old scroll offset ' + topAfterFilter);
    const filterMs = Date.now() - tf;
    await probe;
    await shot('large-capture');
    if (!n || first > 15000 || worst > 1000 || !/^310 of 30,000/.test(c5)) throw new Error(JSON.stringify({ first, all, worst, mid, c5 }));
    return { firstRowsMs: first, allRowsMs: all, workbenchWorstLatencyMs: worst, scrolledTo: mid, filter5xx: c5, filterMs };
  });
  await step('broken.har: clear message with Open as text', async () => {
    await open('broken.har');
    const t = await vs.waitFor(() => E(`(document.querySelector('.notice') || {}).textContent`), 10000);
    if (!/not valid JSON/.test(t || '')) throw new Error(t);
    return t.slice(0, 160);
  });
  await step('light theme', async () => {
    const sp = path.join(vs.ud, 'User', 'settings.json');
    fs.writeFileSync(sp, JSON.stringify({ ...JSON.parse(fs.readFileSync(sp, 'utf8')), 'workbench.colorTheme': 'Default Light Modern' }, null, 1));
    await sleep(2500);
    await open('shop-checkout.har'); await rowsShown(30); await sleep(500);
    await vs.wvClick(wv, rowByUrl('promo/validate')); await sleep(600); await tab('response');
    await shot('light-theme');
    return true;
  });
} finally {
  R.console = vs.console.filter(c => !/copilot|CloudSandboxApi|LESS API|reading 'selection'/i.test(c.text));
  R.logErrors = [];
  for (const f of vs.extHostLogs()) { const t = fs.readFileSync(f, 'utf8'); for (const l of t.split('\n')) if (/\[error\]/.test(l) && /har|zovo/i.test(l)) R.logErrors.push(l.slice(0, 300)); }
  await vs.close();
  if (clipBefore !== null) try { execSync('pbcopy', { input: clipBefore }); } catch {}
  R.unchanged = Object.entries(R.hashes).every(([f, h]) => hash(path.join(ws, f)) === h);
  R.shots = shots;
  fs.writeFileSync(outJson, JSON.stringify(R, null, 1));
  console.log(JSON.stringify({ steps: R.steps.map(s => [s.ok ? 'PASS' : 'FAIL', s.name, s.error || '']), console: R.console, logErrors: R.logErrors, unchanged: R.unchanged, install: R.install.code, network: R.network.length }, null, 1));
}
