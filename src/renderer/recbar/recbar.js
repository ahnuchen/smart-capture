/* 录制控制条：计时 + 停止/取消，按住非按钮区可拖动窗口 */
const bridge = window.api;
const timeEl = document.getElementById('time');
const statusEl = document.getElementById('status');
const btnStop = document.getElementById('btnStop');

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
}

bridge.on('rec:mode', ({ mode }) => {
  if (mode !== 'live') return;
  btnStop.disabled = false;
  statusEl.style.display = 'none';
  timeEl.textContent = '00:00';
});

bridge.on('rec:tick', ({ seconds }) => { timeEl.textContent = fmtTime(seconds); });

/* 拖动：按下非按钮区域即移动窗口（屏幕坐标增量交给主进程） */
let cleanup = null;
function onDragDown(e) {
  if (e.button !== 0 || (e.target && e.target.tagName === 'BUTTON')) return;
  e.preventDefault();
  if (cleanup) cleanup();
  bridge.invoke('rec:bar-drag-start', { x: e.screenX, y: e.screenY });
  const onMove = (ev) => bridge.invoke('rec:bar-drag-move', { x: ev.screenX, y: ev.screenY });
  const onUp = () => { done(); bridge.invoke('rec:bar-drag-end'); };
  const done = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (cleanup === done) cleanup = null;
  };
  cleanup = done;
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
document.addEventListener('mousedown', onDragDown);

document.getElementById('btnCancel').addEventListener('click', () => bridge.invoke('rec:cancel'));
btnStop.addEventListener('click', () => {
  btnStop.disabled = true;
  statusEl.style.display = 'inline';
  statusEl.textContent = '正在保存…';
  bridge.invoke('rec:stop');
});