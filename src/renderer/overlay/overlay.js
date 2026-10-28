/* 覆盖窗启动器（Vue 2 外围 UI + 命令式核心）：
   - idle：取色器放大镜 + 十字线（Vue 渲染面板，采样命令式）
   - select：拖拽选区（#sel 命令式，尺寸角标走 Vue）
   - confirm：8 手柄/4 边带（Vue 渲染）+ Fabric 标注（fabric-controller.js）
   最终把「底图裁剪 + 标注」合成为 fullPng / apiImg 发给主进程 */
const bridge = window.api;
const bg = document.getElementById('bg');
const dim = document.getElementById('dim');
const sel = document.getElementById('sel');
const annWrap = document.getElementById('annWrap');

// 透明窗没有 devtools 入口时，靠 console-message 转发到终端
window.addEventListener('error', (e) => console.error('[overlay] uncaught:', e.message, (e.error && e.error.stack) || ''));
window.addEventListener('unhandledrejection', (e) => console.error('[overlay] rejection:', (e.reason && e.reason.stack) || e.reason));

let displayId = null;
let mode = 'idle'; // idle | select | confirm
let startX = 0, startY = 0;
let rect = null; // {x,y,w,h} CSS 像素，相对本窗口
let ratio = 1; // 物理像素 / CSS 像素
// 会话标志必须存在渲染层局部变量里：window.api 是 contextBridge 冻结对象，写上去会静默失败
let sessionSent = false;

/* ---------- Vue 外围 UI ---------- */
Vue.config.productionTip = false;
window.CaptureI18n.boot();
const app = new Vue(window.OverlayApp).$mount('#app');
const tipEl = document.getElementById('tip');
const pickMag = document.getElementById('pickMag');

/* ---------- 取色器 ---------- */
const MAG_CELLS = 11;
const MAG_CELL_PX = 9;
const MAG_PX = MAG_CELLS * MAG_CELL_PX;
const FORMATS = ['HEX', 'RGB', 'HSL'];
let formatIdx = 0;
let offCanvas = null;
let offCtx = null;
let lastMouseX = 0, lastMouseY = 0;
let magCtx = null;

/* ---------- 启动 ---------- */
FabricController.configure({
  bg,
  getRect: () => rect,
  getRatio: () => ratio,
  onCommit: () => scheduleUpdate(),
});
app.onAdjustStart = (kind, e) => startAdjDrag(kind, e);

bridge.on('overlay:init', ({ image, displayId: id }) => {
  displayId = id;
  pickMag.width = MAG_PX;
  pickMag.height = MAG_PX;
  magCtx = pickMag.getContext('2d');
  bg.onload = () => {
    ratio = bg.naturalWidth / window.innerWidth;
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
bridge.on('overlay:tool', (cmd) => handleToolCommand(cmd));
// 主进程确认「重新选区」后回到空闲态（ESC 可能来自工具条，本窗未必自己处理过）
bridge.on('overlay:reset', () => resetToIdle());

/* ---------- 工具条鼠标穿透 ----------
 * 工具条是独立窗口，但全屏覆盖窗在置顶层里可能压在它上面，
 * 指针进入工具条矩形时让本窗忽略鼠标事件，点击就能落到工具条上。 */
let toolbarRect = null;
let passthroughOn = false;
function setPassthrough(on) {
  if (on === passthroughOn) return;
  passthroughOn = on;
  // 同时交出光标：工具条区域里本窗不再画十字线，避免两窗光标互相抢占造成闪烁
  document.body.classList.toggle('over-toolbar', on);
  bridge.invoke('overlay:passthrough', { on }).catch((e) => console.error('[overlay] passthrough 失败:', e.message));
}
// 只在没有任何鼠标按键按下时切换穿透，避免把正在画的标注截断
function updatePassthrough(e) {
  const r = toolbarRect;
  if (!r) { if (passthroughOn) setPassthrough(false); return; }
  // 按住鼠标时保持现状：一次点击是 down→(微动)→up，中途翻转穿透会让 mouseup 落到覆盖窗上，
  // 工具条按钮就永远收不到 click（表现就是「选了工具之后再也切不动」）
  if (e.buttons !== 0) return;
  const pad = 6;
  const inside = e.clientX >= r.x - pad && e.clientX <= r.x + r.w + pad &&
    e.clientY >= r.y - pad && e.clientY <= r.y + r.h + pad;
  setPassthrough(inside);
}
bridge.on('overlay:toolbar-rect', (rect) => {
  toolbarRect = rect || null;
  if (!toolbarRect) setPassthrough(false);
});

// 自测钩子：自动在屏幕中央框选一块区域
bridge.on('overlay:selftest', () => {
  if (mode === 'confirm') return;
  rect = {
    x: Math.round(window.innerWidth * 0.22),
    y: Math.round(window.innerHeight * 0.25),
    w: Math.round(window.innerWidth * 0.56),
    h: Math.round(window.innerHeight * 0.5),
  };
  confirmSelection();
});

/* ---------- 选区（idle/select） ---------- */
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (mode === 'confirm') return; // 确认态由 Fabric / 手柄处理
  hidePicker();
  setMode('select');
  document.body.classList.add('selecting');
  startX = e.clientX;
  startY = e.clientY;
  rect = { x: startX, y: startY, w: 0, h: 0 };
  hideTip();
});

document.addEventListener('mousemove', (e) => {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  updatePassthrough(e);
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
    setMode('idle');
    document.body.classList.remove('selecting');
    sel.style.display = 'none';
    app.size.visible = false;
    hideTip();
  }
});

