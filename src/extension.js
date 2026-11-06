'use strict';
const vscode = require('vscode');
const path = require('path');
const { buildHtml } = require('./html');
const H = require('./core/har');
const { validateWebviewMessage, sizePlan, fmtSize, chunks, suggestName } = require('./core/protocol');
const { createRatingPrompt } = require('./rate');
const { registerSupport, commandUris, showLinks } = require('./support');

const VIEW_TYPE = 'harViewer.editor';
const EXT_ID = 'zovo.zovo-har-viewer';
let rating = { success() {} };
const panels = new Set(); // { panel, uri, get har() }

function settings() {
  const c = vscode.workspace.getConfiguration('harViewer');
  return { maxFileMB: c.get('maxFileMB', 300), slowMs: c.get('slowRequestMs', 1000), maxBodyKB: c.get('maxBodyKB', 1024) };
}

function errText(e) { return e && e.message ? e.message : String(e); }
function baseName(uri) { return path.posix.basename(uri.path); }
function sibling(uri, name) { return uri.with({ path: path.posix.join(path.posix.dirname(uri.path), name) }); }

async function readHar(uri) {
  const stat = await vscode.workspace.fs.stat(uri);
  const plan = sizePlan(stat.size, settings().maxFileMB);
  if (!plan.open) throw new Error(plan.message);
  const bytes = await vscode.workspace.fs.readFile(uri);
  return H.parseHar(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'));
}

async function writeJson(target, obj) {
  await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(obj, null, 2) + '\n', 'utf8'));
}

function where(uri) { return uri.scheme === 'file' ? uri.fsPath : uri.toString(); }

/** Save dialog for a new HAR next to the source. Never returns the source itself. */
async function pickTarget(source, suffix, label) {
  const target = await vscode.window.showSaveDialog({ defaultUri: sibling(source, suggestName(baseName(source), suffix)), saveLabel: label, filters: { 'HAR files': ['har'] } });
  if (!target) return null;
  if (target.toString() === source.toString()) {
    vscode.window.showWarningMessage('Choose another file name. HAR Viewer never overwrites the file you opened.');
    return null;
  }
  return target;
}

/** Writes a redacted copy. har is the parsed source when it is already open. Returns the result or null. */
async function redactToCopy(source, har) {
  const data = har || await readHar(source);
  const { har: clean, report } = H.redactHar(data);
  const target = await pickTarget(source, '.redacted', 'Save Redacted Copy');
  if (!target) return null;
  await writeJson(target, clean);
  const msg = `Saved ${baseName(target)}. ${H.redactReportText(report)}`;
  vscode.window.showInformationMessage(msg, 'Open').then((pick) => {
    if (pick === 'Open') vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
  }, () => {});
  return { target, report, message: msg };
}

class HarEditorProvider {
  constructor(context) { this.context = context; }

  openCustomDocument(uri) { return { uri, dispose() {} }; }

