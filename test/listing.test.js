import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const md = readFileSync(join(root, 'store', 'listing.md'), 'utf8');

// The listing is a sequence of "# Heading" blocks; each section is the text up to the next one.
const sections = new Map();
for (const block of md.split(/^# /m).slice(1)) {
  const nl = block.indexOf('\n');
  sections.set(block.slice(0, nl).trim(), block.slice(nl + 1).trim());
}
function section(name) {
  assert.ok(sections.has(name), `listing.md has no "# ${name}" section`);
  return sections.get(name);
}

test('listing name equals the manifest name and the subtitle is the spec line', () => {
  assert.equal(section('Name'), m.name);
  assert.equal(section('Subtitle'), "The RRM Research Library's synopsis for the paper you're reading");
});

test('description names no PubMed, NLM, NIH or publisher in its first sentence, and says it works on PubMed later', () => {
  const desc = section('Description');
  const first = desc.split(/(?<=[.?!])\s/)[0];
  assert.ok(!/pubmed|nlm|nih|elsevier|springer|wiley/i.test(first), `first sentence: ${first}`);
  assert.match(desc, /PubMed/);
  assert.ok(desc.length <= 16000);
  assert.ok(!/—/.test(md), 'no em dashes');
});

test('privacy, support, category, single purpose and data use are present', () => {
  assert.equal(section('Privacy policy URL'), 'https://rrmacademy.org/extension/privacy/');
  assert.equal(section('Support URL'), 'https://rrmacademy.org/contact/');
  assert.equal(section('Category'), 'Productivity');
  assert.match(section('Single purpose'), /one purpose/);
  assert.match(section('Data use'), /rrmacademy\.org/);
  assert.equal(section('Screenshot captions').split('\n').filter((l) => /^\d\./.test(l)).length, 3);
});
