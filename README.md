# StoryCursor

StoryCursor is a Manifest V3 browser extension for saving manga progress to Google Sheets. It detects supported reading URLs, suggests workbook records, and shows save confirmation after the synchronization service responds.

**Release status.** The extension saved to a live synthetic Google Sheet from Chrome for Testing. FAB Android and production workbook validation remain pending. Use a separate test workbook for this release.

## Install

1. Download the extension ZIP from the build artifacts, or run the build below. Extract the ZIP.
2. In desktop Chrome, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Choose the extracted release folder containing `manifest.json`. For the local debug build, choose `dist/extension`.
3. Follow the [test workbook and Google authorization setup](docs/setup.md). In the extension popup, select **Connect Google Drive**. The settings page accepts the test deployment URL and token. A managed deployment then suggests a Drive folder.
4. Open a manga chapter. Check the detected title and chapter, then select **Save progress** for an existing series or **Add manga** for a new one. Open **Record actions** for manual entry, record selection and source tools. Once connected, use the settings icon to disconnect or manage Google access. A unique enrolled source is selected automatically. An uncertain match requires explicit record selection and confirmation.

## Popup guide

| Control | What you see or do |
| --- | --- |
| Manga title and Chapter or progress | The active page title and, where available, the chapter from its URL. Edit the chapter field to enter a value manually. |
| Find a title or source | Filter both workbook tabs. Exact aliases and similar-title candidates are shown first when detected. |
| Workbook record | Inspect the source, tab and current progress before confirming an uncertain match. Unenrolled rows are read-only. |
| Record actions | Create, append an alias, change sources, remember a page or series on this device, or send an uncertain observation to review. |
| Operation queue | See pending, submitted, confirmed, conflict and failed operations. Retry an unconfirmed submission using its original operation ID. Confirm a supported restore from a saved operation. |

MangaKatana and MangaReader extract chapters from supported URLs. MangaDex resolves chapter UUIDs through its public API. Unknown URLs and unavailable metadata can be handled manually. [Supported URL patterns and browser evidence](docs/compatibility.md).

## Develop

Use Node.js 24 and pnpm 11.25.0.

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm e2e
pnpm package
pnpm e2e:release
```

- `pnpm build` builds **StoryCursor (Debug)** in `dist/extension`. Reload this folder during local development. `pnpm dev` watches TypeScript files.
- `pnpm package` builds the release into `dist/release/extension` and puts the store ZIP in `dist/release`. Both modes also build their own Apps Script output beside the extension.
- When a new manga is added from a page in a debug build, StoryCursor saves a bounded diagnostic snapshot in that browser profile. After a successful save, export it from **Settings → Debug diagnostics**. Review the file before sharing it in an issue or pull request. See [what debug captures contain](docs/privacy.md#debug-captures).

The workspace separates the [domain and commands](packages/core), [site extraction](packages/site-adapters), [Sheets adapter and persistence engine](packages/sheets-adapter), [popup components](packages/ui), [browser integration](apps/extension), and [Apps Script service](apps/sheets-script).

[API contract](docs/api.md) · [Backup and migration](docs/setup.md) · [Compatibility](docs/compatibility.md) · [Privacy](docs/privacy.md) · [MIT license](LICENSE) · [Private Chrome Web Store test](docs/store/private-test.md)
