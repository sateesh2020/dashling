// Generates PNG icons with no dependencies. Run: node scripts/make-icons.mjs
import zlib from 'node:zlib'; import fs from 'node:fs';
const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const cx = size / 2, ring = size * 0.30, w = size * 0.07;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const t = (x + y) / (2 * size);
      let r = 11 + 14 * t, g = 13 + 20 * t, b = 18 + 40 * t;          // dark gradient background
      const d = Math.hypot(x - cx, y - cx), a = Math.atan2(y - cx, x - cx);
      const edge = Math.min(Math.abs(d - ring) - w / 2, 0) < 0;
      if (edge && a > -Math.PI / 2 - 0.05 && a < Math.PI * 0.75) { r = 94; g = 176; b = 255; } // accent ring, open gap
      if (d < size * 0.05) { r = 232; g = 236; b = 244; }              // center dot
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
fs.mkdirSync('web/icons', { recursive: true });
for (const [n, s] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) fs.writeFileSync(`web/icons/${n}.png`, png(s));
