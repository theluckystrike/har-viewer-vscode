'use strict';
// HAR Viewer webview. Builds every element with createElement and textContent; no HTML strings from the file.
const { TYPES, TYPE_LABELS, filterRows, totals } = require('../core/har');
const { fmtSize, fmtMs } = require('../core/protocol');

const vscode = acquireVsCodeApi();
const ROW_H = 22;
const PHASES = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'];
const PHASE_LABELS = { blocked: 'Blocked / queued', dns: 'DNS lookup', connect: 'Connecting', ssl: 'TLS handshake', send: 'Request sent', wait: 'Waiting (TTFB)', receive: 'Content download' };

const S = {
  name: '', meta: null, rows: [], ids: [], done: false, sel: -1, detail: null, tab: 'headers', rendered: false,
  f: { types: new Set(), status: 'all', domain: '', text: '', sort: 'start', desc: false },
  range: [-1, -1], bannerClosed: false,
};
const app = document.getElementById('app');
const $ = {};

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
}
function btn(text, cls, title, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (title) b.title = title;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
function plural(n, one, many) { return `${n.toLocaleString('en-US')} ${n === 1 ? one : (many || one + 's')}`; }

// ---------- layout ----------

function buildLayout() {
  app.textContent = '';
  const top = el('div', 'top');
  $.title = el('div', 'title', S.name);
  $.stats = el('div', 'stats');
  const actions = el('div', 'actions');
  $.exportBtn = btn('Export filtered...', 'secondary', 'Save the requests shown in the table as a new HAR file', () => {
    if (!S.ids.length) return;
    vscode.postMessage({ type: 'export', indices: S.ids.slice() });
  });
  actions.append(
    $.exportBtn,
    btn('Save redacted copy...', 'secondary', 'Save a copy without Authorization headers, cookies and tokens', () => vscode.postMessage({ type: 'redact' })),
    btn('Open as text', 'secondary', 'Open the HAR in the normal text editor', () => vscode.postMessage({ type: 'openText' })),
  );
  top.append($.title, $.stats, actions);

  $.banner = el('div', 'banner sens');
  $.banner.hidden = true;

  const filters = el('div', 'filters');
  $.search = el('input', 'search');
  $.search.type = 'search';
  $.search.placeholder = 'Filter by URL, method, status or type (use -word to hide)';
  $.search.setAttribute('aria-label', 'Filter requests');
  let timer = 0;
  $.search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { S.f.text = $.search.value; applyFilter(); }, 120); });
  $.chips = el('div', 'chips');
  const all = btn('All', 'chip on', 'Show every type', () => { S.f.types.clear(); applyFilter(); });
  all.dataset.type = '';
  $.chips.append(all);
  for (const t of TYPES) {
    const c = btn(TYPE_LABELS[t], 'chip', `Show ${TYPE_LABELS[t]} requests. Cmd or Ctrl click to pick more than one.`, (ev) => {
      if (ev.metaKey || ev.ctrlKey) { if (S.f.types.has(t)) S.f.types.delete(t); else S.f.types.add(t); } else if (S.f.types.size === 1 && S.f.types.has(t)) S.f.types.clear(); else { S.f.types.clear(); S.f.types.add(t); }
      applyFilter();
    });
    c.dataset.type = t;
    $.chips.append(c);
  }
  $.status = el('select', 'status-sel');
  $.status.setAttribute('aria-label', 'Status filter');
  for (const [v, t] of [['all', 'All statuses'], ['2xx', '2xx success'], ['3xx', '3xx redirect'], ['4xx', '4xx client error'], ['5xx', '5xx server error'], ['failed', 'Failed (4xx, 5xx, no response)'], ['slow', 'Slow'], ['sensitive', 'Holds secrets']]) {
    const o = el('option', null, t); o.value = v; $.status.append(o);
  }
  $.status.addEventListener('change', () => { S.f.status = $.status.value; applyFilter(); });
  $.domain = el('select', 'domain-sel');
  $.domain.setAttribute('aria-label', 'Domain filter');
  $.domain.addEventListener('change', () => { S.f.domain = $.domain.value; applyFilter(); });
  filters.append($.search, $.chips, $.status, $.domain);

  const main = el('div', 'main');
  $.main = main;
  const table = el('div', 'table');
  $.head = el('div', 'row head');
  for (const [key, label] of [['status', 'Status'], ['method', 'Method'], ['name', 'Name'], ['domain', 'Domain'], ['type', 'Type'], ['size', 'Size'], ['time', 'Time'], ['start', 'Waterfall']]) {
    const c = el('div', `c c-${key}`, label);
    if (key !== 'domain') {
      c.classList.add('sortable');
      c.dataset.sort = key;
      c.title = `Sort by ${label.toLowerCase()}`;
      c.addEventListener('click', () => {
        if (S.f.sort === key) S.f.desc = !S.f.desc; else { S.f.sort = key; S.f.desc = key === 'time' || key === 'size'; }
        applyFilter();
      });
    }
    $.head.append(c);
  }
  $.viewport = el('div', 'viewport');
  $.viewport.tabIndex = 0;
  $.viewport.setAttribute('role', 'grid');
  $.viewport.setAttribute('aria-label', 'Requests');
  $.spacer = el('div', 'spacer');
  $.list = el('div', 'list');
  $.spacer.append($.list);
  $.viewport.append($.spacer);
  $.empty = el('div', 'empty-note');
  $.empty.hidden = true;
  $.viewport.append($.empty);
  $.viewport.addEventListener('scroll', () => renderRows(false));
  $.viewport.addEventListener('keydown', onKey);
  $.list.addEventListener('mousedown', (ev) => {
    const r = ev.target.closest('.row');
    if (r && r.dataset.i) { select(Number(r.dataset.i)); $.viewport.focus(); }
  });
  table.append($.head, $.viewport);

  $.detail = el('div', 'detail');
  $.detail.hidden = true;
  main.append(table, $.detail);

  const bar = el('div', 'statusbar');
  $.count = el('span', 'count');
  $.toast = el('span', 'toast');
  $.toast.setAttribute('role', 'status');
  const slot = document.getElementById('support-slot');
  const support = slot && slot.firstElementChild;
  bar.append($.count, $.toast);
  if (support) { const sp = el('span', 'grow'); bar.append(sp, support); }
  app.append(top, $.banner, filters, main, bar);
  new ResizeObserver(() => renderRows(true)).observe($.viewport);
  document.addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === 'f') { ev.preventDefault(); $.search.focus(); $.search.select(); }
    if (ev.key === 'Escape' && document.activeElement !== $.search && !$.detail.hidden) closeDetail();
  });
}

