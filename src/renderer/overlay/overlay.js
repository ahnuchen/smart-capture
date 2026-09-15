/* 覆盖窗逻辑：拖拽选区 + 取色器（Shift 切换格式）+ 裁剪（DPI）→ 通知主进程 */
const bg = document.getElementById('bg');
const dim = document.getElementById('dim');
const sel = document.getElementById('sel');
const sizeEl = document.getElementById('size');
const tip = document.getElementById('tip');
const crossV = document.getElementById('crossV');
const crossH = document.getElementById('crossH');
const picker = document.getElementById('picker');
const pickMag = document.getElementById('pickMag');
const pickSwatch = document.getElementById('pickSwatch');
const pickText = document.getElementById('pickText');
const pickPos = document.getElementById('pickPos');
const bridge = window.api;

let displayId = null;
let mode = 'idle'; // idle | select | confirm
let startX = 0, startY = 0;
let rect = null; // {x,y,w,h} CSS 像素，相对本窗口
let ratio = 1; // 物理像素 / CSS 像素

/* ---------- 取色器 ---------- */
const MAG_CELLS = 11; // 放大镜取 11×11 像素
const MAG_CELL_PX = 9; // 每格 9px
const MAG_PX = MAG_CELLS * MAG_CELL_PX; // 99px
const FORMATS = ['HEX', 'RGB', 'HSL'];
let formatIdx = 0;
let offCanvas = null;
let offCtx = null;
let lastMouseX = 0, lastMouseY = 0;

pickMag.width = MAG_PX;
pickMag.height = MAG_PX;
const magCtx = pickMag.getContext('2d');

// 界面文案本地化
document.getElementById('tip').innerHTML = window.window.i18n.t('overlay.tip');
document.getElementById('pickFmt').textContent = window.window.i18n.t('overlay.pickFmt');

bridge.on('overlay:init', ({ image, displayId: id }) => {
  console.log('[overlay] init received, image length:', image && image.length);
  displayId = id;
  bg.onload = () => {
    ratio = bg.naturalWidth / window.innerWidth;
    console.log('[overlay] bg loaded:', bg.naturalWidth, 'x', bg.naturalHeight, 'ratio:', ratio);
    // 离屏画布：读取像素颜色
    offCanvas = document.createElement('canvas');
    offCanvas.width = bg.naturalWidth;
    offCanvas.height = bg.naturalHeight;
    offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
    offCtx.drawImage(bg, 0, 0);
  };
  bg.onerror = (e) => console.error('[overlay] bg image error', e);
  bg.src = image;
});

bridge.on('overlay:escape', () => handleEscape());
bridge.on('overlay:enter', () => handleEnter());

// 自测钩子：自动在屏幕中央框选一块区域
bridge.on('overlay:selftest', () => {
  console.log('[overlay] selftest select, mode:', mode, 'bg loaded:', bg.naturalWidth > 0);
  if (mode === 'confirm') return;
  rect = {
    x: Math.round(window.innerWidth * 0.22),
    y: Math.round(window.innerHeight * 0.25),
    w: Math.round(window.innerWidth * 0.56),
    h: Math.round(window.innerHeight * 0.5),
  };
  confirmSelection();
});

/* ---------- 选区 ---------- */
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (mode === 'confirm') return; // 确认后点击空白处不响应
  hidePicker();
  mode = 'select';
  document.body.classList.add('selecting');
  startX = e.clientX;
  startY = e.clientY;
  rect = { x: startX, y: startY, w: 0, h: 0 };
  hideTip();
});

document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  if (mode === 'select') {
    const x1 = Math.max(0, Math.min(startX, e.clientX));
    const y1 = Math.max(0, Math.min(startY, e.clientY));
    const x2 = Math.min(window.innerWidth, Math.max(startX, e.clientX));
    const y2 = Math.min(window.innerHeight, Math.max(startY, e.clientY));
    rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    drawSelection(false);
  } else if (mode === 'idle') {
    updatePicker(e);
  }
});

document.addEventListener('mouseup', (e) => {
  if (mode !== 'select') return;
  if (rect && rect.w >= 10 && rect.h >= 10) {
    confirmSelection();
  } else {
    // 单击（未构成选区）：回到全屏待选状态
    mode = 'idle';
    document.body.classList.remove('selecting');
    sel.style.display = 'none';
    sizeEl.style.display = 'none';
    hideTip();
  }
});

