'use strict';
// Writes generated HAR samples. Every host is a reserved example name (example.com, example.net, example.org, .test),
// every token and cookie is made up, and the images are drawn here. Nothing comes from a real capture.
// usage: node scripts/make-samples.js <dir> [--large N]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---- a tiny PNG writer for image bodies ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, paint) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const [r, g, b] = paint(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PRODUCT_PNG = png(96, 96, (x, y) => {
  const d = Math.hypot(x - 48, y - 44);
  if (d < 26) return [240, 160, 40];
  if (y > 76 && y < 82 && x > 20 && x < 76) return [60, 60, 70];
  return [235 - (y >> 2), 240 - (y >> 2), 248];
});
const LOGO_PNG = png(64, 32, (x, y) => ((x >> 3) + (y >> 3)) % 2 ? [22, 50, 79] : [61, 143, 209]);

const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const FAKE_JWT = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'user-1042', name: 'Test Shopper', iat: 1793000000, iss: 'auth.example.com' })}.c2FtcGxlLXNpZ25hdHVyZS1ub3QtcmVhbA`;
const SESSION = 'sess_4f1c2a9e7b6d5c3a1f0e9d8c7b6a5f4e';

function hdrs(obj) { return Object.entries(obj).map(([name, value]) => ({ name, value: String(value) })); }

function makeEntry(o) {
  const url = new URL(o.url);
  const qs = [...url.searchParams.entries()].map(([name, value]) => ({ name, value }));
  const t = o.timings;
  const time = Object.values(t).reduce((a, v) => a + Math.max(0, v), 0) - Math.max(0, t.ssl || 0);
  const text = o.body == null ? undefined : o.body;
  const size = o.size != null ? o.size : (text == null ? 0 : (o.encoding === 'base64' ? Buffer.from(text, 'base64').length : Buffer.byteLength(text)));
  const reqHeaders = hdrs({ ':authority': url.host, ':method': o.method || 'GET', ':path': url.pathname + url.search, ':scheme': 'https', accept: o.accept || '*/*', 'accept-encoding': 'gzip, deflate, br', 'accept-language': 'en-US,en;q=0.9', 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SampleBrowser/1.0', ...(o.reqHeaders || {}) });
  const resHeaders = hdrs({ 'content-type': o.mime, 'content-length': size, date: 'Fri, 06 Nov 2026 14:03:11 GMT', server: 'example-edge', ...(o.resHeaders || {}) });
  const e = {
    pageref: o.page || 'page_1',
    startedDateTime: new Date(o.start).toISOString(),
    time: Math.round(time * 1000) / 1000,
    request: {
      method: o.method || 'GET', url: o.url, httpVersion: 'h2', headers: reqHeaders, queryString: qs,
      cookies: o.reqCookies || [], headersSize: -1, bodySize: o.postData ? Buffer.byteLength(o.postData.text || '') : 0,
      ...(o.postData ? { postData: o.postData } : {}),
    },
    response: {
      status: o.status == null ? 200 : o.status, statusText: o.statusText == null ? 'OK' : o.statusText, httpVersion: 'h2', headers: o.status === 0 ? [] : resHeaders,
      cookies: o.resCookies || [], content: { size, mimeType: o.mime || '', ...(text != null ? { text } : {}), ...(o.encoding ? { encoding: o.encoding } : {}) },
      redirectURL: o.redirect || '', headersSize: -1, bodySize: o.status === 0 ? -1 : Math.round(size * (o.ratio || 1)),
      ...(o.error ? { _error: o.error } : {}), ...(o.chrome ? { _transferSize: o.status === 0 ? 0 : Math.round(size * (o.ratio || 1)) + 320 } : {}),
    },
    cache: {}, timings: t,
    serverIPAddress: o.ip || '192.0.2.10', connection: String(o.conn || 41020),
  };
  if (o.chrome) { e._resourceType = o.rtype; e._priority = o.priority || 'High'; e._initiator = { type: o.initiator || 'parser', url: o.initiatorUrl || 'https://shop.example.com/checkout' }; }
  return e;
}

function tm(r, { dns = 0, connect = 0, ssl = 0, wait, receive, blocked } = {}) {
  return { blocked: blocked != null ? blocked : Math.round(r() * 8 * 100) / 100, dns, connect: connect + ssl, ssl, send: 0.2, wait, receive };
}

/** Chrome-style capture of a checkout page with an API, tokens, cookies, one 404, one 500, a refused connection and slow calls. */
function shopCheckout() {
  const r = rng(7);
  const T0 = Date.parse('2026-11-06T14:03:10.120Z');
  const E = [];
  const add = (o) => E.push(makeEntry({ chrome: true, ...o }));
  const cookieHdr = `session_id=${SESSION}; cart_id=cart_88213; theme=dark`;
  add({ url: 'https://shop.example.com/checkout?step=payment', rtype: 'document', mime: 'text/html', start: T0, timings: tm(r, { dns: 14.2, connect: 18.4, ssl: 22.1, wait: 182.5, receive: 9.3 }), accept: 'text/html,application/xhtml+xml', reqHeaders: { cookie: cookieHdr }, reqCookies: [{ name: 'session_id', value: SESSION }, { name: 'cart_id', value: 'cart_88213' }, { name: 'theme', value: 'dark' }], resHeaders: { 'set-cookie': `csrf_token=csrf_9a8b7c6d5e; Path=/; Secure; SameSite=Strict`, 'cache-control': 'no-store' }, resCookies: [{ name: 'csrf_token', value: 'csrf_9a8b7c6d5e', path: '/', secure: true, sameSite: 'Strict' }], body: '<!doctype html>\n<html lang="en">\n<head><title>Checkout - Example Shop</title><link rel="stylesheet" href="/static/app.css"></head>\n<body>\n<main id="checkout"><h1>Payment</h1><p>Sample page for HAR Viewer.</p></main>\n<script src="/static/app.js"></script>\n</body>\n</html>\n', ratio: 0.35, initiator: 'other' });
  let t = T0 + 240;
  const statics = [
    ['https://shop.example.com/static/app.css', 'stylesheet', 'text/css', 'body{margin:0;font-family:system-ui}#checkout{max-width:720px;margin:auto}\n', 18],
    ['https://shop.example.com/static/vendor.js', 'script', 'application/javascript', null, 52, 183422],
    ['https://shop.example.com/static/app.js', 'script', 'application/javascript', 'import { mountCheckout } from "./checkout.js";\nmountCheckout(document.getElementById("checkout"));\n', 34],
    ['https://fonts.example.org/inter-var.woff2', 'font', 'font/woff2', null, 41, 48211],
    ['https://cdn.example.net/img/logo.png', 'image', 'image/png', LOGO_PNG.toString('base64'), 22, null, 'base64'],
    ['https://cdn.example.net/img/products/lamp-96.png', 'image', 'image/png', PRODUCT_PNG.toString('base64'), 26, null, 'base64'],
    ['https://cdn.example.net/img/products/chair-96.png', 'image', 'image/png', PRODUCT_PNG.toString('base64'), 31, null, 'base64'],
    ['https://cdn.example.net/img/hero-banner.webp', 'image', 'image/webp', null, 64, 92213],
  ];
  for (const [url, rtype, mime, body, wait, size, encoding] of statics) {
    add({ url, rtype, mime, start: t + r() * 30, timings: tm(r, { dns: url.includes('cdn') && !E.some((e) => e.request.url.includes('cdn')) ? 11.6 : 0, connect: url.includes('fonts') ? 16.2 : 0, ssl: url.includes('fonts') ? 19.5 : 0, wait: wait + r() * 20, receive: 4 + r() * 30 }), body, size, encoding, ratio: mime.startsWith('image') || mime.startsWith('font') ? 1 : 0.3, resHeaders: { 'cache-control': 'public, max-age=31536000' } });
    t += 6 + r() * 10;
  }
  // a missing source map and a missing image
  add({ url: 'https://shop.example.com/static/app.js.map', rtype: 'other', mime: 'text/html', status: 404, statusText: 'Not Found', start: t + 120, timings: tm(r, { wait: 38, receive: 1.2 }), body: '<h1>404 Not Found</h1>' });
  add({ url: 'https://cdn.example.net/img/products/desk-96.png', rtype: 'image', mime: 'text/plain', status: 404, statusText: 'Not Found', start: t + 128, timings: tm(r, { wait: 29, receive: 0.8 }), body: 'not found' });
  // API calls with a bearer token
  t += 260;
  const auth = { authorization: `Bearer ${FAKE_JWT}`, 'x-request-id': 'req-0001', cookie: cookieHdr };
  const api = (o) => add({ rtype: 'fetch', mime: 'application/json', initiator: 'script', initiatorUrl: 'https://shop.example.com/static/app.js', reqCookies: [{ name: 'session_id', value: SESSION }], ...o, reqHeaders: { ...auth, accept: 'application/json', ...(o.reqHeaders || {}) } });
  const cart = { cartId: 'cart_88213', currency: 'USD', items: [{ sku: 'LAMP-96', name: 'Desk lamp', qty: 1, price: 39.5 }, { sku: 'CHAIR-96', name: 'Task chair', qty: 2, price: 129 }], subtotal: 297.5, shipping: { method: 'standard', price: 6.9 }, total: 304.4 };
  api({ url: 'https://api.shop.example.com/v2/cart/cart_88213', start: t, timings: tm(r, { dns: 9.8, connect: 14.1, ssl: 17.9, wait: 96.4, receive: 2.2 }), body: JSON.stringify(cart) });
  api({ url: 'https://api.shop.example.com/v2/me', start: t + 4, timings: tm(r, { wait: 71.3, receive: 1.1 }), body: JSON.stringify({ id: 'user-1042', email: 'shopper@example.com', name: 'Test Shopper', tier: 'gold', addresses: [{ id: 'addr_1', line1: '1 Sample Street', city: 'Exampleville', country: 'US' }] }) });
  api({ url: 'https://api.shop.example.com/v2/shipping/quotes?postcode=00000&country=US', start: t + 110, timings: tm(r, { wait: 2310.6, receive: 3.4 }), body: JSON.stringify({ quotes: [{ id: 'std', label: 'Standard', days: 5, price: 6.9 }, { id: 'exp', label: 'Express', days: 1, price: 24 }] }) });
  api({ url: 'https://api.shop.example.com/v2/recommendations?cart=cart_88213&limit=4', start: t + 130, timings: tm(r, { wait: 1480.2, receive: 12.6 }), body: JSON.stringify({ items: [1, 2, 3, 4].map((n) => ({ sku: `REC-${n}`, name: `Recommended item ${n}`, price: 10 * n + 0.99 })) }) });
  api({ url: 'https://api.shop.example.com/v2/promo/validate', method: 'POST', start: t + 1900, status: 500, statusText: 'Internal Server Error', timings: tm(r, { wait: 812.3, receive: 1.0 }), postData: { mimeType: 'application/json', text: JSON.stringify({ code: 'AUTUMN-SAMPLE', cartId: 'cart_88213' }) }, body: JSON.stringify({ error: 'internal_error', message: 'Promo service timed out', traceId: 'trace-7f3e2d1c' }) });
  api({ url: 'https://api.shop.example.com/v2/payment/intent', method: 'POST', start: t + 2900, timings: tm(r, { wait: 344.8, receive: 1.9 }), reqHeaders: { 'content-type': 'application/json', 'x-csrf-token': 'csrf_9a8b7c6d5e' }, postData: { mimeType: 'application/json', text: JSON.stringify({ amount: 30440, currency: 'usd', method: 'card', card: { last4: '4242', brand: 'testcard' } }) }, body: JSON.stringify({ id: 'pi_sample_001', status: 'requires_confirmation', client_secret: 'pi_sample_001_secret_FAKE00000000', amount: 30440 }) });
  // login refresh with form data, a token in the query and a refused analytics call
  add({ url: 'https://auth.example.com/oauth/token', method: 'POST', rtype: 'fetch', mime: 'application/json', start: t + 3400, timings: tm(r, { dns: 12.2, connect: 15.5, ssl: 21.3, wait: 120.5, receive: 0.9 }), reqHeaders: { 'content-type': 'application/x-www-form-urlencoded' }, postData: { mimeType: 'application/x-www-form-urlencoded', text: 'grant_type=refresh_token&client_id=web-checkout&refresh_token=rt_FAKE_5d4c3b2a1f&scope=cart%20payment', params: [{ name: 'grant_type', value: 'refresh_token' }, { name: 'client_id', value: 'web-checkout' }, { name: 'refresh_token', value: 'rt_FAKE_5d4c3b2a1f' }, { name: 'scope', value: 'cart payment' }] }, body: JSON.stringify({ access_token: FAKE_JWT, refresh_token: 'rt_FAKE_6e5d4c3b2a', token_type: 'Bearer', expires_in: 3600 }), resHeaders: { 'set-cookie': `session_id=${SESSION}; Path=/; HttpOnly; Secure; SameSite=Lax` }, resCookies: [{ name: 'session_id', value: SESSION, path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }] });
  add({ url: `https://cdn.example.net/private/invoice-preview.png?access_token=at_FAKE_1a2b3c4d&expires=1793003600`, rtype: 'image', mime: 'image/png', start: t + 3700, timings: tm(r, { wait: 88.2, receive: 6.1 }), body: LOGO_PNG.toString('base64'), encoding: 'base64' });
  add({ url: 'https://analytics.example.test/collect?event=checkout_step&step=payment', method: 'POST', rtype: 'ping', mime: '', status: 0, statusText: '', error: 'net::ERR_CONNECTION_REFUSED', start: t + 3720, timings: { blocked: 1.2, dns: 3.1, connect: -1, ssl: -1, send: 0, wait: 0, receive: 0 }, postData: { mimeType: 'text/plain', text: '{"event":"checkout_step"}' } });
  // a websocket and a few polling calls
  add({ url: 'wss://ws.example.com/live/cart', rtype: 'websocket', mime: '', status: 101, statusText: 'Switching Protocols', start: t + 3800, timings: tm(r, { dns: 8.1, connect: 12.2, ssl: 15.1, wait: 45.3, receive: 0 }), reqHeaders: { upgrade: 'websocket' } });
  for (let k = 0; k < 18; k++) {
    api({ url: `https://api.shop.example.com/v2/stock?sku=${['LAMP-96', 'CHAIR-96'][k % 2]}&n=${k}`, start: t + 4000 + k * 260, timings: tm(r, { wait: 40 + r() * 140, receive: 0.5 + r() }), body: JSON.stringify({ sku: ['LAMP-96', 'CHAIR-96'][k % 2], inStock: true, qty: 3 + (k % 5) }) });
  }
  add({ url: 'https://shop.example.com/checkout/confirm', method: 'POST', rtype: 'document', mime: 'text/html', status: 302, statusText: 'Found', redirect: 'https://shop.example.com/checkout/done?order=ord_5521', start: t + 9200, timings: tm(r, { wait: 210.2, receive: 0.4 }), reqHeaders: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHdr }, postData: { mimeType: 'application/x-www-form-urlencoded', text: 'order_note=Leave+at+the+door&_csrf=csrf_9a8b7c6d5e&save_card=on', params: [{ name: 'order_note', value: 'Leave at the door' }, { name: '_csrf', value: 'csrf_9a8b7c6d5e' }, { name: 'save_card', value: 'on' }] }, body: '' });
  add({ url: 'https://shop.example.com/checkout/done?order=ord_5521', rtype: 'document', mime: 'text/html', start: t + 9420, timings: tm(r, { wait: 154.7, receive: 6.8 }), reqHeaders: { cookie: cookieHdr }, body: '<!doctype html><html><body><h1>Thank you</h1><p>Order ord_5521 is placed.</p></body></html>' });
  E.sort((a, b) => Date.parse(a.startedDateTime) - Date.parse(b.startedDateTime));
  return {
    log: {
      version: '1.2', creator: { name: 'WebInspector', version: '537.36' },
      pages: [{ startedDateTime: new Date(T0).toISOString(), id: 'page_1', title: 'https://shop.example.com/checkout?step=payment', pageTimings: { onContentLoad: 812.4, onLoad: 2961.7 } }],
      entries: E,
    },
  };
}