function notice(text, withOpen) {
  app.textContent = '';
  const box = el('div', 'notice');
  box.append(el('p', null, text));
  if (withOpen) box.append(btn('Open as text', 'secondary', null, () => vscode.postMessage({ type: 'openText' })));
  app.append(box);
}

let toastTimer = 0;
function toast(text) {
  if (!$.toast) return;
  $.toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $.toast.textContent = ''; }, 4000);
}

// ---------- summary and banner ----------

function statLink(text, cls, status) {
  const b = btn(text, `stat-link ${cls}`, 'Show only these requests', () => { S.f.status = status; $.status.value = status; applyFilter(); });
  return b;
}

function renderStats() {
  const m = S.meta;
  if (!m) return;
  const t = m.totals;
  $.stats.textContent = '';
  const parts = [plural(m.count, 'request'), `${fmtSize(t.size)} transferred`, `${fmtSize(t.csize)} resources`, `finish ${fmtMs(t.finish)}`];
  const p = m.pages && m.pages[0];
  if (p && p.onContentLoad > 0) parts.push(`DOMContentLoaded ${fmtMs(p.onContentLoad)}`);
  if (p && p.onLoad > 0) parts.push(`Load ${fmtMs(p.onLoad)}`);
  $.stats.append(el('span', null, parts.join(' · ')));
  if (t.failed) { $.stats.append(el('span', 'sep', '·')); $.stats.append(statLink(plural(t.failed, 'failed', 'failed'), 'bad', 'failed')); }
  if (t.slow) {
    const b = statLink(plural(t.slow, 'slow', 'slow'), 'warn', 'slow');
    b.title = `Show only requests that took ${fmtMs(m.slowMs)} or more (setting harViewer.slowRequestMs)`;
    $.stats.append(el('span', 'sep', '·'), b);
  }
  if (m.creator) $.title.title = `Saved by ${m.creator}${m.started ? ', first request ' + m.started : ''}`;
}

