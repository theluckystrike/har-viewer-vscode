## Share a redacted copy

A HAR file holds everything the browser sent, including the Authorization header, cookies and tokens in URLs or request bodies. Anyone who gets the file can reuse a live session.

HAR Viewer shows a yellow banner when it finds them. "Save redacted copy..." writes a new file next to the original:

- Authorization, API key and CSRF headers become `[REDACTED]` (the `Bearer` word stays).
- Cookie and Set-Cookie keep the cookie names and attributes, with the values replaced.
- Query, form and JSON fields such as `access_token`, `password` or `client_secret`, and any JWT, are replaced in requests and responses.

The original file is never changed. Open the copy to check it: a clean copy opens without the banner.
