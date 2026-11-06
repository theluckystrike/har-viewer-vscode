'use strict';
// Parser, classification, summaries, filters and body views on the generated samples.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/core/har');
const S = require('../scripts/make-samples');

const shop = S.shopCheckout();
const docs = S.docsSite();
const sum = H.summarize(shop, 1000);
const rows = sum.rows;
const at = (part) => rows.find((r) => r.url.includes(part));

test('parseHar reads a HAR and gives plain errors for other files', () => {
  const h = H.parseHar('﻿' + JSON.stringify(shop));
  assert.equal(h.log.entries.length, shop.log.entries.length);
  assert.throws(() => H.parseHar('{"log": {"entries": ['), /not valid JSON/);
  assert.throws(() => H.parseHar('{"hello": 1}'), /no "log" object/);
  assert.throws(() => H.parseHar('{"log": {}}'), /no "log.entries"/);
  assert.equal(H.parseHar(Buffer.from(JSON.stringify(docs))).log.creator.name, 'Firefox');
});

test('classify uses _resourceType, then the MIME type, then the URL', () => {
  assert.equal(at('/checkout?step').type, 'doc');
  assert.equal(at('vendor.js').type, 'js');
  assert.equal(at('app.css').type, 'css');
  assert.equal(at('logo.png').type, 'img');
  assert.equal(at('woff2').type, 'font');
  assert.equal(at('/v2/me').type, 'xhr');
  assert.equal(at('wss://').type, 'ws');
  assert.equal(at('collect').type, 'other');
  // Firefox has no _resourceType
  const d = H.summarize(docs, 1000).rows;
  assert.deepEqual(d.map((r) => r.type).slice(0, 8), ['doc', 'doc', 'css', 'xhr', 'js', 'img', 'font', 'img']);
  assert.equal(H.classify({ request: { url: 'https://x.example/a/b.m3u8' }, response: {} }), 'media');
  assert.equal(H.classify({ request: { url: 'https://x.example/blob' }, response: { content: { mimeType: 'application/octet-stream' } } }), 'other');
});

test('summarize: start offsets, sizes, failed, slow and secret flags', () => {
  assert.equal(rows.length, shop.log.entries.length);
  assert.equal(rows[0].start, 0);
  assert.ok(rows.every((r, k) => k === 0 || r.start >= rows[k - 1].start));
  const quotes = at('shipping/quotes');
  assert.ok(quotes.slow && quotes.time > 2000);
  assert.ok(at('promo/validate').failed && at('promo/validate').status === 500);
  const refused = at('collect');
  assert.ok(refused.failed && refused.status === 0 && /REFUSED/.test(refused.statusText));
  assert.ok(at('app.js.map').failed);
  assert.ok(!at('vendor.js').failed && !at('vendor.js').sens);
  assert.ok(at('/v2/me').sens);
  assert.equal(at('vendor.js').size, Math.round(183422 * 0.3) + 320); // _transferSize
  assert.equal(at('vendor.js').csize, 183422);
  // timings: ssl is counted inside connect in HAR, phases here are separate
  const doc = rows[0];
  assert.deepEqual(doc.t.slice(1, 4), [14.2, 18.4, 22.1]);
  assert.ok(Math.abs(doc.t.reduce((a, b) => a + b, 0) - doc.time) < 0.01);
  assert.ok(refused.t.every((v) => v >= 0));
});

test('totals and domains', () => {
  const t = H.totals(rows);
  assert.equal(t.count, rows.length);
  assert.equal(t.failed, 4);
  assert.equal(t.slow, 2);
  assert.equal(t.slowest.i, at('shipping/quotes').i);
  assert.ok(t.size > 0 && t.csize > t.size);
  assert.ok(t.p95 >= t.p50);
  const sub = H.totals(rows, [at('vendor.js').i]);
  assert.equal(sub.count, 1);
  assert.equal(sub.size, at('vendor.js').size);
  const d = H.domains(rows);
  assert.equal(d[0].host, 'api.shop.example.com');
  assert.ok(d.every((x) => /example\.(com|net|org|test)$/.test(x.host)));
});

