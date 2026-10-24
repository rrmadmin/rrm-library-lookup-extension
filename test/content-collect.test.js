import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { collectPageSignals } from '../src/lib/collect.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const PAGE = `<!doctype html><html><head>
  <meta charset="utf-8">
  <meta name="citation_doi" content="10.3122/jabfm.2017.02.160184">
  <meta name="citation_pmid" content="28379830">
  <meta property="og:title" content="Not a citation tag">
  <meta name="description" content="Not a citation tag either">
  <link rel="canonical" href="https://pubmed.ncbi.nlm.nih.gov/28379830/">
  <script>document.title = 'changed by script'; window.__rrm = { name: 'citation_doi', content: '10.0000/fake' };</script>
</head><body><p>Abstract text</p></body></html>`;

const URL = 'https://pubmed.ncbi.nlm.nih.gov/28379830/?utm_source=x';

function page(html = PAGE, url = URL) {
  return new JSDOM(html, { url, runScripts: 'outside-only' }).window.document;
}

test('collectPageSignals returns exactly the citation metas, the canonical href and the URL', () => {
  const signals = collectPageSignals(page());
  assert.deepEqual(signals, {
    url: URL,
    canonical: 'https://pubmed.ncbi.nlm.nih.gov/28379830/',
    metas: [
      { name: 'citation_doi', content: '10.3122/jabfm.2017.02.160184' },
      { name: 'citation_pmid', content: '28379830' },
    ],
  });
});

test('collectPageSignals ignores meta[property], plain metas and scripts, and reports a missing canonical as null', () => {
  const doc = page(`<!doctype html><html><head>
    <meta property="citation_doi" content="10.0000/property-only">
    <meta name="description" content="x">
    <script type="application/ld+json">{"identifier":"10.0000/in-script"}</script>
  </head><body></body></html>`);
  assert.deepEqual(collectPageSignals(doc), { url: URL, canonical: null, metas: [] });
});

test('collectPageSignals keeps dc., dcterms. and prism. names, case as written, and empty content as ""', () => {
  const doc = page(`<!doctype html><html><head>
    <meta name="DC.Identifier" content="doi:10.1177/0001">
    <meta name="dcterms.title" content="T">
    <meta name="prism.doi" content="10.1177/0001">
    <meta name="citation_title">
  </head><body></body></html>`);
  assert.deepEqual(collectPageSignals(doc).metas, [
    { name: 'DC.Identifier', content: 'doi:10.1177/0001' },
    { name: 'dcterms.title', content: 'T' },
    { name: 'prism.doi', content: '10.1177/0001' },
    { name: 'citation_title', content: '' },
  ]);
});

// background.js injects collectPageSignals with chrome.scripting.executeScript, which serializes
// the function's source and runs it inside the page. That only works if the body closes over
// nothing in the module, so the serialized source is rebuilt in isolation and must still work.
test('collectPageSignals is self-contained when serialized, as executeScript requires', () => {
  const src = collectPageSignals.toString();
  const rebuilt = new Function('document', `return (${src})();`);
  const doc = page();
  assert.deepEqual(rebuilt(doc), collectPageSignals(doc));
});

// The content script is a classic script, so it cannot import collect.js and carries its own
// copy. The two bodies must stay identical.
function functionSource(file) {
  const m = read(file).match(/function collectPageSignals\([^)]*\) \{[\s\S]*?\n\}/);
  assert.ok(m, `${file} does not define collectPageSignals`);
  return m[0];
}

test('content.js carries the same collectPageSignals body as src/lib/collect.js', () => {
  assert.equal(functionSource('src/content.js'), functionSource('src/lib/collect.js'));
});

test('background.js imports collectPageSignals from collect.js rather than carrying a copy', () => {
  const bg = read('src/background.js');
  assert.match(bg, /import \{[^}]*\bcollectPageSignals\b[^}]*\} from '\.\/lib\/collect\.js'/);
  assert.doesNotMatch(bg, /function collectPageSignals/);
});

test('content.js sends DETECTED once with the signals, writes nothing and observes nothing', () => {
  const src = read('src/content.js');
  assert.match(src, /type: 'DETECTED'/);
  assert.equal((src.match(/sendMessage\(/g) || []).length, 1, 'exactly one sendMessage');
  for (const banned of ['innerHTML', 'outerHTML', 'MutationObserver', 'setInterval', 'setTimeout', 'appendChild', 'insertAdjacentHTML', 'document.write', 'addEventListener']) {
    assert.ok(!src.includes(banned), `content.js must not use ${banned}`);
  }
});

test('popup, side panel, content script and views use no inline scripts and no innerHTML (MV3 CSP)', () => {
  for (const file of ['src/popup.html', 'src/sidepanel.html']) {
    const html = read(file);
    assert.match(html, /^<!doctype html>/i, `${file} starts with the doctype`);
    assert.match(html, /<meta charset="utf-8">/, `${file} declares its charset`);
    assert.match(html, /<link rel="stylesheet" href="card\.css">/, `${file} links card.css`);
    assert.match(html, /<script type="module" src="[a-z]+\.js"><\/script>/, `${file} loads one module script`);
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i, `${file} has an inline script body`);
    assert.doesNotMatch(html, /\son[a-z]+=/i, `${file} has an inline event handler`);
    assert.doesNotMatch(html, /https?:\/\//, `${file} references something outside the extension`);
    assert.ok(html.includes('id="root"'), `${file} has #root`);
  }
  for (const file of ['src/content.js', 'src/popup.js', 'src/sidepanel.js', 'src/lib/view.js', 'src/lib/collect.js']) {
    assert.ok(!read(file).includes('innerHTML'), `${file} uses innerHTML`);
  }
});

test('the side panel header reads RRM Academy, Research Library, Following this tab; the popup has no header', () => {
  const panel = read('src/sidepanel.html');
  for (const s of ['RRM Academy', 'Research Library', 'Following this tab']) assert.ok(panel.includes(s), `panel header lacks "${s}"`);
  assert.ok(!read('src/popup.html').includes('Following this tab'));
});

test('no stylesheet draws a border-top or border-bottom, and nothing in src uses an em dash', () => {
  for (const file of ['src/card.css', 'src/shell.css']) {
    const css = read(file);
    assert.doesNotMatch(css, /border-(top|bottom)\b/, `${file} draws a hairline divider`);
  }
  for (const file of ['src/popup.html', 'src/sidepanel.html', 'src/popup.js', 'src/sidepanel.js', 'src/lib/view.js', 'src/content.js', 'src/lib/collect.js', 'src/shell.css']) {
    assert.ok(!read(file).includes(String.fromCharCode(0x2014)), `${file} contains an em dash`);
  }
});
