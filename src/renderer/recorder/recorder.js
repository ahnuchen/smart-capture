/* 录屏窗口：直接录制桌面流为 WebM，裁剪由主进程用 ffmpeg 完成。
 * 不用 canvas 中转：canvas.captureStream 依赖合成器出帧，屏幕静止时几乎不出帧。 */
const bridge = window.api;

let stream = null;
let recorder = null;
let stopped = false;

function pickMime() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
}

function stopAndSend() {
  if (stopped) return;
  stopped = true;
  const finish = async () => {
    const parts = (recorder && recorder._parts) || [];
    const blob = new Blob(parts, { type: 'video/webm' });
    const buf = await blob.arrayBuffer();
    console.log('[rec] data ready, bytes =', buf.byteLength, 'chunks =', parts.length);
    bridge.invoke('rec:data', buf);
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  };
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = finish;
    recorder.stop();
  } else {
    finish();
  }
}

bridge.on('rec:start', async (payload) => {
  const { sourceId, fps } = payload || {};
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
          maxWidth: 4096,
          maxHeight: 4096,
          maxFrameRate: fps || 30,
        },
      },
    });

    const mime = pickMime();
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    recorder._parts = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) recorder._parts.push(e.data); };
    recorder.onerror = (e) => console.error('[rec] recorder error:', e && (e.name || e.message || e.type));
    recorder.start(500);
    console.log('[rec] started', mime, stream.getVideoTracks()[0].getSettings());
    bridge.invoke('rec:ready');
  } catch (e) {
    console.error('[rec] 启动失败:', e.message);
    bridge.invoke('rec:cancel', { error: e.message });
  }
});

bridge.on('rec:stopReq', () => stopAndSend());