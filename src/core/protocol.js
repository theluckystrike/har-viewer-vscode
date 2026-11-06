'use strict';
// Webview -> extension message checks and small formatters. No vscode import, so tests can run it directly.

const MB = 1024 * 1024;
const COPY_FORMATS = ['curl', 'fetch', 'url', 'response', 'request'];
const ROW_CHUNK = 5000;

function isIndex(v, max) { return Number.isInteger(v) && v >= 0 && (max == null || v < max); }

/**
 * Accepts only the known message types with well-formed fields. Returns { ok, msg } with a clean copy.
 * max: number of entries in the open HAR (indices must be below it).
 */
function validateWebviewMessage(raw, max) {
  if (!raw || typeof raw !== 'object' || typeof raw.type !== 'string') return { ok: false };
  const m = raw;
  switch (m.type) {
    case 'ready':
    case 'rendered':
    case 'redact':
    case 'openText':
      return { ok: true, msg: { type: m.type } };
    case 'detail':
      return isIndex(m.i, max) ? { ok: true, msg: { type: 'detail', i: m.i } } : { ok: false };
    case 'copyAs':
      if (!isIndex(m.i, max) || !COPY_FORMATS.includes(m.format)) return { ok: false };
      return { ok: true, msg: { type: 'copyAs', i: m.i, format: m.format } };
    case 'export': {
      if (!Array.isArray(m.indices) || m.indices.length === 0 || (max != null && m.indices.length > max)) return { ok: false };
      if (!m.indices.every((i) => isIndex(i, max))) return { ok: false };
      return { ok: true, msg: { type: 'export', indices: m.indices.slice(), label: typeof m.label === 'string' ? m.label.slice(0, 80) : '' } };
    }
    default:
      return { ok: false };
  }
}

function fmtSize(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < MB) return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
  if (b < 1024 * MB) return `${(b / MB).toFixed(1)} MB`;
  return `${(b / (1024 * MB)).toFixed(2)} GB`;
}

function fmtMs(ms) {
  const v = Number(ms) || 0;
  if (v < 1) return v > 0 ? '<1 ms' : '0 ms';
  if (v < 1000) return `${Math.round(v)} ms`;
  if (v < 60000) return `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} s`;
  const m = Math.floor(v / 60000);
  return `${m} min ${Math.round((v % 60000) / 1000)} s`;
}

/** Whether to open a file of this size. */
function sizePlan(size, maxMB) {
  const limit = Math.max(1, Number(maxMB) || 300) * MB;
  if (size > limit) {
    return { open: false, message: `This HAR is ${fmtSize(size)}. HAR Viewer opens files up to ${fmtSize(limit)} (setting harViewer.maxFileMB), because a HAR is one JSON document that has to be read whole.` };
  }
  return { open: true, large: size > 50 * MB };
}

/** Splits rows into chunks for postMessage so the first rows show quickly. */
function chunks(list, size) {
  const n = size || ROW_CHUNK;
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  if (!out.length) out.push([]);
  return out;
}

function suggestName(base, suffix) {
  const b = String(base || 'capture.har');
  const stem = b.replace(/\.har$/i, '').replace(/\.json$/i, '');
  return `${stem}${suffix}.har`;
}

module.exports = { MB, COPY_FORMATS, ROW_CHUNK, validateWebviewMessage, fmtSize, fmtMs, sizePlan, chunks, suggestName };
