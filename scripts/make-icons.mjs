/**
 * Generate the PWA raster icons.
 *
 * Hand-rolled rather than pulled from a rasteriser: the artwork is a handful of
 * rectangles (a ruled ledger page with a spine, entries on the left, the
 * balance on the right), and this keeps the dependency tree at zero.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = [0x10, 0x13, 0x1a];
const RULE = [0x23, 0x2a, 0x36];
const SPINE = [0x31, 0x3a, 0x4a];
const PAPER = [0xe7, 0xea, 0xf0];
const RED = [0xe2, 0x60, 0x6a];
const GREEN = [0x5f, 0xb0, 0x8a];

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draw the mark on a `size × size` canvas. `inset` leaves a maskable safe area. */
function draw(size, inset) {
  const px = Buffer.alloc(size * size * 4);
  const scale = 1 - inset * 2;
  const rects = [];

  const rect = (x, y, w, h, color) =>
    rects.push({
      x0: (inset + (x / 512) * scale) * size,
      y0: (inset + (y / 512) * scale) * size,
      x1: (inset + ((x + w) / 512) * scale) * size,
      y1: (inset + ((y + h) / 512) * scale) * size,
      color,
    });

  for (const y of [148, 228, 308, 388]) rect(64, y, 384, 8, RULE);
  rect(251, 96, 10, 320, SPINE);
  rect(96, 184, 128, 48, PAPER);
  rect(96, 264, 88, 48, PAPER);
  rect(288, 184, 128, 48, RED);
  rect(288, 264, 56, 48, GREEN);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let color = INK;
      for (const r of rects) {
        if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) color = r.color;
      }
      const i = (y * size + x) * 4;
      px[i] = color[0];
      px[i + 1] = color[1];
      px[i + 2] = color[2];
      px[i + 3] = 255;
    }
  }
  return px;
}

const targets = [
  ['icon-192.png', 192, 0],
  ['icon-512.png', 512, 0],
  // Maskable icons get cropped to a circle; keep the mark inside the safe area.
  ['icon-maskable-512.png', 512, 0.12],
];

for (const [name, size, inset] of targets) {
  writeFileSync(join(OUT_DIR, name), encodePng(size, draw(size, inset)));
  console.log(`wrote public/${name}`);
}
