# Compatibility

| Check | Desktop Chrome for Testing | FAB Android |
| --- | --- | --- |
| MV3 installation and service worker | Pass in automated unpacked profile | Untested |
| Toolbar action opens the popup | Pass using Chrome DevTools Protocol | Untested |
| Active-tab URL and isolated title read | Pass in the actual toolbar popup on a synthetic reader page | Untested |
| Local persistence | Confirmed saved queue state survived a popup reload | Untested |
| Authentication | Synthetic endpoint accepted a valid token and rejected an invalid one. Live deployment and Google consent unverified | Untested |
| Cross-origin requests | Extension page and worker sent POSTs to intercepted Apps Script origin. Google redirect and live service unverified | Untested |
| Save and retry | Extension page exercised manual selection and exact replay after a mock commit with a lost response | Untested |

The packaged manifest has a single build and uses activeTab, scripting, storage, an MV3 service worker and fixed host permissions for Apps Script. The FAB vendor advertises Chrome Web Store extensions. That does not verify these APIs or indicate how to install an unpacked development build. No Android device, FAB session, or store-published build was available for testing. [FAB listing](https://play.google.com/store/apps/details?id=com.hsv.freeadblockerbrowser) · [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) · [Chrome cross-origin requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).

For a live test, install on the target browser, open an enrolled synthetic chapter, verify title and decimal chapter, enter a wrong token and check rejection, then connect with the valid token. Verify the redirected response and one-click save on a verified series. Compare both workbook tabs and the log. Disconnect while submitting, reopen the popup, and retry the same pending operation. Record the browser version, installation method and result for each API.

## Site extraction

| Host | Recognized | Manual handling |
| --- | --- | --- |
| mangakatana.com | `/manga/slug.123` and `/manga/slug.123/c12.5` | Unrecognized chapter forms |
| mangareader.to | `/slug-123` and `/read/slug-123/en/chapter-12.5` | Other languages, volumes and unrecognized variants |
| mangadex.org | `/title/<uuid>` and optional title slug | Chapter UUIDs need a verified series relationship. The extension does not resolve these through an API. |
| Other | Active page URL and page title | Choose record and enter progress manually. Remember an exact page after explicit confirmation. |

Recognized URL forms with query strings fall back to manual handling. Known canonical URLs are compared across both tabs. Test fixtures exercise patterns using invented titles and identifiers.

