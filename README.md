# StoryCursor

StoryCursor is a Manifest V3 browser extension for saving manga progress to Google Sheets. It detects supported reading URLs, suggests workbook records, and shows save confirmation after the synchronization service responds.

**Release status.** The extension and service pass synthetic tests in Chrome for Testing. Live Google Sheets and FAB Android are pending. Use a separate test workbook for this release.

## Install

1. Download the extension ZIP from the build artifacts, or run the build below. Extract the ZIP.
2. In desktop Chrome, open `chrome://extensions`, enable **Developer mode**, and select **Load unpacked**. Choose the extracted folder containing `manifest.json`. For a local build, choose `dist/extension`.
3. Follow the [test workbook and Google authorization setup](docs/setup.md). In the extension popup, open **Connection**, enter the Apps Script deployment URL and service token, and select **Connect**.
4. Open a manga chapter. Check the detected title and chapter, then select **Save progress**. A unique enrolled source is selected automatically. An uncertain match requires explicit record selection and confirmation.

## Popup guide

| Control | What you see or do |
| --- | --- |
| Manga title and Chapter or progress | The active page title and, where available, the chapter from its URL. Edit the chapter field to enter a value manually. |
| Find a title or source | Filter both workbook tabs. Exact aliases and similar-title candidates are shown first when detected. |
| Workbook record | Inspect the source, tab and current progress before confirming an uncertain match. Unenrolled rows are read-only. |
| Record actions | Create, append an alias, change sources, remember a page or series on this device, or send an uncertain observation to review. |
| Operation queue | See pending, submitted, confirmed, conflict and failed operations. Retry an unconfirmed submission using its original operation ID. Confirm a supported restore from a saved operation. |

MangaKatana and MangaReader have chapter URL extractors. MangaDex title pages resolve to a series ID. MangaDex chapter-only IDs and arbitrary websites require manual progress and record selection. [Supported URL patterns and browser evidence](docs/compatibility.md).

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
```

`pnpm dev` rebuilds TypeScript bundles on changes. Reload the unpacked extension after a rebuild. Run a fresh build for manifest or popup HTML/CSS changes. The build emits `dist/extension` and `dist/sheets-script`. The package command emits the installable ZIP in `dist`.

The workspace separates the [domain and commands](packages/core), [site extraction](packages/site-adapters), [Sheets adapter and persistence engine](packages/sheets-adapter), [popup components](packages/ui), [browser integration](apps/extension), and [Apps Script service](apps/sheets-script).

[API contract](docs/api.md) · [Backup and migration](docs/setup.md) · [Compatibility](docs/compatibility.md) · [Privacy](docs/privacy.md) · [MIT license](LICENSE)

