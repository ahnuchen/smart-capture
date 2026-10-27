/* 覆盖窗逻辑：
   - idle：取色器放大镜 + 十字线
   - select：拖拽选区
   - confirm：选区可二次调整（8 手柄缩放 + 边带移动）+ Fabric 标注（矩形/椭圆/直线/箭头/画笔/荧光笔/马赛克）
   最终把「底图裁剪 + 标注」合成为 fullPng / apiImg 发给主进程 */
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
const annWrap = document.getElementById('annWrap');
const adj = document.getElementById('adj');
const bridge = window.api;

let displayId = null;
let mode = 'idle'; // idle | select | confirm
let startX = 0, startY = 0;
let rect = null; // {x,y,w,h} CSS 像素，相对本窗口
let ratio = 1; // 物理像素 / CSS 像素

/* ---------- 取色器 ---------- */
const MAG_CELLS = 11;
const MAG_CELL_PX = 9;
const MAG_PX = MAG_CELLS * MAG_CELL_PX;
const FORMATS = ['HEX', 'RGB', 'HSL'];
let formatIdx = 0;
let offCanvas = null;
let offCtx = null;
let lastMouseX = 0, lastMouseY = 0;

pickMag.width = MAG_PX;
pickMag.height = MAG_PX;
const magCtx = pickMag.getContext('2d');

document.getElementById('tip').innerHTML = window.i18n.t('overlay.tip');
document.getElementById('pickFmt').textContent = window.i18n.t('overlay.pickFmt');

/* ---------- 标注状态 ---------- */
let fc = null; // fabric.Canvas
let tool = 'select';
let color = '#ff3b30';
let strokeWidth = 4;
let history = []; // 每步 fc JSON
let histIdx = -1;
let draft = null; // 拖拽创建中的临时对象
let drawStart = null; // {x,y} 画布内坐标
let mosaicDraft = null; // 马赛克拖拽 {x,y}

bridge.on('overlay:init', ({ image, displayId: id }) => {
  displayId = id;
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
    mode = 'idle';
    document.body.classList.remove('selecting');
    sel.style.display = 'none';
    sizeEl.style.display = 'none';
    hideTip();
  }
});

document.addEventListener('dblclick', (e) => {
  if (mode === 'confirm' && insideRect(e.clientX, e.clientY)) {
    flushUpdate().then(() => bridge.invoke('shot:copy-finish'));
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') handleEscape();
  else if (e.key === 'Enter') handleEnter();
  else if (e.key === 'Shift' && !e.repeat && mode !== 'confirm') cycleColorFormat();
  else if (mode === 'confirm' && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) doRedo(); else doUndo();
  }
});

function handleEscape() {
  if (mode === 'confirm') {
    bridge.invoke('shot:reselect');
    resetConfirmState();
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
  if (mode === 'confirm') flushUpdate().then(() => bridge.invoke('shot:copy-finish'));
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
    sizeEl.style.display = 'block';
    sizeEl.style.left = rect.x + 'px';
    sizeEl.style.top = Math.min(rect.y + rect.h + 8, window.innerHeight - 28) + 'px';
    sizeEl.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
  }
}

async function confirmSelection() {
  mode = 'confirm';
  document.body.classList.remove('selecting');
  dim.style.display = 'none';
  sizeEl.style.display = 'none';
  hidePicker();
  drawSelection(true);
  showTip();
  setupAnnotation();
  layoutSel();
  await flushUpdate(); // 首次上报选区（无标注）→ 主进程显示工具条
}

function showTip() {
  tip.style.display = 'block';
  const tw = tip.offsetWidth || 340;
  let x = rect.x + rect.w / 2 - tw / 2;
  x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
  let y = rect.y - 38;
  if (y < 8) y = rect.y + rect.h + 44;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
function hideTip() {
  tip.style.display = 'none';
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

  if (fc && fc.getObjects().length) {
    const annUrl = fc.toDataURL({ format: 'png', multiplier: ratio });
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
  const { fullPng, apiImg } = await renderComposite();
  const payload = {
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) },
    fullPng,
    apiImg,
  };
  // 首次 confirm 用 shot:selection 建会话；之后用 selection-update 增量刷新
  if (!bridge._sent) {
    bridge._sent = true;
    bridge.invoke('shot:selection', payload);
  } else {
    bridge.invoke('shot:selection-update', payload);
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
  if (fc) fc.setDimensions({ width: rect.w, height: rect.h });
  positionAdj();
}

function positionAdj() {
  adj.style.display = 'block';
  const { x, y, w, h } = rect;
  const pts = {
    nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2],
    se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2],
  };
  for (const [k, [px, py]] of Object.entries(pts)) {
    const el = adj.querySelector(`.handle[data-cur=${k}]`);
    if (el) { el.style.left = px + 'px'; el.style.top = py + 'px'; }
  }
  const setBand = (side, l, t, ww, hh) => {
    const el = adj.querySelector(`.band.${side}`);
    if (el) { el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = ww + 'px'; el.style.height = hh + 'px'; }
  };
  setBand('n', x + 9, y - 3, Math.max(0, w - 18), 7);
  setBand('s', x + 9, y + h - 4, Math.max(0, w - 18), 7);
  setBand('w', x - 3, y + 9, 7, Math.max(0, h - 18));
  setBand('e', x + w - 4, y + 9, 7, Math.max(0, h - 18));
}

