import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { renderCard, COPY } from '../src/lib/card.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src', 'card.css'), 'utf8');

function mount() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
  const el = dom.window.document.getElementById('root');
  return { dom, el, doc: dom.window.document };
}

const record = {
  id: 'recwFou1ja5Awm7Ho',
  slug: 'fertility-treatment-provider-type',
  title: 'Fertility Treatment, Use of in Vitro Fertilization, and Time to Live Birth Based on Initial Provider Type',
  url: 'https://rrmacademy.org/library/fertility-treatment-provider-type/?utm_source=extension&utm_medium=chrome',
  synopsisTitle: 'Starting infertility care with a family doctor meant less IVF',
  summary: '84% of women saw a **generalist** first and reached a live birth no later than those who went straight to a specialist.',
  keyFindings: ['Finding one', 'Finding two', 'Finding three', 'Finding four'],
  grade: { label: '5 - Core RRM', value: 5 },
  openAccess: true,
  citation: 'Boltz, M. W., Sanders, J. N., Simonsen, S. E., & Stanford, J. B. (2017). Fertility treatment. JABFM, 30(2), 230-238. https://doi.org/10.3122/jabfm.2017.02.160184',
  related: [
    { slug: 'a', title: 'Related A', url: 'https://rrmacademy.org/library/a/' },
    { slug: 'b', title: 'Related B', url: 'https://rrmacademy.org/library/b/' },
    { slug: 'c', title: 'Related C', url: 'https://rrmacademy.org/library/c/' },
    { slug: 'd', title: 'Related D', url: 'https://rrmacademy.org/library/d/' },
  ],
};

const textOf = (el, sel) => [...el.querySelectorAll(sel)].map((n) => n.textContent.trim());

test('found with synopsis renders eyebrow, headline, grade chip, summary, related and both actions', () => {
  const { el } = mount();
  renderCard(el, { kind: 'found', record }, { mode: 'popup' });

  assert.equal(el.querySelector('.rrm-eyebrow').textContent.trim(), COPY.inLibrary);
  assert.ok(el.querySelector('.rrm-eyebrow svg.rrm-icon--check'), 'eyebrow carries the Lucide check');
  assert.equal(el.querySelector('.rrm-headline').textContent, record.synopsisTitle);
  assert.equal(el.querySelector('.rrm-chip--grade').textContent, '5 - Core RRM');
  const summary = el.querySelector('.rrm-summary');
  assert.ok(summary.textContent.startsWith('84% of women saw a generalist first'));
  assert.equal(summary.querySelector('strong').textContent, 'generalist');
  assert.deepEqual(textOf(el, '.rrm-related a'), ['Related A', 'Related B', 'Related C'], 'related capped at three');
  const read = el.querySelector('a.rrm-button');
  assert.equal(read.textContent.trim(), COPY.read);
  assert.equal(read.getAttribute('href'), record.url);
  assert.equal(read.getAttribute('target'), '_blank');
  assert.match(read.getAttribute('rel'), /\bnoopener\b/);
  assert.equal(el.querySelector('button.rrm-copy').textContent.trim(), COPY.copy);
  for (const a of el.querySelectorAll('a')) {
    assert.equal(a.getAttribute('target'), '_blank');
    assert.match(a.getAttribute('rel'), /\bnoopener\b/);
  }
  assert.equal(el.querySelector('.rrm-findings'), null, 'key findings do not render in popup mode');
});

test('found without synopsis renders the title as headline and "Synopsis not yet written."', () => {
  const { el } = mount();
  const { synopsisTitle, summary, keyFindings, ...bare } = record;
  renderCard(el, { kind: 'found', record: bare }, { mode: 'panel' });
  assert.equal(el.querySelector('.rrm-headline').textContent, bare.title);
  assert.equal(el.querySelector('.rrm-muted').textContent, COPY.noSynopsis);
  assert.equal(el.querySelector('.rrm-summary'), null);
  assert.equal(el.querySelector('.rrm-findings'), null);
  assert.equal(el.querySelector('.rrm-chip--grade').textContent, '5 - Core RRM');
  assert.equal(el.querySelectorAll('.rrm-related a').length, 3);
  assert.equal(el.querySelector('a.rrm-button').textContent.trim(), COPY.read);
});

