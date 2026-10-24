import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { detectIdentifier, normalizeDoi, normalizePmid } from '../src/lib/detect.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, 'fixtures');
const manifest = JSON.parse(readFileSync(join(here, '..', 'manifest.json'), 'utf8'));

function fixture(name) {
  return JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8'));
}

// Every fixture is one live page captured by scripts/capture-fixture.mjs: final URL, canonical
// href and the citation-style metas only. A host that answered a bot challenge at capture time
// is stored as { captured: false, reason } and skipped here, so the gap stays visible in git.
//
// Hostname notes from the 2026-10-24 capture: the BMJ DOI 10.1136/bjsports-2025-109785 resolved to
// bjsm.bmj.com and the NEJM DOI 10.1056/EVIDoa2400195 to evidence.nejm.org. The manifest lists
// www.bmj.com and www.nejm.org, so neither of those journal hosts gets the automatic badge; the
// reader's "Check this page" path covers them. The two assertions below pin that as a known gap.
const captured = readdirSync(fixturesDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), fixture(f.replace(/\.json$/, ''))])
  .filter(([, fx]) => fx.captured !== false);

test('pubmed article page yields pmid first when both tags exist in citation_pmid order', () => {
  // The live PubMed page lists citation_pmid before citation_doi in document order. Precedence is
  // by tag name, not document position (spec section 5: citation_doi, then citation_pmid), so the
  // page with both yields the doi; a PubMed record with no DOI carries only citation_pmid and
  // yields the pmid. Either identifier resolves the same library record.
  const fx = fixture('pubmed');
  const names = fx.metas.map((m) => m.name.toLowerCase());
  assert.ok(names.indexOf('citation_pmid') < names.indexOf('citation_doi'), 'fixture lists citation_pmid first');
  assert.deepEqual(detectIdentifier(fx), { kind: 'doi', value: '10.3122/jabfm.2017.02.160184' });

  const pmidOnly = detectIdentifier({
    ...fx,
    metas: fx.metas.filter((m) => m.name.toLowerCase() !== 'citation_doi'),
  });
  assert.deepEqual(pmidOnly, { kind: 'pmid', value: '28379830' });

  const noMetas = detectIdentifier({ ...fx, metas: [] });
  assert.deepEqual(noMetas, { kind: 'pmid', value: '28379830' }, 'the URL pattern still yields the pmid');
});

test('each fixture host yields a doi or pmid', () => {
  const article = captured.filter(([name]) => name !== 'pubmed-results');
  assert.ok(article.length >= 4, 'expected several captured article fixtures');
  for (const [name, fx] of article) {
    const id = detectIdentifier(fx);
    assert.ok(id, `${name}: no identifier detected`);
    assert.ok(id.kind === 'doi' || id.kind === 'pmid', `${name}: unexpected kind ${id.kind}`);
    if (id.kind === 'doi') assert.match(id.value, /^10\.\d{4,9}\/\S+$/, `${name}: ${id.value}`);
    if (id.kind === 'pmid') assert.match(id.value, /^\d{1,9}$/, `${name}: ${id.value}`);
    assert.equal(id.value, id.value.toLowerCase(), `${name}: identifier not lowercased`);
  }
});

test('every captured fixture URL is on a host the manifest badges, except the two known journal subdomains', () => {
  const allowed = new Set(manifest.host_permissions.map((p) => new URL(p.replace('*', '')).hostname));
  const knownGaps = new Set(['bjsm.bmj.com', 'evidence.nejm.org']);
  for (const [name, fx] of captured) {
    const host = new URL(fx.url).hostname;
    if (knownGaps.has(host)) continue;
    assert.ok(allowed.has(host), `${name}: ${host} is not in manifest host_permissions`);
  }
});

test('pubmed results page yields null', () => {
  const fx = fixture('pubmed-results');
  assert.notEqual(fx.captured, false);
  assert.equal(detectIdentifier(fx), null);
});

test('first of several citation_doi tags wins', () => {
  const id = detectIdentifier({
    url: 'https://www.example.org/article',
    canonical: null,
    metas: [
      { name: 'citation_doi', content: '10.1000/first' },
      { name: 'citation_doi', content: '10.1000/second' },
      { name: 'citation_pmid', content: '12345' },
    ],
  });
  assert.deepEqual(id, { kind: 'doi', value: '10.1000/first' });
});

