'use strict';
// The sensitive-data scan, the redacted copy and export of filtered entries.
const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/core/har');
const S = require('../scripts/make-samples');

const shop = S.shopCheckout();
const SECRETS = [S.SESSION, 'eyJ', 'rt_FAKE', 'at_FAKE', 'csrf_9a8b', 'secret_FAKE'];

test('scanSensitive counts Authorization headers, cookies, URL tokens and body secrets', () => {
  const s = H.scanSensitive(shop);
  assert.ok(s.any);
  assert.ok(s.auth >= 20);
  assert.ok(s.cookie >= 20);
  assert.equal(s.setCookie, 2);
  assert.equal(s.query, 1);
  assert.ok(s.token >= 2);
  assert.match(H.sensitiveText(s), /^This HAR holds \d+ Authorization headers, cookies in \d+ requests, 2 Set-Cookie responses, 1 token in URLs and \d+ other secrets/);
  const clean = H.scanSensitive(S.docsSite());
  assert.equal(clean.any, false);
  assert.equal(H.sensitiveText(clean), '');
});

test('redactHar removes every secret and keeps the structure', () => {
  const before = JSON.stringify(shop);
  const { har, report } = H.redactHar(shop);
  assert.equal(JSON.stringify(shop), before, 'the source object is not changed');
  const text = JSON.stringify(har);
  for (const s of SECRETS) assert.ok(!text.includes(s), `${s} is gone`);
  assert.equal(har.log.entries.length, shop.log.entries.length);
  assert.deepEqual(har.log.entries.map((e) => new URL(e.request.url).host), shop.log.entries.map((e) => new URL(e.request.url).host));
  assert.equal(H.scanSensitive(har).any, false, 'a redacted copy opens without the warning');
  assert.ok(report.headers > 20 && report.cookies > 20 && report.query === 1 && report.bodies >= 5);
  assert.match(H.redactReportText(report), /^Replaced \d+ header values, \d+ cookies, 1 URL parameter and \d+ body fields in \d+ requests\.$/);
  assert.match(har.log.comment, /\[REDACTED\]/);
});

test('redaction keeps names and safe values', () => {
  const { har } = H.redactHar(shop);
  const find = (part) => har.log.entries.find((e) => e.request.url.includes(part));
  const me = find('/v2/me');
  const hv = (e, n) => e.request.headers.find((h) => h.name === n).value;
  assert.equal(hv(me, 'authorization'), 'Bearer [REDACTED]');
  assert.equal(hv(me, 'cookie'), 'session_id=[REDACTED]; cart_id=[REDACTED]; theme=[REDACTED]');
  assert.equal(hv(me, 'accept'), 'application/json');
  const tok = find('oauth/token');
  assert.equal(tok.request.postData.text, 'grant_type=refresh_token&client_id=web-checkout&refresh_token=%5BREDACTED%5D&scope=cart%20payment');
  assert.deepEqual(JSON.parse(tok.response.content.text), { access_token: '[REDACTED]', refresh_token: '[REDACTED]', token_type: 'Bearer', expires_in: 3600 });
  assert.equal(tok.response.headers.find((h) => h.name === 'set-cookie').value, 'session_id=[REDACTED]; Path=/; HttpOnly; Secure; SameSite=Lax');
  const inv = find('invoice-preview');
  assert.match(inv.request.url, /access_token=%5BREDACTED%5D&expires=1793003600$/);
  assert.equal(inv.request.queryString.find((q) => q.name === 'access_token').value, '[REDACTED]');
  const pay = find('payment/intent');
  assert.equal(JSON.parse(pay.response.content.text).client_secret, '[REDACTED]');
  assert.equal(JSON.parse(pay.response.content.text).amount, 30440);
  const cart = find('/v2/cart/');
  assert.equal(cart.response.content.text, shop.log.entries.find((e) => e.request.url.includes('/v2/cart/')).response.content.text);
  // running it again changes nothing more
  const again = H.redactHar(har);
  assert.equal(again.report.total, 0);
  assert.match(H.redactReportText(again.report), /No Authorization headers/);
});

test('redactHar handles base64 bodies and odd input', () => {
  const har = { log: { entries: [{ request: { url: 'https://a.example/x?sig=abc', headers: [{ name: 'X-Api-Key', value: 'k1' }], postData: { mimeType: 'application/json', encoding: 'base64', text: Buffer.from('{"password":"p1","user":"u"}').toString('base64') } }, response: { headers: [], content: { mimeType: 'application/json', encoding: 'base64', text: Buffer.from('{"token":"t1"}').toString('base64') } } }, {}] } };
  const { har: out, report } = H.redactHar(har);
  const e = out.log.entries[0];
  assert.equal(e.request.url, 'https://a.example/x?sig=%5BREDACTED%5D');
  assert.equal(e.request.headers[0].value, '[REDACTED]');
  assert.deepEqual(JSON.parse(Buffer.from(e.request.postData.text, 'base64').toString()), { password: '[REDACTED]', user: 'u' });
  assert.deepEqual(JSON.parse(Buffer.from(e.response.content.text, 'base64').toString()), { token: '[REDACTED]' });
  assert.equal(report.entries, 1);
});

test('exportEntries keeps only the picked entries and their pages', () => {
  const two = { log: { ...shop.log, pages: [...shop.log.pages, { id: 'page_2', title: 'other', startedDateTime: shop.log.pages[0].startedDateTime, pageTimings: {} }] } };
  const out = H.exportEntries(two, [5, 2, 2, 9999, -1, 1.5]);
  assert.equal(out.log.entries.length, 2);
  assert.ok(Date.parse(out.log.entries[0].startedDateTime) <= Date.parse(out.log.entries[1].startedDateTime));
  assert.deepEqual(out.log.pages.map((p) => p.id), ['page_1']);
  assert.equal(out.log.creator.name, 'WebInspector');
  assert.equal(two.log.entries.length, shop.log.entries.length);
  H.parseHar(JSON.stringify(out));
});
