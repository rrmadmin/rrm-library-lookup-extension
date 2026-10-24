// Identifier detection for one page, from the three signals the content script collects:
// the page URL, the canonical href and the citation-style meta tags (spec section 5).
// Nothing here touches the DOM, so it runs unchanged in the service worker and in tests.

const DOI_SHAPE = /^10\.\d{4,9}\/\S+$/;
// A DOI inside a URL path or a canonical href. The character class stops at whitespace, quotes
// and angle brackets so a DOI embedded in markup is not swallowed; trailing punctuation is
// trimmed by normalizeDoi.
const DOI_IN_TEXT = /10\.\d{4,9}\/[^\s"'<>]+/;
const PMID_PATH = /^\/(\d{1,9})\/?$/;
const DOI_HOSTS = new Set(['doi.org', 'dx.doi.org']);

// Lowercases, strips https://(dx.)doi.org/ and doi: prefixes, trims trailing .,;)] and returns
// null unless what is left is shaped like a DOI.
export function normalizeDoi(raw) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '');
  s = s.replace(/^doi:\s*/i, '');
  s = s.replace(/[.,;)\]]+$/, '');
  s = s.toLowerCase();
  return DOI_SHAPE.test(s) ? s : null;
}

// Strips leading zeros and returns null unless 1 to 9 digits remain.
export function normalizePmid(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  let s = String(raw).trim();
  s = s.replace(/^pmid:?\s*/i, '');
  if (!/^\d+$/.test(s)) return null;
  s = s.replace(/^0+(?=\d)/, '');
  return /^\d{1,9}$/.test(s) ? s : null;
}

// Returns { kind: 'doi' | 'pmid', value } or null. Precedence, stopping at the first hit:
// citation_doi, citation_pmid, dc.identifier naming a DOI, prism.doi; then the URL
// patterns pubmed.ncbi.nlm.nih.gov/<pmid>/, doi.org/<doi>, dx.doi.org/<doi>; then a DOI in the
// canonical href. Meta names compare case-insensitively (publishers emit citation_doi,
// DC.identifier and dc.Identifier). Only the first tag of a given name counts.
export function detectIdentifier({ url, canonical, metas } = {}) {
  const tags = Array.isArray(metas) ? metas : [];

  const fromMeta = detectFromMetas(tags);
  if (fromMeta) return fromMeta;

  const fromUrl = detectFromUrl(url);
  if (fromUrl) return fromUrl;

  if (typeof canonical === 'string') {
    const m = canonical.match(DOI_IN_TEXT);
    const doi = m && normalizeDoi(m[0]);
    if (doi) return { kind: 'doi', value: doi };
  }

  return null;
}

function detectFromMetas(tags) {
  const first = (name) => {
    const hit = tags.find((t) => t && typeof t.name === 'string' && t.name.toLowerCase() === name);
    return hit ? hit.content : undefined;
  };

  const citationDoi = normalizeDoi(first('citation_doi'));
  if (citationDoi) return { kind: 'doi', value: citationDoi };

  const citationPmid = normalizePmid(first('citation_pmid'));
  if (citationPmid) return { kind: 'pmid', value: citationPmid };

  // dc.identifier carries all sorts of ids (PIIs, URLs, internal keys). A value counts only when
  // it says it is a DOI: a doi: prefix, a doi.org URL, or a bare value that is itself DOI-shaped
  // (SAGE emits only `dc.Identifier` with the bare DOI and no citation_doi at all). A page may
  // carry several, so every tag of that name is tried in order.
  for (const t of tags) {
    if (!t || typeof t.name !== 'string' || typeof t.content !== 'string') continue;
    if (t.name.toLowerCase() !== 'dc.identifier') continue;
    const c = t.content.trim();
    if (/^doi:/i.test(c) || /^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i.test(c) || /^10\.\d{4,9}\//.test(c)) {
      const doi = normalizeDoi(c);
      if (doi) return { kind: 'doi', value: doi };
    }
  }

  const prismDoi = normalizeDoi(first('prism.doi'));
  if (prismDoi) return { kind: 'doi', value: prismDoi };

  return null;
}

function detectFromUrl(url) {
  if (typeof url !== 'string') return null;
  let u;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();

  if (host === 'pubmed.ncbi.nlm.nih.gov') {
    const m = u.pathname.match(PMID_PATH);
    const pmid = m && normalizePmid(m[1]);
    if (pmid) return { kind: 'pmid', value: pmid };
    return null;
  }

  if (DOI_HOSTS.has(host)) {
    let path = u.pathname.replace(/^\//, '');
    try {
      path = decodeURIComponent(path);
    } catch {
      // A malformed percent escape is not a DOI we can use; fall through with the raw path.
    }
    const doi = normalizeDoi(path);
    if (doi) return { kind: 'doi', value: doi };
  }

  return null;
}
