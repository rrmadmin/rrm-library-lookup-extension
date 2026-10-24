// Service worker: thin glue between the chrome.* APIs and the pure modules. Every decision
// (precedence, what to apply, what the badge says) lives in src/lib; this file only wires it.
import { detectIdentifier, normalizeDoi, normalizePmid } from './lib/detect.js';
import { lookup } from './lib/api.js';
import { createTabStore, badgeFor, shouldApply, mintRequestId, stateFromLookup } from './lib/state.js';

const BADGE_COLOR = '#987da8';
const MENU_ID = 'rrm-lookup';
const MENU_TITLE = 'Look up in RRM Library';
const STORAGE_KEY = 'tabs';
const LIBRARY_SEARCH = 'https://rrmacademy.org/library/';

// In-memory per-tab state, mirrored to chrome.storage.session so a restarted worker still
// answers GET_STATE. The mirror is read once, before the first message is served.
const store = createTabStore();
const ready = hydrate();

async function hydrate() {
  try {
    const saved = await chrome.storage.session.get(STORAGE_KEY);
    const entries = saved && saved[STORAGE_KEY];
    if (entries && typeof entries === 'object') for (const [tabId, entry] of Object.entries(entries)) store.set(tabId, entry);
  } catch {
    // No mirror yet, or storage unavailable: start empty.
  }
}

function persist() {
  return chrome.storage.session.set({ [STORAGE_KEY]: store.entries() }).catch(() => {});
}

// Runs inside the page via chrome.scripting.executeScript, so it must be self-contained. Reads
// only meta[name], link[rel=canonical] and location.href, and nothing else on the page.
function collectPageSignals() {
  const wanted = /^(citation_|dc\.|dcterms\.|prism\.)/i;
  const metas = [];
  for (const m of document.querySelectorAll('meta[name]')) {
    const name = m.getAttribute('name') || '';
    if (wanted.test(name)) metas.push({ name, content: m.getAttribute('content') || '' });
  }
  const link = document.querySelector('link[rel="canonical"]');
  return { url: location.href, canonical: link ? link.getAttribute('href') : null, metas };
}

function setBadge(tabId, state) {
  const text = badgeFor(state);
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE_COLOR }).catch(() => {});
}

async function setEntry(tabId, entry) {
  store.set(tabId, entry);
  setBadge(tabId, entry.state);
  await persist();
  return entry;
}

// The one path every lookup takes: mint a request id, store loading, call the route, apply the
// answer only if this is still the tab's latest request.
async function runLookup(tabId, identifier, params) {
  const requestId = mintRequestId();
  await setEntry(tabId, { identifier, state: { kind: 'loading' }, requestId });
  const result = await lookup(params);
  if (!shouldApply(store, tabId, requestId)) return store.get(tabId);
  return setEntry(tabId, { identifier, state: stateFromLookup(result), requestId });
}

// Signals from a page (content script or executeScript) become an identifier, then a lookup.
async function handleSignals(tabId, signals, { canCheck = false } = {}) {
  const identifier = signals && signals.identifier !== undefined ? signals.identifier : detectIdentifier(signals || {});
  if (!identifier) return setEntry(tabId, { identifier: null, state: { kind: 'noPaper', canCheck }, requestId: mintRequestId() });
  return runLookup(tabId, identifier, { [identifier.kind]: identifier.value });
}

// Selected text: an identifier if it holds one, else a title search.
async function handleSelection(tabId, text) {
  const raw = String(text || '').trim();
  const doi = normalizeDoi((raw.match(/10\.\d{4,9}\/[^\s"'<>]+/) || [raw])[0]);
  if (doi) return runLookup(tabId, { kind: 'doi', value: doi }, { doi });
  const pmid = normalizePmid(raw);
  if (pmid) return runLookup(tabId, { kind: 'pmid', value: pmid }, { pmid });
  const q = raw.slice(0, 300);
  if (!q) return store.get(tabId);
  return runLookup(tabId, { kind: 'q', value: q }, { q });
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ? tab.id : null;
}

async function checkTab(tabId) {
  let signals = null;
  try {
    const [hit] = await chrome.scripting.executeScript({ target: { tabId }, func: collectPageSignals });
    signals = hit && hit.result;
  } catch {
    // chrome://, the Web Store and other pages the extension may not read: nothing to check.
  }
  if (!signals) return setEntry(tabId, { identifier: null, state: { kind: 'noPaper', canCheck: false }, requestId: mintRequestId() });
  return handleSignals(tabId, signals, { canCheck: false });
}

function broadcast(message) {
  chrome.runtime.sendMessage(message).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  const senderTab = sender && sender.tab ? sender.tab.id : null;

  (async () => {
    await ready;
    switch (msg.type) {
      case 'DETECTED': {
        if (senderTab === null) return null;
        return handleSignals(senderTab, msg.identifier !== undefined ? { identifier: msg.identifier } : msg.signals || msg);
      }
      case 'GET_STATE': {
        const tabId = msg.tabId !== undefined ? msg.tabId : senderTab !== null ? senderTab : await activeTabId();
        if (tabId === null || tabId === undefined) return { tabId: null, entry: null };
        const entry = store.get(tabId);
        // No entry means nothing has run on this tab (an unsupported site), so the card offers a check.
        return { tabId, entry: entry || { identifier: null, state: { kind: 'noPaper', canCheck: true }, requestId: null } };
      }
      case 'CHECK_ACTIVE_TAB': {
        const tabId = msg.tabId !== undefined ? msg.tabId : await activeTabId();
        if (tabId === null || tabId === undefined) return { tabId: null, entry: null };
        return { tabId, entry: await checkTab(tabId) };
      }
      case 'LOOKUP_SELECTION': {
        const tabId = msg.tabId !== undefined ? msg.tabId : senderTab !== null ? senderTab : await activeTabId();
        if (tabId === null || tabId === undefined) return { tabId: null, entry: null };
        return { tabId, entry: await handleSelection(tabId, msg.text) };
      }
      default:
        return null;
    }
  })().then(
    (answer) => sendResponse(answer),
    () => sendResponse({ tabId: null, entry: { identifier: null, state: { kind: 'error' }, requestId: null } }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  store.clear(tabId);
  persist();
});

chrome.tabs.onActivated.addListener(({ tabId }) => broadcast({ type: 'TAB_CHANGED', tabId }));

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  // A navigation starts a new page; the old answer no longer describes this tab. The content
  // script (or the reader's check) fills it in again.
  if (changeInfo.status === 'loading' && store.get(tabId)) {
    store.clear(tabId);
    persist();
  }
  if (changeInfo.status === 'loading' || changeInfo.status === 'complete') broadcast({ type: 'TAB_CHANGED', tabId });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id === undefined) return;
  const text = info.selectionText || '';
  // sidePanel.open needs the user gesture, so it goes first and is not awaited behind the lookup.
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {
    const u = new URL(LIBRARY_SEARCH);
    u.searchParams.set('q', text.slice(0, 300));
    chrome.tabs.create({ url: u.toString() }).catch(() => {});
  });
  ready.then(() => handleSelection(tab.id, text)).then(() => broadcast({ type: 'TAB_CHANGED', tabId: tab.id }));
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: MENU_TITLE, contexts: ['selection'] });
  });
});
