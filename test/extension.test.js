'use strict';
// The extension host on a mocked VS Code API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const samples = require('../scripts/make-samples');
const H = require('../src/core/har');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'harv-ext-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const files = samples.writeAll(tmp);

const state = { config: { maxFileMB: 300, slowRequestMs: 1000, maxBodyKB: 1024, askForRating: true }, saveTarget: null, openTarget: null, clipboard: '', cmds: [], info: [], warn: [], errors: [] };
function uriOf(p) { return { scheme: 'file', fsPath: p, path: p, with(o) { return uriOf(o.path || p); }, toString() { return 'file://' + p; } }; }
const vscodeMock = {
  Uri: { file: uriOf, joinPath: (u, ...s) => uriOf(path.posix.join(u.path, ...s)), parse: (s) => ({ toString: () => s }) },
  workspace: {
    getConfiguration: () => ({ get: (k, d) => (k in state.config ? state.config[k] : d) }),
    fs: { stat: async (u) => ({ size: fs.statSync(u.fsPath).size }), readFile: async (u) => new Uint8Array(fs.readFileSync(u.fsPath)), writeFile: async (u, d) => fs.writeFileSync(u.fsPath, d) },
    isTrusted: true,
  },
  window: {
    registered: [], state: { focused: true }, activeTextEditor: undefined,
    registerCustomEditorProvider(id, p, o) { this.registered.push([id, p, o]); return { dispose() {} }; },
    showSaveDialog: async (o) => { state.saveOpts = o; return state.saveTarget; },
    showOpenDialog: async () => (state.openTarget ? [state.openTarget] : undefined),
    showWarningMessage: async (...a) => { state.warn.push(a[0]); },
    showErrorMessage: async (...a) => { state.errors.push(a[0]); },
    showInformationMessage: async (...a) => { state.info.push(a[0]); return undefined; },
  },
  commands: { list: new Map(), registerCommand(id, fn) { this.list.set(id, fn); return { dispose() {} }; }, executeCommand: async (...a) => { state.cmds.push(a); } },
  env: { clipboard: { writeText: async (t) => { state.clipboard = t; } }, sessionId: 's1', openExternal: async () => true },
  extensions: { getExtension: () => undefined },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return req === 'vscode' ? vscodeMock : origLoad.call(this, req, ...rest); };
const ext = require('../src/extension.js');

let successes = 0;
const globalState = { data: new Map(), get(k) { return this.data.get(k); }, async update(k, v) { if (k === 'zovo.rating.v1') successes = v.count; this.data.set(k, v); } };
const ctx = { extensionUri: uriOf('/ext'), subscriptions: [], globalState };
ext.activate(ctx);
const provider = vscodeMock.window.registered[0][1];
const pkg = require('../package.json');

function fakePanel() {
  const sent = []; let handler = null; let dispose = null; const htmls = [];
  const panel = {
    active: true,
    webview: { options: null, get html() { return htmls[htmls.length - 1]; }, set html(v) { htmls.push(v); }, cspSource: 'https://csp', asWebviewUri: (u) => 'https://res' + u.path, postMessage: async (m) => { sent.push(m); return true; }, onDidReceiveMessage: (h) => { handler = h; } },
    onDidDispose: (h) => { dispose = h; },
  };
  return { panel, sent, htmls, send: (m) => handler(m), close: () => dispose() };
}
async function open(file) {
  const f = fakePanel();
  await provider.resolveCustomEditor({ uri: uriOf(file) }, f.panel);
  await f.send({ type: 'ready' });
  return f;
}
const last = (f, type) => [...f.sent].reverse().find((m) => m.type === type);

test('activate registers the editor and every command in package.json', () => {
  assert.equal(vscodeMock.window.registered[0][0], 'harViewer.editor');
  assert.equal(pkg.contributes.customEditors[0].viewType, 'harViewer.editor');
  for (const c of pkg.contributes.commands) assert.ok(vscodeMock.commands.list.has(c.command), c.command);
  assert.equal(`${pkg.publisher}.${pkg.name}`, 'zovo.zovo-har-viewer');
});

test('open: init, meta with totals and the warning, then rows; webview options are locked down', async () => {
  const f = await open(files['shop-checkout.har']);
  const init = f.sent[0];
  assert.equal(init.type, 'init');
  assert.equal(init.plan.open, true);
  const meta = last(f, 'meta');
  assert.equal(meta.count, 41);
  assert.equal(meta.totals.failed, 4);
  assert.equal(meta.creator, 'WebInspector 537.36');
  assert.ok(meta.sensitive.any);
  assert.match(meta.sensitiveText, /Authorization headers/);
  assert.equal(meta.domains[0].host, 'api.shop.example.com');
  const rows = f.sent.filter((m) => m.type === 'rows');
  assert.equal(rows.reduce((a, m) => a + m.rows.length, 0), 41);
  assert.ok(rows[rows.length - 1].done);
  const o = f.panel.webview.options;
  assert.equal(o.enableScripts, true);
  assert.deepEqual(o.enableCommandUris, ['harViewer.supportDeveloper', 'harViewer.moreViewers', 'workbench.action.openSettings']);
  assert.match(f.htmls[0], /default-src 'none'/);
  const clean = await open(files['docs-site.har']);
  assert.equal(last(clean, 'meta').sensitive.any, false);
});