/** Firefox-style capture of a docs site: no _resourceType, no secrets, a 301 and a cached 304. */
function docsSite() {
  const r = rng(11);
  const T0 = Date.parse('2026-11-05T09:30:00.000Z');
  const E = [];
  const add = (o) => E.push(makeEntry({ page: 'page_docs', ...o }));
  add({ url: 'http://docs.example.org/', mime: 'text/html', status: 301, statusText: 'Moved Permanently', redirect: 'https://docs.example.org/guide/', start: T0, timings: tm(r, { dns: 21, connect: 30, wait: 40, receive: 0 }), body: '' });
  add({ url: 'https://docs.example.org/guide/', mime: 'text/html; charset=utf-8', start: T0 + 95, timings: tm(r, { connect: 22, ssl: 28, wait: 118, receive: 14 }), body: '<!doctype html><html><head><title>Guide - Example Docs</title></head><body><h1>Guide</h1></body></html>' });
  const files = [['guide.css', 'text/css'], ['search-index.json', 'application/json'], ['highlight.js', 'text/javascript'], ['diagram.svg', 'image/svg+xml'], ['mono.woff2', 'font/woff2']];
  let t = T0 + 260;
  for (const [f, mime] of files) {
    const body = mime === 'application/json' ? JSON.stringify({ pages: Array.from({ length: 12 }, (_, k) => ({ id: k, title: `Chapter ${k + 1}`, words: 400 + k * 37 })) }) : mime === 'image/svg+xml' ? '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" rx="8" fill="#3d8fd1"/><circle cx="30" cy="30" r="14" fill="#fff"/></svg>' : mime === 'text/css' ? 'h1{font-size:2rem}' : null;
    add({ url: `https://static.example.org/docs/${f}`, mime, start: t, timings: tm(r, { dns: f === 'guide.css' ? 9 : 0, wait: 30 + r() * 60, receive: 2 + r() * 20 }), body, size: body ? undefined : 24000 + Math.round(r() * 30000) });
    t += 12;
  }
  add({ url: 'https://static.example.org/docs/logo.svg', mime: 'image/svg+xml', status: 304, statusText: 'Not Modified', start: t + 20, timings: tm(r, { wait: 22, receive: 0 }), size: 0 });
  for (let k = 1; k <= 6; k++) add({ url: `https://docs.example.org/api/pages/${k}.json`, mime: 'application/json', start: t + 200 + k * 90, timings: tm(r, { wait: 25 + r() * 70, receive: 1 + r() * 4 }), body: JSON.stringify({ id: k, title: `Chapter ${k}`, sections: k + 2 }) });
  return { log: { version: '1.2', creator: { name: 'Firefox', version: '140.0' }, browser: { name: 'Firefox', version: '140.0' }, pages: [{ startedDateTime: new Date(T0).toISOString(), id: 'page_docs', title: 'Guide - Example Docs', pageTimings: { onContentLoad: 402, onLoad: 688 } }], entries: E } };
}

