# Synchronization API

Send JSON as the body of an HTTPS POST to the Apps Script deployment's `/exec` URL. Send the service token in `token` for every request. Apps Script ContentService uses a redirect for its response, and application statuses are in the JSON body. [ContentService redirects](https://developers.google.com/apps-script/guides/content).

| Action | Request fields in addition to token and action | Success response |
| --- | --- | --- |
| check | None | `{ status: "ready", binding }` |
| list | binding | `{ status: "ready", entries }` |
| submit | binding, command | `{ status: "saved", operationId, target }` |

The returned binding identifies the configured workbook and schema. The client scopes mappings and queued commands to the original endpoint and binding. An entry includes ID, revision, sheet, media kind, title, progress when available, and two source slots. An empty ID denotes a read-only entry. Server failure responses have `status` of `conflict`, `failed` or `retry` and a message. A client treats a missing or mismatched confirmation as uncertain.

A command includes a UUID `operationId`, UUID `target`, `expected` (64-hex revision or `absent`), `type`, `value` (finite number or string, maximum 2,000 characters), and optional boolean `confirmed`. An operation ID deduplicates an exact command. Reuse with a different payload conflicts.

| Command | Value and effect |
| --- | --- |
| SetProgress | Text or number. Updates only reading B. Requires confirmation for downgrades, incomparable changes and changes in representation at equal ordinal progress. |
| CreateEntry | Title. Appends to reading with a new target UUID and `expected: "absent"`. Set a source and progress separately. |
| AppendAlias | One alias. Appends with the exact legacy delimiter. |
| AddSource | HTTP(S) URL. Fills the backup slot when free. |
| SetPrimarySource | HTTP(S) URL. Moves the previous primary URL to backup where possible. Occupied slots can force a conflict. |
| RemoveSource | `primary` or `secondary`. Requires confirmation. |
| LinkExistingEntry | HTTP(S) URL. Persists the additional link in the backup slot. A source already claimed by another workbook record causes a conflict. |
| QueueForReview | Observation text. Writes to the inbox and audit only. Use the operation UUID as target, with `expected: "absent"`. |
| RestoreChange | Prior operation UUID. Requires confirmation and a current revision matching the prior operation's post-change revision. Restores eligible updated values to their exact former type. |

## Identity and transaction limits

IDs occupy reading G and todos F only on enrolled or created rows. The UUID is paired with a digest of the sheet, title and source cells. For plain URL cells, formatting that repeats the exact same link is ignored when hashing. Display text that differs from its destination remains part of the identity check. The service searches for the UUID on each write and rejects missing, duplicated or detached values and indistinguishable anchors. A complete row move within the tab preserves identity. A partial sort can detach it. Google offers row developer metadata as a location mechanism, but the service uses an explicit, exportable ID column and checks content attachment independently. Neither method proves identity if previously distinct records have been made indistinguishable by manual edits. [Sheets developer metadata](https://developers.google.com/workspace/sheets/api/guides/metadata).

LockService serializes requests in one Apps Script project. The service re-reads rows and compares revisions before preparing localized updates. Only literal value fields are updated. Formulas, rich text and linked target cells that cannot be edited safely cause a conflict. The same Sheets batch includes the audit and any inbox append. If the response is lost, retry the identical command; the committed log entry is the recovery record. Preserve the audit log and disable writes before recovering a lost or altered log. [LockService](https://developers.google.com/apps-script/reference/lock/lock-service) · [Sheets batchUpdate reference](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate).

Shares, independent scripts, human edits and imports can bypass the lock. Sheets does not offer a compare-and-swap condition in this batch API. A move or edit between read and batch can invalidate the checked row location. Run a single writer with other changes paused. A process crash or connection drop can leave the browser unsure whether the server committed, and concurrent manual edits are outside the supported safety model.

## Managed Drive setup

Two token-authenticated actions are available before a workbook is bound:

- `folders` returns `{ status: "ready", folders }`. The field is null on a deployment with a bound workbook or with managed setup disabled.
- `useFolder` takes `folder` and `name`. Use a returned folder ID or `new` with a name. Setup requires `MANAGED_DRIVE=yes`, no `SPREADSHEET_ID`, and disabled writes. The server binds the workbook after initializing and verifying its schema.

If the setup response is lost, return to settings and reconnect to the same deployment. A bound workbook is reused. An unfinished setup can be retried by choosing the existing folder. The service refuses ambiguous matching workbooks.
