// Renders the card the popup and the side panel share (spec section 4). Everything the server
// sends lands in text nodes via createElement and textContent; nothing is parsed as HTML.
// The card raises two CustomEvents on root so the host page owns clipboard and messaging:
// 'rrm:copy' (detail: the citation string) and 'rrm:check' (no detail).

export const COPY = Object.freeze({
  inLibrary: 'In the RRM Research Library',
  notInLibrary: 'Not in the RRM Research Library',
  noSynopsis: 'Synopsis not yet written.',
  notFound: "This paper isn't in the library yet.",
  suggest: 'Suggest it',
  read: 'Read on RRM Academy',
  copy: 'Copy citation',
  copied: 'Copied',
  noPaper: "Open a paper on PubMed, doi.org or a journal site and this will show the RRM Research Library's take.",
  check: 'Check this page',
  error: "Couldn't reach the RRM Research Library. Try again.",
  didYouMean: 'Did you mean',
  keyFindings: 'Key findings',
  related: 'Related in the library',
  openAccess: 'Open access',
  loading: 'Checking the RRM Research Library',
});

const MAX_FINDINGS = 3;
const MAX_RELATED = 3;
const MAX_CANDIDATES = 3;
const COPIED_MS = 1600;

// Lucide icons (https://lucide.dev), ISC license, path data from lucide-static 0.468.0.
// Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather
// (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
const ICONS = Object.freeze({
  check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  copy: [
    ['rect', { width: '14', height: '14', x: '8', y: '8', rx: '2', ry: '2' }],
    ['path', { d: 'M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2' }],
  ],
  'external-link': [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  ],
  search: [
    ['circle', { cx: '11', cy: '11', r: '8' }],
    ['path', { d: 'm21 21-4.3-4.3' }],
  ],
  'book-open': [
    ['path', { d: 'M12 7v14' }],
    [
      'path',
      {
        d: 'M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
      },
    ],
  ],
});

const SVG_NS = 'http://www.w3.org/2000/svg';

// Replaces root's children with the card for state. mode is 'popup' or 'panel'; key findings
// render in panel mode only.
export function renderCard(root, state, { mode = 'popup' } = {}) {
  if (!root || !state) return;
  const doc = root.ownerDocument;
  const card = el(doc, 'article', { class: `rrm-card rrm-card--${mode === 'panel' ? 'panel' : 'popup'}`, 'data-state': state.kind });

  switch (state.kind) {
    case 'loading':
      card.appendChild(el(doc, 'p', { class: 'rrm-muted', 'aria-live': 'polite' }, COPY.loading));
      break;
    case 'found':
      renderFound(doc, card, root, state.record || {}, mode === 'panel');
      break;
    case 'notFound':
      renderNotFound(doc, card, state);
      break;
    case 'noPaper':
      card.appendChild(el(doc, 'p', { class: 'rrm-prose' }, COPY.noPaper));
      if (state.canCheck) {
        const btn = el(doc, 'button', { type: 'button', class: 'rrm-button' });
        btn.appendChild(icon(doc, 'search'));
        btn.appendChild(text(doc, COPY.check));
        btn.addEventListener('click', () => root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('rrm:check')));
        card.appendChild(el(doc, 'div', { class: 'rrm-actions' }, btn));
      }
      break;
    case 'error':
      card.appendChild(el(doc, 'p', { class: 'rrm-prose', role: 'alert' }, COPY.error));
      break;
    default:
      return;
  }

  root.replaceChildren(card);
}

