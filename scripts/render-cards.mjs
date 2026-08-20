#!/usr/bin/env node
/**
 * Render the static marketing cards from `press/render/card.html`.
 *
 * Headless Chrome rather than a drawing library on purpose: the cards use the
 * same font stack, the same gold gradient and the same button as the game, and
 * the only way to keep those from drifting is to let the same engine lay them
 * out. A Pillow reimplementation would be a second source of truth for the
 * wordmark, which is exactly the thing a brand asset must not have.
 *
 * Rendered at 2x and downsampled with `sips`, because a 1x headless render of
 * 100px type is visibly softer than the same type downsampled from 200px.
 *
 * Needs the dev server up (the card loads the shots over http, and file://
 * would block them):
 *
 *     python3 scripts/dev-server.py 4177 &
 *     node scripts/render-cards.mjs
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = process.env.PORT || 4177;
const SCALE = 2;

const CARDS = [
  { v: 'og',     w: 1200, h: 630,  out: 'press/banner-og-1200x630.png' },
  { v: 'square', w: 1080, h: 1080, out: 'press/banner-square-1080.png' },
  { v: 'wide',   w: 2400, h: 800,  out: 'press/banner-wide-2400x800.png' },
];

if (!existsSync(CHROME)) {
  console.error(`No Chrome at ${CHROME}`);
  process.exit(1);
}

for (const c of CARDS) {
  const out = resolve(ROOT, c.out);
  mkdirSync(dirname(out), { recursive: true });
  const url = `http://localhost:${PORT}/press/render/card.html?v=${c.v}`;
  execFileSync(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-sandbox',
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${c.w},${c.h}`,
    `--screenshot=${out}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome wrote it at SCALE; bring it back to the card's real dimensions.
  execFileSync('sips', ['-z', String(c.h), String(c.w), out], { stdio: 'ignore' });
  console.log(`${c.out}  ${c.w}x${c.h}  ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