test('detail, copy as cURL / fetch / URL / response, unknown messages ignored', async () => {
  const f = await open(files['shop-checkout.har']);
  const har = H.parseHar(fs.readFileSync(files['shop-checkout.har'], 'utf8'));
  const i = har.log.entries.findIndex((e) => e.request.url.includes('payment/intent'));
  await f.send({ type: 'detail', i });
  assert.equal(last(f, 'detail').detail.general.method, 'POST');
  await f.send({ type: 'copyAs', i, format: 'curl' });
  assert.equal(state.clipboard, H.toCurl(har.log.entries[i]));
  await f.send({ type: 'copyAs', i, format: 'fetch' });
  assert.ok(state.clipboard.startsWith('await fetch("https://api.shop.example.com/v2/payment/intent"'));
  await f.send({ type: 'copyAs', i, format: 'url' });
  assert.equal(state.clipboard, 'https://api.shop.example.com/v2/payment/intent');
  await f.send({ type: 'copyAs', i, format: 'response' });
  assert.equal(JSON.parse(state.clipboard).id, 'pi_sample_001');
  assert.equal(last(f, 'copied').format, 'response');
  const n = f.sent.length;
  await f.send({ type: 'detail', i: 999 });
  await f.send({ type: 'writeFile', path: '/tmp/x' });
  assert.equal(f.sent.length, n);
});

test('export writes a new HAR with the filtered entries; the source is never overwritten', async () => {
  const f = await open(files['shop-checkout.har']);
  const target = path.join(tmp, 'out-filtered.har');
  state.saveTarget = uriOf(target);
  await f.send({ type: 'export', indices: [3, 1, 2] });
  assert.equal(path.basename(state.saveOpts.defaultUri.path), 'shop-checkout-filtered.har');
  const out = H.parseHar(fs.readFileSync(target, 'utf8'));
  assert.equal(out.log.entries.length, 3);
  assert.equal(last(f, 'saved').count, 3);
  const before = fs.readFileSync(files['shop-checkout.har'], 'utf8');
  state.saveTarget = uriOf(files['shop-checkout.har']);
  await f.send({ type: 'export', indices: [0] });
  assert.equal(fs.readFileSync(files['shop-checkout.har'], 'utf8'), before);
  assert.match(state.warn.pop(), /never overwrites/);
  state.saveTarget = null;
  await f.send({ type: 'export', indices: [0] });
  assert.equal(last(f, 'saved').cancelled, true);
});

test('redact from the webview and from the command writes a clean copy', async () => {
  const f = await open(files['shop-checkout.har']);
  const target = path.join(tmp, 'shop.redacted.har');
  state.saveTarget = uriOf(target);
  await f.send({ type: 'redact' });
  assert.equal(path.basename(state.saveOpts.defaultUri.path), 'shop-checkout.redacted.har');
  const text = fs.readFileSync(target, 'utf8');
  assert.ok(!text.includes(samples.SESSION) && !text.includes('eyJ'));
  assert.equal(H.scanSensitive(H.parseHar(text)).any, false);
  assert.match(last(f, 'saved').message, /^Saved shop\.redacted\.har\. Replaced/);
  // command with an Explorer uri
  const t2 = path.join(tmp, 'cmd.redacted.har');
  state.saveTarget = uriOf(t2);
  const r = await vscodeMock.commands.list.get('harViewer.redact')(uriOf(files['shop-checkout.har']));
  assert.ok(r && fs.existsSync(t2));
  // command on a file that is not a HAR shows an error
  state.saveTarget = uriOf(path.join(tmp, 'x.har'));
  await vscodeMock.commands.list.get('harViewer.redact')(uriOf(files['broken.har']));
  assert.match(state.errors.pop(), /could not redact the file\. This file is not valid JSON/);
});

test('broken, not-a-HAR and too-large files show a message instead of a table', async () => {
  const b = await open(files['broken.har']);
  assert.match(last(b, 'error').message, /not valid JSON/);
  assert.equal(last(b, 'error').soft, false);
  const n = await open(files['not-a-har.har']);
  assert.match(last(n, 'error').message, /no "log" object/);
  const bigFile = path.join(tmp, 'big.har');
  samples.writeLarge(bigFile, 1200);
  assert.ok(fs.statSync(bigFile).size > 1024 * 1024);
  state.config.maxFileMB = 1;
  const big = await open(bigFile);
  state.config.maxFileMB = 300;
  assert.equal(big.sent[0].plan.open, false);
  assert.match(big.sent[0].plan.message, /harViewer\.maxFileMB/);
  assert.equal(big.sent.filter((m) => m.type === 'rows').length, 0);
});

test('rating success once per tab on the first rendered message', async () => {
  const before = successes;
  const f = await open(files['docs-site.har']);
  await f.send({ type: 'rendered' });
  await f.send({ type: 'rendered' });
  assert.equal(successes, before + 1);
  const g = await open(files['docs-site.har']);
  await g.send({ type: 'rendered' });
  assert.equal(successes, before + 2);
});

test('support: manifest fields, footer shown by default and hidden by the setting', async () => {
  assert.equal(pkg.sponsor.url, 'https://github.com/sponsors/theluckystrike');
  const p = pkg.contributes.configuration.properties['harViewer.showSupportLinks'];
  assert.equal(p.default, true);
  assert.ok(vscodeMock.commands.list.has('harViewer.supportDeveloper') && vscodeMock.commands.list.has('harViewer.moreViewers'));
  const shown = await open(files['docs-site.har']);
  assert.ok(shown.htmls[0].includes('command:harViewer.supportDeveloper'));
  state.config.showSupportLinks = false;
  const hidden = await open(files['docs-site.har']);
  delete state.config.showSupportLinks;
  assert.ok(!hidden.htmls[0].includes('zovo-support'));
});
