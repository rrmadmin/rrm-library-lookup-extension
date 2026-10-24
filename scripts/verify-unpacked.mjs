#!/usr/bin/env node
// Loads the unpacked extension into a THROWAWAY Chromium profile and drives the eight manual
// checks of the plan (Task 11 Step 5), then composes the three store screenshots (Task 12 Step 3).
// Writes docs/verification/<date>/*.png, docs/verification/<date>/results.json and
// store/screenshots/0{1,2,3}-*.png. Never touches a real browser profile: the profile is a fresh
// mkdtemp directory under PROFILE_ROOT (default os.tmpdir()) and is deleted at the end.
//
// Playwright is not a dependency of this repo. Point PLAYWRIGHT_DIR at any installed copy, e.g.
//   PLAYWRIGHT_DIR=~/iCode/projects/rrm-academy-cf/node_modules/playwright \
//   PROFILE_ROOT=<scratch dir> node scripts/verify-unpacked.mjs
// sharp (a devDependency, used for the icons) composes the store shots.
//
// How the popup and panel are driven: Playwright cannot click the toolbar action, so popup.html
// and sidepanel.html are opened as ordinary tabs in the same window and reloaded to simulate a
// fresh open, while the paper tab is kept ACTIVE (both views ask for the active tab). One effect
// of that: the activeTab permission a real toolbar click grants is never granted here, so
// "Check this page" on a host outside host_permissions cannot read the page in this harness.

import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = dirname(dirname(fileURLToPath(import.meta.url)));
const DATE = process.env.VERIFY_DATE || new Date().toISOString().slice(0, 10);
const OUT = join(repo, 'docs', 'verification', DATE);
const STORE = join(repo, 'store', 'screenshots');
const PROFILE_ROOT = process.env.PROFILE_ROOT || tmpdir();

const BOLTZ_PMID = '28379830';
const BOLTZ_DOI_URL = 'https://doi.org/10.3122/jabfm.2017.02.160184';
const BOLTZ_TITLE = 'Fertility Treatment, Use of in Vitro Fertilization, and Time to Live Birth Based on Initial Provider Type';
const NO_SYNOPSIS_PMID = process.env.NO_SYNOPSIS_PMID || '16793945'; // found, no synopsis (checked against the live route 2026-10-24)
const NOT_FOUND_PMID = process.env.NOT_FOUND_PMID || '42917776'; // a battery-electrolyte paper, not in the library
const SEARCH_URL = 'https://pubmed.ncbi.nlm.nih.gov/?term=endometriosis';
// Repository pages outside the host list, first one that loads wins (the Harvard hosts sometimes
// refuse a fresh automated profile).
const UNSUPPORTED_URLS = ['https://arxiv.org/abs/2301.00001', 'https://dash.harvard.edu/', 'https://scholar.harvard.edu/', 'https://www.biorxiv.org/'];
const RRMA_PAPER_URL = 'https://rrmacademy.org/library/fertility-treatment-use-of-in-vitro-fertilization-and-time-to-live-birth-based-o-reck8jozujuq5hshh/';
const PANEL_PMIDS = [BOLTZ_PMID, '26439038', '30916627'];
const RANDOM_SENTENCE = 'The quick brown fox jumped over seventeen lazy dogs beside a quiet river on Tuesday';
const pubmed = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

async function loadPlaywright() {
  const tries = ['playwright'];
  if (process.env.PLAYWRIGHT_DIR) tries.unshift(pathToFileURL(join(process.env.PLAYWRIGHT_DIR, 'index.mjs')).href);
  for (const t of tries) {
    try {
      return await import(t);
    } catch {
      // try the next one
    }
  }
  throw new Error('playwright not found: set PLAYWRIGHT_DIR to an installed node_modules/playwright');
}
async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    return null;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 8000, interval = 50 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return { value: v, ms: Date.now() - t0 };
    if (Date.now() - t0 > timeout) return { value: null, ms: Date.now() - t0 };
    await sleep(interval);
  }
}

const results = [];
function record(n, name, verdict, observed) {
  results.push({ n, name, verdict, observed });
  console.log(`[${n}] ${verdict}: ${name}\n    ${observed.replace(/\n/g, '\n    ')}`);
}

const { chromium } = await loadPlaywright();
const sharp = await loadSharp();
mkdirSync(OUT, { recursive: true });
mkdirSync(STORE, { recursive: true });
const profile = mkdtempSync(join(PROFILE_ROOT, 'rrm-ext-verify-profile-'));
console.log('profile', profile);

