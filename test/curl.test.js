'use strict';
// Copy as cURL and Copy as fetch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const H = require('../src/core/har');
const S = require('../scripts/make-samples');

const shop = S.shopCheckout();
const find = (part) => shop.log.entries.find((e) => e.request.url.includes(part));

test('cURL for a GET: no -X, no HTTP/2 pseudo headers, --compressed', () => {
  const c = H.toCurl(find('/v2/me'));
  assert.ok(c.startsWith("curl 'https://api.shop.example.com/v2/me'"));
  assert.ok(!/-X /.test(c));
  assert.ok(!/':authority|-H ':/.test(c));
  assert.ok(/-H 'authorization: Bearer eyJ/.test(c));
  assert.ok(c.endsWith('--compressed'));
});

test('cURL for a POST keeps the body; other methods get -X', () => {
  const c = H.toCurl(find('payment/intent'));
  assert.ok(/--data-raw '\{"amount":30440/.test(c));
  assert.ok(!/-X POST/.test(c));
  const put = H.toCurl({ request: { method: 'PUT', url: 'https://a.example/x', headers: [], postData: { mimeType: 'text/plain', text: 'v' } } });
  assert.ok(/-X PUT/.test(put));
  const del = H.toCurl({ request: { method: 'DELETE', url: 'https://a.example/x', headers: [] } });
  assert.equal(del, "curl 'https://a.example/x' \\\n  -X DELETE");
});

test('cURL quotes single quotes so the shell reads the exact text', () => {
  const e = { request: { method: 'POST', url: "https://a.example/it's", headers: [{ name: 'X-Note', value: "it's $HOME `x`" }], postData: { mimeType: 'text/plain', text: "a'b" } } };
  const c = H.toCurl(e);
  // let the shell parse it with curl replaced by printf, which prints each argument on a line
  const out = execFileSync('/bin/sh', ['-c', c.replace(/^curl /, "printf '%s\\n' ")], { encoding: 'utf8' });
  assert.deepEqual(out.trim().split('\n'), ["https://a.example/it's", '-H', "X-Note: it's $HOME `x`", '--data-raw', "a'b"]);
});

test('cURL from params when the body text is missing', () => {
  const c = H.toCurl({ request: { method: 'POST', url: 'https://a.example/f', headers: [], postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'a b', value: 'c&d' }] } } });
  assert.ok(c.endsWith("--data-raw 'a%20b=c%26d'"));
});

test('fetch: valid init object, cookies become credentials include', () => {
  const f = H.toFetch(find('payment/intent'));
  const m = f.match(/^await fetch\(("[^"]+"), ([\s\S]+)\);$/);
  assert.ok(m);
  assert.equal(JSON.parse(m[1]), 'https://api.shop.example.com/v2/payment/intent');
  const init = JSON.parse(m[2]);
  assert.equal(init.method, 'POST');
  assert.equal(init.credentials, 'include');
  assert.equal(init.headers.authorization.slice(0, 10), 'Bearer eyJ');
  assert.ok(!('cookie' in init.headers) && !('user-agent' in init.headers) && !(':path' in init.headers));
  assert.equal(JSON.parse(init.body).amount, 30440);
  const g = JSON.parse(H.toFetch({ request: { method: 'GET', url: 'https://a.example/', headers: [] } }).match(/, ([\s\S]+)\);$/)[1]);
  assert.deepEqual(g, { method: 'GET', credentials: 'omit' });
});