test('filterRows: type, status, domain, text with -word, sort', () => {
  const ids = (f) => H.filterRows(rows, f).map((i) => rows[i]);
  assert.equal(ids({}).length, rows.length);
  assert.ok(ids({ types: ['img'] }).every((r) => r.type === 'img'));
  assert.equal(ids({ types: ['img', 'font'] }).length, rows.filter((r) => r.type === 'img' || r.type === 'font').length);
  assert.deepEqual(ids({ status: '5xx' }).map((r) => r.status), [500]);
  assert.equal(ids({ status: '4xx' }).length, 2);
  assert.equal(ids({ status: 'failed' }).length, 4);
  assert.equal(ids({ status: 'slow' }).length, 2);
  assert.ok(ids({ status: 'sensitive' }).every((r) => r.sens));
  assert.ok(ids({ domain: 'cdn.example.net' }).every((r) => r.host === 'cdn.example.net'));
  assert.ok(ids({ text: 'stock LAMP' }).every((r) => /stock/.test(r.url) && /LAMP/.test(r.url)));
  assert.equal(ids({ text: 'stock -lamp' }).length, 9);
  assert.equal(ids({ text: 'post 500' }).length, 1);
  const bySize = ids({ sort: 'size', desc: true });
  assert.ok(bySize.every((r, k) => k === 0 || bySize[k - 1].size >= r.size));
  const byTime = ids({ sort: 'time', desc: true });
  assert.equal(byTime[0].i, at('shipping/quotes').i);
  assert.deepEqual(ids({ types: ['nope'] }).length, rows.length);
});

test('bodyView: JSON is pretty, forms are pairs, images are data URIs, binary is not shown, long text is cut', () => {
  const j = H.bodyView('application/json; charset=utf-8', '{"a":1,"b":[true,null]}', undefined, 1000);
  assert.equal(j.kind, 'json');
  assert.equal(j.text, '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
  const f = H.bodyView('application/x-www-form-urlencoded', 'a=1&b=two+words&c=%26', undefined, 1000);
  assert.deepEqual(f.pairs, [{ name: 'a', value: '1' }, { name: 'b', value: 'two words' }, { name: 'c', value: '&' }]);
  const png = S.png(4, 4, () => [1, 2, 3]).toString('base64');
  const im = H.bodyView('image/png', png, 'base64', 1000);
  assert.equal(im.kind, 'image');
  assert.ok(im.dataUri.startsWith('data:image/png;base64,iVBOR'));
  assert.equal(H.bodyView('font/woff2', 'AAAA', 'base64', 1000).kind, 'binary');
  assert.equal(H.bodyView('text/plain', Buffer.from('hello').toString('base64'), 'base64', 1000).text, 'hello');
  const cut = H.bodyView('text/plain', 'x'.repeat(5000), undefined, 1000);
  assert.ok(cut.truncated && cut.text.length === 1000 && cut.full === 5000);
  assert.equal(H.bodyView('text/html', '', undefined, 1000, 200).kind, 'empty');
  assert.equal(H.bodyView('text/plain', '{not json', undefined, 1000).kind, 'text');
  assert.equal(H.bodyView('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"/>', undefined, 1000).kind, 'image');
});

test('entryDetail has headers, query, cookies, bodies and timings', () => {
  const i = at('oauth/token').i;
  const d = H.entryDetail(shop, i, 100000);
  assert.equal(d.general.method, 'POST');
  assert.equal(d.general.status, 200);
  assert.ok(d.reqHeaders.some((h) => h.name === 'content-type'));
  assert.equal(d.requestBody.kind, 'form');
  assert.ok(d.requestBody.pairs.some((p) => p.name === 'refresh_token'));
  assert.equal(d.responseBody.kind, 'json');
  assert.equal(d.resCookies[0].name, 'session_id');
  assert.ok(d.resCookies[0].httpOnly);
  assert.deepEqual(d.timings.map((t) => t.name), H.TIMING_KEYS);
  const q = H.entryDetail(shop, at('shipping/quotes').i, 100000);
  assert.deepEqual(q.query.map((x) => x.name), ['postcode', 'country']);
  assert.equal(H.entryDetail(shop, 99999, 10), null);
  const img = H.entryDetail(shop, at('lamp-96').i, 100000);
  assert.equal(img.responseBody.kind, 'image');
});
