# Privacy

StoryCursor reads the active tab's URL and page title when the popup opens. It does not install persistent page overlays or inject scripts on a schedule. A URL and title can be sensitive. Before adding a source or sending an observation to review, check the URL for embedded private data.

The extension stores the service URL, token, remembered record associations, and operation history in local extension storage. This storage is accessible to the browser profile. Treat the token like a password. Clear extension data or uninstall the extension to remove the local data, and revoke or rotate the server token when access is no longer needed.

The only network integration is the configured Apps Script deployment and its response redirect. The script reads the configured workbook and stores operation IDs and previous editable values in the audit tab. Review observations may include titles, URLs and progress and reside in the inbox tab. Worksheet data and backups are subject to the deployment owner's Google account permissions and retention. The application includes no analytics or advertising.