function renderBanner() {
  const m = S.meta;
  if (!m || !m.sensitive || !m.sensitive.any || S.bannerClosed) { $.banner.hidden = true; return; }
  $.banner.textContent = '';
  $.banner.append(el('span', 'icon', '!'), el('span', 'text', m.sensitiveText));
  $.banner.append(
    btn('Save redacted copy...', 'primary', 'Write a copy with these values replaced by [REDACTED]', () => vscode.postMessage({ type: 'redact' })),
    btn('Show them', 'secondary', 'Show only the requests that hold secrets', () => { S.f.status = 'sensitive'; $.status.value = 'sensitive'; applyFilter(); }),
    btn('×', 'close', 'Hide this warning for this tab', () => { S.bannerClosed = true; renderBanner(); }),
  );
  $.banner.hidden = false;
}

function renderDomains() {
  const keep = S.f.domain;
  $.domain.textContent = '';
  const o = el('option', null, `All domains (${S.meta ? S.meta.domains.length : 0})`); o.value = ''; $.domain.append(o);
  for (const d of (S.meta ? S.meta.domains : [])) { const x = el('option', null, `${d.host} (${d.count})`); x.value = d.host; $.domain.append(x); }
  $.domain.value = keep;
}

// ---------- table ----------

function applyFilter(keepScroll) {
  S.ids = filterRows(S.rows, { types: [...S.f.types], status: S.f.status, domain: S.f.domain, text: S.f.text, sort: S.f.sort, desc: S.f.desc });
  for (const c of $.chips.children) c.classList.toggle('on', c.dataset.type ? S.f.types.has(c.dataset.type) : S.f.types.size === 0);
  for (const c of $.head.children) {
    c.classList.toggle('sorted', c.dataset.sort === S.f.sort && !(S.f.sort === 'start' && !S.f.desc));
    c.dataset.dir = c.dataset.sort === S.f.sort ? (S.f.desc ? 'desc' : 'asc') : '';
  }
  $.exportBtn.disabled = S.ids.length === 0;
  $.spacer.style.height = `${S.ids.length * ROW_H}px`;
  if (keepScroll !== true) $.viewport.scrollTop = 0;
  renderCount();
  renderRows(true);
}

function renderCount() {
  const t = totals(S.rows, S.ids);
  const all = S.rows.length;
  const shown = S.ids.length === all ? plural(all, 'request') : `${S.ids.length.toLocaleString('en-US')} of ${plural(all, 'request')}`;
  $.count.textContent = `${shown} · ${fmtSize(t.size)} transferred · ${fmtSize(t.csize)} resources${t.count ? ` · median ${fmtMs(t.p50)} · p95 ${fmtMs(t.p95)}` : ''}${S.done ? '' : ' · loading...'}`;
  $.empty.hidden = S.ids.length > 0 || !S.done;
  $.empty.textContent = S.rows.length ? 'No request matches these filters.' : 'This HAR has no requests.';
}

function statusClass(r) {
  if (r.status === 0 || r.failed && r.status < 400) return 'st-fail';
  if (r.status >= 500) return 'st-5';
  if (r.status >= 400) return 'st-4';
  if (r.status >= 300) return 'st-3';
  return 'st-2';
}

function waterfall(r, scale) {
  const wf = el('div', 'c c-start wf');
  const bar = el('div', 'bar');
  const s = scale > 0 ? scale : 1;
  bar.style.left = `${Math.min(100, (r.start / s) * 100)}%`;
  bar.style.width = `max(2px, ${Math.min(100, (r.time / s) * 100)}%)`;
  const total = r.t.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let k = 0; k < PHASES.length; k++) {
      if (r.t[k] <= 0) continue;
      const seg = el('span', `ph ph-${PHASES[k]}`);
      seg.style.flexGrow = String(r.t[k]);
      bar.append(seg);
    }
  } else bar.append(el('span', 'ph ph-wait'));
  wf.append(bar);
  wf.title = `Start ${fmtMs(r.start)}, total ${fmtMs(r.time)}\n` + PHASES.map((p, k) => `${PHASE_LABELS[p]}: ${fmtMs(r.t[k])}`).join('\n');
  return wf;
}

