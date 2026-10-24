import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('manifest matches the spec constraints', () => {
  assert.equal(m.manifest_version, 3);
  assert.equal(m.name, 'RRM Research Library Lookup');
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'contextMenus', 'scripting', 'sidePanel', 'storage']);
  assert.equal(m.optional_host_permissions, undefined);
  assert.ok(m.host_permissions.includes('https://pubmed.ncbi.nlm.nih.gov/*'));
  assert.ok(m.host_permissions.includes('https://rrmacademy.org/*'));
  assert.ok(!/pubmed|nlm|nih/i.test(m.name));
  assert.ok(!/pubmed|nlm|nih|publisher/i.test(m.description.split(' ').slice(0, 3).join(' ')));
  assert.ok(m.description.length <= 132, 'Chrome Web Store caps the manifest description at 132 characters');
  assert.equal(m.background.type, 'module');
  assert.equal(m.minimum_chrome_version, '116');
  for (const cs of m.content_scripts) assert.equal(cs.run_at, 'document_idle');
});

test('the content scripts run on every host the extension may badge, and nowhere else', () => {
  const contentHosts = new Set(m.content_scripts.flatMap((cs) => cs.matches));
  for (const h of contentHosts) assert.ok(m.host_permissions.includes(h), `${h} runs a content script without host permission`);
  // rrmacademy.org is a host permission for the lookup call only; no content script runs there.
  assert.ok(!contentHosts.has('https://rrmacademy.org/*'));
  assert.equal(new Set(m.host_permissions).size, m.host_permissions.length, 'duplicate host permission');
  for (const h of m.host_permissions) assert.match(h, /^https:\/\/[a-z0-9.-]+\/\*$/, `${h} is not a plain https host pattern`);
});

test('version is one number in manifest and package', () => {
  assert.equal(m.version, pkg.version);
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
});

test('every file the manifest names exists', () => {
  const paths = [
    m.background.service_worker,
    m.action.default_popup,
    m.side_panel.default_path,
    ...Object.values(m.action.default_icon),
    ...Object.values(m.icons),
    ...m.content_scripts.flatMap((cs) => cs.js),
  ];
  for (const p of paths) assert.ok(existsSync(join(root, p)), `${p} is named in manifest.json but does not exist`);
});

test('the five OFL font files and both licences are bundled, and no CDN is referenced anywhere in src', () => {
  for (const f of ['CormorantGaramond-400', 'CormorantGaramond-600', 'Inter-400', 'Inter-500', 'Inter-600']) {
    assert.ok(existsSync(join(root, 'src', 'fonts', `${f}.woff2`)), `${f}.woff2 missing`);
  }
  assert.ok(existsSync(join(root, 'src', 'fonts', 'OFL-Inter.txt')));
  assert.ok(existsSync(join(root, 'src', 'fonts', 'OFL-Cormorant.txt')));
});
