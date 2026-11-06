# HAR Viewer & HTTP Archive Viewer

Open a .har file from browser DevTools in VS Code and see every request in a table with a timing waterfall, then copy any call as cURL or save a redacted copy that is safe to share.

![HAR Viewer with the request table, the timing waterfall, the secrets warning and the Timing tab of a slow request](images/har-viewer.png)

The screenshot is a real VS Code 1.142 window running this extension on `shop-checkout.har`, a sample made by `scripts/make-samples.js` with fake hosts and fake tokens.

- See where the time went. Each row has a waterfall bar split into DNS, connect, TLS, waiting and download, and the summary counts failed and slow requests so you can jump straight to them.
- Read the whole exchange. Request and response headers, query string, payload, cookies and the response body, with JSON pretty-printed, form fields as a table and images shown inline.
- Share without leaking a session. A banner warns when the file holds Authorization headers, cookies or tokens, and one click writes a copy with those values replaced by `[REDACTED]`.

## Quick start

1. In Chrome, Edge or Firefox open DevTools, go to the Network tab and choose "Save all as HAR" (Safari calls it "Export HAR").
2. Click the .har file in the VS Code Explorer. It opens in HAR Viewer.

## What you can do

| Task | How |
|---|---|
| Find failed requests | Click "4 failed" in the summary, or pick Failed in the status list. Failed means 4xx, 5xx or no response at all. |
| Find slow requests | Click the slow count, or sort by Time. The limit is `harViewer.slowRequestMs` (1,000 ms by default). |
| Filter | Type buttons (Doc, Fetch/XHR, JS, CSS, Img, Font, Media, WS, Other), status, domain and a text box. `api -stock` keeps rows with "api" and hides rows with "stock". |
| Inspect one request | Click a row. Tabs show Headers, Payload, Response, Cookies and Timing. Arrow keys move through the rows and Escape closes the pane. |
| Reproduce a call | Copy as cURL or Copy as fetch, the same way DevTools does it. Copy URL and Copy response are next to them. |
| Keep only some requests | Filter the table, then "Export filtered..." writes those requests to a new HAR. |
| Share a capture | "Save redacted copy..." in the banner, or the command "HAR Viewer: Save a Redacted Copy", or right-click a .har in the Explorer. |

![Response tab with a pretty JSON body and secret header badges](images/details-json.png)

![Only the failed requests, with the 404, 500 and refused rows](images/failed-filter.png)

![The same capture in the Light Modern theme with a 500 response open](images/light-theme.png)

## What the redacted copy changes

- Authorization, Proxy-Authorization, API key, CSRF and similar headers become `[REDACTED]`. The `Bearer` or `Basic` word stays so you can still see the scheme.
- Cookie and Set-Cookie headers keep the cookie names and attributes, with each value replaced. The cookie lists in the HAR get the same treatment.
- Query, form and JSON fields with names such as `access_token`, `refresh_token`, `password`, `client_secret`, `api_key` or `session_id`, and any JWT, are replaced in URLs, request bodies and text response bodies.
- The original file is never changed, and a save over it is refused. A clean copy opens without the warning.

The rules are name-based. A secret stored under an unusual field name, or inside a binary body, is not found, so read the copy before you send it.

![The redacted copy, opened without a warning, with the Authorization header replaced](images/redacted-copy.png)

## Large files

A HAR is one JSON document, so it is read whole. In the release test a 47 MB capture with 30,000 requests showed its first rows in 0.8 seconds and all rows in under 1 second, a status filter over all 30,000 took about 0.2 seconds, and the rest of VS Code never waited more than 30 ms. Only the visible rows are drawn, so scrolling stays smooth. Files above `harViewer.maxFileMB` (300 MB by default) show a message instead of loading. Bodies longer than `harViewer.maxBodyKB` are cut in the details pane, and Copy still copies the full text.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `harViewer.maxFileMB` | 300 | Largest HAR that is opened |
| `harViewer.slowRequestMs` | 1000 | Time at which a request counts as slow |
| `harViewer.maxBodyKB` | 1024 | Longest body shown in the details pane |
| `harViewer.askForRating` | true | Ask one time for a rating after a few days of use |
| `harViewer.showSupportLinks` | true | Show the small Sponsor and More free viewers links in the status line |

## Privacy

HAR Viewer works offline. It makes no network calls and sends no telemetry. The webview runs under a strict Content Security Policy with no remote scripts, images in a HAR are shown from the file itself, and every value from the file is shown as text, never as HTML.

## Known limits

- The viewer is read-only. Edit the JSON with "Open as text" if you need to.
- WebSocket frames (`_webSocketMessages`) are not listed yet. The upgrade request shows as a WS row.
- Pages are not grouped. The summary uses the timings of the first page in the file.
- Redaction is pattern-based, as described above.

## Support

