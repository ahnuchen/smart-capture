// OpenAI 兼容的大模型客户端：流式 SSE + 429 限流重试
const DEFAULT_TIMEOUT = 120000;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 流式对话。onDelta(kind, delta, full) 中 kind 为 'content' | 'reasoning'。
 * 返回 { content, reasoning } 全文。
 */
async function chatStream({ provider, model, messages, onDelta, signal }) {
  const url = String(provider.baseURL || '').replace(/\/+$/, '') + '/chat/completions';
  const maxRetries = 4;
  let lastErr = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify({ model, messages, stream: true }),
        signal,
      });
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      lastErr = new Error(`网络请求失败：${e.message}`);
      await sleep(1500 * (attempt + 1));
      continue;
    }

    // 平台限流：每密钥 3 秒 1 次，超限返回 429 + Retry-After
    if (res.status === 429 && attempt < maxRetries) {
      const ra = parseFloat(res.headers.get('retry-after'));
      await sleep((isNaN(ra) ? 3 : ra) * 1000 + 400);
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(`API 密钥无效或无权限（HTTP ${res.status}），请在设置中检查密钥`);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 400);
      // 5xx 等服务端错误做有限重试
      if (res.status >= 500 && attempt < maxRetries) {
        lastErr = new Error(`服务端错误 HTTP ${res.status}: ${text}`);
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw new Error(`API 错误 HTTP ${res.status}: ${text}`);
    }

    const contentType = res.headers.get('content-type') || '';
    // 服务端不支持流式时直接返回完整 JSON
    if (contentType.includes('application/json')) {
      const j = await res.json();
      const msg = j.choices && j.choices[0] && j.choices[0].message || {};
      const content = msg.content || '';
      const reasoning = msg.reasoning_content || '';
      if (content) onDelta('content', content, content);
      return { content, reasoning };
    }

    // SSE 流解析
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let content = '';
    let reasoning = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return { content, reasoning };
        try {
          const j = JSON.parse(data);
          const delta = (j.choices && j.choices[0] && j.choices[0].delta) || {};
          if (delta.reasoning_content) {
            reasoning += delta.reasoning_content;
            onDelta('reasoning', delta.reasoning_content, reasoning);
          }
          if (delta.content) {
            content += delta.content;
            onDelta('content', delta.content, content);
          }
        } catch (_) {
          /* 忽略无法解析的行 */
        }
      }
    }
    return { content, reasoning };
  }
  throw lastErr || new Error('请求失败（已重试）');
}

module.exports = { chatStream };
