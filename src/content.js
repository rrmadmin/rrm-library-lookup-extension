// Content script, run once at document_idle on the fixed host list (manifest.json). It reads the
// page's citation signals and hands them to the service worker as one DETECTED message. It
// writes nothing to the page, watches nothing and never retries; a page that changes its
// identifier without navigating is covered by "Check this page" in the popup.
//
// This is a classic script (MV3 content scripts are not modules), so it cannot import
// src/lib/collect.js and carries the same function. test/content-collect.test.js keeps the two
// bodies identical.

function collectPageSignals(doc = document) {
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

(function detectOnce() {
  let signals;
  try {
    signals = collectPageSignals();
  } catch {
    return;
  }
  // The worker may be asleep or the extension just reloaded; a rejected send is nothing to act on.
  try {
    const sent = chrome.runtime.sendMessage({ type: 'DETECTED', signals });
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch {
    // Extension context invalidated: nothing to do.
  }
})();