Zovo extensions have no ads and no tracking, and sponsors pay for the time that goes into fixes and new viewers. You can sponsor the work on [GitHub Sponsors](https://github.com/sponsors/theluckystrike).

## More viewers by Zovo

- [Large JSON Viewer & JSON Tree](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-json-tree-viewer) shows large JSON files as a searchable tree, copies JSONPath and turns arrays of objects into a table.
- [PDF Viewer & PDF Reader with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.pdf-viewer-dark) reads PDFs with a real dark mode, search, an outline and thumbnails.
- [CSV Viewer, Excel Viewer & Parquet Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.table-viewer-vscode) opens CSV, TSV, Excel and Parquet files as a sortable, filterable table.
- [DOCX Viewer & Word Viewer with Dark Mode](https://marketplace.visualstudio.com/items?itemName=zovo.docx-viewer-vscode) previews Word and ODT files with dark mode, an outline and search.
- [PPTX Viewer & PowerPoint Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.pptx-slide-viewer) shows PowerPoint slides, thumbnails and speaker notes.
- [JSONL Viewer & NDJSON Table Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.zovo-jsonl-viewer) opens JSONL and NDJSON files as a table, as records or as a chat view.
- [SQLite Viewer & DB Viewer (Read-Only)](https://marketplace.visualstudio.com/items?itemName=zovo.sqlite-table-viewer) browses SQLite tables read-only and runs SELECT queries.
- [HDF5 & NetCDF Explorer (H5 Viewer)](https://marketplace.visualstudio.com/items?itemName=zovo.hdf5-netcdf-explorer) browses groups, attributes and values in HDF5 and NetCDF files and plots slices.
- [GGUF, Safetensors & NPY Viewer (NumPy Viewer)](https://marketplace.visualstudio.com/items?itemName=zovo.tensor-viewer) shows NPY, NPZ, Safetensors and GGUF tensors with stats and heatmaps.
- [MP4 Video Player & Video Preview with Sound](https://marketplace.visualstudio.com/items?itemName=zovo.video-preview-with-sound) plays MP4, MOV, MKV and WebM files with their sound.
- [DXF Viewer & CAD Viewer for 2D Drawings](https://marketplace.visualstudio.com/items?itemName=zovo.dxf-viewer) opens ASCII and binary DXF drawings with layers, measuring and PNG or SVG export.
- [AGENTS.md & CLAUDE.md Linter (Context Drift)](https://marketplace.visualstudio.com/items?itemName=zovo.context-drift) finds stale commands, paths and versions in AGENTS.md and CLAUDE.md files.
- [Agent Skills & Claude Skills (Skill Shelf)](https://marketplace.visualstudio.com/items?itemName=zovo.skill-shelf) lists, checks and toggles the Agent Skills that Claude Code, Codex and Cursor load.
- [Claude Code History & Codex History Viewer](https://marketplace.visualstudio.com/items?itemName=zovo.agent-session-viewer) browses and searches your local Claude Code and Codex sessions.
- [Claude Code Usage & Codex Usage Cost Meter](https://marketplace.visualstudio.com/items?itemName=zovo.ai-usage-meter) shows Claude Code and Codex tokens and estimated cost from your local session files.

Coming soon to the Marketplace, with the code on GitHub now.

- [Audio Preview & Loudness Meter](https://github.com/theluckystrike/audio-preview-vscode) plays audio files with a waveform, a spectrogram and LUFS loudness.
- [Graphviz Preview & DOT Viewer](https://github.com/theluckystrike/graphviz-preview-vscode) shows a live preview of DOT files and exports SVG or PNG.
- [TIFF Viewer (16-bit, Float, GeoTIFF)](https://github.com/theluckystrike/tiff-viewer-vscode) opens 16-bit, float, multi-page and GeoTIFF images.
- [Avro Viewer, Arrow Viewer & Feather Viewer](https://github.com/theluckystrike/arrow-avro-viewer-vscode) opens Avro, Arrow and Feather files as a paged table.
- [EML Viewer & MBOX Email Viewer](https://github.com/theluckystrike/eml-viewer-vscode) reads EML, EMLX and MBOX email files with remote images blocked.
- [3D Model Viewer (GLB, glTF, STL, OBJ, PLY)](https://github.com/theluckystrike/model-viewer-vscode) views GLB, glTF, STL, OBJ, PLY and 3MF models.
- [PKL Viewer & Pickle Viewer](https://github.com/theluckystrike/pickle-viewer-vscode) opens Python pickle files without Python and never runs their code.
- [DICOM Viewer & NIfTI Viewer for CT and MRI](https://github.com/theluckystrike/dicom-nifti-viewer-vscode) opens CT and MRI scans, DICOM folders and NIfTI volumes with window presets and three views.
- [ZIP Viewer & Archive Explorer (JAR, TAR, GZ)](https://github.com/theluckystrike/archive-explorer-vscode) browses ZIP, JAR, VSIX, TAR and GZ files, opens entries in tabs and extracts them safely.
- [GCode Viewer & 3D Print Preview](https://github.com/theluckystrike/gcode-viewer-vscode) shows GCode toolpaths in 3D layer by layer, with print time and filament use.
- [EPUB Reader & EPUB Viewer](https://github.com/theluckystrike/epub-reader-vscode) reads EPUB books with a table of contents, search and light, sepia or dark themes.
- [File Viewers Pack](https://github.com/theluckystrike/zovo-file-viewers) installs the PDF, table, Word, PowerPoint, HDF5 and tensor viewers in one step.

## License

MIT
