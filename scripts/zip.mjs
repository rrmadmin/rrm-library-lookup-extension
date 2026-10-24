// Writes dist/rrm-research-library-lookup-<version>.zip from manifest.json, src/ and LICENSE,
// the exact store package. Uses the system zip so the repo carries no build dependency.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const dist = join(root, 'dist');
mkdirSync(dist, { recursive: true });
const out = join(dist, `rrm-research-library-lookup-${version}.zip`);
if (existsSync(out)) rmSync(out);
execFileSync('zip', ['-r', '-X', '-q', out, 'manifest.json', 'src', 'LICENSE', '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(out);