document.addEventListener('dblclick', (e) => {
  if (mode === 'confirm' && insideRect(e.clientX, e.clientY)) {
    flushUpdate().then(copyFinish);
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') handleEscape();
  else if (e.key === 'Enter') handleEnter();
  else if (e.key === 'Shift' && !e.repeat && mode !== 'confirm') cycleColorFormat();
  else if (mode === 'confirm' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) FabricController.redo(); else FabricController.undo();
  }
});

function setMode(next) {
  mode = next;
  app.mode = next;
}

function resetToIdle() {
  if (mode !== 'confirm') return;
  FabricController.reset();
  sessionSent = false;
  toolbarRect = null;
  setPassthrough(false);
  setMode('idle');
  rect = null; // 丢掉旧选区，避免 120ms 后的 scheduleUpdate 又补发一次上报
  app.rect = null;
  document.body.classList.remove('selecting');
  sel.style.display = 'none';
  annWrap.style.display = 'none';
  app.size.visible = false;
  hideTip();
  hidePicker(); // 顺带收起十字线
  dim.style.display = 'block'; // 重新变暗，回到初始框选状态
}

function handleEscape() {
  if (mode === 'confirm' && FabricController.isEditingText()) {
    FabricController.exitEditing();
    return; // 文字编辑中 ESC 只退出编辑，不要重选区
  }
  if (mode === 'confirm') {
    resetToIdle();
    bridge.invoke('shot:reselect').catch(() => {});
  } else if (mode !== 'select') {
    bridge.invoke('shot:canceled');
  }
}

function copyFinish() {
  return bridge.invoke('shot:copy-finish').catch((e) => console.error('[overlay] copy-finish 失败:', e.message));
}

function handleEnter() {
  if (mode === 'confirm' && !FabricController.isEditingText()) flushUpdate().then(copyFinish);
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
  sel.style.backgroundImage = `url("${bg.src}")`;
  sel.style.backgroundSize = `${window.innerWidth}px ${window.innerHeight}px`;
  sel.style.backgroundPosition = `${-rect.x}px ${-rect.y}px`;
  sel.classList.toggle('confirm', !!confirmed);
  if (!confirmed) {
    app.size.visible = true;
    app.size.left = rect.x;
    app.size.top = Math.min(rect.y + rect.h + 8, window.innerHeight - 28);
    app.size.text = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  }
}

async function confirmSelection() {
  setMode('confirm');
  document.body.classList.remove('selecting');
  dim.style.display = 'none';
  app.size.visible = false;
  hidePicker();
  drawSelection(true);
  showTip();
  // 先上报选区（工具条依赖它），标注层失败也不能拖垮选区流程
  await flushUpdate();
  try {
    FabricController.ensure();
    layoutSel();
  } catch (e) {
    console.error('[overlay] 标注层初始化失败:', e && e.message);
    if (typeof fabric === 'undefined') hideTip();
  }
}