  async resolveCustomEditor(document, panel) {
    const ctx = this.context;
    const uri = document.uri;
    const dist = vscode.Uri.joinPath(ctx.extensionUri, 'dist');
    const media = vscode.Uri.joinPath(ctx.extensionUri, 'media');
    // Command links are limited to the two support commands and the settings page (footer "Hide" link).
    panel.webview.options = { enableScripts: true, localResourceRoots: [dist, media], enableCommandUris: commandUris('harViewer') };
    const name = baseName(uri);
    const st = { har: null, rows: null, disposed: false, counted: false, loading: null };
    const entry = { panel, uri, get har() { return st.har; } };
    panels.add(entry);
    const post = (m) => (st.disposed ? Promise.resolve(false) : panel.webview.postMessage(m));

    const load = async () => {
      const stat = await vscode.workspace.fs.stat(uri);
      const s = settings();
      const plan = sizePlan(stat.size, s.maxFileMB);
      await post({ type: 'init', name, size: stat.size, sizeText: fmtSize(stat.size), plan });
      if (!plan.open) return;
      if (!st.har) {
        const t0 = Date.now();
        st.har = await readHar(uri);
        const sum = H.summarize(st.har, s.slowMs);
        st.rows = sum.rows;
        st.t0 = sum.t0;
        st.parseMs = Date.now() - t0;
      }
      const sens = H.scanSensitive(st.har);
      await post({
        type: 'meta',
        count: st.rows.length,
        creator: H.creatorText(st.har),
        version: String(st.har.log.version || ''),
        pages: H.pagesInfo(st.har),
        started: st.t0 ? new Date(st.t0).toISOString() : '',
        totals: H.totals(st.rows),
        domains: H.domains(st.rows),
        sensitive: sens,
        sensitiveText: H.sensitiveText(sens),
        slowMs: s.slowMs,
        parseMs: st.parseMs,
      });
      const parts = chunks(st.rows);
      for (let k = 0; k < parts.length; k++) {
        if (st.disposed) return;
        await post({ type: 'rows', rows: parts[k], done: k === parts.length - 1 });
      }
    };

    panel.webview.onDidReceiveMessage(async (raw) => {
      const v = validateWebviewMessage(raw, st.rows ? st.rows.length : 0);
      if (!v.ok) return;
      const msg = v.msg;
      try {
        if (msg.type === 'ready') {
          if (!st.loading) st.loading = load().finally(() => { st.loading = null; });
          await st.loading;
          return;
        }
        if (!st.har) return;
        if (msg.type === 'detail') {
          await post({ type: 'detail', detail: H.entryDetail(st.har, msg.i, settings().maxBodyKB * 1024) });
          return;
        }
        if (msg.type === 'rendered') { if (!st.counted) { st.counted = true; rating.success(); } return; }
        if (msg.type === 'copyAs') {
          const e = st.har.log.entries[msg.i];
          let text = '';
          if (msg.format === 'curl') text = H.toCurl(e);
          else if (msg.format === 'fetch') text = H.toFetch(e);
          else if (msg.format === 'url') text = String((e.request && e.request.url) || '');
          else if (msg.format === 'response') {
            const c = (e.response && e.response.content) || {};
            text = c.text == null ? '' : (String(c.encoding).toLowerCase() === 'base64' && /^(text\/|application\/(json|xml|javascript))/.test(String(c.mimeType)) ? Buffer.from(c.text, 'base64').toString('utf8') : String(c.text));
          } else if (msg.format === 'request') {
            const pd = e.request && e.request.postData;
            text = pd && pd.text != null ? String(pd.text) : '';
          }
          await vscode.env.clipboard.writeText(text);
          await post({ type: 'copied', format: msg.format, chars: text.length });
          return;
        }
        if (msg.type === 'export') {
          const target = await pickTarget(uri, '-filtered', 'Export Requests');
          if (!target) { await post({ type: 'saved', cancelled: true }); return; }
          const out = H.exportEntries(st.har, msg.indices);
          await writeJson(target, out);
          await post({ type: 'saved', what: 'export', name: baseName(target), path: where(target), count: out.log.entries.length });
          vscode.window.showInformationMessage(`Exported ${out.log.entries.length} request${out.log.entries.length === 1 ? '' : 's'} to ${baseName(target)}.`, 'Open').then((pick) => {
            if (pick === 'Open') vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
          }, () => {});
          return;
        }
        if (msg.type === 'redact') {
          const r = await redactToCopy(uri, st.har);
          if (!r) { await post({ type: 'saved', cancelled: true }); return; }
          await post({ type: 'saved', what: 'redact', name: baseName(r.target), path: where(r.target), message: r.message });
          return;
        }
        if (msg.type === 'openText') { await vscode.commands.executeCommand('vscode.openWith', uri, 'default'); }
      } catch (e) {
        await post({ type: 'error', message: errText(e), soft: msg.type !== 'ready' });
      }
    });
    panel.onDidDispose(() => { st.disposed = true; st.har = null; st.rows = null; panels.delete(entry); });
    panel.webview.html = buildHtml({
      cspSource: panel.webview.cspSource,
      scriptUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(dist, 'webview.js')).toString(),
      styleUri: panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'webview.css')).toString(),
      title: name,
      showSupportLinks: showLinks(vscode, 'harViewer'),
    });
  }
}

function activeHar() {
  for (const p of panels) if (p.panel.active) return p;
  return null;
}

async function redactCommand(arg) {
  try {
    let uri = arg && arg.scheme ? arg : null;
    let har = null;
    if (!uri) {
      const a = activeHar();
      if (a) { uri = a.uri; har = a.har; }
    }
    if (!uri) {
      const ed = vscode.window.activeTextEditor;
      if (ed && /\.har$/i.test(ed.document.uri.path)) uri = ed.document.uri;
    }
    if (!uri) {
      const picked = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Redact', filters: { 'HAR files': ['har'] } });
      if (!picked || !picked.length) return null;
      uri = picked[0];
    }
    return await redactToCopy(uri, har);
  } catch (e) {
    vscode.window.showErrorMessage(`HAR Viewer could not redact the file. ${errText(e)}`);
    return null;
  }
}

function activate(context) {
  rating = createRatingPrompt({ vscode, context, extensionId: EXT_ID, section: 'harViewer', message: (n) => `HAR Viewer has opened ${n} HAR files for you. A rating helps other people find it.` });
  registerSupport({ vscode, context, prefix: 'harViewer', selfId: EXT_ID });
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new HarEditorProvider(context), {
      supportsMultipleEditorsPerDocument: true,
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('harViewer.redact', redactCommand),
    vscode.commands.registerCommand('harViewer.openWalkthrough', () =>
      vscode.commands.executeCommand('workbench.action.openWalkthrough', `${EXT_ID}#harViewer.start`, false)),
    vscode.commands.registerCommand('harViewer.openWith', async (uri) => {
      const target = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
      if (target) await vscode.commands.executeCommand('vscode.openWith', target, VIEW_TYPE);
    }),
  );
}

function deactivate() {}

module.exports = { activate, deactivate, HarEditorProvider, VIEW_TYPE, redactCommand };
