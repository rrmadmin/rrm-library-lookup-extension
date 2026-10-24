// What the popup and the side panel share: ask the service worker for the active tab's state,
// render the card, own the clipboard and the "Check this page" message, and follow the tab.
// Chrome APIs come in as arguments so the whole thing runs under jsdom with a fake chrome.

import { renderCard } from './card.js';

const PLAIN_HOST = /^https:\/\/([a-z0-9.-]+)\/\*$/;

// True when url is on a host the content script runs on (manifest content_scripts[0].matches).
// Those hosts already report their paper, so the card offers "Check this page" only elsewhere.
export function hostSupported(url, matches) {
  if (typeof url !== 'string' || !url) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  for (const pattern of Array.isArray(matches) ? matches : []) {
    const m = typeof pattern === 'string' && pattern.match(PLAIN_HOST);
    if (m && m[1] === u.host) return true;
  }
  return false;
}

export function contentHosts(manifest) {
  const cs = manifest && Array.isArray(manifest.content_scripts) ? manifest.content_scripts[0] : null;
  return cs && Array.isArray(cs.matches) ? cs.matches : [];
}

// Turns a GET_STATE answer into a card state. The worker answers a tab it has never seen with a
// placeholder entry (requestId null); that is "no paper" with a Check button on hosts the content
// script does not cover, and "still loading" while a covered host is mid-navigation, because the
// content script reports once the page is idle.
export function resolveState(answer, tab, matches) {
  const url = tab && typeof tab.url === 'string' ? tab.url : '';
  const supported = hostSupported(url, matches);
  if (!answer || !answer.entry || !answer.entry.state) return { kind: 'noPaper', canCheck: !!tab && !supported };
  const entry = answer.entry;
  if (entry.requestId === null || entry.requestId === undefined) {
    if (supported && tab && tab.status === 'loading') return { kind: 'loading' };
    return { kind: 'noPaper', canCheck: !!tab && !supported };
  }
  return entry.state;
}

// Mounts the view on root. mode is 'popup' or 'panel'. Returns { refresh, dispose } for tests.
export function mountView(root, { mode = 'popup', chrome = globalThis.chrome, clipboard = globalThis.navigator && globalThis.navigator.clipboard } = {}) {
  const matches = contentHosts(chrome.runtime.getManifest());
  let shownCard = false; // true once a non-loading card is on screen
  let seq = 0;

  async function activeTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      return tab || null;
    } catch {
      return null;
    }
  }

  function send(message) {
    try {
      return Promise.resolve(chrome.runtime.sendMessage(message));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function show(state) {
    renderCard(root, state, { mode });
    shownCard = state.kind !== 'loading';
  }

  // Asks for the active tab's state and renders it. A loading answer never replaces a card that
  // is already up: the worker broadcasts again when the lookup settles. Out-of-order answers are
  // dropped by sequence.
  async function refresh() {
    const mine = ++seq;
    const tab = await activeTab();
    let state;
    try {
      const answer = await send({ type: 'GET_STATE', tabId: tab ? tab.id : undefined });
      state = resolveState(answer, tab, matches);
    } catch {
      state = { kind: 'error' };
    }
    if (mine !== seq) return;
    if (state.kind === 'loading' && shownCard) return;
    show(state);
  }

  async function check() {
    const mine = ++seq;
    const tab = await activeTab();
    show({ kind: 'loading' });
    let state;
    try {
      const answer = await send({ type: 'CHECK_ACTIVE_TAB', tabId: tab ? tab.id : undefined });
      state = resolveState(answer, tab, matches);
      // A check that found nothing stays quiet: the page was looked at and holds no paper.
      if (state.kind === 'noPaper') state = { kind: 'noPaper', canCheck: false };
    } catch {
      state = { kind: 'error' };
    }
    if (mine !== seq) return;
    show(state);
  }

  const onCopy = (e) => {
    const text = typeof e.detail === 'string' ? e.detail : '';
    if (!text || !clipboard || typeof clipboard.writeText !== 'function') return;
    Promise.resolve(clipboard.writeText(text)).catch(() => {});
  };
  const onCheck = () => {
    check();
  };
  const onMessage = (msg) => {
    if (msg && msg.type === 'TAB_CHANGED') refresh();
    return false;
  };

  root.addEventListener('rrm:copy', onCopy);
  root.addEventListener('rrm:check', onCheck);
  chrome.runtime.onMessage.addListener(onMessage);

  const first = refresh();

  return {
    refresh,
    ready: first,
    dispose() {
      root.removeEventListener('rrm:copy', onCopy);
      root.removeEventListener('rrm:check', onCheck);
      if (chrome.runtime.onMessage.removeListener) chrome.runtime.onMessage.removeListener(onMessage);
    },
  };
}