function showTip() {
  app.tip.visible = true;
  app.tip.left = rect.x + rect.w / 2 - 170;
  app.tip.top = rect.y - 38;
  Vue.nextTick(() => {
    if (!app.tip.visible) return;
    const tw = tipEl.offsetWidth || 340;
    let x = rect.x + rect.w / 2 - tw / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
    let y = rect.y - 38;
    if (y < 8) y = rect.y + rect.h + 44;
    app.tip.left = x;
    app.tip.top = y;
  });
}
function hideTip() {
  app.tip.visible = false;
}

/* ---------- 合成导出 ---------- */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// 底图裁剪 + 标注 → { fullPng, apiImg }
async function renderComposite() {
  ratio = bg.naturalWidth / window.innerWidth || 1;
  const pw = Math.max(1, Math.round(rect.w * ratio));
  const ph = Math.max(1, Math.round(rect.h * ratio));
  const out = document.createElement('canvas');
  out.width = pw;
  out.height = ph;
  const octx = out.getContext('2d');
  octx.drawImage(bg, rect.x * ratio, rect.y * ratio, pw, ph, 0, 0, pw, ph);

  if (FabricController.hasObjects()) {
    const annUrl = FabricController.toDataURL({ format: 'png', multiplier: ratio });
    try {
      const img = await loadImage(annUrl);
      octx.drawImage(img, 0, 0, pw, ph);
    } catch (_) { /* 标注合成失败则仅导出底图 */ }
  }

  const fullPng = out.toDataURL('image/png');
  const MAX_EDGE = 1568;
  const scale = Math.min(1, MAX_EDGE / Math.max(pw, ph));
  let api = out;
  if (scale < 1) {
    api = document.createElement('canvas');
    api.width = Math.max(1, Math.round(pw * scale));
    api.height = Math.max(1, Math.round(ph * scale));
    const ctx = api.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, 0, 0, api.width, api.height);
  }
  const apiImg = api.toDataURL('image/jpeg', 0.88);
  return { fullPng, apiImg };
}

let updateTimer = null;
function scheduleUpdate() {
  clearTimeout(updateTimer);
  updateTimer = setTimeout(flushUpdate, 120);
}
async function flushUpdate() {
  clearTimeout(updateTimer);
  if (!rect) return;
  let composited;
  try {
    composited = await renderComposite();
  } catch (e) {
    console.error('[overlay] 合成失败，选区未上报:', (e && e.stack) || e);
    return;
  }
  const { fullPng, apiImg } = composited;
  const payload = {
    displayId,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
    fullPng,
    apiImg,
  };
  // 首次 confirm 用 shot:selection 建会话；之后用 selection-update 增量刷新
  if (!sessionSent) {
    sessionSent = true;
    bridge.invoke('shot:selection', payload).catch((e) => console.error('[overlay] shot:selection 失败:', e.message));
  } else {
    // 主进程可能已因 reselect 丢掉会话，此时 selection-update 会被静默忽略 → 重新建会话
    bridge.invoke('shot:selection-update', payload).then((r) => {
      if (r && r.lost) {
        sessionSent = false;
        flushUpdate();
      }
    }).catch((e) => console.error('[overlay] shot:selection-update 失败:', e.message));
  }
}

/* ---------- 选区二次调整 ---------- */
function layoutSel() {
  sel.style.left = rect.x + 'px';
  sel.style.top = rect.y + 'px';
  sel.style.width = rect.w + 'px';
  sel.style.height = rect.h + 'px';
  sel.style.backgroundPosition = `${-rect.x}px ${-rect.y}px`;
  annWrap.style.display = 'block';
  annWrap.style.left = rect.x + 'px';
  annWrap.style.top = rect.y + 'px';
  FabricController.resize(rect.w, rect.h); // 含重建马赛克底图
  app.rect = { ...rect }; // 手柄/边带渲染
}

