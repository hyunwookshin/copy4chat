# Chrome Web Store submission — Copy4Chat v0.1.0

Copy-paste answers for the developer dashboard, written against the code as it
actually is. Keep in sync with `manifest.json`.

## 1. Permissions requested, and why each is necessary

`manifest.json` requests four permissions and **no host permissions**.

| Permission | Justification (paste into the dashboard) |
|---|---|
| `contextMenus` | Adds the "Copy For Chat" item to the right-click menu on selected text. This is the extension's only entry point; it has no toolbar button, popup, or other UI. |
| `activeTab` | Grants access to the current tab only at the moment the user clicks the menu item. The extension must read the selected element's live layout, form values, and control state, which exist only in the page. |
| `scripting` | Injects the extraction and formatting code into that tab on demand, in response to the user's click. The extension registers no persistent content script, so no code runs on any page until invoked. |
| `clipboardWrite` | Writes the formatted result to the clipboard — the extension's entire output. Required because the user gesture is delivered to the browser's context menu rather than to the page, so the clipboard write is not covered by in-page user activation. |

### Minimally scoped — verified

- **No `host_permissions`, no `<all_urls>`, no `content_scripts` block.**
  Nothing executes on any page until the user right-clicks a selection and
  picks the menu item. Access expires with the tab's navigation.
- `storage` is **not** requested — the extension persists nothing.
- `tabs` is **not** requested — `activeTab` covers the single tab in play.
- `offscreen` is **not** requested — the clipboard write happens in the page,
  not in the service worker.

## 2. Single purpose

> Copy4Chat converts user-selected webpage content into structured, readable
> text for AI conversations. It preserves document hierarchy, form values,
> control states, and visual grouping. Processing happens locally in the
> browser and is initiated explicitly through the context menu.

One purpose, one entry point, one output.

## 3. Data-flow audit

Grepped across `src/` and `manifest.json`:

| Checked for | Result |
|---|---|
| `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` | none |
| `chrome.storage`, `localStorage`, `sessionStorage`, `indexedDB`, `chrome.cookies` | none |
| analytics, telemetry, crash/error reporting | none |
| `eval`, `new Function`, `importScripts`, remotely hosted scripts | none |
| externally referenced URLs in code | none |

Page content, form values, and URLs are read inside the tab, formatted there,
and written to the clipboard there. The background service worker only routes
the menu click; **page content never reaches it**, let alone the network.

One deliberate exception worth knowing about: `src/content/main.js` logs the
intermediate representation via `console.debug`, which stays in the user's own
DevTools console at Verbose level. It is a local debugging aid, not a
transmission, and the values in it are already masked.

## 4. Privacy practices — Data usage

**Do not tick anything reflexively; read the dashboard's current wording at
submit time, since these definitions change.** What follows is the honest
reading of this code against the definitions as written.

The operative question is whether data is **transmitted off the user's
device**. For this extension it is not, so the accurate answer is that no data
is collected. Supporting detail if the review asks:

- Personally identifiable information, health, financial, authentication,
  personal communications, location, web history, user activity — **not
  collected**.
- **Website content** — read transiently, in-page, only on explicit
  invocation; never transmitted, never stored, discarded when the copy
  completes.

Two nuances to state plainly rather than paper over, because the listing
invites both:

1. The output lands on the **system clipboard**, which is outside the
   extension's control and may be synchronised by the OS or browser.
2. The user then pastes it somewhere — often an AI service. That is the user's
   action and their choice of destination, but it is the extension's stated
   purpose, so the privacy policy says so explicitly.

Certifications:
- [x] Data is not sold to third parties
- [x] Data is not used for purposes unrelated to the single purpose
- [x] Data is not used to determine creditworthiness or for lending

### Sensitive-data handling, worth volunteering

Because a selection can overlap credential fields, the extension masks them
rather than copying them: password inputs, sensitive `autocomplete` values
(`cc-number`, `cc-csc`, `one-time-code`), credential-like field names, values
shaped like tokens, Luhn-valid card numbers, and credential-like URL
parameters. A toast reports how many values were masked. See `PRIVACY.md`.

## 5. Remote code

Answer **"No, I am not using remote code."** All logic ships inside the
package; the default MV3 content security policy is unmodified.

## 6. Policy conflicts

Checked against the Developer Program Policies; nothing found:

- **Single purpose** — satisfied, narrowly.
- **Minimum permissions** — satisfied; `activeTab` instead of host
  permissions is the preferred pattern.
- **Remote code** — none.
- **User data privacy** — a privacy policy is required for any extension that
  handles user data, including locally. `PRIVACY.md` exists for this.
- **Deceptive behaviour** — none; the only action is user-initiated and its
  result is visible in the clipboard.

## 7. Privacy policy URL

`PRIVACY.md` in the repository. Host it at a stable public URL — GitHub Pages,
or the raw file link — and paste that URL into the dashboard. It must stay
accurate as the code changes.

## 8. Listing assets still needed

- [x] Screenshot, 1280×800 — `store/screenshot-1280x800.png`
      (also `store/screenshot-640x400.png` if the smaller size is preferred)
- [ ] Small promo tile, 440×280
- [x] Store icon, 128×128 — `icons/icon128.png`
- [ ] Category: Productivity
- [ ] Support / homepage URL

## 9. Pre-submit checklist

- [x] `manifest.json` at the ZIP root
- [x] Manifest V3, default CSP, no overrides
- [x] Every manifest-referenced file present in the archive
- [x] Every injected content script present and listed in `background.js`
- [x] Icons at 16/32/48/128, dimensions verified
- [x] No tests, tooling, screenshots, docs, or VCS metadata in the package
- [x] No secrets, API keys, or credentials
- [x] Version is a valid dotted-integer string

Build and verify with `./tools/package.sh`.

## 10. How the screenshot was produced

`img/screenshot.png` is 1787×827 (2.16:1); the store wants 1.6:1. Scaling and
padding left the content small inside white bars, and a centred crop sliced
the form's left-hand labels mid-word. So the crop is offset instead — source
window x 190–1513, which is exactly 1.6:1 at full height, keeping the labels
intact and letting the bleed fall on the panel's right edge. Rendered with
headless Chrome, since `sips` only crops from the centre.
