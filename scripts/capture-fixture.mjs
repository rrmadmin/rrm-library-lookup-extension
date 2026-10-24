// Captures a detection fixture from one live page: the final URL, the canonical href and the
// citation-style <meta name|content> pairs, and nothing else. No page text is kept.
//
//   node scripts/capture-fixture.mjs <url> [name]
//   node scripts/capture-fixture.mjs --from-html <saved.html> <url> [name]
//
// Writes test/fixtures/<name>.json (name defaults to the final hostname). Metas are limited to
// names starting with citation_, dc., dcterms. or prism. (case-insensitive), minus the ones that
// carry page text or bulk (abstract, description, reference lists, author and keyword lists), so
// a fixture is identifiers and bibliographic labels only. A page that answers
// anything but 200, or a bot challenge, is recorded as { url, captured: false, reason } so the
// fixture loop in test/detect.test.js skips it and the gap stays visible.
//
// Most publishers answer curl with a bot challenge. For those, open the article in a real
// browser, save the page (File > Save Page As, "Webpage, HTML only") and pass the file with
// --from-html plus the URL the browser showed; the same head parser runs and nothing else is
// read from the file.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36';
const META_PREFIX = /^(citation_|dc\.|dcterms\.|prism\.)/i;
// Page text and bulk never go in a fixture; detection reads none of these.
const META_SKIP = /abstract$|description|reference|author|creator|contributor|institution|orcid|keywords|subject|funding|rights|^citation_springer/i;
const CHALLENGE = /just a moment|access denied|verify you are human|are you a robot|captcha|request unsuccessful|enable javascript and cookies/i;

const args = process.argv.slice(2);
const fromHtml = args[0] === '--from-html' ? args[1] : null;
const [requested, nameArg] = fromHtml ? args.slice(2) : args;
if (!requested || (args[0] === '--from-html' && !fromHtml)) {
  console.error('usage: node scripts/capture-fixture.mjs <url> [name]\n       node scripts/capture-fixture.mjs --from-html <saved.html> <url> [name]');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = join(root, 'test', 'fixtures');
mkdirSync(fixtures, { recursive: true });

let status = '200';
let url = requested;
let html = '';
if (fromHtml) {
  html = safeRead(fromHtml);
  if (!html) {
    console.error(`cannot read ${fromHtml}`);
    process.exit(2);
  }
} else {
  const body = join(tmpdir(), `rrm-fixture-${process.pid}.html`);
  try {
    const w = execFileSync('curl', ['-sL', '-A', UA, '--max-time', '30', '-o', body, '-w', '%{http_code} %{url_effective}', requested], {
      encoding: 'utf8',
    });
    [status, url] = w.trim().split(' ', 2);
  } catch (err) {
    write({ url, captured: false, reason: `curl failed: ${err.message.split('\n')[0]}` });
    process.exit(0);
  }
  html = safeRead(body);
  rmSync(body, { force: true });
}
const head = html.slice(0, html.search(/<body[\s>]/i) === -1 ? html.length : html.search(/<body[\s>]/i));
const title = (head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';

if (status !== '200') {
  write({ url, captured: false, reason: `HTTP ${status}` });
  process.exit(0);
}
if (CHALLENGE.test(title)) {
  write({ url, captured: false, reason: `challenge page: ${title.trim()}` });
  process.exit(0);
}

const metas = [];
for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
  const attrs = attributes(tag);
  if (attrs.name && META_PREFIX.test(attrs.name) && !META_SKIP.test(attrs.name) && attrs.content !== undefined) {
    metas.push({ name: attrs.name, content: attrs.content });
  }
}
let canonical = null;
for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
  const attrs = attributes(tag);
  if (attrs.rel && attrs.rel.trim().toLowerCase() === 'canonical' && attrs.href) {
    canonical = attrs.href;
    break;
  }
}

write({ url, canonical, metas });

function attributes(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) {
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[m[1].toLowerCase()] = decode(value);
  }
  return out;
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function safeRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function write(fixture) {
  const name = nameArg || new URL(fixture.url).hostname;
  const file = join(fixtures, `${name}.json`);
  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`);
  const summary = fixture.captured === false ? `not captured (${fixture.reason})` : `${fixture.metas.length} metas, canonical ${fixture.canonical ? 'yes' : 'no'}`;
  console.log(`${name}: ${summary} <- ${fixture.url}`);
}