function startAdjDrag(kind, e) {
  if (mode !== 'confirm' || !rect) return;
  e.preventDefault();
  const sx = e.clientX, sy = e.clientY;
  const r0 = { ...rect };
  const minSize = 20;
  const onMove = (ev) => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy;
    let { x, y, w, h } = r0;
    if (kind === 'move') {
      x = clamp(r0.x + dx, 0, window.innerWidth - r0.w);
      y = clamp(r0.y + dy, 0, window.innerHeight - r0.h);
    } else {
      if (kind.includes('w')) { x = clamp(r0.x + dx, 0, r0.x + r0.w - minSize); w = r0.x + r0.w - x; }
      if (kind.includes('e')) { w = clamp(r0.w + dx, minSize, window.innerWidth - r0.x); }
      if (kind.includes('n')) { y = clamp(r0.y + dy, 0, r0.y + r0.h - minSize); h = r0.y + r0.h - y; }
      if (kind.includes('s')) { h = clamp(r0.h + dy, minSize, window.innerHeight - r0.y); }
    }
    rect = { x, y, w, h };
    layoutSel();
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    scheduleUpdate();
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

/* ---------- 工具指令 ---------- */
function handleToolCommand(cmd) {
  switch (cmd.type) {
    case 'tool':
      // 工具栏按工具记忆样式，切工具时一并下发；value 为 null 表示取消工具
      FabricController.setTool(cmd.value || null, { color: cmd.color, width: cmd.width });
      break;
    case 'color': FabricController.setColor(cmd.value); break;
    case 'width': FabricController.setWidth(cmd.value); break;
    case 'undo': FabricController.undo(); break;
    case 'redo': FabricController.redo(); break;
    case 'clear': FabricController.clear(); break;
  }
}

/* ---------- 取色器 ---------- */
function updatePicker(e) {
  if (!offCtx || !bg.naturalWidth) return;
  const px = clamp(Math.round(e.clientX * ratio), 0, bg.naturalWidth - 1);
  const py = clamp(Math.round(e.clientY * ratio), 0, bg.naturalHeight - 1);

  const d = offCtx.getImageData(px, py, 1, 1).data;
  const r = d[0], g = d[1], b = d[2];
  app.picker.color = `rgb(${r}, ${g}, ${b})`;
  app.picker.text = formatColor(r, g, b);
  app.picker.pos = `X ${px}   Y ${py}`;

  const sx = px - (MAG_CELLS - 1) / 2;
  const sy = py - (MAG_CELLS - 1) / 2;
  if (magCtx) {
    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, MAG_PX, MAG_PX);
    magCtx.fillStyle = '#0b0d14';
    magCtx.fillRect(0, 0, MAG_PX, MAG_PX);
    magCtx.drawImage(bg, sx, sy, MAG_CELLS, MAG_CELLS, 0, 0, MAG_PX, MAG_PX);
    magCtx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    magCtx.lineWidth = 1;
    for (let i = 1; i < MAG_CELLS; i++) {
      const p = i * MAG_CELL_PX + 0.5;
      magCtx.beginPath(); magCtx.moveTo(p, 0); magCtx.lineTo(p, MAG_PX); magCtx.stroke();
      magCtx.beginPath(); magCtx.moveTo(0, p); magCtx.lineTo(MAG_PX, p); magCtx.stroke();
    }
    magCtx.strokeStyle = '#3b82f6';
    magCtx.lineWidth = 2;
    magCtx.strokeRect(MAG_CELL_PX * 5 + 1, MAG_CELL_PX * 5 + 1, MAG_CELL_PX - 2, MAG_CELL_PX - 2);
  }

  const pw = 128, ph = 156; // 面板固定尺寸，避免每帧读 offsetWidth
  let x = e.clientX + 20;
  let y = e.clientY + 20;
  if (x + pw > window.innerWidth - 8) x = e.clientX - pw - 20;
  if (y + ph > window.innerHeight - 8) y = e.clientY - ph - 20;
  app.picker.left = x;
  app.picker.top = y;
  app.picker.visible = true;

  app.cross.visible = true;
  app.cross.x = e.clientX;
  app.cross.y = e.clientY;
}

function hidePicker() {
  app.picker.visible = false;
  app.cross.visible = false;
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
    s = l > 0.5 ? d / (2 - max - min) : d / (max - min) / 2;
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cycleColorFormat() {
  formatIdx = (formatIdx + 1) % FORMATS.length;
  if (mode === 'idle') updatePicker({ clientX: lastMouseX, clientY: lastMouseY });
}

window.addEventListener('contextmenu', (e) => e.preventDefault());
