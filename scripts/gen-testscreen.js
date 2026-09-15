// 生成自测用伪造屏幕图 test-artifacts/fake-screen.png（2048×1152）
// 用法：node scripts/gen-testscreen.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const W = 2048, H = 1152;

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function mix(c1, c2, t) { return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t]; }
function inRect(x, y, rx, ry, rw, rh) { return x >= rx && x < rx + rw && y >= ry && y < ry + rh; }
function inCircle(x, y, cx, cy, r) { return (x - cx) ** 2 + (y - cy) ** 2 <= r * r; }

function sample(x, y) {
  // 壁纸：蓝色渐变 + 光斑
  const g = y / H;
  let col = mix([18, 32, 74], [46, 86, 158], g);
  if (inCircle(x, y, 1600, 260, 300)) col = mix(col, [90, 140, 230], 0.5);
  if (inCircle(x, y, 400, 900, 420)) col = mix(col, [30, 60, 130], 0.6);

  // 应用窗口（白色）
  if (inRect(x, y, 260, 160, 1100, 760)) {
    col = [250, 250, 252];
    // 标题栏
    if (y < 200) col = [228, 232, 240];
    // 标题栏三个圆点
    if (inCircle(x, y, 292, 180, 8)) col = [240, 90, 90];
    if (inCircle(x, y, 320, 180, 8)) col = [230, 180, 70];
    if (inCircle(x, y, 348, 180, 8)) col = [110, 200, 110];
    // 大标题（黑色粗条）
    if (inRect(x, y, 300, 240, 520, 34)) col = [30, 34, 46];
    // 正文"文字"行
    const lineY = 320 + Math.floor((y - 320) / 46) * 46;
    if (y >= 320 && y < 320 + 12 && x >= 300 && x < 300 + 200 + (lineY % 7) * 130) col = [90, 96, 112];
    // 表格
    if (inRect(x, y, 300, 660, 1020, 220)) {
      col = [244, 246, 250];
      const tx = (x - 300) % 340, ty = (y - 660) % 55;
      if (tx < 2 || ty < 2) col = [200, 206, 218];
      if (ty >= 18 && ty < 30 && tx >= 24 && tx < 240) col = [110, 118, 134];
    }
    // 右侧图表
    if (inRect(x, y, 1380, 240, 560, 620) === false && x >= 1380 && x < 1940 && y >= 240 && y < 860) {
      // unreachable
    }
  }
  // 窗口内右侧图表区（画一个柱状图）
  if (inRect(x, y, 1420, 260, 480, 600)) {
    col = [252, 252, 254];
    const bars = [[1480, 300], [1560, 220], [1640, 380], [1720, 180], [1800, 300]];
    let inBar = false;
    for (const [bx, bh] of bars) if (x >= bx && x < bx + 60 && y >= 820 - bh && y < 820) inBar = true;
    if (inBar) col = [64, 120, 220];
    if (inRect(x, y, 1440, 820, 440, 3)) col = [190, 196, 208];
  }
  // 桌面图标（几个圆角方块）
  const icons = [[80, 90], [80, 210], [80, 330]];
  for (const [ix, iy] of icons) {
    if (inRect(x, y, ix, iy, 72, 72)) col = mix(col, [100, 150, 240], 0.75);
  }
  // 任务栏
  if (y >= H - 56) col = [26, 30, 44];
  if (y >= H - 56 && y < H - 52) col = [60, 66, 86];
  for (let i = 0; i < 6; i++) {
    if (inRect(x, y, 40 + i * 64, H - 46, 44, 36)) col = [52, 60, 84];
  }
  // 右下角时间块
  if (inRect(x, y, W - 200, H - 50, 180, 42)) col = [40, 46, 66];

  return [col[0], col[1], col[2], 255];
}

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

const raw = Buffer.alloc((W * 4 + 1) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  for (let x = 0; x < W; x++) {
    const c = sample(x, y);
    raw[p++] = Math.round(c[0]);
    raw[p++] = Math.round(c[1]);
    raw[p++] = Math.round(c[2]);
    raw[p++] = 255;
  }
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;
ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'test-artifacts');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'fake-screen.png'), png);
console.log('fake screen written:', path.join(out, 'fake-screen.png'), png.length, 'bytes');
