const VERSION_PATH = /\/v\d+(?:alpha|beta\d*)?$/i;
const KNOWN_ENDPOINT_PATH = /\/(?:models|responses|chat\/completions)$/i;
const NON_CHAT_MODEL = /(?:embedding|rerank|whisper|tts|speech|transcrib|image-generation|dall-e|sora|realtime|moderation)/i;

function normalizeBaseUrl(value) {
  const url = new URL(typeof value === 'string' ? value.trim() : '');
  const localEndpoint = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && localEndpoint)) {
    throw new Error('API 地址必须使用 HTTPS，本机服务可使用 HTTP');
  }
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function normalizeConfiguration(configuration, { fallbackApiKey = '', requireModel = true } = {}) {
  const provider = ['openai', 'deepseek', 'kimi', 'custom'].includes(configuration?.provider) ? configuration.provider : 'custom';
  const protocol = ['auto', 'responses', 'chat-completions'].includes(configuration?.protocol) ? configuration.protocol : 'auto';
  const baseUrl = normalizeBaseUrl(configuration?.baseUrl);
  const apiKey = typeof configuration?.apiKey === 'string' && configuration.apiKey.trim()
    ? configuration.apiKey.trim()
    : fallbackApiKey;
  const model = typeof configuration?.model === 'string' ? configuration.model.trim() : '';
  const reasoning = ['low', 'medium', 'high', 'xhigh'].includes(configuration?.reasoning) ? configuration.reasoning : 'medium';
  if (!apiKey || apiKey.length > 2048) throw new Error('请填写有效的 API 密钥');
  if (requireModel && (!model || model.length > 160)) throw new Error('请填写有效的模型名称');
  return { provider, protocol, baseUrl, apiKey, model, reasoning };
}

function unique(values) { return [...new Set(values)]; }

function apiRoots(configuration) {
  const input = new URL(configuration.baseUrl);
  input.pathname = input.pathname.replace(/\/$/, '').replace(KNOWN_ENDPOINT_PATH, '');
  const root = input.toString().replace(/\/$/, '');
  if (VERSION_PATH.test(input.pathname)) return [root];
  const versioned = `${root}/v1`;
  return configuration.provider === 'custom' ? unique([versioned, root]) : unique([root, versioned]);
}

function requestCandidates(configuration) {
  const responsesFirst = /^(?:gpt-5|codex)/i.test(configuration.model || '');
  const protocols = configuration.protocol === 'auto'
    ? (configuration.provider === 'openai' || responsesFirst ? ['responses', 'chat-completions'] : ['chat-completions', 'responses'])
    : [configuration.protocol];
  return protocols.flatMap((protocol) => apiRoots(configuration).map((root) => ({
    protocol,
    endpoint: `${root}/${protocol === 'responses' ? 'responses' : 'chat/completions'}`
  })));
}

function modelEndpoints(configuration) {
  return apiRoots(configuration).map((root) => `${root}/models`);
}

function parseJsonPayload(responseText) {
  try { return JSON.parse(responseText.replace(/^\uFEFF/, '').trim()); }
  catch { return null; }
}

function contentText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join('');
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.output_text === 'string') return value.output_text;
  if (typeof value.content === 'string' || Array.isArray(value.content)) return contentText(value.content);
  return '';
}

function extractResponseText(payload) {
  if (typeof payload === 'string') return payload;
  if (!payload || typeof payload !== 'object') return '';
  const choice = payload.choices?.[0];
  const directCandidates = [
    choice?.message?.content,
    choice?.text,
    payload.output_text,
    payload.response?.output_text,
    payload.data?.output_text,
    payload.message?.content,
    payload.result,
    payload.content
  ];
  for (const candidate of directCandidates) {
    const text = contentText(candidate).trim();
    if (text) return text;
  }
  const output = Array.isArray(payload.output) ? payload.output : payload.response?.output;
  return Array.isArray(output) ? output.flatMap((item) => Array.isArray(item?.content) ? item.content : []).map(contentText).join('').trim() : '';
}

function reasoningText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(reasoningText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  return reasoningText(value.text || value.content || value.summary || value.output_text || value.reasoning_content);
}

function extractReasoningSummary(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const candidates = [
    payload.reasoning?.summary,
    payload.reasoning?.content,
    payload.reasoning_summary,
    payload.reasoning_content,
    payload.choices?.[0]?.message?.reasoning_content,
    payload.choices?.[0]?.message?.reasoning,
    payload.response?.reasoning?.summary,
    payload.response?.reasoning_summary
  ];
  for (const candidate of candidates) {
    const text = reasoningText(candidate).replace(/\s+/g, ' ').trim();
    if (text) return text.slice(0, 5000);
  }
  const output = Array.isArray(payload.output) ? payload.output : payload.response?.output;
  if (Array.isArray(output)) {
    const summary = output.filter((item) => item?.type === 'reasoning').map((item) => reasoningText(item.summary || item.content || item)).join(' ');
    if (summary.trim()) return summary.replace(/\s+/g, ' ').trim().slice(0, 5000);
  }
  return '';
}

function extractSseText(responseText) {
  const payloads = responseText.split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line && line !== '[DONE]')
    .map(parseJsonPayload)
    .filter(Boolean);
  if (!payloads.length) return '';
  let completed = '';
  const chunks = [];
  for (const payload of payloads) {
    const chatDelta = contentText(payload?.choices?.[0]?.delta?.content);
    const responseDelta = payload?.type === 'response.output_text.delta' ? contentText(payload.delta) : '';
    if (chatDelta) chunks.push(chatDelta);
    if (responseDelta) chunks.push(responseDelta);
    const finalText = payload?.response ? extractResponseText(payload.response) : extractResponseText(payload);
    if (!chatDelta && !responseDelta && finalText) completed = finalText;
  }
  return (completed || chunks.join('')).trim();
}

