# Copy4Chat Privacy Policy

_Last updated: 2026-10-13_

**Copy4Chat does not transmit or store any data.** It makes no network
requests of any kind, and nothing it reads from a page is retained after the
copy completes.

## What the extension does

When you select text and choose **Copy For Chat (Copy4Chat)** from the
right-click menu, the extension reads the selected part of the page you are
viewing, converts it to structured plain text, and writes that text to your
clipboard. That is the entire operation.

## Where your data goes

Nowhere. Specifically:

- **No servers.** The extension makes no network requests of any kind. It
  contains no remote endpoints, no analytics, no telemetry, and no error
  reporting.
- **No storage.** Nothing is written to `chrome.storage`, `localStorage`,
  cookies, or any other persistent store. Nothing survives the copy.
- **Nothing leaves the tab.** Extraction, formatting, and the clipboard write
  all happen inside the page you invoked it on. The extension's background
  service worker only routes the menu click; page content never reaches it.

The only output is the clipboard, and only when you explicitly ask for it.

Two consequences of that are worth stating plainly:

- The clipboard is a system resource outside this extension's control. Your
  operating system or browser may synchronise it between your devices.
- The extension exists so you can paste that text into an AI assistant. Where
  you paste it, and what that service does with it, is your choice and is
  governed by that service's own policies — not by this extension.

## What is deliberately excluded from the copy

Because selections can overlap sensitive fields, the following are replaced
with `••••••` rather than copied:

- password fields
- fields with sensitive `autocomplete` values (`cc-number`, `cc-csc`,
  `one-time-code`, and similar)
- fields whose name, id, placeholder, or label matches a credential-like
  pattern (password, secret, token, API key, SSN, CVV, PIN, account number)
- values shaped like access tokens, or digit strings that validate as payment
  card numbers
- credential-like parameters inside link URLs

The extension also never expands your selection. Only what you highlighted is
copied; surrounding page structure is read to label relationships and is marked
as context in the output.

A notification appears after each copy stating how many values were masked.

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | Adds the right-click menu item. It is the only way to invoke the extension. |
| `activeTab` | Grants access to the current tab **only** at the moment you click the menu item. |
| `scripting` | Injects the extraction code into that tab on demand. |
| `clipboardWrite` | Writes the result to your clipboard. |

The extension requests **no host permissions** and registers **no persistent
content script**, so no code runs on any page until you invoke it.

## Contact

Please open an issue on the project repository.
