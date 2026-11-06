'use strict';
// Builds the webview HTML. Kept free of the vscode module so tests can check the CSP.
// Every value from the HAR file is set with textContent in the webview script, never as HTML.
const crypto = require('crypto');
const { footerHtml, FOOTER_CSS } = require('./support');

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildCsp(cspSource, nonce) {
  return [
    "default-src 'none'",
    `style-src ${cspSource} 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`,
    // data: is for image bodies stored in the HAR. No remote image is ever loaded.
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
  ].join('; ');
}

/**
 * @param {{cspSource:string, scriptUri:string, styleUri:string, title:string, nonce?:string, showSupportLinks?:boolean}} p
 * showSupportLinks false hides the small Sponsor and More free viewers line (setting harViewer.showSupportLinks).
 */
function buildHtml(p) {
  const n = p.nonce || crypto.randomBytes(24).toString('base64url');
  const csp = buildCsp(p.cspSource, n);
  const footer = footerHtml('harViewer', p.showSupportLinks !== false, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${escapeAttr(p.styleUri)}">
${footer ? `<style nonce="${n}">${FOOTER_CSS}</style>` : ''}
<title>${escapeAttr(p.title)}</title>
</head>
<body>
<div id="app"><p class="loading">Reading the HAR file...</p></div>
<div id="support-slot" hidden>${footer}</div>
<script nonce="${n}" src="${escapeAttr(p.scriptUri)}"></script>
</body>
</html>`;
}

module.exports = { buildHtml, buildCsp, escapeAttr };
