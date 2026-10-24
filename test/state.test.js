import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTabStore, badgeFor, shouldApply, mintRequestId, stateFromLookup } from '../src/lib/state.js';

test('a late answer for an older requestId on the same tab is not applied', () => {
  const store = createTabStore();
  const first = mintRequestId();
  store.set(7, { identifier: { kind: 'doi', value: '10.1/a' }, state: { kind: 'loading' }, requestId: first });
  const second = mintRequestId();
  store.set(7, { identifier: { kind: 'doi', value: '10.1/b' }, state: { kind: 'loading' }, requestId: second });

  assert.equal(shouldApply(store, 7, first), false, 'the older request must not overwrite the newer one');
  assert.equal(shouldApply(store, 7, second), true);
  assert.equal(shouldApply(store, 8, second), false, 'an unknown tab never applies');
  assert.notEqual(first, second);
});

test('answers are keyed by tab: tab A found does not badge tab B', () => {
  const store = createTabStore();
  const a = mintRequestId();
  store.set(1, { identifier: { kind: 'pmid', value: '1' }, state: { kind: 'found', record: { title: 'A' } }, requestId: a });
  const b = mintRequestId();
  store.set(2, { identifier: { kind: 'pmid', value: '2' }, state: { kind: 'notFound' }, requestId: b });

  assert.equal(badgeFor(store.get(1).state), 'RRM');
  assert.equal(badgeFor(store.get(2).state), '');
  assert.equal(store.get(3), null);
  assert.equal(badgeFor(store.get(3) && store.get(3).state), '');
});

test('badgeFor returns RRM only for found', () => {
  assert.equal(badgeFor({ kind: 'found', record: {} }), 'RRM');
  for (const kind of ['loading', 'notFound', 'noPaper', 'error']) assert.equal(badgeFor({ kind }), '');
  assert.equal(badgeFor(null), '');
  assert.equal(badgeFor(undefined), '');
});

test('clear removes the tab entry', () => {
  const store = createTabStore();
  store.set(5, { identifier: null, state: { kind: 'found', record: {} }, requestId: 'r1' });
  assert.ok(store.get(5));
  store.clear(5);
  assert.equal(store.get(5), null);
  assert.equal(shouldApply(store, 5, 'r1'), false);
  assert.deepEqual(store.entries(), {});
});

test('a store rehydrates from a plain object mirror and keys tabs by number', () => {
  const store = createTabStore({ 11: { identifier: null, state: { kind: 'found', record: {} }, requestId: 'x' }, bad: null });
  assert.equal(store.get('11').state.kind, 'found');
  assert.equal(store.get(11).requestId, 'x');
  assert.deepEqual(Object.keys(store.entries()), ['11']);
});

test('stateFromLookup maps the route answer to a card state', () => {
  assert.deepEqual(stateFromLookup({ ok: false, reason: 'network' }), { kind: 'error' });
  assert.deepEqual(stateFromLookup(null), { kind: 'error' });
  assert.deepEqual(stateFromLookup({ ok: true, data: { v: 1, found: true, record: { title: 'T' } } }), { kind: 'found', record: { title: 'T' } });
  assert.deepEqual(stateFromLookup({ ok: true, data: { v: 1, found: false, suggestUrl: 'https://rrmacademy.org/contact/' } }), {
    kind: 'notFound',
    suggestUrl: 'https://rrmacademy.org/contact/',
    candidates: [],
  });
  const c = [{ title: 'A', url: 'https://rrmacademy.org/library/a/' }];
  assert.deepEqual(stateFromLookup({ ok: true, data: { v: 1, found: false, suggestUrl: 'u', candidates: c } }).candidates, c);
});