function responseError(payload, status, requestId, endpoint, responseText = '') {
  const message = payload?.error?.message || payload?.message || `API 请求失败（HTTP ${status}）`;
  const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 180);
  return Object.assign(new Error(message || preview), { status, requestId, endpoint });
}

function headers(apiKey) {
  return {
    accept: 'application/json, text/event-stream, text/plain',
    'content-type': 'application/json',
    authorization: `Bearer ${apiKey}`
  };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || !messages.length || messages.length > 60) throw new Error('消息数量无效');
  return messages.map((message) => {
    const role = ['system', 'developer', 'user', 'assistant'].includes(message?.role) ? message.role : 'user';
    const content = typeof message?.content === 'string' ? message.content.trim() : '';
    if (!content || content.length > 30000) throw new Error('单条消息内容过长或为空');
    return { role, content };
  });
}

async function requestCompatibleAi(fetcher, configuration, messages, { systemPrompt = '', signal } = {}) {
  const safeMessages = validateMessages(messages);
  const requestMessages = systemPrompt && !safeMessages.some((message) => ['system', 'developer'].includes(message.role))
    ? [{ role: 'system', content: systemPrompt }, ...safeMessages]
    : safeMessages;
  const controller = new AbortController();
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => controller.abort(), 90000);
  let lastError;
  try {
    const candidates = requestCandidates(configuration);
    for (let index = 0; index < candidates.length; index += 1) {
      const { endpoint, protocol } = candidates[index];
      const instructions = requestMessages.filter((message) => ['system', 'developer'].includes(message.role)).map((message) => message.content).join('\n\n');
      const responseInput = requestMessages.filter((message) => !['system', 'developer'].includes(message.role));
      const body = protocol === 'responses'
        ? { model: configuration.model, input: responseInput, ...(instructions ? { instructions } : {}), reasoning: { effort: configuration.reasoning || 'medium' }, store: false, stream: false }
        : { model: configuration.model, messages: requestMessages, reasoning_effort: configuration.reasoning || 'medium', stream: false };
      const response = await fetcher(endpoint, {
        method: 'POST', headers: headers(configuration.apiKey), body: JSON.stringify(body), signal: controller.signal
      });
      const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || '';
      const responseText = await response.text();
      const payload = parseJsonPayload(responseText);
      if (!response.ok) {
        lastError = responseError(payload, response.status, requestId, endpoint, responseText);
        if (index < candidates.length - 1 && [400, 404, 405, 415].includes(response.status)) continue;
        throw lastError;
      }
      const contentType = response.headers.get('content-type') || '';
      const parsedContent = payload ? extractResponseText(payload) : extractSseText(responseText);
      const plainContent = !payload && /^text\/plain\b/i.test(contentType) && !/^\s*</.test(responseText) ? responseText.trim() : '';
      const content = (parsedContent || plainContent).trim();
      if (content) return { content, reasoningSummary: extractReasoningSummary(payload), status: response.status, requestId, endpoint, protocol };
      const preview = responseText.replace(/\s+/g, ' ').trim().slice(0, 160);
      lastError = Object.assign(new Error(`API 返回格式不兼容（${contentType || '未知类型'}）${preview ? `：${preview}` : ''}`), { status: response.status, requestId, endpoint });
    }
    throw lastError || new Error('API 没有返回可显示的回复');
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw new Error('请求已中断');
      throw new Error('API 请求超时，请检查网络或服务商状态');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

function extractModels(payload) {
  const source = Array.isArray(payload) ? payload : (Array.isArray(payload?.data) ? payload.data : payload?.models);
  if (!Array.isArray(source)) return [];
  return unique(source.map((model) => {
    if (typeof model === 'string') return model.trim();
    return String(model?.id || model?.model_id || model?.name || '').trim();
  }).filter((id) => id && !NON_CHAT_MODEL.test(id)))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true, sensitivity: 'base' }));
}

async function listCompatibleModels(fetcher, configuration) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let lastError;
  try {
    const endpoints = modelEndpoints(configuration);
    for (let index = 0; index < endpoints.length; index += 1) {
      const endpoint = endpoints[index];
      const response = await fetcher(endpoint, { method: 'GET', headers: headers(configuration.apiKey), signal: controller.signal });
      const requestId = response.headers.get('x-request-id') || response.headers.get('request-id') || '';
      const responseText = await response.text();
      const payload = parseJsonPayload(responseText);
      if (!response.ok) {
        lastError = responseError(payload, response.status, requestId, endpoint, responseText);
        if (index < endpoints.length - 1 && [404, 405].includes(response.status)) continue;
        throw lastError;
      }
      const models = extractModels(payload);
      if (models.length) return { models, endpoint, requestId };
      lastError = Object.assign(new Error('模型接口没有返回可用的对话模型'), { status: response.status, requestId, endpoint });
    }
    throw lastError || new Error('无法从服务端读取模型');
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('模型列表请求超时，请检查网络或服务商状态');
    throw error;
  } finally { clearTimeout(timeout); }
}

module.exports = {
  normalizeConfiguration,
  requestCandidates,
  modelEndpoints,
  extractResponseText,
  extractReasoningSummary,
  extractSseText,
  extractModels,
  requestCompatibleAi,
  listCompatibleModels
};
