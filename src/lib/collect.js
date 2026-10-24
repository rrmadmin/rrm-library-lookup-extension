// The three signals detectIdentifier (detect.js) reads from a page: the URL, the canonical href
// and the citation-style meta tags (spec section 5). Nothing else on the page is read.
//
// background.js injects this function with chrome.scripting.executeScript, which serializes the
// source and runs it inside the page, so the body must close over nothing in this module (the
// test rebuilds it from its source to prove that). src/content.js is a classic script and cannot
// import this file, so it carries a copy of the same function; a test keeps the two identical.

export function collectPageSignals(doc = document) {
  const wanted = /^(citation_|dc\.|dcterms\.|prism\.)/i;
  const metas = [];
  for (const m of doc.querySelectorAll('meta[name]')) {
    const name = m.getAttribute('name') || '';
    if (wanted.test(name)) metas.push({ name, content: m.getAttribute('content') || '' });
  }
  const link = doc.querySelector('link[rel="canonical"]');
  const url = doc.location && doc.location.href ? doc.location.href : doc.URL;
  return { url, canonical: link ? link.getAttribute('href') : null, metas };
}