/** A large capture: n entries, written as a stream so memory stays flat. Returns the byte size. */
function writeLarge(file, n) {
  const r = rng(99);
  const T0 = Date.parse('2026-11-06T10:00:00.000Z');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, '{"log":{"version":"1.2","creator":{"name":"WebInspector","version":"537.36"},"pages":[{"startedDateTime":"' + new Date(T0).toISOString() + '","id":"page_1","title":"https://app.example.com/dashboard","pageTimings":{"onContentLoad":1200,"onLoad":4100}}],"entries":[\n');
  const kinds = [['fetch', 'application/json'], ['script', 'application/javascript'], ['image', 'image/png'], ['stylesheet', 'text/css'], ['xhr', 'application/json']];
  let buf = [];
  for (let k = 0; k < n; k++) {
    const [rtype, mime] = kinds[k % kinds.length];
    const status = k % 97 === 0 ? 500 : k % 61 === 0 ? 404 : 200;
    const body = mime === 'application/json' ? JSON.stringify({ id: k, values: [r(), r(), r()].map((x) => Math.round(x * 1000)), label: `row ${k}`, pad: 'x'.repeat(200 + (k % 400)) }) : null;
    const e = makeEntry({ chrome: true, rtype, mime, status, statusText: status === 200 ? 'OK' : status === 404 ? 'Not Found' : 'Internal Server Error', url: `https://${['app', 'api', 'cdn', 'metrics'][k % 4]}.example.com/v1/items/${k}?page=${k % 50}`, start: T0 + k * 7 + r() * 5, timings: tm(r, { wait: 10 + r() * (k % 53 === 0 ? 3000 : 200), receive: r() * 20 }), body, size: body ? undefined : 2000 + Math.round(r() * 40000) });
    buf.push(JSON.stringify(e));
    if (buf.length >= 500) { fs.writeSync(fd, (k >= buf.length ? ',\n' : '') + buf.join(',\n')); buf = []; }
  }
  if (buf.length) fs.writeSync(fd, (n > buf.length ? ',\n' : '') + buf.join(',\n'));
  fs.writeSync(fd, '\n]}}\n');
  fs.closeSync(fd);
  return fs.statSync(file).size;
}

