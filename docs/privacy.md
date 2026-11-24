# Privacy

StoryCursor reads the active tab's URL and page title when the popup opens. It does not install persistent page overlays or inject scripts on a schedule. A URL and title can be sensitive. Before adding a source or sending an observation to review, check the URL for embedded private data.

The extension stores the service URL, token, remembered record associations, and operation history in local extension storage. This storage is accessible to the browser profile. Treat the token like a password. Clear extension data or uninstall the extension to remove the local data, and revoke or rotate the server token when access is no longer needed.

Network requests go to the configured Apps Script deployment and its response redirect. When you open the popup on a supported MangaDex chapter page, StoryCursor sends the chapter UUID to the public MangaDex API to look up series and progress. That request excludes browser credentials, your service token and workbook information. The script reads the configured workbook and stores operation IDs and previous editable values in the audit tab. Review observations may include titles, URLs and progress and reside in the inbox tab. Worksheet data and backups are subject to the deployment owner's Google account permissions and retention. The application includes no analytics or advertising.

The optional managed-folder setup uses the deployment's Google Drive file scope. It lists folders accessible to the app and creates its own workbook in the user-selected folder. Disconnecting in settings removes the connection from the current browser profile. To revoke the Google grant itself, use **Manage Google access** in settings.

A configured private deployment can use Google sign-in. The service requests OpenID Connect email identity, verifies it against the account configured by the deployer and issues a StoryCursor session lasting up to 30 days. The Google access token and OAuth client secret stay server-side. Disconnecting removes the local session, and rotating the deployment's service token invalidates all issued sessions.

## Debug captures

The local **StoryCursor (Debug)** build collects a small page snapshot when adding a manga from the active tab. It records the page title and selected title metadata, a few headings, the host and a redacted path shape, a canonical link summary, a few external script URLs reduced to host and path shape, and the number of structured data scripts. It removes query strings and fragments and redacts common credential patterns. It does not read cookies, browser storage, form values, full HTML, inline script contents, JavaScript responses, or network requests.

Captures live in a separate IndexedDB database in the extension's browser profile. They are kept out of Google Sheets, the sync request and GitHub. The database is bounded to 50 records and prunes records older than 30 days on capture or export. Only confirmed creations are exportable. Use **Settings → Debug diagnostics** to export or clear your data. Review any export before you attach it to an issue or pull request, since titles and headings can still contain personal text.

The release build omits the capture, storage, and export code entirely.
