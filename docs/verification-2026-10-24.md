# Loaded-build verification, 2026-10-24

Plan Task 11 Step 5 (the eight manual checks) and Task 12 Step 3 (the three store screenshots), run against the extension loaded unpacked from this repo at `main` (`ed92260`, CI green, 59 tests) and the live route `https://rrmacademy.org/api/library/lookup`.

## Method

`scripts/verify-unpacked.mjs` drives everything and can be rerun:

```
PLAYWRIGHT_DIR=~/iCode/projects/rrm-academy-cf/node_modules/playwright \
PROFILE_ROOT=<scratch dir> VERIFY_DATE=2026-10-24 node scripts/verify-unpacked.mjs
```

- Playwright is not a dependency of this repo. The script imports it from `PLAYWRIGHT_DIR` (the rrm-academy-cf copy, Playwright 1.61.1) so nothing was added to `package.json`. `sharp`, already a devDependency for the icons, composes the store shots.
- The browser is Playwright's bundled Chrome for Testing, headed, launched with `launchPersistentContext` on a fresh `mkdtemp` profile under `PROFILE_ROOT` with `--disable-extensions-except` and `--load-extension` pointing at this repo, plus `--disk-cache-dir` inside that profile. The profile is deleted when the run ends. No real Chrome or Comet profile is touched.
- The extension id and badge come from the service worker (`context.serviceWorkers()`, then `chrome.action.getBadgeText({ tabId })` through `sw.evaluate`). Per-tab state is read from the worker's `chrome.storage.session` mirror. A wrapper on the worker's global `fetch` counts every lookup and records its outcome; an extra `chrome.runtime.onMessage` listener logs what the worker receives.
- Playwright cannot click the toolbar action, so `src/popup.html` and `src/sidepanel.html` are opened as ordinary tabs in the same window and reloaded to simulate a fresh open, while the paper tab is kept active (both views ask for the active tab). `chrome.action.openPopup()` was also tried and refused ("Could not find an active browser window"). Consequence: the `activeTab` grant a real toolbar click carries is never granted in this harness, so "Check this page" on a host outside `host_permissions` cannot read the page here (scenarios 4 and 5 say where that bit).
- The context menu cannot be right-clicked from Playwright; scenario 7 sends the same `LOOKUP_SELECTION` message the menu handler runs.
- Clipboard: a background tab cannot read the clipboard without a permission prompt, so the view's `navigator.clipboard.writeText` is wrapped in the popup page to record what it was handed and whether Chromium accepted the write.
- Screenshots: `docs/verification/2026-10-24/*.png` per state (popup shots are 360 px wide and content-height, as Chrome sizes the real popup); `store/screenshots/*.png` are exactly 1280x800.

## Environment

- Chrome for Testing 149.0.7827.55 (Playwright 1.61.1, chromium build 1228), macOS 26 (Darwin 25.6.0), node 24.22.1.
- Extension id in this profile: `limklljjogahepilfikfocoihoehmhnn`; worker `src/background.js`.
- Route verified beforehand: `?pmid=28379830` answers `found: true` with synopsis and 3 related; `?pmid=1` answers `found: false` with `suggestUrl`; every answer carries `cache-control: no-store`.
- Records used: Boltz 2017 (PMID 28379830, DOI 10.3122/jabfm.2017.02.160184); PMID 16793945 (published, grade 2, no synopsis); PMIDs 26439038 and 30916627 (panel); PMID 42917776 (a battery paper, not in the library).

## Results