function writeAll(dir, opts) {
  const o = opts || {};
  fs.mkdirSync(dir, { recursive: true });
  const out = {};
  const w = (name, obj) => { const p = path.join(dir, name); fs.writeFileSync(p, JSON.stringify(obj, null, 2)); out[name] = p; };
  w('shop-checkout.har', shopCheckout());
  w('docs-site.har', docsSite());
  fs.writeFileSync(path.join(dir, 'broken.har'), '{"log": {"version": "1.2", "entries": [ {"request": ');
  out['broken.har'] = path.join(dir, 'broken.har');
  fs.writeFileSync(path.join(dir, 'not-a-har.har'), JSON.stringify({ hello: 'this JSON has no log object' }));
  out['not-a-har.har'] = path.join(dir, 'not-a-har.har');
  if (o.large) { out['large-capture.har'] = path.join(dir, 'large-capture.har'); writeLarge(out['large-capture.har'], o.large); }
  return out;
}

module.exports = { writeAll, shopCheckout, docsSite, writeLarge, FAKE_JWT, SESSION, png };

if (require.main === module) {
  const dir = process.argv[2] || 'samples';
  const li = process.argv.indexOf('--large');
  const files = writeAll(dir, { large: li > 0 ? Number(process.argv[li + 1]) || 50000 : 0 });
  for (const [n, p] of Object.entries(files)) console.log(n, fs.statSync(p).size);
}
