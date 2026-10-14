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
  "src/content/clipboard.js",
  "src/content/main.js",
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Copy for chat",
      contexts: ["selection"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  // Invoking an extension context-menu item grants activeTab for this tab,
  // which is what lets us inject without host permissions.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId ?? 0] },
      files: FILES,
    });
  } catch (err) {
    console.error("[copy4chat] injection failed", err);
  }
});