const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1280, height: 800 },
  // The HTTP cache goes inside the throwaway profile too, so nothing outlives the run.
  args: [`--disable-extensions-except=${repo}`, `--load-extension=${repo}`, `--disk-cache-dir=${join(profile, 'cache')}`],
});

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extId = new URL(sw.url()).host;
  const browserVersion = context.browser() ? context.browser().version() : 'unknown';
  console.log('chromium', browserVersion, 'extension', extId);
  results.environment = { chromium: browserVersion, extensionId: extId, serviceWorker: sw.url(), date: DATE };

  // --- service worker helpers -----------------------------------------------------------------
  const tabsAll = () => sw.evaluate(() => chrome.tabs.query({}));
  const badge = (tabId) => sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  const mirror = async (tabId) => {
    const saved = await sw.evaluate(() => chrome.storage.session.get('tabs'));
    return saved && saved.tabs ? saved.tabs[String(tabId)] || null : null;
  };
  const activate = (tabId) => sw.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  // Counts the worker's fetch calls. api.js resolves `fetch` from the global at call time, so a
  // wrapper on globalThis sees every lookup. Reinstalled if the worker restarted.
  const resetFetchLog = () =>
    sw.evaluate(() => {
      if (!globalThis.__rrmFetchLog) {
        const orig = globalThis.fetch;
        globalThis.__rrmFetchLog = [];
        globalThis.fetch = (...a) => {
          const row = { url: String(a[0] && a[0].url ? a[0].url : a[0]), t: Date.now(), outcome: 'pending' };
          globalThis.__rrmFetchLog.push(row);
          const p = orig(...a);
          p.then(
            (r) => {
              row.outcome = `HTTP ${r.status} after ${Date.now() - row.t} ms`;
            },
            (e) => {
              row.outcome = `threw ${e && e.message} after ${Date.now() - row.t} ms`;
            },
          );
          return p;
        };
      }
      globalThis.__rrmFetchLog.length = 0;
    });
  const fetchLog = () => sw.evaluate(() => globalThis.__rrmFetchLog || 'counter lost (worker restarted)');
  const fetchSummary = (log) => (Array.isArray(log) ? `${log.length} (${log.map((f) => `${decodeURIComponent(f.url).replace('https://rrmacademy.org/api/library/lookup', '')} ${f.outcome}`).join('; ')})` : String(log));
  // Logs every runtime message the worker receives (type, sender frame and document lifecycle).
  await sw.evaluate(() => {
    globalThis.__rrmMsgs = [];
    chrome.runtime.onMessage.addListener((msg, sender) => {
      globalThis.__rrmMsgs.push({ type: msg && msg.type, frameId: sender.frameId, url: sender.url, lifecycle: sender.documentLifecycle, t: Date.now() });
      return false;
    });
  });
  const resetMsgLog = () => sw.evaluate(() => (globalThis.__rrmMsgs ? (globalThis.__rrmMsgs.length = 0) : null));
  const msgLog = () => sw.evaluate(() => (globalThis.__rrmMsgs || []).map((m) => `${m.type}${m.frameId !== undefined ? ` frame ${m.frameId}` : ''}${m.lifecycle ? ` ${m.lifecycle}` : ''}${m.url ? ` ${m.url.slice(0, 60)}` : ''}`));
  const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map((x) => x.trim())) : null;
  const want = (n) => !ONLY || ONLY.has(String(n));

  // --- pages ------------------------------------------------------------------------------------
  const paper = context.pages()[0];
  // Without the tabs permission the worker sees tab.url only for host-permitted pages, so the
  // paper tab is found by parking it on rrmacademy.org first.
  await paper.goto('https://rrmacademy.org/extension/', { waitUntil: 'commit' });
  const popup = await context.newPage();
  // 360 px is the popup's width (shell.css); a short viewport lets a fullPage screenshot measure
  // the card's own height, the way Chrome sizes the real popup to its content.
  await popup.setViewportSize({ width: 360, height: 100 });
  await popup.goto(`chrome-extension://${extId}/src/popup.html`);
  let paperTabId = null;
  {
    const found = await waitFor(async () => (await tabsAll()).find((t) => (t.url || '').startsWith('https://rrmacademy.org/')), { timeout: 10000 });
    if (!found.value) throw new Error('paper tab not found');
    paperTabId = found.value.id;
  }
  await activate(paperTabId);
  console.log('paper tab', paperTabId);

  // Bounded reads: a locator call that waits 30 s for a re-rendering card would stall a scenario.
  const txt = (loc) => loc.innerText({ timeout: 2000 }).catch(() => '');
  async function cardOf(page) {
    const card = page.locator('.rrm-card');
    if ((await card.count()) === 0) return { kind: 'EMPTY', text: '' };
    return { kind: await card.getAttribute('data-state', { timeout: 2000 }).catch(() => 'EMPTY'), text: (await txt(page.locator('#root'))).replace(/\s+/g, ' ').trim() };
  }
  // Simulates opening the popup: reload the page and wait for a settled card.
  async function openPopup({ settle = 8000 } = {}) {
    await popup.reload();
    await popup.waitForSelector('.rrm-card');
    await waitFor(async () => (await cardOf(popup)).kind !== 'loading', { timeout: settle });
    return cardOf(popup);
  }
  const shot = (page, name, opts = {}) => page.screenshot({ path: join(OUT, name), ...opts });
  const popupShot = (name) => shot(popup, name, { fullPage: true });

  // Navigates the paper tab and reports when the badge lit, relative to commit and to load.
  async function openPaper(url, { want = 'RRM', timeout = 8000 } = {}) {
    await resetFetchLog();
    await resetMsgLog();
    let tLoad = null;
    paper.once('load', () => {
      tLoad = Date.now();
    });
    const tCommit = Date.now();
    await paper.goto(url, { waitUntil: 'commit' });
    const seen = await waitFor(async () => ((await badge(paperTabId)) === want ? Date.now() : null), { timeout });
    await paper.waitForLoadState('load').catch(() => {});
    if (!tLoad) tLoad = Date.now();
    return {
      badge: seen.value ? want : await badge(paperTabId),
      fromCommitMs: seen.value ? seen.value - tCommit : null,
      fromLoadMs: seen.value ? seen.value - tLoad : null,
      loadMs: tLoad - tCommit,
    };
  }

  // 1 ------------------------------------------------------------------------------------------
  if (want(1)) {
    const hops = [];
    const onResp = (r) => {
      if (r.request().isNavigationRequest() && r.request().frame() === paper.mainFrame()) hops.push(`${r.status()} ${r.url()}`);
    };
    paper.on('response', onResp);
    const b = await openPaper(pubmed(BOLTZ_PMID));
    await sleep(1500); // PubMed may serve a reCAPTCHA interstitial first and then the real page
    paper.off('response', onResp);
    const card = await openPopup();
    const eyebrow = (await popup.locator('.rrm-eyebrow').first().evaluate((el) => el.textContent)).trim(); // textContent: CSS uppercases it
    const headline = (await txt(popup.locator('.rrm-headline'))).trim();
    const chip = (await txt(popup.locator('.rrm-chip--grade'))).trim();
    const summary = (await txt(popup.locator('.rrm-summary'))).trim();
    const relatedN = await popup.locator('.rrm-related li').count();
    const readHref = await popup.locator('a.rrm-button').getAttribute('href');
    const copyBtn = popup.locator('.rrm-copy');
    const copyLabel0 = (await txt(copyBtn)).trim();
    await shot(paper, '01-paper-boltz.png');
    await popupShot('01-popup-found.png');
    // Records what the view hands to the clipboard and whether Chromium accepted the write; a
    // clipboard READ would raise a permission prompt in a background tab and stall the run.
    await popup.evaluate(() => {
      const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
      window.__clip = { text: null, result: 'not called' };
      navigator.clipboard.writeText = (t) => {
        window.__clip.text = t;
        return orig(t).then(
          () => {
            window.__clip.result = 'written';
          },
          (e) => {
            window.__clip.result = `rejected: ${e && e.message}`;
          },
        );
      };
    });
    await copyBtn.click();
    const flipped = await waitFor(async () => ((await txt(copyBtn)).trim() === 'Copied' ? 'Copied' : null), { timeout: 1000 });
    await popupShot('01-popup-copied.png');
    await sleep(300);
    const clipSeen = await popup.evaluate(() => window.__clip);
    const entry1 = await mirror(paperTabId);
    const citation = entry1 && entry1.state.record ? entry1.state.record.citation : null;
    const clip = clipSeen.text === null ? 'writeText never called' : `writeText got ${clipSeen.text === citation ? 'the APA citation' : JSON.stringify(clipSeen.text.slice(0, 60))} (${clipSeen.result})`;
    const reverted = await waitFor(async () => ((await txt(copyBtn)).trim() === copyLabel0 ? true : null), { timeout: 3000 });
    const fetches = await fetchLog();
    const ok = b.badge === 'RRM' && b.fromLoadMs !== null && b.fromLoadMs <= 2000 && card.kind === 'found' && eyebrow === 'In the RRM Research Library' && headline && chip === '5 - Core RRM' && summary && relatedN === 3 && /rrmacademy\.org\/library\//.test(readHref || '') && flipped.value === 'Copied';
    record(
      1,
      'Boltz on PubMed: badge, found card, Copy citation',
      ok ? 'PASS' : 'FAIL',
      `badge "${b.badge}" ${b.fromLoadMs} ms after load (${b.fromCommitMs} ms after commit; PubMed load took ${b.loadMs} ms); card=${card.kind}; eyebrow "${eyebrow}"; headline "${headline}"; chip "${chip}"; summary ${summary.length} chars; related ${relatedN}; Read href ${readHref}; Copy label "${copyLabel0}" -> "${flipped.value || (await txt(copyBtn))}" in ${flipped.ms} ms, reverted ${reverted.value ? 'yes' : 'no'}; ${clip}; navigation chain: ${hops.join(' -> ')}; worker fetches ${fetchSummary(fetches)}; worker messages: ${(await msgLog()).filter((m) => m.startsWith('DETECTED')).join(', ')}`,
    );
    // Bonus: can the REAL popup be opened programmatically? (informational only)
    const realPopup = context.waitForEvent('page', { timeout: 3000 }).catch(() => null);
    const opened = await sw.evaluate(async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab) await chrome.windows.update(tab.windowId, { focused: true });
        await chrome.action.openPopup();
        return 'opened';
      } catch (e) {
        return `refused: ${e.message}`;
      }
    });
    const real = await realPopup;
    results.realPopup = `chrome.action.openPopup() ${opened}; Playwright saw ${real ? real.url() : 'no new page'}`;
    if (real) {
      await real.waitForTimeout(1500);
      await real.screenshot({ path: join(OUT, '01-real-popup.png') }).catch(() => {});
      await real.close().catch(() => {});
    }
    await activate(paperTabId);
  }

  // 2 ------------------------------------------------------------------------------------------
  if (want(2)) {
    const b = await openPaper(pubmed(NO_SYNOPSIS_PMID));
    const card = await openPopup();
    const headline = (await txt(popup.locator('.rrm-headline'))).trim();
    const muted = (await txt(popup.locator('.rrm-muted'))).trim();
    const summaryN = await popup.locator('.rrm-summary').count();
    const entry = await mirror(paperTabId);
    const title = entry && entry.state.record ? entry.state.record.title : '';
    await shot(paper, '02-paper-no-synopsis.png');
    await popupShot('02-popup-no-synopsis.png');
    const ok = b.badge === 'RRM' && card.kind === 'found' && headline === title && muted === 'Synopsis not yet written.' && summaryN === 0;
    record(2, `Published record without a synopsis (PMID ${NO_SYNOPSIS_PMID})`, ok ? 'PASS' : 'FAIL', `badge "${b.badge}" ${b.fromLoadMs} ms after load; card=${card.kind}; headline "${headline}" (record title "${title}"); muted line "${muted}"; summary blocks ${summaryN}`);
  }

  // 3 ------------------------------------------------------------------------------------------
  if (want(3)) {
    const b = await openPaper(SEARCH_URL, { want: 'RRM', timeout: 3000 });
    await sleep(1500);
    const badgeNow = await badge(paperTabId);
    const entry = await mirror(paperTabId);
    const card = await openPopup();
    const buttons = await popup.locator('button').count();
    const fetches = await fetchLog();
    await shot(paper, '03-paper-search.png');
    await popupShot('03-popup-no-paper.png');
    const ok = badgeNow === '' && card.kind === 'noPaper' && buttons === 0 && /Open a paper/.test(card.text) && Array.isArray(fetches) && fetches.length === 0;
    record(3, 'PubMed search page: no badge, "Open a paper", no Check button', ok ? 'PASS' : 'FAIL', `badge "${badgeNow}" (waited ${b.fromCommitMs === null ? 'full' : ''} 3 s + 1.5 s); worker entry ${JSON.stringify(entry && entry.state)}; card=${card.kind}; buttons ${buttons}; text "${card.text}"; worker fetches ${Array.isArray(fetches) ? fetches.length : fetches}`);
  }

  // 4 ------------------------------------------------------------------------------------------
  if (want(4)) {
    const hops = [];
    const onResp = (r) => {
      if (r.request().isNavigationRequest() && r.request().frame() === paper.mainFrame()) hops.push(`${r.status()} ${r.url()}`);
    };
    paper.on('response', onResp);
    const b = await openPaper(BOLTZ_DOI_URL, { timeout: 4000 });
    await sleep(2000);
    paper.off('response', onResp);
    const badgeNow = await badge(paperTabId);
    const finalUrl = paper.url();
    const entry = await mirror(paperTabId);
    const fetches = await fetchLog();
    const card = await openPopup();
    const checkBtn = popup.locator('button.rrm-button');
    const hasCheck = (await checkBtn.count()) === 1;
    await shot(paper, '04-paper-doi-redirect.png');
    await popupShot('04-popup-after-redirect.png');
    let afterCheck = null;
    if (hasCheck) {
      await resetFetchLog();
      await checkBtn.click();
      await waitFor(async () => (await cardOf(popup)).kind !== 'loading', { timeout: 8000 });
      afterCheck = { card: await cardOf(popup), fetches: await fetchLog() };
      await popupShot('04-popup-after-check.png');
    }
    const finalHost = new URL(finalUrl).host;
    const ok = badgeNow === '' && Array.isArray(fetches) && fetches.length === 0 && card.kind === 'noPaper' && hasCheck;
    record(
      4,
      'doi.org link that redirects off the host list',
      ok ? 'PASS' : 'FAIL',
      `redirect chain: ${hops.join(' -> ') || '(none captured)'}; final ${finalUrl}; badge "${badgeNow}" (${b.badge ? `lit after ${b.fromCommitMs} ms` : 'never lit'}); worker entry ${JSON.stringify(entry && entry.state)}; lookups fired by the doi.org pattern: ${Array.isArray(fetches) ? fetches.length : fetches}; popup card=${card.kind} with Check button ${hasCheck}; ${afterCheck ? `after Check: card=${afterCheck.card.kind} "${afterCheck.card.text}", fetches ${Array.isArray(afterCheck.fetches) ? afterCheck.fetches.length : afterCheck.fetches} (${finalHost} is outside host_permissions and this harness cannot grant activeTab)` : ''}`,
    );
  }

  // 5 ------------------------------------------------------------------------------------------
  if (want(5)) {
    let usedUrl = null;
    for (const u of UNSUPPORTED_URLS) {
      try {
        const resp = await paper.goto(u, { waitUntil: 'load', timeout: 20000 });
        if (resp && resp.status() < 400) {
          usedUrl = `${u} (HTTP ${resp.status()})`;
          break;
        }
      } catch {
        // try the next host
      }
    }
    if (!usedUrl) throw new Error('no unsupported host loaded');
    await sleep(1500);
    const badgeA = await badge(paperTabId);
    const cardA = await openPopup();
    const btnA = popup.locator('button.rrm-button');
    const hasCheckA = (await btnA.count()) === 1 && (await txt(btnA)).trim() === 'Check this page';
    await shot(paper, '05-paper-unsupported.png');
    await popupShot('05-popup-check-offered.png');
    await resetFetchLog();
    if (hasCheckA) await btnA.click();
    await waitFor(async () => (await cardOf(popup)).kind !== 'loading', { timeout: 8000 });
    const afterA = await cardOf(popup);
    const fetchesA = await fetchLog();
    await popupShot('05-popup-after-check-unsupported.png');

    // Second half: a host the extension may read (host_permissions) that the content script does
    // not cover, so the Check path runs end to end without the activeTab grant.
    await paper.goto(RRMA_PAPER_URL, { waitUntil: 'load' });
    await sleep(1000);
    const badgeB = await badge(paperTabId);
    const cardB = await openPopup();
    const btnB = popup.locator('button.rrm-button');
    const hasCheckB = (await btnB.count()) === 1;
    await resetFetchLog();
    if (hasCheckB) await btnB.click();
    await waitFor(async () => (await cardOf(popup)).kind !== 'loading' && (await cardOf(popup)).kind !== 'noPaper', { timeout: 8000 });
    const afterB = await cardOf(popup);
    const fetchesB = await fetchLog();
    const badgeB2 = await badge(paperTabId);
    await shot(paper, '05-paper-rrma-library.png');
    await popupShot('05-popup-after-check-rrma.png');
    const ok = badgeA === '' && cardA.kind === 'noPaper' && hasCheckA && badgeB === '' && hasCheckB && afterB.kind === 'found' && Array.isArray(fetchesB) && fetchesB.length === 1;
    record(
      5,
      'Unsupported host: no badge, "Check this page", one lookup on click',
      ok ? 'PASS' : 'FAIL',
      `${usedUrl}: badge "${badgeA}"; popup card=${cardA.kind}, Check button ${hasCheckA}; after click: card=${afterA.kind} "${afterA.text}", worker fetches ${Array.isArray(fetchesA) ? fetchesA.length : fetchesA} (no activeTab grant in this harness, so the page could not be read; a real toolbar click grants it).\n${RRMA_PAPER_URL} (in host_permissions, not a content-script host): badge "${badgeB}", Check button ${hasCheckB}; after click: card=${afterB.kind}, worker fetches ${Array.isArray(fetchesB) ? fetchesB.map((f) => f.url).join(', ') : fetchesB}; badge now "${badgeB2}"`,
    );
  }

  // 6 ------------------------------------------------------------------------------------------
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 800 });
  await panel.goto(`chrome-extension://${extId}/src/sidepanel.html`);
  await activate(paperTabId);
  if (want(6)) {
    await paper.goto(pubmed(PANEL_PMIDS[0]), { waitUntil: 'load' });
    await waitFor(async () => (await cardOf(panel)).kind === 'found', { timeout: 8000 });
    // Record every card the panel shows from here on.
    await panel.evaluate(() => {
      const root = document.getElementById('root');
      const read = () => {
        const c = root.querySelector('.rrm-card');
        const h = c && c.querySelector('.rrm-headline');
        return { t: Math.round(performance.now()), kind: c ? c.dataset.state : 'EMPTY', headline: h ? h.textContent : '' };
      };
      window.__rrmStates = [read()];
      new MutationObserver(() => {
        const s = read();
        const last = window.__rrmStates[window.__rrmStates.length - 1];
        if (s.kind !== last.kind || s.headline !== last.headline) window.__rrmStates.push(s);
      }).observe(root, { childList: true, subtree: true });
    });
    const follow = [];
    for (let i = 0; i < PANEL_PMIDS.length; i++) {
      const pmid = PANEL_PMIDS[i];
      const t0 = Date.now();
      await paper.goto(pubmed(pmid), { waitUntil: 'commit' });
      const expected = await waitFor(async () => {
        const e = await mirror(paperTabId);
        return e && e.state.kind === 'found' ? e.state.record : null;
      }, { timeout: 10000 });
      const want = expected.value ? expected.value.synopsisTitle || expected.value.title : null;
      const shown = await waitFor(async () => ((await txt(panel.locator('.rrm-headline'))).trim() === want ? true : null), { timeout: 8000 });
      await paper.waitForLoadState('load').catch(() => {});
      await shot(panel, `06-panel-${i + 1}-${pmid}.png`);
      follow.push(`${pmid}: panel showed "${want}" ${shown.value ? `${Date.now() - t0} ms after navigation` : 'NOT shown within 8 s'}`);
    }
    const states = await panel.evaluate(() => window.__rrmStates);
    const kinds = states.map((s) => s.kind);
    const blank = kinds.filter((k) => k !== 'found');
    const ok = follow.every((f) => /ms after navigation/.test(f)) && blank.length === 0 && states.length >= PANEL_PMIDS.length;
    record(6, 'Side panel follows three PubMed papers with no blank between', ok ? 'PASS' : 'FAIL', `${follow.join('; ')}; panel card sequence: ${states.map((s) => `${s.kind}${s.headline ? ` "${s.headline.slice(0, 40)}"` : ''}`).join(' -> ')}; non-found frames: ${blank.length}`);
  }

  // 7 ------------------------------------------------------------------------------------------
  if (want(7)) {
    const send = (text) =>
      panel.evaluate(({ tabId, text }) => chrome.runtime.sendMessage({ type: 'LOOKUP_SELECTION', tabId, text }), { tabId: paperTabId, text });
    await resetFetchLog();
    const a = await send(BOLTZ_TITLE);
    await waitFor(async () => (await cardOf(panel)).kind !== 'loading', { timeout: 8000 });
    const cardA = await cardOf(panel);
    const fetchesA = await fetchLog();
    await shot(panel, '07-panel-selection-title.png');
    await resetFetchLog();
    const b = await send(RANDOM_SENTENCE);
    await waitFor(async () => (await cardOf(panel)).kind !== 'loading' && (await cardOf(panel)).kind !== 'found', { timeout: 8000 });
    const cardB = await cardOf(panel);
    const fetchesB = await fetchLog();
    const candidatesB = await panel.locator('.rrm-candidates li').count();
    await shot(panel, '07-panel-selection-random.png');
    const ok = a && a.entry && cardA.kind === 'found' && /Boltz|generalist|IVF/i.test(cardA.text) && b && b.entry && cardB.kind === 'notFound';
    record(
      7,
      'Context-menu lookup (message sent directly; the real right-click was not exercised)',
      ok ? 'PASS' : 'FAIL',
      `title selection: worker answered state=${a && a.entry ? a.entry.state.kind : '?'}, identifier ${JSON.stringify(a && a.entry && a.entry.identifier)}, fetch ${Array.isArray(fetchesA) ? fetchesA.map((f) => decodeURIComponent(f.url).slice(0, 120)).join(', ') : fetchesA}; panel card=${cardA.kind} "${cardA.text.slice(0, 120)}".\nrandom sentence: state=${b && b.entry ? b.entry.state.kind : '?'}, candidates ${candidatesB}${candidatesB ? ' ("Did you mean")' : ' (plain not-found)'}; panel card=${cardB.kind} "${cardB.text.slice(0, 160)}"; fetch ${Array.isArray(fetchesB) ? fetchesB.length : fetchesB}`,
    );
  }

  // 8 ------------------------------------------------------------------------------------------
  if (want(8)) {
    // Offline, no page loads, so no content script runs; the lookup is forced through the two
    // paths a reader has: the popup's check of the page already open, and a selection lookup.
    // Chrome hands a lookup it answered seconds ago back from its copy of the response even
    // offline (same cf-ray), so the counted request uses an identifier this run never fetched.
    await paper.goto(pubmed(BOLTZ_PMID), { waitUntil: 'load' });
    await waitFor(async () => (await badge(paperTabId)) === 'RRM', { timeout: 8000 });
    await context.setOffline(true);
    await sleep(500);
    const probe = await sw.evaluate(async () => {
      try {
        const r = await fetch('https://rrmacademy.org/api/library/lookup?pmid=2');
        return `a direct worker fetch still answered HTTP ${r.status}`;
      } catch (e) {
        return `a direct worker fetch threw "${e.message}"`;
      }
    });
    await resetFetchLog();
    const check = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'CHECK_ACTIVE_TAB', tabId }), paperTabId);
    const checkFetches = await fetchLog();
    await resetFetchLog();
    await resetMsgLog();
    const t0 = Date.now();
    const answer = await popup.evaluate((tabId) => chrome.runtime.sendMessage({ type: 'LOOKUP_SELECTION', tabId, text: '10.1016/j.fertnstert.2019.01.001' }), paperTabId);
    const tAnswer = Date.now() - t0;
    const card = await openPopup();
    await sleep(5000); // a retry loop would show up here
    const fetches = await fetchLog();
    const badgeNow = await badge(paperTabId);
    await popupShot('08-popup-offline.png');
    await context.setOffline(false);
    const ok = answer && answer.entry && answer.entry.state.kind === 'error' && card.kind === 'error' && card.text === "Couldn't reach the RRM Research Library. Try again." && Array.isArray(fetches) && fetches.length === 1 && /threw/.test(fetches[0].outcome) && badgeNow === '';
    record(
      8,
      'Offline: error line, exactly one request, no retry',
      ok ? 'PASS' : 'FAIL',
      `context.setOffline(true): ${probe}. Check of the already-looked-up PubMed page: state=${check && check.entry ? check.entry.state.kind : '?'}, fetch ${fetchSummary(checkFetches)} (Chrome reused its copy of the response). Selection lookup of a DOI never fetched in this run: worker answered state=${answer && answer.entry ? answer.entry.state.kind : JSON.stringify(answer)} in ${tAnswer} ms; popup card=${card.kind} "${card.text}"; worker fetch attempts over the next 5 s: ${fetchSummary(fetches)}; badge "${badgeNow}"`,
    );
  }

  // --- store screenshots (1280x800) ---------------------------------------------------------------
  const storeNotes = [];
  if (sharp && !ONLY) {
    const popupPng = async (name) => {
      const buf = await popup.screenshot({ fullPage: true });
      return buf;
    };
    // Floating popup over the page, anchored where the toolbar popup opens (top right).
    async function composeFound(file, pageBuf, popupBuf) {
      const meta = await sharp(popupBuf).metadata();
      const pad = 18;
      const shadowed = await sharp({ create: { width: meta.width + pad * 2, height: meta.height + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: await sharp({ create: { width: meta.width, height: meta.height, channels: 4, background: { r: 20, g: 14, b: 28, alpha: 0.28 } } }).png().toBuffer(), left: pad, top: pad + 4 }])
        .blur(8)
        .png()
        .toBuffer();
      const framed = await sharp(popupBuf)
        .extend({ top: 1, bottom: 1, left: 1, right: 1, background: { r: 205, g: 196, b: 212, alpha: 1 } })
        .png()
        .toBuffer();
      const left = 1280 - meta.width - 24;
      await sharp(pageBuf)
        .composite([
          { input: shadowed, left: left - pad, top: 8 - pad },
          { input: framed, left: left - 1, top: 7 },
        ])
        .png()
        .toFile(file);
    }
    // 01: Boltz found
    await paper.goto(pubmed(BOLTZ_PMID), { waitUntil: 'load' });
    await waitFor(async () => (await badge(paperTabId)) === 'RRM', { timeout: 8000 });
    await openPopup();
    await composeFound(join(STORE, '01-found.png'), await paper.screenshot(), await popupPng());
    storeNotes.push('01-found.png: the Boltz PubMed page at 1280x800 with the popup page (360 px wide, full height) composed at the top right where the toolbar popup opens');
    // 02: panel beside the page
    await paper.setViewportSize({ width: 900, height: 800 });
    await panel.setViewportSize({ width: 380, height: 800 });
    await sleep(500);
    await waitFor(async () => (await cardOf(panel)).kind === 'found', { timeout: 8000 });
    const pageBuf = await paper.screenshot();
    const panelBuf = await panel.screenshot();
    await sharp({ create: { width: 1280, height: 800, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
      .composite([
        { input: pageBuf, left: 0, top: 0 },
        { input: await sharp({ create: { width: 1, height: 800, channels: 4, background: { r: 205, g: 196, b: 212, alpha: 1 } } }).png().toBuffer(), left: 900, top: 0 },
        { input: panelBuf, left: 900, top: 0 },
      ])
      .png()
      .toFile(join(STORE, '02-panel.png'));
    storeNotes.push('02-panel.png: the page at 900x800 beside the side panel page at 380x800, as Chrome docks the panel');
    await paper.setViewportSize({ width: 1280, height: 800 });
    // 03: not found
    await paper.goto(pubmed(NOT_FOUND_PMID), { waitUntil: 'load' });
    await sleep(2500);
    const nf = await openPopup();
    const nfBadge = await badge(paperTabId);
    await composeFound(join(STORE, '03-not-found.png'), await paper.screenshot(), await popupPng());
    await popupShot('03-not-found-popup.png');
    storeNotes.push(`03-not-found.png: PubMed ${NOT_FOUND_PMID} (not in the library; badge "${nfBadge}", card=${nf.kind}) with the popup composed as in 01`);
  } else if (!sharp) {
    storeNotes.push('sharp not installed: store screenshots skipped (npm ci, then rerun)');
  }
  results.store = storeNotes;
  await panel.close();
  await popup.close();
} finally {
  // An ONLY rerun replaces just its scenarios in an existing results.json.
  const file = join(OUT, 'results.json');
  let merged = { environment: results.environment, realPopup: results.realPopup, store: results.store, results: [...results] };
  if (process.env.ONLY && existsSync(file)) {
    try {
      const prev = JSON.parse(readFileSync(file, 'utf8'));
      const mine = new Set(results.map((r) => r.n));
      merged = { ...prev, environment: results.environment || prev.environment, results: [...(prev.results || []).filter((r) => !mine.has(r.n)), ...results].sort((a, b) => a.n - b.n) };
    } catch {
      // unreadable previous file: write this run's results alone
    }
  }
  writeFileSync(file, JSON.stringify(merged, null, 2));
  await context.close().catch(() => {});
  rmSync(profile, { recursive: true, force: true });
  console.log('profile removed', profile);
}
