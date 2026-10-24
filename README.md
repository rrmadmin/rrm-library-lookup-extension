# RRM Research Library Lookup

A Chrome and Edge extension that shows the [RRM Research Library](https://rrmacademy.org/library/)'s synopsis, grade and citation for the paper you're reading. Product page and install links: [rrmacademy.org/extension](https://rrmacademy.org/extension/). Privacy: [rrmacademy.org/extension/privacy](https://rrmacademy.org/extension/privacy/).

Open a paper on PubMed, PubMed Central, doi.org or one of the supported journal sites. If the library has it, the toolbar badge lights and one click shows the card: the library's synopsis, its relevance grade, an APA citation you can copy, and up to three related papers. Right-click any selected text on any site to look it up.

## What it is not

No sign-in, no analytics, no cookies, no identifiers. The extension never changes the page you're reading and loads nothing from outside itself except one lookup call to `rrmacademy.org/api/library/lookup`. All content comes from the library at lookup time; the extension itself carries none.

## Development

```
npm ci
npm test          # node --test (test/**/*.test.js)
npm run zip       # dist/rrm-research-library-lookup-<version>.zip
npm run icons     # regenerate src/icons/*.png from the Lucide book-open glyph
```

Load unpacked: `chrome://extensions`, Developer mode, "Load unpacked", pick this folder.

Manifest V3, plain ES modules, no bundler, no framework. Fonts (Cormorant Garamond, Inter) are bundled under the SIL Open Font License; icons are Lucide (ISC). Code is MIT.

## Architecture

- `src/content.js` runs at `document_idle` on the fixed host list, reads the citation meta tags once (`src/lib/collect.js`), and messages the service worker. It writes nothing to the page.
- `src/background.js` detects the identifier (`src/lib/detect.js`), calls the lookup route (`src/lib/api.js`), keeps per-tab state (`src/lib/state.js`), sets the badge, owns the context menu and the side panel.
- `src/popup.html` and `src/sidepanel.html` render the same card (`src/lib/card.js`, `src/card.css`).

The lookup route is `GET https://rrmacademy.org/api/library/lookup?doi=|pmid=|q=` (exactly one), answering `{ v: 1, found, record | candidates }`. Its design is in the rrm-academy-cf repo: `docs/superpowers/specs/2026-10-16-rrm-library-lookup-extension-design.md`.
