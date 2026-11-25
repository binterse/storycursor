# StoryCursor private Chrome Web Store test

Use the same Manifest V3 package for desktop and FAB. The private listing is for named testers. Verify that FAB can sign into the Chrome Web Store as one of those testers before treating Android distribution as working.

## Upload material

- Release ZIP from `pnpm package` at `dist/release/storycursor-0.3.7.zip`. The local debug folder is `dist/extension`.
- Screenshot at [1280 × 800](screenshot-1280x800.png)
- Small promotional tile at [440 × 280](promo-440x280.png)
- The ZIP includes the 128 px icon.
- Website and repository [StoryCursor on GitHub](https://github.com/binterse/storycursor)
- Privacy policy [StoryCursor privacy documentation](https://github.com/binterse/storycursor/blob/main/docs/privacy.md)

Name **StoryCursor**

Category **Productivity**

Summary **Save manga reading progress to your connected Google Sheet.**

Description **Open StoryCursor on a supported manga chapter to review the detected progress. Choose a workbook record if needed and save. The extension supports manual progress entry, remembers mappings you confirm, and keeps a local queue for retrying unconfirmed saves. A StoryCursor sync deployment and Google workbook are required for the private test.**

Permission justifications:

- `activeTab` and `scripting` read the active page URL and title when the tester opens StoryCursor. The extension injects no persistent overlay.
- `storage` preserves local connection settings, confirmed mappings and pending operations.
- Apps Script domains are used for authenticated sync and Google's response redirect.
- The MangaDex API domain resolves a chapter UUID to its series and chapter number.

## Dashboard and test

1. Open the [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole). Use an enrolled publisher account. Complete developer registration, contact verification, and any terms or payment Google requests directly.
2. Upload the ZIP as a new item. Enter the listing text and privacy information above and upload the screenshots and tile. Supply reviewer access through private review instructions if Google requests it. Use separate staging credentials and synthetic data for any reviewer access.
3. Add the Google account used in FAB to the publisher's trusted testers. Under **Distribution → Visibility** choose **Private** and **Only trusted testers**, then submit for review. [Google distribution settings](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution)
4. After approval, open the item URL in FAB with that tester account. Verify install, toolbar popup, the settings page, storage persistence and one confirmed staging save. Record any difference from desktop, then disable staging writes again.