function buildAdj() {
  adj.innerHTML = '';
  for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const el = document.createElement('div');
    el.className = 'handle';
    el.dataset.cur = k;
    el.addEventListener('mousedown', (e) => startAdjDrag(e, k));
    adj.appendChild(el);
  }
  for (const side of ['n', 's', 'w', 'e']) {
    const el = document.createElement('div');
    el.className = 'band ' + side;
    el.dataset.cur = 'move';
    el.addEventListener('mousedown', (e) => startAdjDrag(e, 'move'));
    adj.appendChild(el);
  }
}

function startAdjDrag(e, kind) {
  e.preventDefault();
  e.stopPropagation();
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

/* ---------- Fabric 标注 ---------- */
function setupAnnotation() {
  if (fc) return;
  fc = new fabric.Canvas('ann', {
    selection: true,
    preserveObjectStacking: true,
    renderOnFireOnAdd: false,
  });
  fc.backgroundColor = 'transparent';
  buildAdj();
  applyTool();
  requestAnimationFrame(() => fc.renderAll());

  fc.on('mouse:down', onFcDown);
  fc.on('mouse:move', onFcMove);
  fc.on('mouse:up', onFcUp);
  fc.on('path:created', (e) => {
    // 画笔/荧光笔落笔完成
    if (tool === 'highlighter' && e.path) {
      e.path.set({ opacity: 0.4, strokeLineCap: 'round', strokeLineJoin: 'round' });
      fc.requestRenderAll();
    }
    commit();
  });
  fc.on('object:modified', commit);
}

function resetConfirmState() {
  annWrap.style.display = 'none';
  adj.style.display = 'none';
  bridge._sent = false;
  if (fc) {
    fc.clear();
    fc.getObjects().slice().forEach((o) => fc.remove(o));
    history = [];
    histIdx = -1;
    commit();
  }
}

function applyTool() {
  if (!fc) return;
  fc.isDrawingMode = tool === 'pencil' || tool === 'highlighter';
  fc.selection = tool === 'select';
  fc.forEachObject((o) => {
    o.selectable = tool === 'select';
    o.evented = tool === 'select';
  });
  if (fc.isDrawingMode) {
    const brush = new fabric.PencilBrush(fc);
    brush.width = tool === 'highlighter' ? strokeWidth * 4 : strokeWidth;
    brush.color = tool === 'highlighter' ? hexToRgba(color, 0.4) : color;
    fc.freeDrawingBrush = brush;
  }
  const el = document.getElementById('ann');
  if (el) el.style.cursor = tool === 'select' ? 'default' : 'crosshair';
}

function setTool(next) {
  if (next === tool) return;
  fc && fc.discardActiveObject();
  tool = next;
  applyTool();
  fc && fc.requestRenderAll();
}

function handleToolCommand(cmd) {
  switch (cmd.type) {
    case 'tool': setTool(cmd.value); break;
    case 'color': color = cmd.value; applyTool(); break;
    case 'width': strokeWidth = cmd.value; applyTool(); break;
    case 'undo': doUndo(); break;
    case 'redo': doRedo(); break;
    case 'clear': doClear(); break;
  }
}

function onFcDown(opt) {
  if (!fc) return;
  const p = fc.getPointer(opt.e);
  if (tool === 'mosaic') {
    mosaicDraft = { x: p.x, y: p.y };
    return;
  }
  if (['rect', 'ellipse', 'line', 'arrow'].includes(tool)) {
    drawStart = { x: p.x, y: p.y };
    draft = createShape(tool, p.x, p.y, p.x, p.y);
    if (draft) { draft.set({ selectable: false, evented: false }); fc.add(draft); }
  }
}

function onFcMove(opt) {
  if (!fc) return;
  const p = fc.getPointer(opt.e);
  if (tool === 'mosaic' && mosaicDraft) return; // 马赛克在 up 时生成
  if (draft && drawStart) {
    updateShape(draft, tool, drawStart.x, drawStart.y, p.x, p.y);
    fc.requestRenderAll();
  }
}

function onFcUp(opt) {
  if (!fc) return;
  const p = fc.getPointer(opt.e);
  if (tool === 'mosaic' && mosaicDraft) {
    const a = mosaicDraft, b = p;
    mosaicDraft = null;
    addMosaic(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return;
  }
  if (draft && drawStart) {
    const w = Math.abs(p.x - drawStart.x), h = Math.abs(p.y - drawStart.y);
    if (w < 4 && h < 4) {
      fc.remove(draft); // 太小，丢弃
    } else {
      draft.set({ selectable: tool === 'select', evented: tool === 'select' });
      commit();
    }
    draft = null;
    drawStart = null;
  }
}

function createShape(kind, x1, y1, x2, y2) {
  const common = { fill: 'transparent', stroke: color, strokeWidth, strokeUniform: true };
  if (kind === 'rect') return new fabric.Rect({ ...common, left: x1, top: y1, width: 0, height: 0 });
  if (kind === 'ellipse') return new fabric.Ellipse({ ...common, left: x1, top: y1, rx: 0, ry: 0 });
  if (kind === 'line') return new fabric.Line([x1, y1, x2, y2], { ...common, fill: '', strokeLineCap: 'round' });
  if (kind === 'arrow') return new fabric.Path(arrowPath(x1, y1, x2, y2), { ...common, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' });
  return null;
}

function updateShape(obj, kind, x1, y1, x2, y2) {
  if (kind === 'rect') {
    obj.set({ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  } else if (kind === 'ellipse') {
    obj.set({ left: Math.min(x1, x2), top: Math.min(y1, y2), rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 });
  } else if (kind === 'line') {
    obj.set({ x1, y1, x2, y2 });
    obj.setCoords();
  } else if (kind === 'arrow') {
    obj.set({ path: parsePath(arrowPath(x1, y1, x2, y2)) });
    obj.setCoords();
  }
}

function arrowPath(x1, y1, x2, y2) {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const hl = Math.max(12, strokeWidth * 3.5);
  const a1 = a + Math.PI - 0.42, a2 = a + Math.PI + 0.42;
  return (
    `M ${x1} ${y1} L ${x2} ${y2} ` +
    `M ${x2} ${y2} L ${x2 + hl * Math.cos(a1)} ${y2 + hl * Math.sin(a1)} ` +
    `M ${x2} ${y2} L ${x2 + hl * Math.cos(a2)} ${y2 + hl * Math.sin(a2)}`
  );
}
// fabric.Path 的 path 数组解析（用于更新箭头端点）
function parsePath(d) {
  return d.trim().split(/\s+(?=[ML])/).map((seg) => {
    const parts = seg.trim().split(/\s+/);
    return [parts[0], ...parts.slice(1).map(Number)];
  });
}

// 马赛克：取底图对应区域做像素化，铺回选区
function addMosaic(cx, cy, cw, ch) {
  if (cw < 4 || ch < 4) return;
  const sx = (rect.x + cx) * ratio;
  const sy = (rect.y + cy) * ratio;
  const sw = cw * ratio;
  const sh = ch * ratio;
  const block = Math.max(6, Math.round(10 * ratio));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(sw / block));
  small.height = Math.max(1, Math.round(sh / block));
  const sctx = small.getContext('2d');
  sctx.drawImage(bg, sx, sy, sw, sh, 0, 0, small.width, small.height);
  const big = document.createElement('canvas');
  big.width = Math.max(1, Math.round(sw));
  big.height = Math.max(1, Math.round(sh));
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, big.width, big.height);
  fabric.Image.fromURL(big.toDataURL('image/png'), (img) => {
    img.set({ left: cx, top: cy, selectable: tool === 'select', evented: tool === 'select', hoverCursor: 'default' });
    fc.add(img);
    fc.requestRenderAll();
    commit();
  });
}

/* ---------- 历史（撤销/重做） ---------- */
function commit() {
  if (!fc) return;
  const snap = JSON.stringify(fc.toJSON());
  history = history.slice(0, histIdx + 1);
  history.push(snap);
  histIdx = history.length - 1;
  scheduleUpdate();
}
function restore(snap) {
  if (!fc) return;
  fc.loadFromJSON(snap, () => {
    fc.getObjects().forEach((o) => {
      o.set({ selectable: tool === 'select', evented: tool === 'select' });
    });
    fc.renderAll();
    scheduleUpdate();
  });
}
function doUndo() {
  if (histIdx > 0) { histIdx--; restore(history[histIdx]); }
}
function doRedo() {
  if (histIdx < history.length - 1) { histIdx++; restore(history[histIdx]); }
}
function doClear() {
  if (!fc) return;
  fc.clear();
  fc.backgroundColor = 'transparent';
  fc.renderAll();
  commit();
}

/* ---------- 颜色工具 ---------- */
function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function cycleColorFormat() {
  formatIdx = (formatIdx + 1) % FORMATS.length;
  if (mode === 'idle') updatePicker({ clientX: lastMouseX, clientY: lastMouseY });
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

  const sx = px - (MAG_CELLS - 1) / 2;
  const sy = py - (MAG_CELLS - 1) / 2;
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

  picker.style.display = 'block';
  const pw = picker.offsetWidth || 128;
  const ph = picker.offsetHeight || 156;
  let x = e.clientX + 20;
  let y = e.clientY + 20;
  if (x + pw > window.innerWidth - 8) x = e.clientX - pw - 20;
  if (y + ph > window.innerHeight - 8) y = e.clientY - ph - 20;
  picker.style.left = x + 'px';
  picker.style.top = y + 'px';

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

window.addEventListener('contextmenu', (e) => e.preventDefault());
