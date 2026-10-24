import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { mountView, hostSupported, resolveState, contentHosts } from '../src/lib/view.js';
import { COPY } from '../src/lib/card.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const matches = contentHosts(manifest);

const found = {
  identifier: { kind: 'pmid', value: '28379830' },
  requestId: 'r1',
  state: { kind: 'found', record: { title: 'Boltz 2017', url: 'https://rrmacademy.org/library/boltz/', citation: 'Boltz, M. W. (2017). JABFM.' } },
};
const placeholder = { identifier: null, state: { kind: 'noPaper', canCheck: true }, requestId: null };

// A fake chrome: answers come from a queue per message type; every message and listener is kept.
function fakeChrome({ tab, answers = {} }) {
  const sent = [];
  const listeners = [];
  const pending = {};
  return {
    sent,
    listeners,
    tab,
    resolveNext(type, answer) {
      const r = (pending[type] || []).shift();
      assert.ok(r, `no pending ${type}`);
      r(answer);
    },
    runtime: {
      getManifest: () => manifest,
      sendMessage(msg) {
        sent.push(msg);
        const queue = answers[msg.type];
        if (queue === 'reject') return Promise.reject(new Error('no receiver'));
        if (queue === 'defer') return new Promise((res) => (pending[msg.type] = (pending[msg.type] || []).concat(res)));
        return Promise.resolve(Array.isArray(queue) ? queue.shift() : queue);
      },
      onMessage: {
        addListener: (fn) => listeners.push(fn),
        removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
      },
    },
    tabs: {
      query: async () => (tab ? [tab] : []),
    },
  };
}

function mount(chrome, mode = 'popup', clipboard) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const el = dom.window.document.getElementById('root');
  const view = mountView(el, { mode, chrome, clipboard });
  return { el, view, dom };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

test('hostSupported matches only https hosts on the manifest content-script list', () => {
  assert.equal(hostSupported('https://pubmed.ncbi.nlm.nih.gov/28379830/', matches), true);
  assert.equal(hostSupported('https://doi.org/10.1/x', matches), true);
  assert.equal(hostSupported('http://pubmed.ncbi.nlm.nih.gov/1/', matches), false, 'http is not covered');
  assert.equal(hostSupported('https://repository.example.edu/handle/1', matches), false);
  assert.equal(hostSupported(undefined, matches), false, 'no url (no host permission) means unsupported');
  assert.equal(hostSupported('not a url', matches), false);
});

test('resolveState: placeholder entry is noPaper with Check off-list, loading mid-navigation on-list', () => {
  const answer = { tabId: 1, entry: placeholder };
  assert.deepEqual(resolveState(answer, { id: 1, url: 'https://repository.example.edu/x', status: 'complete' }, matches), { kind: 'noPaper', canCheck: true });
  assert.deepEqual(resolveState(answer, { id: 1, url: 'https://pubmed.ncbi.nlm.nih.gov/?term=endo', status: 'complete' }, matches), { kind: 'noPaper', canCheck: false });
  assert.deepEqual(resolveState(answer, { id: 1, url: 'https://pubmed.ncbi.nlm.nih.gov/1/', status: 'loading' }, matches), { kind: 'loading' });
  assert.deepEqual(resolveState(answer, { id: 1, status: 'complete' }, matches), { kind: 'noPaper', canCheck: true }, 'url withheld means no host permission, so unsupported');
  assert.deepEqual(resolveState({ tabId: null, entry: null }, null, matches), { kind: 'noPaper', canCheck: false });
  assert.deepEqual(resolveState({ tabId: 1, entry: found }, { id: 1, url: 'https://pubmed.ncbi.nlm.nih.gov/1/' }, matches), found.state);
});

test('mount asks GET_STATE for the active tab and renders the found card', async () => {
  const chrome = fakeChrome({ tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/28379830/', status: 'complete' }, answers: { GET_STATE: { tabId: 7, entry: found } } });
  const { el, view } = mount(chrome);
  await view.ready;
  assert.deepEqual(chrome.sent, [{ type: 'GET_STATE', tabId: 7 }]);
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'found');
  assert.equal(el.querySelector('.rrm-headline').textContent, 'Boltz 2017');
  assert.equal(chrome.listeners.length, 1, 'listens for TAB_CHANGED');
});

test('no entry on a supported host: "Open a paper" without a Check button', async () => {
  const chrome = fakeChrome({ tab: { id: 1, url: 'https://pubmed.ncbi.nlm.nih.gov/?term=endometriosis', status: 'complete' }, answers: { GET_STATE: { tabId: 1, entry: placeholder } } });
  const { el, view } = mount(chrome);
  await view.ready;
  assert.equal(el.querySelector('.rrm-prose').textContent, COPY.noPaper);
  assert.equal(el.querySelector('button.rrm-button'), null);
});

test('no entry on an unsupported host: Check button sends CHECK_ACTIVE_TAB and renders the answer', async () => {
  const chrome = fakeChrome({
    tab: { id: 3, url: 'https://repository.example.edu/handle/123', status: 'complete' },
    answers: { GET_STATE: { tabId: 3, entry: placeholder }, CHECK_ACTIVE_TAB: { tabId: 3, entry: found } },
  });
  const { el, view } = mount(chrome);
  await view.ready;
  const btn = el.querySelector('button.rrm-button');
  assert.equal(btn.textContent.trim(), COPY.check);
  btn.click();
  await tick();
  await tick();
  assert.deepEqual(chrome.sent[1], { type: 'CHECK_ACTIVE_TAB', tabId: 3 });
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'found');
});

