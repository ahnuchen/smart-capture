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

// 透明窗没有 devtools 入口时，靠 console-message 转发到终端
window.addEventListener('error', (e) => console.error('[overlay] uncaught:', e.message, (e.error && e.error.stack) || ''));
window.addEventListener('unhandledrejection', (e) => console.error('[overlay] rejection:', (e.reason && e.reason.stack) || e.reason));

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
let tool = 'rect';
let color = '#ff3b30';
let strokeWidth = 4;
let history = []; // 每步 fc JSON
let histIdx = -1;
let draft = null; // 拖拽创建中的临时对象
let drawStart = null; // {x,y} 画布内坐标
let mosaicDraft = null; // 马赛克拖拽起点 {x,y}
let mosaicFull = null; // 覆盖整个选区的像素化底图（fabric.Image）
let editingText = false; // 正在输入标注文字

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
    flushUpdate().then(copyFinish);
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

function isEditingText() {
  if (editingText) return true;
  const a = fc && fc.getActiveObject && fc.getActiveObject();
  return !!(a && a.isEditing);
}

function handleEscape() {
  if (mode === 'confirm' && isEditingText()) {
    const a = fc.getActiveObject();
    if (a && a.exitEditing) a.exitEditing();
    editingText = false;
    return; // 文字编辑中 ESC 只退出编辑，不要重选区
  }
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

function copyFinish() {
  return bridge.invoke('shot:copy-finish').catch((e) => console.error('[overlay] copy-finish 失败:', e.message));
}

function handleEnter() {
  if (mode === 'confirm' && !isEditingText()) flushUpdate().then(copyFinish);
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
  // 先上报选区（工具条依赖它），标注层失败也不能拖垮选区流程
  await flushUpdate();
  try {
    setupAnnotation();
    layoutSel();
  } catch (e) {
    console.error('[overlay] 标注层初始化失败:', e && e.message);
    if (typeof fabric === 'undefined') hideTip();
  }
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
  if (!bridge._sent) {
    bridge._sent = true;
    bridge.invoke('shot:selection', payload).catch((e) => console.error('[overlay] shot:selection 失败:', e.message));
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
  if (fc) {
    fc.setDimensions({ width: rect.w, height: rect.h });
    buildMosaicFull(); // 像素化底图与选区绑定，调整选区后需重建
  }
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
  // 热区 24px（见 .handle::after），边带在角上让位 12px，避免角手柄抢走边手柄的点击
  const BAND = 12;
  const setBand = (side, l, t, ww, hh) => {
    const el = adj.querySelector(`.band.${side}`);
    if (el) { el.style.left = l + 'px'; el.style.top = t + 'px'; el.style.width = ww + 'px'; el.style.height = hh + 'px'; }
  };
  setBand('n', x + BAND, y - BAND + 1, Math.max(0, w - BAND * 2), 24);
  setBand('s', x + BAND, y + h - BAND + 1, Math.max(0, w - BAND * 2), 24);
  setBand('w', x - BAND + 1, y + BAND, 24, Math.max(0, h - BAND * 2));
  setBand('e', x + w - BAND + 1, y + BAND, 24, Math.max(0, h - BAND * 2));
}

function buildAdj() {
  adj.innerHTML = '';
  // 边带先入 DOM、手柄后入：重叠处手柄优先（否则边带会盖住边中点手柄抢走缩放点击）
  for (const side of ['n', 's', 'w', 'e']) {
    const el = document.createElement('div');
    el.className = 'band ' + side;
    el.dataset.cur = 'move';
    el.addEventListener('mousedown', (e) => startAdjDrag(e, 'move'));
    adj.appendChild(el);
  }
  for (const k of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const el = document.createElement('div');
    el.className = 'handle';
    el.dataset.cur = k;
    el.addEventListener('mousedown', (e) => startAdjDrag(e, k));
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
  if (fc) { buildAdj(); applyTool(); return; } // 重新选区：画布复用，热区重建
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
  fc.on('path:created', () => commit());
  fc.on('object:modified', commit);
  fc.on('text:editing:entered', () => { editingText = true; });
  fc.on('text:editing:exited', (e) => {
    editingText = false;
    const obj = e && e.target;
    if (obj && (!String(obj.text || '').trim() || obj.text === placeholderText())) fc.remove(obj);
    commit();
  });
  fc.on('object:added', (e) => {
    const o = e && e.target;
    if (o && o.type === 'i-text') o.set({ selectable: true, evented: true });
  });
}

function resetConfirmState() {
  annWrap.style.display = 'none';
  adj.style.display = 'none';
  bridge._sent = false;
  editingText = false;
  mosaicFull = null;
  mosaicDraft = null;
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
  fc.isDrawingMode = tool === 'pencil';
  fc.selection = tool === 'pencil' ? false : true;
  // 没有独立「选择」工具：对象始终可点选拖动，只有点空白处才触发画形状
  fc.forEachObject((o) => {
    o.set({ selectable: true, evented: true });
  });
  if (fc.isDrawingMode) {
    const brush = new fabric.PencilBrush(fc);
    brush.width = strokeWidth;
    brush.color = color;
    fc.freeDrawingBrush = brush;
  }
  const el = document.getElementById('ann');
  if (el) el.style.cursor = 'crosshair';
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
  if (!fc || fc.isDrawingMode) return;
  const p = fc.getPointer(opt.e);
  // 点在已有标注上 = 拖动它，不开新框；文字输入中同样不触发
  if (editingText || opt.target) return;
  if (tool === 'text') { addText(p.x, p.y); return; }
  if (tool === 'mosaic') {
    if (!mosaicFull) return;
    mosaicDraft = { x: p.x, y: p.y };
    draft = cloneMosaic();
    draft.set({ selectable: false, evented: false });
    fc.add(draft);
    setMosaicBox(draft, p.x, p.y, 0, 0);
    return;
  }
  if (['rect', 'ellipse', 'line', 'arrow', 'highlighter'].includes(tool)) {
    drawStart = { x: p.x, y: p.y };
    draft = createShape(tool, p.x, p.y, p.x, p.y);
    if (draft) { draft.set({ selectable: false, evented: false }); fc.add(draft); }
  }
}

function onFcMove(opt) {
  if (!fc || fc.isDrawingMode || !draft) return;
  const p = fc.getPointer(opt.e);
  if (tool === 'mosaic' && mosaicDraft) {
    setMosaicBox(draft, Math.min(mosaicDraft.x, p.x), Math.min(mosaicDraft.y, p.y), Math.abs(p.x - mosaicDraft.x), Math.abs(p.y - mosaicDraft.y));
    fc.requestRenderAll();
    return;
  }
  if (drawStart) {
    updateShape(draft, tool, drawStart.x, drawStart.y, p.x, p.y);
    fc.requestRenderAll();
  }
}

function onFcUp(opt) {
  if (!fc || fc.isDrawingMode) return;
  const p = fc.getPointer(opt.e);
  if (tool === 'mosaic' && draft) {
    const start = mosaicDraft;
    mosaicDraft = null;
    const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
    if (w < 4 || h < 4) fc.remove(draft);
    else {
      setMosaicBox(draft, Math.min(start.x, p.x), Math.min(start.y, p.y), w, h);
      draft.set({ selectable: true, evented: true });
      commit();
    }
    draft = null;
    return;
  }
  if (draft && drawStart) {
    const w = Math.abs(p.x - drawStart.x), h = Math.abs(p.y - drawStart.y);
    if (w < 4 && h < 4) {
      fc.remove(draft); // 太小，丢弃
    } else {
      draft.set({ selectable: true, evented: true });
      commit();
    }
    draft = null;
    drawStart = null;
  }
}

function createShape(kind, x1, y1, x2, y2) {
  const hl = Math.max(10, strokeWidth * 3);
  const common = { fill: 'transparent', stroke: color, strokeWidth, strokeUniform: true };
  if (kind === 'rect') return new fabric.Rect({ ...common, left: x1, top: y1, width: 0, height: 0 });
  if (kind === 'highlighter') return new fabric.Rect({ left: x1, top: y1, width: 0, height: 0, fill: hexToRgba(color, 0.35), stroke: 'transparent' });
  if (kind === 'ellipse') return new fabric.Ellipse({ ...common, left: x1, top: y1, rx: 0, ry: 0 });
  if (kind === 'line') return new fabric.Line([x1, y1, x2, y2], { ...common, fill: '', strokeLineCap: 'round' });
  if (kind === 'arrow') {
    // 用两条 Line 组合，不用 fabric.Path：路径归一化会把超长箭头的包围盒算错导致整条不显示
    const a = Math.atan2(y2 - y1, x2 - x1);
    const o = { ...common, fill: '', strokeLineCap: 'round', strokeLineJoin: 'round' };
    return new fabric.Group(
      [
        new fabric.Line([x1, y1, x2, y2], o),
        new fabric.Line([x2, y2, x2 - hl * Math.cos(a - 0.42), y2 - hl * Math.sin(a - 0.42)], o),
        new fabric.Line([x2, y2, x2 - hl * Math.cos(a + 0.42), y2 - hl * Math.sin(a + 0.42)], o),
      ],
      { originX: 'center', originY: 'center' }
    );
  }
  return null;
}

function updateShape(obj, kind, x1, y1, x2, y2) {
  if (kind === 'rect' || kind === 'highlighter') {
    obj.set({ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) });
  } else if (kind === 'ellipse') {
    obj.set({ left: Math.min(x1, x2), top: Math.min(y1, y2), rx: Math.abs(x2 - x1) / 2, ry: Math.abs(y2 - y1) / 2 });
  } else if (kind === 'line') {
    obj.set({ x1, y1, x2, y2 });
    obj.setCoords();
  } else if (kind === 'arrow') {
    // Group 的包围盒只在创建时算，拖拽时直接重建（Path 归一化对长箭头会算错，故不用 Path）
    const next = createShape('arrow', x1, y1, x2, y2);
    if (!next) return;
    fc.remove(obj);
    fc.add(next);
    draft = next;
  }
}

/* ---------- 文字标注 ---------- */
function placeholderText() {
  return window.i18n.t('overlay.textPh');
}

function addText(x, y) {
  if (!fc) return;
  const t = new fabric.IText(placeholderText(), {
    left: x,
    top: y,
    fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
    fontSize: Math.max(14, Math.round(strokeWidth * 5)),
    fill: color,
    editable: true,
    originX: 'left',
    originY: 'top',
  });
  fc.add(t);
  fc.setActiveObject(t);
  t.enterEditing();
  t.selectAll();
  fc.requestRenderAll();
}

/* ---------- 马赛克：整幅像素化底图 + 裁剪显示，拖拽过程实时跟随 ---------- */
function buildMosaicFull() {
  if (!fc) return;
  const vw = Math.max(1, Math.round(rect.w * ratio));
  const vh = Math.max(1, Math.round(rect.h * ratio));
  const block = Math.max(6, Math.round(10 * ratio));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(vw / block));
  small.height = Math.max(1, Math.round(vh / block));
  small.getContext('2d').drawImage(bg, rect.x * ratio, rect.y * ratio, vw, vh, 0, 0, small.width, small.height);
  const big = document.createElement('canvas');
  big.width = vw;
  big.height = vh;
  const bctx = big.getContext('2d');
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(small, 0, 0, vw, vh);
  mosaicFull = new fabric.Image(big, {
    left: rect.w / 2,
    top: rect.h / 2,
    originX: 'center',
    originY: 'center',
    selectable: false,
    evented: false,
    hoverCursor: 'default',
  });
}

function cloneMosaic() {
  return new fabric.Image(mosaicFull.getElement(), {
    left: rect.w / 2,
    top: rect.h / 2,
    originX: 'center',
    originY: 'center',
    scaleX: mosaicFull.scaleX,
    scaleY: mosaicFull.scaleY,
    hoverCursor: 'default',
  });
}

// 把像素化底图裁剪到给定选区局部矩形（CSS 坐标）
function setMosaicBox(img, x, y, w, h) {
  const sc = mosaicFull.scaleX || 1;
  img.set({
    left: x + w / 2,
    top: y + h / 2,
    width: Math.max(1, Math.round((w * ratio) / sc)),
    height: Math.max(1, Math.round((h * ratio) / sc)),
    cropX: (x * ratio) / sc,
    cropY: (y * ratio) / sc,
  });
  img.setCoords();
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
      o.set({ selectable: true, evented: true });
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
