// Tegner app-ikonet (et kalenderblad) som PNG i tre størrelser:  node tools/lav-ikoner.js
// Ingen ekstra pakker – PNG-filen bygges i hånden med Nodes indbyggede zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLAA = [47, 111, 222];
const HVID = [255, 255, 255];
const PRIKKER = [[47, 111, 222], [214, 51, 108], [43, 138, 62], [232, 89, 12], [112, 72, 232], [92, 103, 125]];

// Afstand til et afrundet rektangel (negativ = indenfor), alt i enheder 0..1
function afrundet(x, y, x0, y0, x1, y1, r) {
  const dx = Math.max(x0 + r - x, 0, x - (x1 - r));
  const dy = Math.max(y0 + r - y, 0, y - (y1 - r));
  return Math.hypot(dx, dy) - r;
}

function farve(x, y) {
  if (afrundet(x, y, 0.16, 0.2, 0.84, 0.84, 0.08) > 0) return BLAA; // baggrund
  if (y < 0.36) return [30, 78, 170]; // kalenderens top
  // 3 x 2 prikker – én farve pr. person + familien
  for (let i = 0; i < 6; i++) {
    const cx = 0.31 + (i % 3) * 0.19;
    const cy = 0.5 + Math.floor(i / 3) * 0.19;
    if (Math.hypot(x - cx, y - cy) < 0.062) return PRIKKER[i];
  }
  return HVID;
}

const crcTabel = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = crcTabel[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function blok(type, data) {
  const laengde = Buffer.alloc(4);
  laengde.writeUInt32BE(data.length);
  const indhold = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(indhold));
  return Buffer.concat([laengde, indhold, sum]);
}

function png(n) {
  const SS = 3; // 3x3 delprøver pr. pixel giver bløde kanter
  const raa = Buffer.alloc(n * (1 + n * 3));
  for (let py = 0; py < n; py++) {
    const linje = py * (1 + n * 3);
    for (let px = 0; px < n; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const f = farve((px + (sx + 0.5) / SS) / n, (py + (sy + 0.5) / SS) / n);
          sum[0] += f[0]; sum[1] += f[1]; sum[2] += f[2];
        }
      for (let k = 0; k < 3; k++) raa[linje + 1 + px * 3 + k] = Math.round(sum[k] / (SS * SS));
    }
  }
  const hoved = Buffer.alloc(13);
  hoved.writeUInt32BE(n, 0);
  hoved.writeUInt32BE(n, 4);
  hoved.set([8, 2, 0, 0, 0], 8); // 8 bit, RGB
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    blok('IHDR', hoved),
    blok('IDAT', zlib.deflateSync(raa, { level: 9 })),
    blok('IEND', Buffer.alloc(0)),
  ]);
}

const mappe = path.resolve(__dirname, '..', 'ikoner');
fs.mkdirSync(mappe, { recursive: true });
for (const n of [180, 192, 512]) {
  fs.writeFileSync(path.join(mappe, `ikon-${n}.png`), png(n));
  console.log(`ikon-${n}.png`);
}
