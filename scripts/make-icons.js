#!/usr/bin/env node
// Renders the app icons with zero dependencies: rasterise into an RGBA buffer at
// 4x, box-downsample for antialiasing, then hand-encode a PNG with zlib.
//
//   node scripts/make-icons.js
//
// Writes icon-192.png, icon-512.png and apple-touch-icon.png to the repo root.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SS = 4; // supersample factor

// ------------------------------------------------------------------- raster

function makeSurface(size) {
  return { w: size, h: size, data: new Uint8ClampedArray(size * size * 4) };
}

function blend(surf, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= surf.w || y >= surf.h || a <= 0) return;
  const i = (y * surf.w + x) * 4;
  const d = surf.data;
  const ia = 1 - a;
  d[i] = r * a + d[i] * ia;
  d[i + 1] = g * a + d[i + 1] * ia;
  d[i + 2] = b * a + d[i + 2] * ia;
  d[i + 3] = Math.min(255, a * 255 + d[i + 3] * ia);
}

const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

/** Fill every pixel where test(nx, ny) is true, with nx/ny normalised 0..1. */
function fill(surf, test, color, alpha = 1) {
  const [r, g, b] = typeof color === 'string' ? hex(color) : color;
  for (let y = 0; y < surf.h; y++) {
    const ny = y / surf.h;
    for (let x = 0; x < surf.w; x++) {
      const nx = x / surf.w;
      if (test(nx, ny)) blend(surf, x, y, r, g, b, alpha);
    }
  }
}

/** Vertical gradient across a region. */
function gradient(surf, test, stops) {
  for (let y = 0; y < surf.h; y++) {
    const ny = y / surf.h;
    let c0 = stops[0], c1 = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (ny >= stops[i][0] && ny <= stops[i + 1][0]) { c0 = stops[i]; c1 = stops[i + 1]; break; }
    }
    const span = Math.max(1e-6, c1[0] - c0[0]);
    const k = Math.max(0, Math.min(1, (ny - c0[0]) / span));
    const a = hex(c0[1]), b = hex(c1[1]);
    const col = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    for (let x = 0; x < surf.w; x++) {
      if (test(x / surf.w, ny)) blend(surf, x, y, col[0], col[1], col[2], 1);
    }
  }
}

const ellipse = (cx, cy, rx, ry) => (x, y) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

const rect = (x0, y0, x1, y1) => (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

const roundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

const and = (...fns) => (x, y) => fns.every((f) => f(x, y));
const not = (f) => (x, y) => !f(x, y);

// --------------------------------------------------------------- the artwork

function drawIcon(size) {
  const s = makeSurface(size);
  const card = roundRect(0, 0, 1, 1, 0.22);

  // sunset backdrop
  gradient(s, card, [
    [0.0, '#2b1b52'],
    [0.42, '#8d3b6b'],
    [0.78, '#e8663c'],
    [1.0, '#ffb35c'],
  ]);
  // low sun
  fill(s, and(card, ellipse(0.5, 0.62, 0.34, 0.34)), '#ffd98a', 0.28);
  // alley walls converging toward the vanishing point
  fill(s, and(card, (x, y) => y > 0.62 && x < 0.5 - (0.72 - y) * 0.9), '#3a2b46', 0.85);
  fill(s, and(card, (x, y) => y > 0.62 && x > 0.5 + (0.72 - y) * 0.9), '#2e2238', 0.85);
  fill(s, and(card, rect(0, 0.88, 1, 1)), '#241d2a', 0.7);

  // flannel shoulders
  fill(s, and(card, roundRect(0.16, 0.78, 0.84, 1.0, 0.08)), '#3c5f9e');
  fill(s, and(card, rect(0.16, 0.78, 0.84, 1.0), (x) => Math.floor(x * 9) % 2 === 0), '#28406d', 0.5);
  fill(s, and(card, (x, y) => y > 0.78 && Math.abs(x - 0.5) < 0.09), '#f2efe6');

  // head
  const head = ellipse(0.5, 0.5, 0.29, 0.31);
  fill(s, and(card, head), '#b9784e');
  // hair
  fill(s, and(card, ellipse(0.5, 0.44, 0.315, 0.30), not(ellipse(0.5, 0.56, 0.30, 0.26))), '#20161a');
  fill(s, and(card, ellipse(0.5, 0.30, 0.315, 0.16)), '#20161a');

  // thick brows
  fill(s, and(card, roundRect(0.27, 0.455, 0.45, 0.495, 0.018)), '#17110f');
  fill(s, and(card, roundRect(0.55, 0.455, 0.73, 0.495, 0.018)), '#17110f');

  // gold aviators
  const lensL = ellipse(0.375, 0.565, 0.108, 0.082);
  const lensR = ellipse(0.625, 0.565, 0.108, 0.082);
  fill(s, and(card, lensL), '#ffc93c');
  fill(s, and(card, lensR), '#ffc93c');
  fill(s, and(card, ellipse(0.375, 0.565, 0.086, 0.060)), '#3f8f86');
  fill(s, and(card, ellipse(0.625, 0.565, 0.086, 0.060)), '#3f8f86');
  fill(s, and(card, rect(0.478, 0.552, 0.522, 0.572)), '#ffc93c');
  // lens flash
  fill(s, and(card, roundRect(0.315, 0.542, 0.365, 0.562, 0.01)), '#ffffff', 0.65);
  fill(s, and(card, roundRect(0.565, 0.542, 0.615, 0.562, 0.01)), '#ffffff', 0.65);

  // mouth
  fill(s, and(card, roundRect(0.455, 0.685, 0.545, 0.712, 0.012)), '#241318');

  // inner rim so the icon reads on a light home screen
  fill(s, and(card, not(roundRect(0.028, 0.028, 0.972, 0.972, 0.20))), '#ffc93c', 0.5);

  return s;
}

function downsample(src, factor) {
  const out = makeSurface(src.w / factor);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const i = ((y * factor + dy) * src.w + (x * factor + dx)) * 4;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2]; a += src.data[i + 3];
        }
      }
      const n = factor * factor;
      const i = (y * out.w + x) * 4;
      out.data[i] = r / n; out.data[i + 1] = g / n; out.data[i + 2] = b / n; out.data[i + 3] = a / n;
    }
  }
  return out;
}

// ------------------------------------------------------------- PNG encoding

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(surf) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(surf.w, 0);
  ihdr.writeUInt32BE(surf.h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // RGBA
  const raw = Buffer.alloc(surf.h * (surf.w * 4 + 1));
  let p = 0;
  for (let y = 0; y < surf.h; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < surf.w; x++) {
      const i = (y * surf.w + x) * 4;
      raw[p++] = surf.data[i];
      raw[p++] = surf.data[i + 1];
      raw[p++] = surf.data[i + 2];
      raw[p++] = surf.data[i + 3];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------- run

const root = path.join(__dirname, '..');
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
  ['favicon.png', 64],
];

for (const [name, size] of targets) {
  const big = drawIcon(size * SS);
  const png = encodePNG(downsample(big, SS));
  fs.writeFileSync(path.join(root, name), png);
  console.log(`wrote ${name} (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}