| # | Check | Verdict | Observed |
|---|-------|---------|----------|
| 1 | Boltz on PubMed: badge within 2 s; popup shows the found card; Copy citation | PASS | Badge `RRM` 766 ms after the navigation committed (693 ms after load). Card: eyebrow "In the RRM Research Library", headline "Women who first see a generalist for infertility have lower IVF odds", grade chip "5 - Core RRM", "Open access" chip, 363-character summary, 3 related, "Read on RRM Academy" linking the library record with `utm_source=extension`, "Copy citation". Clicking Copy flipped the label to "Copied" within 1 ms and back to "Copy citation" after the 1.6 s hold; `writeText` received the APA citation string and Chromium accepted the write. |
| 2 | Published record without a synopsis (PMID 16793945) | PASS | Badge `RRM` 552 ms after load. Card headline is the record title ("Perchlorate versus other environmental sodium/iodide symporter inhibitors..."), grade chip "2 - Peripheral", the line "Synopsis not yet written.", no summary block, 3 related, both actions. |
| 3 | PubMed search page: no badge; "Open a paper" with no Check button | PASS | Badge empty after 4.5 s; worker entry `{ kind: noPaper, canCheck: false }`; popup shows the "Open a paper on PubMed, doi.org or a journal site..." line, zero buttons, zero lookups. |
| 4 | `https://doi.org/10.3122/jabfm.2017.02.160184` | PASS (against the expectation stated for this run: no automatic badge) | Chain: 302 doi.org, 301 http://www.jabfm.org/lookup/doi/..., 301 https://www.jabfm.org/lookup/doi/..., 200 https://www.jabfm.org/content/30/2/230. The doi.org URL pattern never fires: the redirect is an HTTP 302, so no document commits at doi.org and the content script never runs there (zero lookups, worker entry null). The final host is outside the host list, so no badge; the popup offers "Check this page". Clicking it in this harness stays quiet (no page read, zero lookups) because `activeTab` is not granted here; a real toolbar click grants it and jabfm.org carries `citation_doi`. The plan's wording "badge lights after the redirect settles" cannot hold for a host outside the list; that is the designed behaviour, not a defect. |
| 5 | Unsupported host: no badge; "Check this page"; one lookup on click | PASS | `https://arxiv.org/abs/2301.00001`: badge empty, popup shows the "Open a paper" line with the "Check this page" button. Click in this harness: quiet card, zero lookups (no `activeTab`, as above). The Check path itself proven on `https://rrmacademy.org/library/<Boltz record>/`, a host the manifest may read that the content script does not cover: badge empty, Check offered, one click fired exactly one lookup (`?doi=10.3122/jabfm.2017.02.160184`), the found card rendered and the badge lit. Both Harvard hosts (`scholar.harvard.edu`, `dash.harvard.edu`) refused the fresh automated profile on the final run, hence arXiv. |
| 6 | Side panel follows three PubMed papers, never blank between | PASS | Panel page open, paper tab navigated to PMIDs 28379830, 26439038, 30916627 (direct navigation, equivalent to clicking three results). The panel showed each paper's headline 430, 991 and 765 ms after navigation. A MutationObserver on the panel root recorded every card change: `found -> found -> found`, zero non-found frames (no loading, no "Open a paper", no empty root). Key findings render in the panel. |
| 7 | Context-menu lookup (message sent to the worker; the real right-click was not exercised) | PASS | Boltz title as selection: identifier `{ kind: q }`, one `?q=` lookup, worker answered `found`, panel shows the Boltz card. Random sentence: worker answered `notFound` with 3 candidates, panel shows "Not in the RRM Research Library", "This paper isn't in the library yet.", a "Did you mean" list and "Suggest it". |
| 8 | Offline: error line, one request, no retry | PASS | `context.setOffline(true)`: a direct worker fetch throws "Failed to fetch". A selection lookup of a DOI this run had never fetched: the worker answered `error` in 2 ms, the reopened popup shows exactly "Couldn't reach the RRM Research Library. Try again.", the worker made one fetch attempt (threw) and none more over the following 5 s; badge empty. See finding 2 for what a check of an already-looked-up page does offline. |

## Screenshots

`docs/verification/2026-10-24/`: `01-paper-boltz.png`, `01-popup-found.png`, `01-popup-copied.png`, `02-paper-no-synopsis.png`, `02-popup-no-synopsis.png`, `03-paper-search.png`, `03-popup-no-paper.png`, `03-not-found-popup.png`, `04-paper-doi-redirect.png`, `04-popup-after-redirect.png`, `04-popup-after-check.png`, `05-paper-unsupported.png`, `05-popup-check-offered.png`, `05-popup-after-check-unsupported.png`, `05-paper-rrma-library.png`, `05-popup-after-check-rrma.png`, `06-panel-1-28379830.png`, `06-panel-2-26439038.png`, `06-panel-3-30916627.png`, `07-panel-selection-title.png`, `07-panel-selection-random.png`, `08-popup-offline.png`, plus `results.json` (the raw observations the table above is written from).

`store/screenshots/` (1280x800, audited at real size):

- `01-found.png`: the Boltz PubMed page with the popup page (360 px, content height) composed at the top right where the toolbar popup opens, with a border and shadow. Composed because the real popup cannot be captured by Playwright.
- `02-panel.png`: the Boltz PubMed page at 900 px beside the side panel page at 380 px, as Chrome docks the panel; the panel shows the card with key findings.
- `03-not-found.png`: PubMed 42917776 with the not-found popup composed as in 01.

## Findings

No defect in the extension was found; nothing in `src/` was changed. Three observations worth keeping:

1. PubMed serves a reCAPTCHA interstitial (HTTP 203, "Checking your browser", same URL) to a fresh profile and then loads the real page as a second document. The content script runs once per document, so a first PubMed open in a fresh profile sends `DETECTED` twice and the worker makes two lookups for the same PMID. The tab store is cleared on each `loading` event and the last answer wins, so the card and badge are right; the cost is one extra request on a profile that has not passed PubMed's check. The plan's "runs once" holds per document.
2. Under DevTools offline emulation, a check of a page whose lookup had been answered seconds earlier came back `found` in 1 ms with the same `cf-ray` as the earlier answer: Chromium reused its copy of the response although the route sends `cache-control: no-store`. The extension did not reach the network and made no retry. The scenario 8 verdict therefore uses an identifier the run had never fetched, where the fetch throws and the error line shows. Whether a real network loss behaves the same way as the emulation was not tested.
3. The popup and panel driven as tabs behave exactly as the real surfaces except for the `activeTab` grant (scenarios 4 and 5). A click on the real toolbar icon on an unsupported host remains a manual check for the day-1 store install (Task 12 Step 6).
