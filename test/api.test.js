import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lookup, lookupUrl, LOOKUP_URL } from '../src/lib/api.js';

function response(status, body) {
  return {
    status,
    json: async () => {
      if (body instanceof Error) throw body;
      return body;
    },
  };
}

function fetchReturning(status, body) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    return response(status, body);
  };
  fn.calls = calls;
  return fn;
}

test('builds the url for doi, pmid and q and rejects two params', async () => {
  assert.equal(LOOKUP_URL, 'https://rrmacademy.org/api/library/lookup');
  assert.equal(lookupUrl({ doi: '10.3122/jabfm.2017.02.160184' }), 'https://rrmacademy.org/api/library/lookup?doi=10.3122%2Fjabfm.2017.02.160184');
  assert.equal(lookupUrl({ pmid: '28379830' }), 'https://rrmacademy.org/api/library/lookup?pmid=28379830');
  assert.equal(lookupUrl({ q: 'Fertility treatment & time to live birth' }), 'https://rrmacademy.org/api/library/lookup?q=Fertility+treatment+%26+time+to+live+birth');
  assert.equal(lookupUrl({ doi: '10.1/x', pmid: '1' }), null);
  assert.equal(lookupUrl({}), null);
  assert.equal(lookupUrl({ pmcid: 'PMC5533589' }), null);
  assert.equal(lookupUrl({ q: '   ' }), null);
  assert.equal(lookupUrl({ q: 'x'.repeat(400) }).length, 'https://rrmacademy.org/api/library/lookup?q='.length + 300);

  const two = await lookup({ doi: '10.1/x', pmid: '1' }, { fetchImpl: fetchReturning(200, { v: 1, found: false }) });
  assert.deepEqual(two, { ok: false, reason: 'invalid' });

  const f = fetchReturning(200, { v: 1, found: false, suggestUrl: 'https://rrmacademy.org/contact/' });
  const r = await lookup({ pmid: '28379830' }, { fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.data.found, false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, 'https://rrmacademy.org/api/library/lookup?pmid=28379830');
  assert.equal(f.calls[0].init.credentials, 'omit');
});

test('maps 400 to invalid, 503 to unavailable, thrown fetch to network, v!==1 to schema', async () => {
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(400, { error: 'bad' }) }), { ok: false, reason: 'invalid' });
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(503, {}) }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(429, {}) }), { ok: false, reason: 'unavailable' });
  assert.deepEqual(
    await lookup(
      { doi: '10.1/x' },
      {
        fetchImpl: async () => {
          throw new TypeError('Failed to fetch');
        },
      },
    ),
    { ok: false, reason: 'network' },
  );
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(200, { v: 2, found: true, record: {} }) }), { ok: false, reason: 'schema' });
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(200, { found: true }) }), { ok: false, reason: 'schema' });
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(200, { v: 1, found: true }) }), { ok: false, reason: 'schema' });
  assert.deepEqual(await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(200, new SyntaxError('not json')) }), { ok: false, reason: 'schema' });

  const ok = await lookup({ doi: '10.1/x' }, { fetchImpl: fetchReturning(200, { v: 1, found: true, record: { title: 'T' } }) });
  assert.equal(ok.ok, true);
  assert.equal(ok.data.record.title, 'T');
});

test('aborts after timeoutMs and reports network', async () => {
  let sawSignal = null;
  const slow = (url, init) =>
    new Promise((resolve, reject) => {
      sawSignal = init.signal;
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      setTimeout(() => resolve(response(200, { v: 1, found: false })), 5000).unref();
    });
  const started = Date.now();
  const r = await lookup({ q: 'anything' }, { fetchImpl: slow, timeoutMs: 20 });
  assert.deepEqual(r, { ok: false, reason: 'network' });
  assert.ok(sawSignal && sawSignal.aborted, 'the fetch signal was aborted');
  assert.ok(Date.now() - started < 2000, 'returned on the timeout, not the slow response');
});