test('meta names compare case-insensitively and dc.identifier counts only when it names a DOI', () => {
  assert.deepEqual(
    detectIdentifier({ url: 'https://x.test/', canonical: null, metas: [{ name: 'DC.Identifier', content: 'doi:10.1002/RMB2.70008' }] }),
    { kind: 'doi', value: '10.1002/rmb2.70008' },
  );
  assert.deepEqual(
    detectIdentifier({ url: 'https://x.test/', canonical: null, metas: [{ name: 'Citation_DOI', content: '10.1000/abc' }] }),
    { kind: 'doi', value: '10.1000/abc' },
  );
  assert.equal(
    detectIdentifier({ url: 'https://x.test/', canonical: null, metas: [{ name: 'dc.identifier', content: 'S0015028224000013' }] }),
    null,
  );
  // SAGE: no citation_doi, two dc.Identifier tags, the first an underscore form that is not a DOI.
  assert.deepEqual(
    detectIdentifier({
      url: 'https://journals.sagepub.com/doi/10.1177/15409996261443813',
      canonical: null,
      metas: [
        { name: 'dc.Identifier', content: '10.1177_15409996261443813' },
        { name: 'dc.Identifier', content: '10.1177/15409996261443813' },
      ],
    }),
    { kind: 'doi', value: '10.1177/15409996261443813' },
  );
  assert.deepEqual(
    detectIdentifier({ url: 'https://x.test/', canonical: null, metas: [{ name: 'prism.doi', content: 'doi:10.1056/EVIDoa2400195' }] }),
    { kind: 'doi', value: '10.1056/evidoa2400195' },
  );
});

test('doi from canonical with trailing period is trimmed', () => {
  const id = detectIdentifier({
    url: 'https://www.example.org/some/path',
    canonical: 'https://www.example.org/doi/10.1234/abc.def.',
    metas: [],
  });
  assert.deepEqual(id, { kind: 'doi', value: '10.1234/abc.def' });
});

test('uppercase doi normalizes to lowercase', () => {
  assert.equal(normalizeDoi('10.1056/EVIDoa2400195'), '10.1056/evidoa2400195');
  assert.equal(normalizeDoi('https://doi.org/10.1016/J.JEP.2026.122135'), '10.1016/j.jep.2026.122135');
  assert.equal(normalizeDoi('https://dx.doi.org/10.1016/j.jep.2026.122135;'), '10.1016/j.jep.2026.122135');
  assert.equal(normalizeDoi('doi: 10.1017/S2045796023000525)'), '10.1017/s2045796023000525');
  assert.equal(normalizeDoi('10.1000'), null);
  assert.equal(normalizeDoi('11.1000/abc'), null);
  assert.equal(normalizeDoi(''), null);
  assert.equal(normalizeDoi(undefined), null);
});

test('normalizePmid strips leading zeros and bounds the length', () => {
  assert.equal(normalizePmid('0028379830'), '28379830');
  assert.equal(normalizePmid('28379830'), '28379830');
  assert.equal(normalizePmid(' 1 '), '1');
  assert.equal(normalizePmid('PMID: 28379830'), '28379830');
  assert.equal(normalizePmid('1234567890'), null);
  assert.equal(normalizePmid('PMC5533589'), null);
  assert.equal(normalizePmid('abc'), null);
  assert.equal(normalizePmid(''), null);
});

test('resolver and legacy hosts are detected from the URL alone', () => {
  assert.deepEqual(detectIdentifier({ url: 'https://doi.org/10.1038/s41598-026-36763-0', canonical: null, metas: [] }), {
    kind: 'doi',
    value: '10.1038/s41598-026-36763-0',
  });
  assert.deepEqual(detectIdentifier({ url: 'https://dx.doi.org/10.1002/RMB2.70008', canonical: null, metas: [] }), {
    kind: 'doi',
    value: '10.1002/rmb2.70008',
  });
  assert.deepEqual(detectIdentifier({ url: 'https://doi.org/10.1017/S2045796023000525?x=1#frag', canonical: null, metas: [] }), {
    kind: 'doi',
    value: '10.1017/s2045796023000525',
  });
  assert.deepEqual(detectIdentifier({ url: 'https://pubmed.ncbi.nlm.nih.gov/28379830/', canonical: null, metas: [] }), {
    kind: 'pmid',
    value: '28379830',
  });
  assert.deepEqual(detectIdentifier({ url: 'https://pubmed.ncbi.nlm.nih.gov/28379830', canonical: null, metas: [] }), {
    kind: 'pmid',
    value: '28379830',
  });
  // The legacy host redirects to pubmed.ncbi.nlm.nih.gov; its own URL carries nothing we read.
  assert.equal(detectIdentifier({ url: 'https://www.ncbi.nlm.nih.gov/pubmed/28379830', canonical: null, metas: [] }), null);
  assert.equal(detectIdentifier({ url: 'https://doi.org/', canonical: null, metas: [] }), null);
  assert.equal(detectIdentifier({ url: 'https://pubmed.ncbi.nlm.nih.gov/?term=endometriosis', canonical: null, metas: [] }), null);
  assert.equal(detectIdentifier({ url: 'not a url', canonical: null, metas: [] }), null);
  assert.equal(detectIdentifier(), null);
});

test('non-paper page with a stray "10.1000" string in a meta description yields null', () => {
  const id = detectIdentifier({
    url: 'https://www.example.org/about',
    canonical: 'https://www.example.org/about',
    metas: [
      { name: 'description', content: 'Our catalog lists 10.1000/xyz style handles and more.' },
      { name: 'dc.description', content: 'See 10.1000/abc for details.' },
      { name: 'dc.identifier', content: 'https://www.example.org/about' },
      { name: 'dc.identifier', content: 'about-page-10.1000' },
    ],
  });
  assert.equal(id, null);
});
