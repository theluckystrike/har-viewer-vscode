## Find slow and failed requests

- The summary line counts failed and slow requests. Click either count to show only those requests.
- Type buttons (Doc, Fetch/XHR, JS, CSS, Img, Font, Media, WS, Other) narrow the table. Cmd or Ctrl click picks more than one.
- The status list has 2xx to 5xx, Failed, Slow and "Holds secrets". The domain list shows each host with its request count.
- The text box matches the URL, method, status and type. Put a minus before a word to hide matches, for example `api -stock`.
- Click a column header to sort by status, name, size or time.
- Export filtered writes the requests in the table to a new HAR file.

The slow limit is 1,000 ms by default. Change it with the `harViewer.slowRequestMs` setting.
