# Test workbook, authorization and migration

## Create a synthetic workbook

Create a separate spreadsheet while signed in to a Google account you control. Use a dedicated deployment account whose editable spreadsheet access is limited to the test workbook. Set up these tabs, including headers in row 1 and at least seven columns in reading and six in todos.

| Tab | A | B | C | D | E | F | G |
| --- | --- | --- | --- | --- | --- | --- | --- |
| reading | Title | Progress | Extra information | Rating | Primary link | Secondary link | Reserved ID |
| todos | Title | Extra information | Rating | Primary link | Secondary link | Reserved ID | |

Use these exact headers. The service checks their order before opening the workbook. Use synthetic rows. For example, on reading row 2, use `Orbit Library-;;;-Library of Moons-;;;-Orbital Archive` in A2, numeric `156.5` in B2, and `https://mangakatana.com/manga/orbit-library.1042` in E2. Add a note to B2 to verify preservation. Add another row with literal text `33.6/33.6` and a link with custom display text. Test with a separate browser profile.

## Deploy and authorize Google access

1. Run `pnpm build`. Create a standalone Apps Script project. Paste `dist/sheets-script/Code.gs` into the script. In Project Settings, show the manifest and replace its contents with the built `appsscript.json`. Enable the advanced Google Sheets service. If using a standard Cloud project, also enable Google Sheets API in that project and configure Google Auth Platform for the deploying account, including its test user when applicable. [Advanced Sheets service](https://developers.google.com/apps-script/advanced/sheets).
2. Set the script properties from `apps/sheets-script/config.example.json`. Use the synthetic workbook ID and leave `EXCLUSIVE_WRITER=no`. Generate a 256-bit random token locally with `node -p "require('node:crypto').randomBytes(32).toString('hex')"`. Store it in the script properties and enter it only in the installed extension.
3. Run `initializeStoryCursor` in the script editor. Google will present its authorization flow to the deployment account for the Sheets scope declared in the manifest. Accept only in the intended test account. Repeat initialization to verify that it reports the existing schema. It creates the three reserved tabs in one batch or refuses to take over an incomplete reserved namespace.
4. Enroll the intended synthetic rows using the reviewed procedure below. Deploy as a **Web app**, **Execute as me**, with access **Anyone** if your account policy permits it. The service checks the StoryCursor credential before opening the workbook or taking the write lock. Google OAuth grants the service spreadsheet access at setup. The default test package uses the generated bearer secret. The optional private sign-in setup below issues a time-limited StoryCursor credential to the authorized account. Use one deployment per workbook. [Apps Script web apps](https://developers.google.com/apps-script/guides/web).
5. Confirm that the deployment is bound to the synthetic spreadsheet. Ensure only the one script deployment can write it, then set `EXCLUSIVE_WRITER=yes`. Connect from the extension and try the [compatibility checks](compatibility.md). Stop and turn writes off if any check fails.

If your organization blocks anonymous transport to web apps, this build cannot connect to that deployment. The service must never accept POSTs without its secret. Google OAuth consent, the response redirect, and a one-click save were verified in a separate synthetic staging workbook.

## Review and enroll existing rows

1. Keep service writes disabled. Pause all other writers, including users, automations and imports. Make a complete Google Sheets copy and verify that its worksheets, row counts, formulas, rich links and notes are present. Retain access to the original version history.
2. Review the target schema and verify that reading G and todos F are unused by existing rows. The tool refuses any chosen row with a populated or structurally occupied identity cell. If a reserved column is already used, stop and adapt the schema in a verified copy first. Additional tabs and existing media cells are outside the migration. A separate review must reconcile different legacy headers before staging can proceed.
3. Run `previewStoryCursorEnrollment` in the Apps Script editor. It logs sheet names, one-based rows and revision hashes. Review each row against the workbook and copy the desired `sheet`, `row`, and `expected` values into the `ENROLL_PLAN` script property, as a JSON array of up to 100 choices. Run `enrollStoryCursorRows`. Rows that changed between preview and enrollment and indistinguishable identities cause the batch to be rejected. An exact retry has no effect on already-enrolled rows.
4. Review the copy against its backup. Exercise full-width row moves, stale commands, duplicates, an interrupted submission, restore, and formatting preservation. Test disabled writes and invalid tokens. Keep detached or ambiguous rows read-only until reviewed. Move the whole row including its ID when sorting. Stop all sync before deliberate manual changes, then reconcile affected identities before resuming.
5. Do not point this deployment at the real workbook. Production use needs explicit authorization, a verified backup, live staging evidence, and review of an exclusive-writer and migration plan. Use a separate deployment and token for any approved environment.

To pause or roll back, disable service writes and revoke the deployment or rotate the token as needed. Preserve the audit and inbox tabs. Restore a reviewed copy or use Google Sheets version history if necessary, after comparing changes made since the backup. Use the extension's **Restore** action for eligible individual field changes. Creation and inbox records do not have an automatic restore.

## Optional managed Drive folder

For a fresh test deployment, set `MANAGED_DRIVE=yes` and `EXCLUSIVE_WRITER=no`, leaving `SPREADSHEET_ID` unset. Enable the advanced Drive service and authorize the `drive.file` scope in that deployment. Standard Google Cloud projects also need the Drive API enabled. Use a separate project from any deployment that already points to a workbook.

In StoryCursor select **Connect Google Drive**, then sign in using a configured Google build or enter the test deployment URL and token. StoryCursor suggests an app-accessible folder named **StoryCursor** or offers to create one in My Drive. You can select another visible folder or change the new name. Drive returns folders the deployment has access to under its file scope. An existing folder that has never been granted to the app may be absent.

On confirmation, the service creates or reopens its tagged StoryCursor workbook in the selected folder and initializes its tabs. It leaves pre-existing workbooks in place. A deployment that already has a `SPREADSHEET_ID` continues to use it. Enable exclusive staging writes separately once you have reviewed the resulting folder and workbook.

## Optional Google sign-in for a private deployment

One deployer configures this flow for one authorized Google account and one workbook. A tester then opens **Settings → Sign in with Google**, selects the account, and chooses **Use StoryCursor folder** or **Choose another folder**. A previously bound deployment skips the folder step.

1. In Google Auth Platform configure a web application OAuth client. Add the exact Apps Script deployment `/exec` URL as an authorized redirect URI. If the OAuth app is in testing, add the approved account as a test user. [Google OAuth web-server setup](https://developers.google.com/identity/protocols/oauth2/web-server)
2. Set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` and `GOOGLE_OAUTH_ALLOWED_EMAIL` in Apps Script properties. Use a Gmail or Google Workspace account, or pin the expected Google `sub` with `GOOGLE_OAUTH_ALLOWED_SUB` for another type of Google account. Keep the strong existing `CLIENT_TOKEN` in script properties. The deployment's authorized Drive access and workbook binding still govern where it can write.
3. Set `STORYCURSOR_GOOGLE_ENDPOINT` to that same `/exec` URL in your build environment and run `pnpm package`. It is a deployment URL, and may appear in the extension package. Copy the Apps Script output from that build, including its manifest, to the deployment and deploy **New version**. The generated manifest adds Apps Script external request authorization for the server-side Google token exchange. Never put the OAuth client secret or `CLIENT_TOKEN` in the build environment or package.
4. In the Apps Script editor select `checkStoryCursorSignIn` and click **Run** as the deployment owner. Approve the additional external-request permission. The execution log should report **Google token endpoint reached.** This check uses an invalid authorization code and leaves the workbook untouched.
5. Test the Google flow with a synthetic workbook and the authorized account. Also verify that a different account is rejected. On Android, repeat the sign-in and one confirmed save once installed through the private listing.

The flow uses a normal browser tab. It does not depend on the extension `chrome.identity` API. The browser-side and server-side behavior is covered with simulated OAuth responses. Live provider and FAB verification require the configured deployment. The account gets a single-deployment StoryCursor session lasting up to 30 days. End users choose from folders the deployment can already access, with no general-purpose My Drive picker in this build.

## Verify an updated staging deployment

When editing an existing web app, select **New version** and verify both the active version number and the unchanged endpoint URL after deploying. A saved description can update independently of the active code.

With staging writes enabled, set `STORYCURSOR_STAGING_ENDPOINT`, `STORYCURSOR_STAGING_TOKEN` and `STORYCURSOR_STAGING_SPREADSHEET_ID` in your shell from the reviewed test deployment. Run `pnpm verify:staging`. It checks the workbook binding, then sends a valid-shaped creation command with a disallowed revision. An expected conflict proves the live server recognized the new creation command without writing a row. Keep the token in your local environment.
