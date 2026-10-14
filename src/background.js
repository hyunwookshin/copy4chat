// Service worker: routing only.
//
// It deliberately never sees page content. `info.selectionText` is plain text
// and would throw away the structure we exist to capture, so all extraction,
// rendering and clipboard writing happens in the tab. Keeping content out of
// the worker is also the strongest privacy boundary available to us.

const MENU_ID = "copy4chat";

// Injected in order into the same isolated world. Each file attaches to the
// C4C namespace rather than declaring top-level bindings, so repeated
// injection on every menu click is safe.
const FILES = [
  "src/content/mask.js",
  "src/content/extract.js",
  "src/content/render.js",
  "src/content/render-boxed.js",
  "src/content/clipboard.js",
  "src/content/main.js",
];

// Chrome refuses to script some pages no matter what an extension requests.
// Restricting the menu to schemes we can actually act on means the item is
// simply absent there, rather than present and silently doing nothing.
const URL_PATTERNS = ["http://*/*", "https://*/*", "file:///*"];

// The one exception the patterns cannot express: the Web Store gallery is
// https, but Chrome blocks extensions from scripting it ("The extensions
// gallery cannot be scripted").
const BLOCKED_HOSTS = [
  "chromewebstore.google.com",
  "chrome.google.com", // /webstore
];

function isBlocked(url) {
  try {
    return BLOCKED_HOSTS.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Copy For Chat (Copy4Chat)",
      contexts: ["selection"],
      documentUrlPatterns: URL_PATTERNS,
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  if (isBlocked(info.pageUrl || tab.url || "")) {
    console.warn(
      "[copy4chat] Chrome does not allow extensions to read this page " +
        "(the Web Store gallery). Nothing was copied."
    );
    return;
  }

  // Invoking an extension context-menu item grants activeTab for this tab,
  // which is what lets us inject without host permissions.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      files: FILES,
    });
  } catch (err) {
    const msg = String(err && err.message);
    if (/cannot be scripted|Cannot access|Extension manifest/i.test(msg)) {
      // Protected page: chrome://, another extension, a PDF, or a file:// URL
      // without "Allow access to file URLs" enabled.
      console.warn("[copy4chat] Chrome blocks reading this page:", msg);
    } else {
      console.error("[copy4chat] injection failed", err);
    }
  }
});