test('a check that finds no paper leaves no second Check button', async () => {
  const chrome = fakeChrome({
    tab: { id: 3, url: 'https://repository.example.edu/handle/123', status: 'complete' },
    answers: { GET_STATE: { tabId: 3, entry: placeholder }, CHECK_ACTIVE_TAB: { tabId: 3, entry: { identifier: null, state: { kind: 'noPaper', canCheck: false }, requestId: 'r9' } } },
  });
  const { el, view } = mount(chrome);
  await view.ready;
  el.querySelector('button.rrm-button').click();
  await tick();
  await tick();
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'noPaper');
  assert.equal(el.querySelector('button.rrm-button'), null);
});

test('Copy citation writes the citation to the clipboard', async () => {
  const written = [];
  const chrome = fakeChrome({ tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/28379830/', status: 'complete' }, answers: { GET_STATE: { tabId: 7, entry: found } } });
  const { el, view } = mount(chrome, 'popup', { writeText: async (t) => written.push(t) });
  await view.ready;
  el.querySelector('button.rrm-copy').click();
  await tick();
  assert.deepEqual(written, [found.state.record.citation]);
});

test('panel follows TAB_CHANGED: re-asks, keeps the card while loading, swaps when settled', async () => {
  const chrome = fakeChrome({
    tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/28379830/', status: 'complete' },
    answers: {
      GET_STATE: [
        { tabId: 7, entry: found },
        { tabId: 7, entry: { identifier: null, state: { kind: 'loading' }, requestId: 'r2' } },
        { tabId: 7, entry: placeholder },
        { tabId: 7, entry: { identifier: null, state: { kind: 'notFound', candidates: [] }, requestId: 'r3' } },
      ],
    },
  });
  const { el, view } = mount(chrome, 'panel');
  await view.ready;
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'found');
  const [listener] = chrome.listeners;

  // Lookup in flight on the new page: the old card stays up.
  listener({ type: 'TAB_CHANGED', tabId: 7 });
  await tick();
  await tick();
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'found', 'no flash to loading');

  // Navigation cleared the entry while the tab is still loading: still the old card.
  chrome.tab.status = 'loading';
  listener({ type: 'TAB_CHANGED', tabId: 7 });
  await tick();
  await tick();
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'found', 'no flash to noPaper mid-navigation');

  // The answer lands: swap.
  chrome.tab.status = 'complete';
  listener({ type: 'TAB_CHANGED', tabId: 7 });
  await tick();
  await tick();
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'notFound');
  assert.equal(chrome.sent.filter((m) => m.type === 'GET_STATE').length, 4);
  assert.ok(el.querySelector('.rrm-card--panel'), 'panel mode');
});

test('the first render may be the loading line; a rejected send renders the error line', async () => {
  const loading = fakeChrome({ tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/1/', status: 'complete' }, answers: { GET_STATE: { tabId: 7, entry: { identifier: null, state: { kind: 'loading' }, requestId: 'r2' } } } });
  const a = mount(loading);
  await a.view.ready;
  assert.equal(a.el.querySelector('.rrm-card').getAttribute('data-state'), 'loading');
  assert.equal(a.el.textContent.trim(), COPY.loading);

  const dead = fakeChrome({ tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/1/', status: 'complete' }, answers: { GET_STATE: 'reject' } });
  const b = mount(dead);
  await b.view.ready;
  assert.equal(b.el.querySelector('.rrm-card').getAttribute('data-state'), 'error');
  assert.equal(b.el.textContent.trim(), COPY.error);
  assert.equal(dead.sent.length, 1, 'one request, no retry loop');
});

test('a late answer for an earlier refresh does not overwrite a newer one', async () => {
  const chrome = fakeChrome({ tab: { id: 7, url: 'https://pubmed.ncbi.nlm.nih.gov/1/', status: 'complete' }, answers: { GET_STATE: 'defer' } });
  const { el, view } = mount(chrome);
  await tick();
  view.refresh();
  await tick();
  // The older request answers first, after a newer one was issued: dropped, nothing rendered.
  chrome.resolveNext('GET_STATE', { tabId: 7, entry: found });
  await view.ready;
  await tick();
  assert.equal(el.querySelector('.rrm-card'), null, 'the stale first answer was dropped');
  chrome.resolveNext('GET_STATE', { tabId: 7, entry: { identifier: null, state: { kind: 'notFound', candidates: [] }, requestId: 'r5' } });
  await tick();
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'notFound');
  view.dispose();
  assert.equal(chrome.listeners.length, 0);
});