test('open access chip appears only when openAccess is true', () => {
  const { el } = mount();
  renderCard(el, { kind: 'found', record }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-chip--oa').textContent, COPY.openAccess);

  renderCard(el, { kind: 'found', record: { ...record, openAccess: false } }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-chip--oa'), null);
  renderCard(el, { kind: 'found', record: { ...record, openAccess: undefined } }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-chip--oa'), null);
  renderCard(el, { kind: 'found', record: { ...record, openAccess: 'yes' } }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-chip--oa'), null);
});

test('key findings render in panel mode only and are capped at 3', () => {
  const { el } = mount();
  renderCard(el, { kind: 'found', record }, { mode: 'panel' });
  assert.equal(el.querySelector('.rrm-findings .rrm-label').textContent, COPY.keyFindings);
  assert.deepEqual(textOf(el, '.rrm-findings li'), ['Finding one', 'Finding two', 'Finding three']);

  renderCard(el, { kind: 'found', record }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-findings'), null);
});

test('related section is absent when related is empty', () => {
  const { el } = mount();
  renderCard(el, { kind: 'found', record: { ...record, related: [] } }, { mode: 'panel' });
  assert.equal(el.querySelector('.rrm-related'), null);
  renderCard(el, { kind: 'found', record: { ...record, related: undefined } }, { mode: 'panel' });
  assert.equal(el.querySelector('.rrm-related'), null);
});

test('notFound renders Suggest it and up to three candidates under "Did you mean"', () => {
  const { el } = mount();
  renderCard(
    el,
    {
      kind: 'notFound',
      suggestUrl: 'https://rrmacademy.org/contact/',
      candidates: [
        { slug: 'a', title: 'Cand A', url: 'https://rrmacademy.org/library/a/' },
        { slug: 'b', title: 'Cand B', url: 'https://rrmacademy.org/library/b/' },
        { slug: 'c', title: 'Cand C', url: 'https://rrmacademy.org/library/c/' },
        { slug: 'd', title: 'Cand D', url: 'https://rrmacademy.org/library/d/' },
      ],
    },
    { mode: 'panel' },
  );
  assert.equal(el.querySelector('.rrm-eyebrow').textContent.trim(), COPY.notInLibrary);
  assert.ok([...el.querySelectorAll('p')].some((p) => p.textContent === COPY.notFound));
  const suggest = [...el.querySelectorAll('a')].find((a) => a.textContent.trim() === COPY.suggest);
  assert.ok(suggest, 'Suggest it link present');
  assert.equal(suggest.getAttribute('href'), 'https://rrmacademy.org/contact/');
  assert.equal(suggest.getAttribute('target'), '_blank');
  assert.equal(el.querySelector('.rrm-candidates .rrm-label').textContent, COPY.didYouMean);
  assert.deepEqual(textOf(el, '.rrm-candidates a'), ['Cand A', 'Cand B', 'Cand C']);

  renderCard(el, { kind: 'notFound', suggestUrl: 'https://rrmacademy.org/contact/' }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-candidates'), null);
  assert.ok([...el.querySelectorAll('a')].some((a) => a.textContent.trim() === COPY.suggest));
});

test('noPaper and error states carry the exact copy, and the check button only when canCheck', () => {
  const { el } = mount();
  renderCard(el, { kind: 'noPaper', canCheck: true }, { mode: 'popup' });
  assert.ok([...el.querySelectorAll('p')].some((p) => p.textContent === COPY.noPaper));
  assert.equal(el.querySelector('button.rrm-button').textContent.trim(), COPY.check);

  renderCard(el, { kind: 'noPaper', canCheck: false }, { mode: 'popup' });
  assert.equal(el.querySelector('button'), null);

  renderCard(el, { kind: 'error' }, { mode: 'popup' });
  assert.equal(el.querySelector('[role="alert"]').textContent, COPY.error);

  renderCard(el, { kind: 'loading' }, { mode: 'popup' });
  assert.equal(el.querySelector('.rrm-card').getAttribute('data-state'), 'loading');
});

test('server text is inserted as text nodes, never parsed as HTML', () => {
  const { el } = mount();
  const hostile = {
    ...record,
    title: '<img src=x onerror=1>',
    synopsisTitle: '<img src=x onerror=1>',
    summary: '<script>alert(1)</script> **<b>bold</b>**',
    keyFindings: ['<img src=x onerror=1>'],
    grade: { label: '<img src=x onerror=1>', value: 5 },
    citation: '<img src=x onerror=1>',
    related: [{ slug: 'x', title: '<img src=x onerror=1>', url: 'https://rrmacademy.org/library/x/' }],
  };
  renderCard(el, { kind: 'found', record: hostile }, { mode: 'panel' });
  assert.equal(el.querySelectorAll('img').length, 0);
  assert.equal(el.querySelectorAll('script').length, 0);
  assert.equal(el.querySelectorAll('b').length, 0);
  assert.equal(el.querySelector('.rrm-headline').textContent, '<img src=x onerror=1>');
  assert.equal(el.querySelector('.rrm-chip--grade').textContent, '<img src=x onerror=1>');
  assert.equal(el.querySelector('.rrm-summary strong').textContent, '<b>bold</b>');

  renderCard(el, { kind: 'notFound', suggestUrl: 'https://rrmacademy.org/contact/', candidates: [{ title: '<img src=x>', url: 'https://rrmacademy.org/library/y/' }] }, { mode: 'panel' });
  assert.equal(el.querySelectorAll('img').length, 0);
  assert.equal(el.querySelector('.rrm-candidates a').textContent, '<img src=x>');
});

test('copy link dispatches rrm:copy with the citation', () => {
  const { el, dom } = mount();
  renderCard(el, { kind: 'found', record }, { mode: 'popup' });
  let detail = null;
  el.addEventListener('rrm:copy', (e) => {
    detail = e.detail;
  });
  const copy = el.querySelector('button.rrm-copy');
  copy.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(detail, record.citation);
  assert.equal(copy.textContent.trim(), COPY.copied);
});

test('check button dispatches rrm:check', () => {
  const { el, dom } = mount();
  renderCard(el, { kind: 'noPaper', canCheck: true }, { mode: 'popup' });
  let fired = 0;
  el.addEventListener('rrm:check', () => fired++);
  el.querySelector('button.rrm-button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(fired, 1);
});

test('card.css keeps the palette, bundles the fonts and draws no hairline dividers', () => {
  assert.ok(!/border-(top|bottom)/.test(css), 'no border-top or border-bottom anywhere');
  for (const hex of ['#725e7e', '#987da8', '#f5f0f8', '#4c3e54']) assert.ok(css.includes(hex), `${hex} missing`);
  assert.ok(!/https?:\/\//.test(css), 'no external URL in card.css');
  for (const f of ['CormorantGaramond-400', 'CormorantGaramond-600', 'Inter-400', 'Inter-500', 'Inter-600']) {
    assert.ok(css.includes(`url('fonts/${f}.woff2')`), `${f} not bundled via @font-face`);
  }
  assert.equal((css.match(/@font-face/g) || []).length, 5);
  assert.ok(/\.rrm-headline\s*\{[^}]*Cormorant Garamond|--rrm-font-display:\s*'Cormorant Garamond'/.test(css));
  assert.ok(!css.includes(String.fromCharCode(0x2014)), 'no em dashes');
});
