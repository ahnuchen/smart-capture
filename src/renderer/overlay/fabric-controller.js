/* Fabric 标注控制器：标注层的全部命令式逻辑收敛在这里。
 * Vue 不碰 canvas 子树；覆盖窗 boot 通过 configure({bg,getRect,getRatio,onCommit}) 注入环境，
 * 对外只暴露有限方法。rect/ratio 每次经 getter 现取，避免状态两份。
 */
(function () {
  let fc = null;
  let tool = null; // 未选中工具 = 画布不接收事件，避免干扰选区/热区
  let color = '#ff3b30';
  let strokeWidth = 4;
  let textSize = 20; // 文字工具字号，与线宽分开
  let history = [];
  let histIdx = -1;
  let draft = null;
  let drawStart = null;
  let mosaicDraft = null;
  let mosaicFull = null;
  let editingText = false;

  let bg = null;
  let getRect = () => null;
  let getRatio = () => 1;
  let onCommit = () => {};

  function configure(opts) {
    bg = opts.bg;
    getRect = opts.getRect;
    getRatio = opts.getRatio;
    onCommit = opts.onCommit;
  }

  function lockObject(o) {
    if (!o) return o;
    return o.set({ selectable: false, evented: false, hasControls: false, hasBorders: false, hoverCursor: 'default' });
  }

  function ensure() {
    if (fc) { applyTool(); return; }
    fc = new fabric.Canvas('ann', {
      selection: false,
      preserveObjectStacking: true,
      renderOnFireOnAdd: false,
    });
    fc.backgroundColor = 'transparent';
    applyTool();
    requestAnimationFrame(() => fc.renderAll());

    fc.on('mouse:down', onFcDown);
    fc.on('mouse:move', onFcMove);
    fc.on('mouse:up', onFcUp);
    fc.on('path:created', (e) => { lockObject(e && e.path); commit(); });
    fc.on('object:modified', commit);
    fc.on('text:editing:entered', () => { editingText = true; });
    fc.on('text:editing:exited', (e) => {
      editingText = false;
      const obj = e && e.target;
      if (obj && !String(obj.text || '').trim()) fc.remove(obj);
      lockObject(obj);
      commit();
    });
  }

  function reset() {
    editingText = false;
    mosaicFull = null;
    mosaicDraft = null;
    draft = null;
    drawStart = null;
    if (fc) {
      fc.clear();
      fc.getObjects().slice().forEach((o) => fc.remove(o));
      history = [];
      histIdx = -1;
      fc.requestRenderAll();
      // 不调 commit()：那会触发一次多余的补发上报
    }
  }

  function applyTool() {
    if (!fc) return;
    const on = !!tool;
    fc.isDrawingMode = on && tool === 'pencil';
    fc.selection = false; // 标注对象不参与画布框选
    fc.forEachObject((o) => lockObject(o));
    if (fc.upperCanvasEl) fc.upperCanvasEl.style.pointerEvents = on ? 'auto' : 'none';
    if (on) {
      if (fc.isDrawingMode) {
        const brush = new fabric.PencilBrush(fc);
        brush.width = strokeWidth;
        brush.color = color;
        fc.freeDrawingBrush = brush;
      }
      const el = document.getElementById('ann');
      if (el) el.style.cursor = 'crosshair';
    }
  }

  function setTool(next, style) {
    if (style) {
      if (style.color) color = style.color;
      if (style.width) strokeWidth = style.width;
      if (style.size) textSize = style.size;
    }
    if (next === tool) { applyTool(); return; }
    if (fc) fc.discardActiveObject();
    tool = next || null;
    applyTool();
    if (fc) fc.requestRenderAll();
  }

  function setColor(c) { color = c; applyTool(); }
  function setWidth(w) { strokeWidth = w; applyTool(); }
  function setSize(s) { textSize = Math.min(96, Math.max(10, Number(s) || 20)); }

  function isEditingText() {
    if (editingText) return true;
    const a = fc && fc.getActiveObject && fc.getActiveObject();
    return !!(a && a.isEditing);
  }

  function exitEditing() {
    const a = fc && fc.getActiveObject && fc.getActiveObject();
    if (a && a.exitEditing) a.exitEditing();
    editingText = false;
  }

  function onFcDown(opt) {
    if (!fc || !tool || fc.isDrawingMode) return;
    const rect = getRect();
    if (!rect) return;
    const p = fc.getPointer(opt.e);
    if (editingText) return; // 文字输入中不触发画框
    if (tool === 'text') { addText(p.x, p.y); return; }
    if (tool === 'mosaic') {
      if (!mosaicFull) buildMosaicFull();
      if (!mosaicFull) return;
      mosaicDraft = { x: p.x, y: p.y };
      draft = cloneMosaic();
      fc.add(draft);
      setMosaicBox(draft, p.x, p.y, 0, 0);
      return;
    }
    if (['rect', 'ellipse', 'line', 'arrow', 'highlighter'].includes(tool)) {
      drawStart = { x: p.x, y: p.y };
      draft = createShape(tool, p.x, p.y, p.x, p.y);
      if (draft) { lockObject(draft); fc.add(draft); }
    }
  }

  function onFcMove(opt) {
    if (!fc || !tool || fc.isDrawingMode || !draft) return;
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
    if (!fc || !tool || fc.isDrawingMode) return;
    const p = fc.getPointer(opt.e);
    if (tool === 'mosaic' && draft) {
      const start = mosaicDraft;
      mosaicDraft = null;
      const w = Math.abs(p.x - start.x), h = Math.abs(p.y - start.y);
      if (w < 4 || h < 4) fc.remove(draft);
      else {
        setMosaicBox(draft, Math.min(start.x, p.x), Math.min(start.y, p.y), w, h);
        lockObject(draft);
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
        lockObject(draft);
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
      // 用三条 Line 组 Group，不用 fabric.Path：路径归一化会把超长箭头的包围盒算错导致整条不显示
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
      // Group 的包围盒只在创建时算，拖拽时直接重建
      const next = createShape('arrow', x1, y1, x2, y2);
      if (!next) return;
      fc.remove(obj);
      fc.add(next);
      draft = next;
    }
  }

  function addText(x, y) {
    if (!fc) return;
    const t = new fabric.IText('', {
      left: x,
      top: y,
      fontFamily: '"Microsoft YaHei", "Segoe UI", sans-serif',
      fontSize: Math.min(96, Math.max(10, Math.round(textSize))),
      fill: color,
      editable: true,
      originX: 'left',
      originY: 'top',
    });
    fc.add(t);
    fc.setActiveObject(t);
    t.enterEditing();
    fc.requestRenderAll();
  }

  /* ---------- 马赛克：整幅像素化底图 + 裁剪显示，拖拽过程实时跟随 ---------- */
  function buildMosaicFull() {
    if (!fc) return;
    const rect = getRect();
    const ratio = getRatio();
    if (!rect) return;
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
    // 源图是物理像素（rect.w*ratio 宽），scale=1/ratio 后 1 CSS px = 1/ratio 元素像素，
    // 后面用左上角锚点 + cropX/cropY 就能直接用 CSS 坐标裁剪，不需要居中换算
    mosaicFull = new fabric.Image(big, {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      scaleX: 1 / ratio,
      scaleY: 1 / ratio,
      selectable: false,
      evented: false,
      hoverCursor: 'default',
    });
  }

  function cloneMosaic() {
    const ratio = getRatio();
    return new fabric.Image(mosaicFull.getElement(), {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      scaleX: 1 / ratio,
      scaleY: 1 / ratio,
      hoverCursor: 'default',
    });
  }

  // 把像素化底图裁剪到给定选区局部矩形（CSS 坐标）
  function setMosaicBox(img, x, y, w, h) {
    const ratio = getRatio();
    img.set({
      left: Math.round(x),
      top: Math.round(y),
      width: Math.max(1, Math.round(w * ratio)),
      height: Math.max(1, Math.round(h * ratio)),
      cropX: Math.round(x * ratio),
      cropY: Math.round(y * ratio),
    });
    img.dirty = true;
    img.setCoords();
  }

  /* ---------- 历史（撤销/重做） ---------- */
  function commit() {
    if (!fc) return;
    const snap = JSON.stringify(fc.toJSON());
    history = history.slice(0, histIdx + 1);
    history.push(snap);
    histIdx = history.length - 1;
    onCommit();
  }
  function restore(snap) {
    if (!fc) return;
    fc.loadFromJSON(snap, () => {
      fc.getObjects().forEach(lockObject);
      fc.renderAll();
      onCommit();
    });
  }
  function undo() { if (histIdx > 0) { histIdx--; restore(history[histIdx]); } }
  function redo() { if (histIdx < history.length - 1) { histIdx++; restore(history[histIdx]); } }
  function clear() {
    if (!fc) return;
    fc.clear();
    fc.backgroundColor = 'transparent';
    fc.renderAll();
    commit();
  }
  function hasObjects() { return !!(fc && fc.getObjects().length); }
  function toDataURL(opts) { return fc ? fc.toDataURL(opts) : null; }
  function resize(w, h) {
    if (!fc) return;
    fc.setDimensions({ width: w, height: h });
    buildMosaicFull();
  }

  function hexToRgba(hex, a) {
    const h = hex.replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  window.FabricController = {
    configure, ensure, reset, applyTool, setTool, setColor, setWidth,
    isEditingText, exitEditing, undo, redo, clear, hasObjects, toDataURL, resize, setSize,
  };
})();
