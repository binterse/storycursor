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
4. Enroll the intended synthetic rows using the reviewed procedure below. Deploy as a **Web app**, **Execute as me**, with access **Anyone** if your account policy permits it. The extension sends a randomly generated bearer secret in each POST. The service checks the secret before opening the workbook or taking the lock. Google OAuth grants the service spreadsheet access at setup. The extension uses application-level token authentication without a Chrome Identity API or end-user Google OAuth sign-in. Do not share the URL and secret together or use this design as a multi-tenant service. [Apps Script web apps](https://developers.google.com/apps-script/guides/web).
5. Confirm that the deployment is bound to the synthetic spreadsheet. Ensure only the one script deployment can write it, then set `EXCLUSIVE_WRITER=yes`. Connect from the extension and try the [compatibility checks](compatibility.md). Stop and turn writes off if any check fails.

If your organization blocks anonymous transport to web apps, this build cannot connect to that deployment. The service must never accept POSTs without its secret. Live Google OAuth consent, the redirect, and live writes remain unverified.

## Review and enroll existing rows

1. Keep service writes disabled. Pause all other writers, including users, automations and imports. Make a complete Google Sheets copy and verify that its worksheets, row counts, formulas, rich links and notes are present. Retain access to the original version history.
2. Review the target schema and verify that reading G and todos F are unused by existing rows. The tool refuses any chosen row with a populated or structurally occupied identity cell. If a reserved column is already used, stop and adapt the schema in a verified copy first. Additional tabs and existing media cells are outside the migration. A separate review must reconcile different legacy headers before staging can proceed.
3. Run `previewStoryCursorEnrollment` in the Apps Script editor. It logs sheet names, one-based rows and revision hashes. Review each row against the workbook and copy the desired `sheet`, `row`, and `expected` values into the `ENROLL_PLAN` script property, as a JSON array of up to 100 choices. Run `enrollStoryCursorRows`. Rows that changed between preview and enrollment and indistinguishable identities cause the batch to be rejected. An exact retry has no effect on already-enrolled rows.
4. Review the copy against its backup. Exercise full-width row moves, stale commands, duplicates, an interrupted submission, restore, and formatting preservation. Test disabled writes and invalid tokens. Keep detached or ambiguous rows read-only until reviewed. Move the whole row including its ID when sorting. Stop all sync before deliberate manual changes, then reconcile affected identities before resuming.
5. Do not point this deployment at the real workbook. Production use needs explicit authorization, a verified backup, live staging evidence, and review of an exclusive-writer and migration plan. Use a separate deployment and token for any approved environment.

To pause or roll back, disable service writes and revoke the deployment or rotate the token as needed. Preserve the audit and inbox tabs. Restore a reviewed copy or use Google Sheets version history if necessary, after comparing changes made since the backup. Use the extension's **Restore** action for eligible individual field changes. Creation and inbox records do not have an automatic restore.
