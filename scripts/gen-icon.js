// 生成应用图标 assets/icon.png（512×512，抗锯齿 4x 超采样）
// 用法：node scripts/gen-icon.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SIZE = 512;
const SS = 4; // 超采样倍数
const N = SIZE * SS;

// ---- 简易 2D 场景的 SDF ----
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ax, ay) - r;
}
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
// 四角星光（两条正交胶囊的近似）
function sdStar4(px, py, cx, cy, r, thick) {
  const dx = Math.abs(px - cx), dy = Math.abs(py - cy);
  const l = Math.hypot(Math.max(dx - r, 0), Math.max(dy - r, 0));
  return Math.max(l, Math.min(Math.max(dx, dy), r) - thick) - thick * 0.35;
}
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function aa(dist) { return clamp01(0.5 - dist * SS); } // 距离→覆盖率
function mix(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

function sample(x, y) {
  // 背景渐变（左上靛蓝 → 右下紫）
  const g = clamp01((x + y) / (2 * SIZE));
  let col = mix([64, 72, 220], [138, 62, 226], g);

  // 圆角方形底
  const bg = sdRoundRect(x, y, SIZE / 2, SIZE / 2, 236, 236, 96);
  const bgCov = aa(bg);
  col = mix([0, 0, 0, 0], col, bgCov); // 圆角外透明（后面与 alpha 合成）
  let alpha = bgCov;

  // 相机机身（白色圆角矩形）
  const body = sdRoundRect(x, y, 262, 292, 150, 104, 34);
  const bodyCov = aa(body);
  col = mix(col, [255, 255, 255], bodyCov * 0.97);
  alpha = Math.max(alpha, bodyCov * bgCov);

  // 相机顶部凸起（取景器）
  const hump = sdRoundRect(x, y, 262, 178, 62, 36, 18);
  const humpCov = aa(hump);
  col = mix(col, [255, 255, 255], humpCov * 0.97);
  alpha = Math.max(alpha, humpCov * bgCov);

  // 镜头外环（深色）
  const ring = sdCircle(x, y, 262, 296, 74);
  const ringCov = aa(ring);
  col = mix(col, [76, 82, 150], ringCov * bgCov);
  alpha = Math.max(alpha, ringCov * bgCov);

  // 镜头内圈（渐变蓝）
  const lens = sdCircle(x, y, 262, 296, 52);
  const lensCov = aa(lens);
  const lg = clamp01((x - 210 + y - 244) / 220);
  col = mix(col, mix([96, 132, 250], [58, 74, 190], lg), lensCov * bgCov);
  alpha = Math.max(alpha, lensCov * bgCov);

  // 镜头高光（小圆）
  const hl = sdCircle(x, y, 240, 276, 14);
  const hlCov = aa(hl);
  col = mix(col, [226, 238, 255], hlCov * bgCov * 0.85);
  alpha = Math.max(alpha, hlCov * bgCov);

  // 右上角四角星光（AI 灵感）
  const star = sdStar4(x, y, 386, 132, 52, 9);
  const starCov = aa(star);
  col = mix(col, [255, 224, 130], starCov * bgCov);
  alpha = Math.max(alpha, starCov * bgCov);
  const star2 = sdStar4(x, y, 430, 196, 22, 6);
  const star2Cov = aa(star2);
  col = mix(col, [255, 244, 190], star2Cov * bgCov * 0.9);
  alpha = Math.max(alpha, star2Cov * bgCov);

  return [col[0], col[1], col[2], clamp01(alpha)];
}

// ---- PNG 编码 ----
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
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

const raw = Buffer.alloc((N * 4 + 1) * N);
let p = 0;
for (let yy = 0; yy < N; yy++) {
  raw[p++] = 0; // filter none
  for (let xx = 0; xx < N; xx++) {
    // 超采样：4×4 盒式滤波
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const s = sample((xx + (sx + 0.5) / SS) / SS, (yy + (sy + 0.5) / SS) / SS);
        r += s[0]; g += s[1]; b += s[2]; a += s[3];
      }
    }
    const cnt = SS * SS;
    raw[p++] = Math.round(r / cnt);
    raw[p++] = Math.round(g / cnt);
    raw[p++] = Math.round(b / cnt);
    raw[p++] = Math.round((a / cnt) * 255);
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0);
ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'icon.png'), png);
console.log('icon written:', path.join(out, 'icon.png'), png.length, 'bytes');