function rowEl(r, pos, scale) {
  const d = el('div', `row${r.i === S.sel ? ' sel' : ''}${r.failed ? ' failed' : ''}${r.slow ? ' slow' : ''}`);
  d.dataset.i = String(r.i);
  d.setAttribute('role', 'row');
  d.style.top = `${pos * ROW_H}px`;
  d.append(el('div', `c c-status ${statusClass(r)}`, r.status || (r.statusText ? 'failed' : '(failed)')));
  d.lastChild.title = r.status ? `${r.status} ${r.statusText}` : (r.statusText || 'No response');
  d.append(el('div', 'c c-method', r.method));
  const name = el('div', 'c c-name');
  if (r.sens) { const k = el('span', 'key-badge', 'secret'); k.title = 'This request holds an Authorization header, cookies or a token'; name.append(k); }
  name.append(document.createTextNode(r.name));
  name.title = r.url;
  d.append(name);
  d.append(el('div', 'c c-domain', r.host));
  d.append(el('div', 'c c-type', TYPE_LABELS[r.type]));
  const size = el('div', 'c c-size num', fmtSize(r.size));
  size.title = `${fmtSize(r.size)} transferred, ${fmtSize(r.csize)} resource`;
  d.append(size);
  d.append(el('div', `c c-time num${r.slow ? ' warn' : ''}`, fmtMs(r.time)));
  d.append(waterfall(r, scale));
  return d;
}

function renderRows(force) {
  if (!$.viewport) return;
  const h = $.viewport.clientHeight || 400;
  const first = Math.max(0, Math.floor($.viewport.scrollTop / ROW_H) - 10);
  const last = Math.min(S.ids.length, Math.ceil(($.viewport.scrollTop + h) / ROW_H) + 10);
  if (!force && first === S.range[0] && last === S.range[1]) return;
  S.range = [first, last];
  const scale = S.meta ? S.meta.totals.finish : 1;
  const frag = document.createDocumentFragment();
  for (let k = first; k < last; k++) frag.append(rowEl(S.rows[S.ids[k]], k, scale));
  $.list.textContent = '';
  $.list.append(frag);
  if (!S.rendered && S.ids.length) { S.rendered = true; vscode.postMessage({ type: 'rendered' }); }
}

function markSelection() {
  for (const r of $.list.children) r.classList.toggle('sel', Number(r.dataset.i) === S.sel);
}

function select(i) {
  if (i < 0) return;
  S.sel = i;
  markSelection();
  vscode.postMessage({ type: 'detail', i });
  $.main.classList.add('with-detail');
  $.detail.hidden = false;
  if (!S.detail || S.detail.i !== i) {
    $.detail.textContent = '';
    $.detail.append(el('p', 'loading', 'Loading...'));
  }
}

function closeDetail() {
  S.sel = -1; S.detail = null;
  $.detail.hidden = true;
  $.main.classList.remove('with-detail');
  markSelection();
  renderRows(true);
  $.viewport.focus();
}

function onKey(ev) {
  const pos = S.ids.indexOf(S.sel);
  let next = -1;
  const page = Math.max(1, Math.floor($.viewport.clientHeight / ROW_H) - 1);
  if (ev.key === 'ArrowDown') next = Math.min(S.ids.length - 1, pos + 1);
  else if (ev.key === 'ArrowUp') next = Math.max(0, pos < 0 ? 0 : pos - 1);
  else if (ev.key === 'PageDown') next = Math.min(S.ids.length - 1, pos + page);
  else if (ev.key === 'PageUp') next = Math.max(0, pos - page);
  else if (ev.key === 'Home') next = 0;
  else if (ev.key === 'End') next = S.ids.length - 1;
  else return;
  ev.preventDefault();
  if (next < 0 || !S.ids.length) return;
  const top = next * ROW_H;
  if (top < $.viewport.scrollTop) $.viewport.scrollTop = top;
  else if (top + ROW_H > $.viewport.scrollTop + $.viewport.clientHeight) $.viewport.scrollTop = top + ROW_H - $.viewport.clientHeight;
  select(S.ids[next]);
  renderRows(false);
}

// ---------- details ----------

function kvTable(rows, opts) {
  const o = opts || {};
  if (!rows.length) return el('p', 'muted', o.empty || 'None');
  const t = el('table', 'kv');
  for (const r of rows) {
    const tr = el('tr');
    const k = el('th', null, r.name);
    const v = el('td', null, r.value);
    if (o.secret && o.secret(r.name)) { tr.className = 'secret'; k.append(el('span', 'key-badge', 'secret')); }
    tr.append(k, v);
    t.append(tr);
  }
  return t;
}

function section(title, body, count) {
  const s = el('details', 'sec');
  s.open = true;
  const sum = el('summary', null, count != null ? `${title} (${count})` : title);
  s.append(sum, body);
  return s;
}

const SECRET_HEADER = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-access-token|x-csrf-token|x-xsrf-token|x-amz-security-token|x-goog-api-key|private-token)$/i;

