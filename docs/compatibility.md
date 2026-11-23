# Compatibility

| Check | Desktop Chrome for Testing | FAB Android |
| --- | --- | --- |
| MV3 installation and service worker | Pass in automated unpacked profile | Untested |
| Toolbar action opens the popup | Pass using Chrome DevTools Protocol | Untested |
| Active-tab URL and isolated title read | Pass in the actual toolbar popup on a synthetic reader page | Untested |
| Local persistence | Confirmed saved queue state survived a popup reload | Untested |
| Authentication | Google consent completed. Live staging accepted the valid token and rejected an invalid one | Untested |
| Cross-origin requests | Live toolbar popup and worker reached Apps Script and received confirmation through the Google response redirect | Untested |
| Save and retry | Live toolbar saved a decimal chapter with one click. Exact replay produced one audit row, a stale revision was rejected, and the mock test covered a lost response | Untested |

The packaged manifest has a single build and uses activeTab, scripting, storage, an MV3 service worker and fixed host permissions for Apps Script and the MangaDex API. The FAB vendor advertises Chrome Web Store extensions. That does not verify these APIs or indicate how to install an unpacked development build. No Android device, FAB session, or store-published build was available for testing. [FAB listing](https://play.google.com/store/apps/details?id=com.hsv.freeadblockerbrowser) · [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

For a live test, install on the target browser, open an enrolled synthetic chapter, verify title and decimal chapter, enter a wrong token and check rejection, then connect with the valid token. Verify the redirected response and one-click save on a verified series. Compare both workbook tabs and the log. Disconnect while submitting, reopen the popup, and retry the same pending operation. Record the browser version, installation method and result for each API.

## Site extraction

| Host | Recognized | Manual handling |
| --- | --- | --- |
| mangakatana.com | `/manga/slug.123` and `/manga/slug.123/c12.5` | Unrecognized chapter forms |
| mangareader.to | `/slug-123` and `/read/slug-123/en/chapter-12.5` | Other languages, volumes and unrecognized variants |
| www.mangaread.org | `/manga/slug/` and `/manga/slug/chapter-12/` | A dash-separated decimal like `chapter-12-5` needs the reader title to confirm `12.5` |
| manhuaplus.org | `/manga/slug` and `/manga/slug/chapter-12` | Alternate URL formats |
| manhuatop.org | `/manhua/slug/` and `/manhua/slug/chapter-12/` | Alternate URL formats |
| m.fanfox.net | `/manga/slug/`, chapter paths under `/manga/slug/c012/` and `/roll_manga/slug/c012/` with optional page number like `1.html` | Other hosts and paths with volume markers |
| www.mgeko.cc | `/manga/slug/` and `/reader/en/slug-chapter-12-eng-li/` | Other languages and reader variants |
| mangadex.org | `/title/<uuid>` and optional title slug | Chapter URLs with a UUID and optional page number use the official MangaDex API. If the API is unavailable, a recognized MangaDex reader title can supply the chapter number. An exact chapter link saved to an enrolled record also matches other pages of that chapter. Another chapter requires separate identity evidence or manual selection. |
| Other | Active page URL and page title | Choose record and enter progress manually. Remember an exact page after explicit confirmation. |

Recognized URL forms with query strings fall back to manual handling. Known canonical URLs are compared across both tabs. Test fixtures exercise patterns using invented titles and identifiers.
The live API returned expected chapter metadata to a direct HTTP client. In headless Chrome for Testing, the MangaDex API returned HTTP 403 with a bot challenge and the popup fell back to manual entry. Newer builds can also use a recognized MangaDex reader title for the chapter number in this case.

MangaDex chapter metadata is provided by [MangaDex](https://mangadex.org/). The resolver requests the chapter entity and requires exactly one matching manga relationship. [MangaDex API specification](https://api.mangadex.org/docs/static/api.yaml).

## Private test candidate

Chrome for Testing exercised the 0.2 options page, folder proposal, mock folder setup, legacy progress operations and profile-local disconnect. The managed Drive handler was tested against synthetic Drive and Sheets responses. Live managed-folder provisioning and FAB installation from the private store listing remain unverified.

Desktop popup layout regression tests cover MangaKatana, MangaReader, MangaDex title pages and an unknown site using synthetic pages at the respective URL patterns. They check title truncation, chapter display, popup width and action visibility. The desktop save test also covers connected manual entry. These tests do not certify live site access or the FAB popup viewport.

A live desktop staging test used synthetic MangaKatana and MangaReader chapter pages with the actual Google Sheets deployment. It saved on MangaKatana, linked MangaReader as a backup, reopened the same record by the new canonical source, and saved chapter 159. It also exposed differences in URL and auto-link handling on Apps Script, covered by regression tests.

## Automated system checks

Install the Playwright browser once with `pnpm exec playwright install chromium`. `pnpm system:test` builds both extension variants under `dist/system`, then opens the actual toolbar popup in a fresh Chrome for Testing profile in each browser test. No extension reload or toolbar click is needed in the developer's browser. GitHub Actions also runs the browser suite for both variants.

The MangaDex outage scenario injects a reader title and a 403 response, adds a manga through the popup, reopens another page of the same chapter and verifies there is still one record. It also opens a different chapter ID with the same title and checks that the saved record is not selected. The save goes through the extension worker and the real operation engine backed by a synthetic workbook. This run needs no Google connection.

System tests replay two successive chapters for MangaKatana, MangaRead, ManhuaPlus, ManhuaTop, FanFox and MGeko. Each adds the manga with the series title and source, then verifies that one click on the next chapter updates the same record. The MangaRead case covers a fractional chapter.

In the 0.3.5 desktop check, the installed toolbar completed add and update using the sites' real Next chapter links on MangaRead (including a MangaEffect redirect), ManhuaPlus, ManhuaTop and MGeko. Saves used a synthetic workbook. The FanFox reader timed out in the extension test profile; its URL patterns and save flow passed with synthetic pages.

The popup tests also cover an existing manga visited on a new, identifiable series URL. The suggested update requires confirmation, then the next chapter can be saved with one click in the same browser profile. Duplicate titles require choosing a record in the popup. With only a MangaDex chapter ID and no series metadata, the title stays a suggestion for other chapter IDs.

`pnpm system:live` checks the installed toolbar on public MangaKatana chapters 234 and 235 of *Return of the Frozen Player* and on MangaReader's *Vagabond* chapter 1. It also checks the public MangaDex API's chapter-to-series metadata. It reports a failed check for unavailable readers and writes successful popup screenshots under `test-results/live`. In the 0.3.3 check, both MangaKatana chapters and the MangaDex API passed. MangaReader's navigation timed out. The live checks make no Google Sheets requests and do not load the live MangaDex reader site.

For a configured staging service, `pnpm verify:staging` checks the workbook binding and whether the deployed service recognizes the current add-manga command without inserting a row. See [the staging probe](setup.md).