function renderFound(doc, card, root, record, isPanel) {
  const hasSynopsis = typeof record.synopsisTitle === 'string' && record.synopsisTitle.trim() !== '';

  const eyebrow = el(doc, 'p', { class: 'rrm-eyebrow' });
  eyebrow.appendChild(icon(doc, 'check'));
  eyebrow.appendChild(text(doc, COPY.inLibrary));
  card.appendChild(eyebrow);

  card.appendChild(el(doc, 'h1', { class: 'rrm-headline' }, hasSynopsis ? record.synopsisTitle : str(record.title)));

  const chips = el(doc, 'div', { class: 'rrm-chips' });
  const gradeLabel = record.grade && typeof record.grade.label === 'string' ? record.grade.label : '';
  if (gradeLabel) chips.appendChild(el(doc, 'span', { class: 'rrm-chip rrm-chip--grade' }, gradeLabel));
  if (record.openAccess === true) chips.appendChild(el(doc, 'span', { class: 'rrm-chip rrm-chip--oa' }, COPY.openAccess));
  if (chips.childNodes.length) card.appendChild(chips);

  if (hasSynopsis && typeof record.summary === 'string' && record.summary.trim() !== '') {
    card.appendChild(prose(doc, record.summary));
  } else if (!hasSynopsis) {
    card.appendChild(el(doc, 'p', { class: 'rrm-muted' }, COPY.noSynopsis));
  }

  const findings = Array.isArray(record.keyFindings) ? record.keyFindings.filter((f) => typeof f === 'string' && f.trim()) : [];
  if (isPanel && hasSynopsis && findings.length) {
    const section = el(doc, 'section', { class: 'rrm-section rrm-findings' });
    section.appendChild(el(doc, 'h2', { class: 'rrm-label' }, COPY.keyFindings));
    const ul = el(doc, 'ul', { class: 'rrm-list' });
    for (const f of findings.slice(0, MAX_FINDINGS)) ul.appendChild(el(doc, 'li', {}, f));
    section.appendChild(ul);
    card.appendChild(section);
  }

  const related = Array.isArray(record.related) ? record.related.filter((r) => r && typeof r.url === 'string' && typeof r.title === 'string') : [];
  if (related.length) {
    const section = el(doc, 'section', { class: 'rrm-section rrm-related' });
    section.appendChild(el(doc, 'h2', { class: 'rrm-label' }, COPY.related));
    const ul = el(doc, 'ul', { class: 'rrm-list rrm-list--links' });
    for (const r of related.slice(0, MAX_RELATED)) {
      ul.appendChild(el(doc, 'li', {}, link(doc, r.url, r.title)));
    }
    section.appendChild(ul);
    card.appendChild(section);
  }

  const actions = el(doc, 'div', { class: 'rrm-actions' });
  if (typeof record.url === 'string' && record.url) {
    const read = link(doc, record.url, COPY.read, 'rrm-button');
    read.appendChild(icon(doc, 'external-link'));
    actions.appendChild(read);
  }
  if (typeof record.citation === 'string' && record.citation.trim()) {
    const copy = el(doc, 'button', { type: 'button', class: 'rrm-link rrm-copy' });
    copy.appendChild(icon(doc, 'copy'));
    const label = text(doc, COPY.copy);
    copy.appendChild(label);
    copy.addEventListener('click', () => {
      root.dispatchEvent(new root.ownerDocument.defaultView.CustomEvent('rrm:copy', { detail: record.citation }));
      label.data = COPY.copied;
      copy.setAttribute('data-copied', 'true');
      setTimeout(() => {
        label.data = COPY.copy;
        copy.removeAttribute('data-copied');
      }, COPIED_MS);
    });
    actions.appendChild(copy);
  }
  if (actions.childNodes.length) card.appendChild(actions);
}

function renderNotFound(doc, card, state) {
  card.appendChild(el(doc, 'p', { class: 'rrm-eyebrow rrm-eyebrow--quiet' }, COPY.notInLibrary));
  card.appendChild(el(doc, 'p', { class: 'rrm-prose' }, COPY.notFound));

  const candidates = Array.isArray(state.candidates) ? state.candidates.filter((c) => c && typeof c.url === 'string' && typeof c.title === 'string') : [];
  if (candidates.length) {
    const section = el(doc, 'section', { class: 'rrm-section rrm-candidates' });
    section.appendChild(el(doc, 'h2', { class: 'rrm-label' }, COPY.didYouMean));
    const ul = el(doc, 'ul', { class: 'rrm-list rrm-list--links' });
    for (const c of candidates.slice(0, MAX_CANDIDATES)) ul.appendChild(el(doc, 'li', {}, link(doc, c.url, c.title)));
    section.appendChild(ul);
    card.appendChild(section);
  }

  const suggestUrl = typeof state.suggestUrl === 'string' && state.suggestUrl ? state.suggestUrl : 'https://rrmacademy.org/contact/';
  const suggest = link(doc, suggestUrl, COPY.suggest, 'rrm-link');
  suggest.appendChild(icon(doc, 'external-link'));
  card.appendChild(el(doc, 'div', { class: 'rrm-actions' }, suggest));
}

// The summary may carry markdown bold (**text**); that is the only markup honored, as <strong>.
function prose(doc, summary) {
  const p = el(doc, 'p', { class: 'rrm-prose rrm-summary' });
  const parts = summary.split(/\*\*/);
  parts.forEach((part, i) => {
    if (!part) return;
    if (i % 2 === 1 && i !== parts.length - 1) p.appendChild(el(doc, 'strong', {}, part));
    else p.appendChild(text(doc, i % 2 === 1 ? `**${part}` : part));
  });
  return p;
}

function link(doc, href, label, className = '') {
  const a = el(doc, 'a', { href, target: '_blank', rel: 'noopener noreferrer' }, label);
  if (className) a.setAttribute('class', className);
  return a;
}

function icon(doc, name) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', `rrm-icon rrm-icon--${name}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const [tag, attrs] of ICONS[name] || []) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    svg.appendChild(node);
  }
  return svg;
}

function el(doc, tag, attrs = {}, child) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) node.setAttribute(k, v);
  if (typeof child === 'string') node.appendChild(text(doc, child));
  else if (child) node.appendChild(child);
  return node;
}

function text(doc, s) {
  return doc.createTextNode(str(s));
}

function str(v) {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}