// JSON with colored tokens, built from text nodes only.
function jsonPre(text, colored) {
  const pre = el('pre', 'code json');
  if (!colored) { pre.textContent = text; return pre; }
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
  let last = 0; let m;
  const frag = document.createDocumentFragment();
  while ((m = re.exec(text))) {
    if (m.index > last) frag.append(document.createTextNode(text.slice(last, m.index)));
    if (m[1]) { frag.append(el('span', m[2] ? 'j-key' : 'j-str', m[1])); if (m[2]) frag.append(document.createTextNode(m[2])); } else if (m[3]) frag.append(el('span', 'j-lit', m[3])); else frag.append(el('span', 'j-num', m[4]));
    last = re.lastIndex;
  }
  if (last < text.length) frag.append(document.createTextNode(text.slice(last)));
  pre.append(frag);
  return pre;
}

function bodyEl(b, what) {
  const box = el('div', 'body');
  if (!b || b.kind === 'empty') { box.append(el('p', 'muted', b && b.size > 0 ? `The HAR does not include this ${what} body (${fmtSize(b.size)}).` : `No ${what} body.`)); return box; }
  const info = el('p', 'muted', [b.mime || 'unknown type', b.full != null ? fmtSize(b.full) + ' of text' : (b.size ? fmtSize(b.size) : '')].filter(Boolean).join(' · '));
  box.append(info);
  if (b.kind === 'image') {
    const img = el('img', 'preview');
    img.alt = `${what} image`;
    img.src = b.dataUri;
    box.append(img);
  } else if (b.kind === 'binary') {
    box.append(el('p', 'muted', b.note || 'Binary content. It is not shown here.'));
  } else if (b.kind === 'form') {
    box.append(kvTable(b.pairs, { empty: 'No fields.', secret: (n) => /pass|token|secret|key|session|auth/i.test(n) }));
  } else if (b.kind === 'json') {
    box.append(jsonPre(b.text, b.text.length < 300000));
  } else {
    const pre = el('pre', 'code');
    pre.textContent = b.text;
    box.append(pre);
  }
  if (b.truncated) box.append(el('p', 'muted', `Cut at ${fmtSize(b.text.length)} (setting harViewer.maxBodyKB). Copy copies the full text.`));
  return box;
}

function timingEl(d) {
  const wrap = el('div', 'timing');
  const total = d.timings.reduce((a, t) => a + t.ms, 0) || 1;
  let acc = 0;
  const t = el('table', 'tm');
  for (const p of d.timings) {
    const tr = el('tr');
    tr.append(el('th', null, PHASE_LABELS[p.name]));
    const cell = el('td', 'tm-bar');
    const b = el('span', `ph ph-${p.name}`);
    b.style.marginLeft = `${(acc / total) * 100}%`;
    b.style.width = `${Math.max(p.ms > 0 ? 0.5 : 0, (p.ms / total) * 100)}%`;
    cell.append(b);
    acc += p.ms;
    tr.append(cell, el('td', 'num', fmtMs(p.ms)));
    t.append(tr);
  }
  const tr = el('tr', 'tm-total');
  tr.append(el('th', null, 'Total'), el('td'), el('td', 'num', fmtMs(d.general.time)));
  t.append(tr);
  wrap.append(t);
  wrap.append(el('p', 'muted', 'HAR counts the TLS handshake inside Connecting. Here Connecting shows only the part before TLS.'));
  return wrap;
}

