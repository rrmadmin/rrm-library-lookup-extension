// Per-tab lookup state as pure functions, so every decision the service worker makes is testable
// without Chrome. background.js is glue over these and the chrome.* APIs.

// Returns an in-memory store keyed by tabId. An entry is { identifier, state, requestId }.
export function createTabStore(initial) {
  const map = new Map();
  if (initial && typeof initial === 'object') {
    for (const [k, v] of Object.entries(initial)) if (v && typeof v === 'object') map.set(Number(k), v);
  }
  return {
    set(tabId, entry) {
      map.set(Number(tabId), entry);
      return entry;
    },
    get(tabId) {
      return map.get(Number(tabId)) || null;
    },
    clear(tabId) {
      map.delete(Number(tabId));
    },
    entries() {
      return Object.fromEntries(map);
    },
  };
}

// The badge is a yes: 'RRM' when the tab's paper is in the library, nothing otherwise.
export function badgeFor(state) {
  return state && state.kind === 'found' ? 'RRM' : '';
}

// True only when requestId is the latest minted for that tab, so a slow answer for a page the
// tab has since left is dropped.
export function shouldApply(store, tabId, requestId) {
  const entry = store.get(tabId);
  return !!entry && entry.requestId === requestId;
}

let counter = 0;
// Mints a request id that is unique within this service worker's life and still unique across
// restarts, since the counter alone would restart at zero.
export function mintRequestId() {
  counter += 1;
  return `${Date.now().toString(36)}-${counter}`;
}

// Maps a lookup result into a card state. identifier is kept so the panel can show what was asked.
export function stateFromLookup(result) {
  if (!result || !result.ok) return { kind: 'error' };
  const data = result.data;
  if (data.found) return { kind: 'found', record: data.record };
  return { kind: 'notFound', suggestUrl: data.suggestUrl, candidates: Array.isArray(data.candidates) ? data.candidates : [] };
}
