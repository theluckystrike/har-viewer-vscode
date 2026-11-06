'use strict';
// Webview message checks, formatters, the CSP and static checks on the shipped code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const P = require('../src/core/protocol');
const { buildHtml, buildCsp } = require('../src/html');

const root = path.join(__dirname, '..');

test('validateWebviewMessage accepts only known, well-formed messages', () => {
  const v = (m, max = 10) => P.validateWebviewMessage(m, max);
  for (const t of ['ready', 'rendered', 'redact', 'openText']) assert.deepEqual(v({ type: t, extra: 1 }), { ok: true, msg: { type: t } });
  assert.deepEqual(v({ type: 'detail', i: 3 }), { ok: true, msg: { type: 'detail', i: 3 } });
  for (const i of [-1, 10, 1.5, '2', null]) assert.equal(v({ type: 'detail', i }).ok, false);
  assert.equal(v({ type: 'copyAs', i: 1, format: 'curl' }).ok, true);
  assert.equal(v({ type: 'copyAs', i: 1, format: 'powershell' }).ok, false);
  assert.deepEqual(v({ type: 'export', indices: [1, 2] }).msg.indices, [1, 2]);
  assert.equal(v({ type: 'export', indices: [] }).ok, false);
  assert.equal(v({ type: 'export', indices: [1, 99] }).ok, false);
  assert.equal(v({ type: 'export', indices: new Array(11).fill(0) }).ok, false);
  for (const bad of [null, 'ready', {}, { type: 'writeFile', path: '/etc/x' }, { type: 'openExternal', url: 'https://x' }, { type: 'detail', i: 0 }]) {
    assert.equal(P.validateWebviewMessage(bad, 0).ok, false);
  }
});

test('formatters, size plan, chunks and file names', () => {
  assert.equal(P.fmtSize(0), '0 B');
  assert.equal(P.fmtSize(1536), '1.5 KB');
  assert.equal(P.fmtSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(P.fmtMs(0), '0 ms');
  assert.equal(P.fmtMs(0.4), '<1 ms');
  assert.equal(P.fmtMs(812.4), '812 ms');
  assert.equal(P.fmtMs(2315.47), '2.32 s');
  assert.equal(P.fmtMs(125000), '2 min 5 s');
  assert.equal(P.sizePlan(10, 300).open, true);
  const big = P.sizePlan(400 * P.MB, 300);
  assert.equal(big.open, false);
  assert.match(big.message, /400\.0 MB.*up to 300\.0 MB \(setting harViewer\.maxFileMB\)/);
  assert.deepEqual(P.chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(P.chunks([], 2), [[]]);
  assert.equal(P.suggestName('capture.har', '.redacted'), 'capture.redacted.har');
  assert.equal(P.suggestName('net.HAR', '-filtered'), 'net-filtered.har');
});

test('CSP: no remote scripts, nonce only, data: images only, title escaped', () => {
  const html = buildHtml({ cspSource: 'https://csp.example', scriptUri: 'https://csp.example/w.js', styleUri: 'https://csp.example/s.css', title: '<img src=x onerror=alert(1)>.har', nonce: 'NONCE' });
  const csp = html.match(/content="([^"]+)"/)[1];
  assert.equal(csp, buildCsp('https://csp.example', 'NONCE'));
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'nonce-NONCE'(;|$)/);
  assert.match(csp, /img-src https:\/\/csp\.example data:(;|$)/);
  assert.ok(!/unsafe-inline|unsafe-eval|https: |http:/.test(csp.replace('https://csp.example', '')));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;.har'));
  assert.ok(html.includes('id="zovo-support"'));
  assert.ok(!buildHtml({ cspSource: 'c', scriptUri: 's', styleUri: 't', title: 'x', showSupportLinks: false }).includes('zovo-support'));
});

test('shipped code: no innerHTML, eval or network in the webview; no network modules in the host', () => {
  const web = fs.readFileSync(path.join(root, 'src/webview/main.js'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'eval(', 'new Function', 'fetch(', 'XMLHttpRequest', 'WebSocket', 'setAttribute(\'style']) assert.ok(!web.includes(bad), bad);
  for (const f of ['src/extension.js', 'src/core/har.js', 'src/core/protocol.js', 'src/html.js']) {
    const s = fs.readFileSync(path.join(root, f), 'utf8');
    assert.ok(!/require\(['"](https?|net|tls|dgram|child_process)['"]\)/.test(s), f);
    assert.ok(!/\bfetch\(/.test(s.replace(/toFetch|await fetch\(\$\{/g, '')), f);
  }
  const bundle = fs.readFileSync(path.join(root, 'dist/webview.js'), 'utf8');
  assert.ok(!bundle.includes('innerHTML'));
});