document.addEventListener('dblclick', (e) => {
  if (mode === 'confirm' && insideRect(e.clientX, e.clientY)) {
    bridge.invoke('shot:copy-finish');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') handleEscape();
  else if (e.key === 'Enter') handleEnter();
  else if (e.key === 'Shift' && !e.repeat) cycleColorFormat();
});

function handleEscape() {
  if (mode === 'confirm') {
    // 回到待选状态，主进程关闭工具条
    bridge.invoke('shot:reselect');
    mode = 'idle';
    document.body.classList.remove('selecting');
    sel.style.display = 'none';
    sizeEl.style.display = 'none';
    hideTip();
  } else if (mode !== 'select') {
    bridge.invoke('shot:canceled');
  }
}

function handleEnter() {
  if (mode === 'confirm') bridge.invoke('shot:copy-finish');
}

function insideRect(x, y) {
  return rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function drawSelection(confirmed) {
  sel.style.display = 'block';
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.w + 'px';
  sel.style.height = rect.h + 'px';
  // 选区内显示清晰图像
  sel.style.backgroundImage = `url("${bg.src}")`;
  sel.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
  sel.style.backgroundPosition = `${-rect.x}px ${-rect.y}px`;
  sel.classList.toggle('confirm', !!confirmed);
  if (!confirmed) {
    sizeEl.style.display = 'block';
    sizeEl.style.left = rect.x + 'px';
    sizeEl.style.top = Math.min(rect.y + rect.h + 8, window.innerHeight - 28) + 'px';
    sizeEl.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  }
}

function confirmSelection() {
  mode = 'confirm';
  document.body.classList.remove('selecting');
  dim.style.display = 'none';
  drawSelection(true);
  sizeEl.style.display = 'none';
  hidePicker();
  showTip();

  const { fullPng, apiImg } = crop();
  bridge.invoke('shot:selection', {
    displayId,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
    fullPng,
    apiImg,
  });
}

function showTip() {
  tip.style.display = 'block';
  const tw = tip.offsetWidth || 340;
  let x = rect.x + rect.w / 2 - tw / 2;
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  let y = rect.y - 38;
  if (y < 8) y = rect.y + rect.h + 44; // 底部放不下工具条时往下挪
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}

function hideTip() {
  tip.style.display = 'none';
}

// 生成两份图：fullPng（原始分辨率，用于保存/复制）、apiImg（限边长 JPEG，用于模型）
function crop() {
  ratio = bg.naturalWidth / window.innerWidth || 1;
  const sx = rect.x * ratio;
  const sy = rect.y * ratio;
  const sw = rect.w * ratio;
  const sh = rect.h * ratio;
  const full = document.createElement('canvas');
  full.width = Math.max(1, Math.round(sw));
  full.height = Math.max(1, Math.round(sh));
  full.getContext('2d').drawImage(bg, sx, sy, sw, sh, 0, 0, full.width, full.height);

  const MAX_EDGE = 1568;
  const scale = Math.min(1, MAX_EDGE / Math.max(full.width, full.height));
  let apiCanvas = full;
  if (scale < 1) {
    apiCanvas = document.createElement('canvas');
    apiCanvas.width = Math.max(1, Math.round(full.width * scale));
    apiCanvas.height = Math.max(1, Math.round(full.height * scale));
    const ctx = apiCanvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(full, 0, 0, apiCanvas.width, apiCanvas.height);
  }
  return {
    fullPng: full.toDataURL('image/png'),
    apiImg: apiCanvas.toDataURL('image/jpeg', 0.88),
  };
}

/* ---------- 取色器实现 ---------- */
function updatePicker(e) {
  if (!offCtx || !bg.naturalWidth) return;
  const px = clamp(Math.round(e.clientX * ratio), 0, bg.naturalWidth - 1);
  const py = clamp(Math.round(e.clientY * ratio), 0, bg.naturalHeight - 1);

  const d = offCtx.getImageData(px, py, 1, 1).data;
  const r = d[0], g = d[1], b = d[2];
  pickSwatch.style.background = `rgb(${r}, ${g}, ${b})`;
  pickText.textContent = formatColor(r, g, b);
  pickPos.textContent = `X ${px}   Y ${py}`;

  // 放大镜：以光标为中心取 11×11 物理像素放大
  const sx = px - (MAG_CELLS - 1) / 2;
  const sy = py - (MAG_CELLS - 1) / 2;
  magCtx.imageSmoothingEnabled = false;
  magCtx.clearRect(0, 0, MAG_PX, MAG_PX);
  magCtx.fillStyle = '#0b0d14'; // 越界区域底色
  magCtx.fillRect(0, 0, MAG_PX, MAG_PX);
  magCtx.drawImage(bg, sx, sy, MAG_CELLS, MAG_CELLS, 0, 0, MAG_PX, MAG_PX);
  // 网格线
  magCtx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  magCtx.lineWidth = 1;
  for (let i = 1; i < MAG_CELLS; i++) {
    const p = i * MAG_CELL_PX + 0.5;
    magCtx.beginPath(); magCtx.moveTo(p, 0); magCtx.lineTo(p, MAG_PX); magCtx.stroke();
    magCtx.beginPath(); magCtx.moveTo(0, p); magCtx.lineTo(MAG_PX, p); magCtx.stroke();
  }
  // 中心格高亮
  magCtx.strokeStyle = '#3b82f6';
  magCtx.lineWidth = 2;
  magCtx.strokeRect(MAG_CELL_PX * 5 + 1, MAG_CELL_PX * 5 + 1, MAG_CELL_PX - 2, MAG_CELL_PX - 2);

  // 面板跟随光标，靠边翻转
  picker.style.display = 'block';
  const pw = picker.offsetWidth || 128;
  const ph = picker.offsetHeight || 156;
  let x = e.clientX + 20;
  let y = e.clientY + 20;
  if (x + pw > window.innerWidth - 8) x = e.clientX - pw - 20;
  if (y + ph > window.innerHeight - 8) y = e.clientY - ph - 20;
  picker.style.left = x + 'px';
  picker.style.top = y + 'px';

  // 十字辅助线
  crossV.style.display = 'block';
  crossH.style.display = 'block';
  crossV.style.left = e.clientX + 'px';
  crossH.style.top = e.clientY + 'px';
}

function hidePicker() {
  picker.style.display = 'none';
  crossV.style.display = 'none';
  crossH.style.display = 'none';
}

function cycleColorFormat() {
  formatIdx = (formatIdx + 1) % FORMATS.length;
  if (mode === 'idle') updatePicker({ clientX: lastMouseX, clientY: lastMouseY });
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function formatColor(r, g, b) {
  const fmt = FORMATS[formatIdx];
  if (fmt === 'RGB') return `rgb(${r}, ${g}, ${b})`;
  if (fmt === 'HSL') {
    const [h, s, l] = rgbToHsl(r, g, b);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

window.addEventListener('contextmenu', (e) => e.preventDefault());