function renderDetail() {
  const d = S.detail;
  if (!d || d.i !== S.sel) return;
  const g = d.general;
  $.detail.textContent = '';
  const head = el('div', 'dhead');
  const nm = el('div', 'dname', g.url);
  nm.title = g.url;
  head.append(nm, btn('×', 'close', 'Close the details (Escape)', closeDetail));
  const acts = el('div', 'dacts');
  const copy = (format, label) => btn(label, 'secondary', null, () => vscode.postMessage({ type: 'copyAs', i: d.i, format }));
  acts.append(copy('curl', 'Copy as cURL'), copy('fetch', 'Copy as fetch'), copy('url', 'Copy URL'));
  if (d.responseBody.kind !== 'empty' && d.responseBody.kind !== 'image') acts.append(copy('response', 'Copy response'));
  const tabs = el('div', 'dtabs');
  tabs.setAttribute('role', 'tablist');
  const counts = { headers: d.reqHeaders.length + d.resHeaders.length, payload: d.query.length + (d.requestBody.kind === 'empty' ? 0 : 1), cookies: d.reqCookies.length + d.resCookies.length };
  for (const [id, label] of [['headers', 'Headers'], ['payload', 'Payload'], ['response', 'Response'], ['cookies', 'Cookies'], ['timing', 'Timing']]) {
    const b = btn(counts[id] != null ? `${label} (${counts[id]})` : label, `dtab${S.tab === id ? ' on' : ''}`, null, () => { S.tab = id; renderDetail(); });
    b.dataset.tab = id;
    b.setAttribute('role', 'tab');
    tabs.append(b);
  }
  const body = el('div', 'dbody');
  if (S.tab === 'headers') {
    const gen = [
      ['Request URL', g.url], ['Method', g.method], ['Status', g.status > 0 ? `${g.status} ${g.statusText}` : `No response${g.error ? ' (' + g.error + ')' : ''}`],
      ['Type', `${TYPE_LABELS[g.type]}${g.mime ? ' · ' + g.mime : ''}`], ['HTTP version', g.httpVersion], ['Remote address', g.serverIPAddress],
      ['Started', g.startedDateTime], ['Time', fmtMs(g.time)], ['Transferred', fmtSize(g.transfer)], ['Resource size', fmtSize(g.contentSize)],
      ['Redirect to', g.redirectURL], ['Error', g.status > 0 ? g.error : ''], ['Initiator', g.initiator], ['Priority', g.priority], ['From cache', g.fromCache], ['Comment', g.comment],
    ].filter(([, v]) => v !== '' && v != null).map(([name, value]) => ({ name, value }));
    body.append(section('General', kvTable(gen)));
    body.append(section('Response headers', kvTable(d.resHeaders, { secret: (n) => SECRET_HEADER.test(n) }), d.resHeaders.length));
    body.append(section('Request headers', kvTable(d.reqHeaders, { secret: (n) => SECRET_HEADER.test(n) }), d.reqHeaders.length));
  } else if (S.tab === 'payload') {
    body.append(section('Query string', kvTable(d.query, { empty: 'No query parameters.', secret: (n) => /token|key|secret|pass|session|sig|auth/i.test(n) }), d.query.length));
    body.append(section('Request body', bodyEl(d.requestBody, 'request')));
  } else if (S.tab === 'response') {
    body.append(bodyEl(d.responseBody, 'response'));
  } else if (S.tab === 'cookies') {
    const ck = (list, empty) => {
      if (!list.length) return el('p', 'muted', empty);
      const t = el('table', 'kv cookies');
      const hr = el('tr');
      for (const h of ['Name', 'Value', 'Domain', 'Path', 'Expires', 'HttpOnly', 'Secure', 'SameSite']) hr.append(el('th', null, h));
      t.append(hr);
      for (const c of list) {
        const tr = el('tr');
        for (const v of [c.name, c.value, c.domain, c.path, c.expires, c.httpOnly ? 'yes' : '', c.secure ? 'yes' : '', c.sameSite]) tr.append(el('td', null, v));
        t.append(tr);
      }
      return t;
    };
    body.append(section('Request cookies', ck(d.reqCookies, 'No request cookies.'), d.reqCookies.length));
    body.append(section('Response cookies', ck(d.resCookies, 'No response cookies.'), d.resCookies.length));
  } else {
    body.append(timingEl(d));
  }
  $.detail.append(head, acts, tabs, body);
}

// ---------- messages ----------

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  switch (m.type) {
    case 'init':
      S.name = m.name;
      if (!m.plan.open) { notice(m.plan.message, true); return; }
      buildLayout();
      $.count.textContent = `Reading ${m.sizeText}...`;
      break;
    case 'meta':
      S.meta = m;
      S.rows = [];
      renderStats(); renderBanner(); renderDomains();
      break;
    case 'rows':
      for (const r of m.rows) S.rows.push(r);
      S.done = !!m.done;
      applyFilter(true);
      break;
    case 'detail':
      S.detail = m.detail;
      renderDetail();
      break;
    case 'copied':
      toast({ curl: 'Copied as cURL.', fetch: 'Copied as fetch.', url: 'Copied the URL.', response: 'Copied the response body.', request: 'Copied the request body.' }[m.format] || 'Copied.');
      break;
    case 'saved':
      if (m.cancelled) break;
      toast(m.what === 'redact' ? `Saved ${m.name}.` : `Exported ${plural(m.count, 'request')} to ${m.name}.`);
      break;
    case 'error':
      if (m.soft && $.toast) toast(m.message); else notice(m.message, true);
      break;
    default:
  }
});

vscode.postMessage({ type: 'ready' });
