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

Loaded-build verification: `scripts/verify-unpacked.mjs` loads the unpacked extension into a throwaway Chromium profile and drives the eight checks of the plan plus the store screenshots. It imports Playwright from `PLAYWRIGHT_DIR` (any installed copy; the repo adds no dependency for it). The latest run and its screenshots: `docs/verification-2026-10-24.md`.

Manifest V3, plain ES modules, no bundler, no framework. Fonts (Cormorant Garamond, Inter) are bundled under the SIL Open Font License; icons are Lucide (ISC). Code is MIT.

## Store status

- Chrome Web Store: submitted 2026-10-24 under publisher RRM Academy (administrator@rrmacademy.org, non-trader); first submission rejected the same night for keyword spam on the publisher-name list in the description, resubmitted with the list removed and pending review. Item ID `hkkbmaapblbpdgklcepdgdkddklecpni`; listing URL once published: https://chromewebstore.google.com/detail/hkkbmaapblbpdgklcepdgdkddklecpni. Category Education, publish automatically after review.
- Microsoft Edge Add-ons: submitted 2026-10-25 (In review) under the same publisher via Partner Center, product `72d2521d-6b8b-443a-9e37-eb7e1ebd410c`, category Productivity, all markets. An empty stray draft `Product_96892440` sits beside it in the dashboard and can be deleted.

Store assets: `store/listing.md` (copy), `store/screenshots/01..03*.png` (1280x800; the store wants 24-bit PNG with no alpha, so flatten before upload), `store/screenshots/promo-tile-440x280.png` (small promo tile, rendered from the 128px icon with the bundled Cormorant Garamond and Inter).

## Architecture

- `src/content.js` runs at `document_idle` on the fixed host list, reads the citation meta tags once (`src/lib/collect.js`), and messages the service worker. It writes nothing to the page.
- `src/background.js` detects the identifier (`src/lib/detect.js`), calls the lookup route (`src/lib/api.js`), keeps per-tab state (`src/lib/state.js`), sets the badge, owns the context menu and the side panel.
- `src/popup.html` and `src/sidepanel.html` render the same card (`src/lib/card.js`, `src/card.css`) through one view module (`src/lib/view.js`) that asks the worker for the active tab's state, owns the clipboard and the "Check this page" message, and re-asks on `TAB_CHANGED`, keeping the last card up until the next answer is in.

The lookup route is `GET https://rrmacademy.org/api/library/lookup?doi=|pmid=|q=` (exactly one), answering `{ v: 1, found, record | candidates }`. Its design is in the rrm-academy-cf repo: `docs/superpowers/specs/2026-10-16-rrm-library-lookup-extension-design.md`.
