/* 钉图窗口：只负责显示图片 + 拖动 + 关闭（纯 DOM） */
const bridge = window.api;
const img = document.getElementById('img');
const closeBtn = document.getElementById('close');

closeBtn.title = window.i18n.t('pin.close');

bridge.on('pin:init', (payload) => {
  const len = payload && payload.image ? String(payload.image).length : 0;
  console.log('[pin] init received, image length =', len);
  if (len) img.src = payload.image;
});
img.addEventListener('load', () => console.log('[pin] image loaded', img.naturalWidth + 'x' + img.naturalHeight));
img.addEventListener('error', () => console.error('[pin] image failed to load'));

let closed = false;
function close() {
  if (closed) return;
  closed = true;
  console.log('[pin] close');
  bridge.invoke('pin:close');
}

// 关闭：按下即关（不依赖 down/up 落在同一元素上的 click 事件），另外保留 click 兜底
closeBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); close(); });
closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
document.addEventListener('contextmenu', (e) => { e.preventDefault(); close(); });
document.addEventListener('dblclick', close);

/* 拖动：pointer 与 mouse 双通道（哪个能收到就用哪个），位移交给主进程 setBounds */
let dragging = false;
let cleanup = null;

function beginDrag(sx, sy) {
  if (dragging) return;
  dragging = true;
  console.log('[pin] drag start at', sx, sy);
  bridge.invoke('pin:drag-start', { x: sx, y: sy });
  const onMove = (ev) => bridge.invoke('pin:drag-move', { x: ev.screenX, y: ev.screenY });
  const onUp = () => { endDrag(); bridge.invoke('pin:drag-end'); };
  const endDrag = () => {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragging = false;
    if (cleanup === endDrag) cleanup = null;
  };
  cleanup = endDrag;
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function onDown(e) {
  if (e.button !== 0 || e.target === closeBtn) return;
  e.preventDefault();
  if (cleanup) cleanup();
  beginDrag(e.screenX, e.screenY);
}
document.addEventListener('pointerdown', onDown);
document.addEventListener('mousedown', onDown);
