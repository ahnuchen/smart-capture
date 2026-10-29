/* 录屏窗口：直接录制桌面流为 WebM，分片交给主进程追加写临时文件（1 小时也不会撑爆内存）。
 * 裁剪、转码、预览都由主进程完成。 */
const bridge = window.api;

let stream = null;
let recorder = null;
let stopped = false;
let sendChain = Promise.resolve();

function pickMime() {
  return ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
}

function stopAndSend() {
  if (stopped) return;
  stopped = true;
  const finish = () => sendChain
    .then(() => bridge.invoke('rec:done'))
    .catch((e) => console.error('[rec] 收尾失败:', e.message));
  if (recorder && recorder.state !== 'inactive') {
    recorder.onstop = finish;
    recorder.stop();
  } else {
    finish();
  }
}

bridge.on('rec:start', async (payload) => {
  const { sourceId, fps, timeslice } = payload || {};
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
    recorder.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      // 必须串行发送，主进程 appendFile 的顺序才不会乱
      sendChain = sendChain
        .then(async () => {
          const buf = await e.data.arrayBuffer();
          await bridge.invoke('rec:chunk', buf);
        })
        .catch((err) => console.error('[rec] 分片发送失败:', err.message));
    };
    recorder.onerror = (e) => console.error('[rec] recorder error:', e && (e.name || e.message || e.type));
    recorder.start(timeslice || 2000);
    console.log('[rec] started', mime, stream.getVideoTracks()[0].getSettings());
    bridge.invoke('rec:ready');
  } catch (e) {
    console.error('[rec] 启动失败:', e.message);
    bridge.invoke('rec:cancel', { error: e.message });
  }
});

bridge.on('rec:stopReq', () => stopAndSend());