// Renders src/icons/icon-{16,32,48,128}.png: Lucide's book-open glyph in white on the
// RRM Academy primary purple #725e7e. Lucide is ISC licensed (https://lucide.dev/license);
// the glyph paths below are lucide-static 0.468.0 book-open.svg, unchanged.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', 'src', 'icons');
mkdirSync(out, { recursive: true });

const GLYPH = '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>';

// The glyph is drawn in a 24-unit box; at 16 px a 2-unit stroke is 1.3 px, which reads as a
// smudge, so the small sizes use a heavier stroke and less padding (checked at rendered size).
const SIZES = [
  { px: 16, pad: 2, stroke: 2.75 },
  { px: 32, pad: 4, stroke: 2.5 },
  { px: 48, pad: 7, stroke: 2.25 },
  { px: 128, pad: 20, stroke: 2 },
];

for (const { px, pad, stroke } of SIZES) {
  const inner = px - pad * 2;
  const scale = inner / 24;
  const radius = Math.round(px * 0.2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}">
  <rect width="${px}" height="${px}" rx="${radius}" fill="#725e7e"/>
  <g transform="translate(${pad} ${pad}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${GLYPH}</g>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(join(out, `icon-${px}.png`));
  console.log(`icon-${px}.png`);
}
