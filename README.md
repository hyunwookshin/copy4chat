# Copy4Chat

Copies browser selections as structured text for LLMs, preserving visual and semantic relationships that plain-text copy drops.

**Status: v0.1 spike.** Built strictly to test whether structured copy outperforms `selection.toString()` on downstream agent tasks.

## Install

1. Open `chrome://extensions`, enable **Developer mode**, and click **Load unpacked** on this directory.
2. Select text on any page, right-click, and choose **Copy for chat**.

## Architecture

```
context-menu click  (service worker — routing only, never sees page content)
      └─ chrome.scripting.executeScript  (activeTab; no host permissions)
            ├─ extract.js    selection → IR
            ├─ render.js     IR → text
            └─ clipboard.js  write, two paths
```

Nothing runs on pages until invoked via `activeTab` (no `<all_urls>` content script). The service worker only routes the click and never touches page content.

## Design Rules

- **Selection-only content.** Never expand the selection outward. Surrounding DOM is read only to annotate hierarchy, explicitly marked so agents can distinguish context from selection:
  ```
  ‹context: Checkout › Payment Form›

  Error
    Payment failed
    Card number is invalid
  ```
- **Emit what is visible, never more.** Respect visual presentation (`text-transform`, `::before`, masked passwords) over raw DOM strings.
- **Semantics → hierarchy → geometry.** HTML/ARIA wins first, then DOM nesting and sibling shape. Geometry never promotes relationships—it only vetoes them or fixes CSS-reordered reading order (`order`, `row-reverse`, absolute positioning).
- **Degrade to nesting.** Ambiguous structure falls back to nested lists rather than hallucinated tables. Only real `<table>` elements render as Markdown tables.

## Privacy

- **Unconditional masking:** `input[type=password]`, sensitive `autocomplete` attributes (`cc-number`, `cc-csc`, `one-time-code`, etc.), secret-like field names/labels, token patterns, and Luhn-valid card numbers—applied to both content and context labels.
- **Clean clipboard:** No footers, URLs, or attribution are appended to copied text. When masking occurs, a page toast notifies the user directly.

## Benchmark

`test/fixtures/` and `test/questions.json` evaluate cases where plain-text copy loses or inverts meaning. Every fixture is scored against `selection.toString()`; any fixture that plain copy passes is removed.

| Fixture | Failure mode of plain-text copy |
|---|---|
| `feature-matrix.html` | ✓/✗ grid collapses into an unbound run of symbols |
| `split-labels.html` | Labels and values separate, destroying pairings |
| `kanban-reordered.html` | DOM order contradicts visual order |
| `pricing-cards.html` | Negative test: must remain nested, not coerced into a table |

## Out of Scope (v0.1)

- **Shadow DOM** — requires `Selection.getComposedRanges()`.
- **Cross-frame selections** — execution targets a single frame.
- **Canvas apps** (Docs, Figma) — no underlying DOM text.
- **Virtualized lists** — only currently mounted DOM nodes are captured.
- **Automated eval runner** — fixtures are currently scored manually.
