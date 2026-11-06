# Changelog

## 0.1.0 (2026-11-07)

- First release. Opens .har files in a read-only viewer with a request table and a timing waterfall.
- Filters by type, status, domain and text. Slow and failed requests are one click away.
- Details pane with headers, query, payload, response body (pretty JSON, form data, images), cookies and timing phases.
- Copy as cURL, Copy as fetch, Copy URL and Copy response.
- Export filtered requests to a new HAR file.
- A warning banner when the file holds Authorization headers, cookies or tokens, and a command that saves a redacted copy.
- Works offline. No telemetry and no network calls.
