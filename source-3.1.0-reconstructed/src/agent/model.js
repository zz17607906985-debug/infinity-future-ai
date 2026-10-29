const http = require('http');
const https = require('https');
const { URL } = require('url');

const SECRET_RE = /(api[_-]?key|authorization|bearer|sk-[a-z0-9]{10,}|xox[baprs]-)/i;

function joinUrl(base, endpoint) {
  const root = String(base || '').replace(/\/$/, '');
  const path = String(endpoint || '').replace(/^\//, '');
  return `${root}/${path}`;
}

function redact(value) {
  if (typeof value === 'string') return SECRET_RE.test(value) ? '[REDACTED]' : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, SECRET_RE.test(key) ? '[REDACTED]' : redact(child)]));
  }
  return value;
}

function openaiTools(specs) {
  return specs.map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
}

function anthropicTools(specs) {
  return specs.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
}

function detectFormat(hint = '', baseUrl = '') {
  const text = `${hint} ${baseUrl}`.toLowerCase();
  if (/anthropic|claude/.test(text)) return 'anthropic';
  return 'openai';
}

// Server-sent events: calls onEvent(parsedJson) for every `data:` line; ignores [DONE] and comments.
function createSseParser(onEvent) {
  let buffer = '';
  return chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '');
      buffer = buffer.slice(index + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try { onEvent(JSON.parse(data)); } catch (_err) { /* partial or non-JSON keep-alive */ }
    }
  };
}

/**
 * POST JSON. With `onSse`, an event-stream response is parsed incrementally and resolves with
 * `{streamed: true}`; a plain JSON response (relay ignored stream) resolves as usual.
 */
function requestJson(url, { method = 'POST', headers = {}, body, timeoutMs = 120_000, signal, onSse } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(url); } catch (err) { reject(err); return; }
    const lib = parsed.protocol === 'http:' ? http : https;
    const payload = body == null ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers }
    }, res => {
      const okStatus = res.statusCode >= 200 && res.statusCode < 300;
      if (onSse && okStatus && /text\/event-stream/i.test(String(res.headers['content-type'] || ''))) {
        const feed = createSseParser(onSse);
        res.setEncoding('utf8');
        res.on('data', feed);
        res.on('end', () => { feed('\n'); resolve({ ok: true, status: res.statusCode, streamed: true, data: null, text: '', headers: res.headers }); });
        res.on('error', reject);
        return;
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (_err) { data = { raw: text }; }
        resolve({ ok: okStatus, status: res.statusCode, data, text, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('模型请求超时')); });
    if (signal) {
      if (signal.aborted) { req.destroy(new Error('已取消')); return; }
      signal.addEventListener('abort', () => req.destroy(new Error('已取消')), { once: true });
    }
    if (payload) req.write(payload);
    req.end();
  });
}

function usageOf(data = {}) {
  const usage = data.usage || {};
  return {
    input: Number(usage.prompt_tokens || usage.input_tokens || 0),
    output: Number(usage.completion_tokens || usage.output_tokens || 0)
  };
}

function parseOpenai(data) {
  const message = data.choices?.[0]?.message || {};
  const toolCalls = (message.tool_calls || []).map(call => ({
    id: String(call.id || `call_${Math.random().toString(16).slice(2)}`),
    name: String(call.function?.name || ''),
    arguments: safeArgs(call.function?.arguments)
  })).filter(call => call.name);
  return { role: 'assistant', content: String(message.content || ''), toolCalls, usage: usageOf(data), stop: data.choices?.[0]?.finish_reason || '' };
}

function parseAnthropic(data) {
  const blocks = Array.isArray(data.content) ? data.content : [];
  const text = blocks.filter(block => block.type === 'text').map(block => block.text || '').join('\n');
  const toolCalls = blocks.filter(block => block.type === 'tool_use').map(block => ({
    id: String(block.id || `toolu_${Math.random().toString(16).slice(2)}`),
    name: String(block.name || ''),
    arguments: block.input && typeof block.input === 'object' ? block.input : safeArgs(block.input)
  })).filter(call => call.name);
  return { role: 'assistant', content: text, toolCalls, usage: usageOf(data), stop: data.stop_reason || '' };
}

function safeArgs(value) {
  if (value && typeof value === 'object') return value;
  try { return JSON.parse(String(value || '{}')); } catch (_err) { return {}; }
}

function isTransientModelStatus(status) {
  return [408, 429, 500, 502, 503, 504].includes(Number(status) || 0);
}

function isTransientModelError(err) {
  const detail = `${err?.code || ''} ${err?.message || ''} ${err?.name || ''}`;
  return /timeout|econnreset|econnrefused|etimedout|socket hang up|network|fetch failed|aborted|ENOTFOUND|EAI_AGAIN/i.test(detail);
}

function modelRetryDelay(attempt, retryAfterHeader = '') {
  const value = String(retryAfterHeader || '').trim();
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
    const date = Date.parse(value);
    if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 30000);
  }
  return Math.min(800 * Math.pow(2, attempt), 4000);
}

function transientModelFailureMessage(status, detail = '') {
  if (Number(status) === 429 || /rate.?limit|429/i.test(detail)) {
    return '接口请求过于频繁或额度受限（HTTP 429）。请稍后再试，或在设置中切换其他 API / 模型。';
  }
  if ([502, 503, 504].includes(Number(status))) {
    return `中转站暂时不可用（HTTP ${status}）。已自动重试仍失败，请稍后重试，或在设置中切换其他 API / 模型。`;
  }
  return '网络不稳定或请求超时，已自动重试仍失败。请检查网络，或在设置中切换其他 API / 模型。';
}

async function requestModelWithRetry(transport, url, options = {}, { retries = 2 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await transport(url, options);
      if (response.ok || !isTransientModelStatus(response.status) || attempt === retries) return response;
      lastError = new Error(modelError(response));
      const delay = modelRetryDelay(attempt, response.headers?.['retry-after'] || response.headers?.['Retry-After'] || '');
      await new Promise(resolve => setTimeout(resolve, delay));
    } catch (err) {
      lastError = err;
      if (!isTransientModelError(err) || attempt === retries) throw err;
      await new Promise(resolve => setTimeout(resolve, modelRetryDelay(attempt)));
    }
  }
  throw lastError || new Error('模型请求失败');
}

/**
 * Call a chat model with tools. `transport` is injectable for tests.
 * Never puts the API key into returned content.
 */
async function chat({
  format = 'openai',
  baseUrl,
  apiKey,
  model,
  system,
  messages,
  tools,
  temperature = 0.2,
  maxTokens = 4096,
  // Reasoning models observed on the user's provider take ~2 minutes per non-streamed step;
  // 120s idle timeouts aborted legitimate runs. The user can still stop the run at any time.
  timeoutMs = 300_000,
  signal,
  onDelta,
  transport = requestJson
} = {}) {
  if (!baseUrl || !apiKey || !model) throw new Error('请先在设置中配置聊天供应商、模型和密钥');
  const anthropic = format === 'anthropic';
  const url = joinUrl(baseUrl, anthropic ? '/v1/messages' : '/chat/completions');
  const headers = anthropic ? { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' } : { Authorization: `Bearer ${apiKey}` };
  const body = anthropic
    ? {
      model,
      max_tokens: maxTokens,
      temperature,
      system: system || undefined,
      tools: anthropicTools(tools || []),
      messages: (messages || []).filter(item => item.role !== 'system').map(toAnthropicMessage)
    }
    : {
      model,
      temperature,
      max_tokens: maxTokens,
      ...(tools?.length ? { tools: openaiTools(tools), tool_choice: 'auto' } : {}),
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        ...flattenMessagesForOpenai(messages || [])
      ]
    };
  const send = async stream => {
    const assembler = stream ? createStreamAssembler(anthropic ? 'anthropic' : 'openai', onDelta) : null;
    const response = await requestModelWithRetry(transport, url, {
      method: 'POST',
      headers,
      body: stream ? { ...body, stream: true, ...(anthropic ? {} : { stream_options: { include_usage: true } }) } : body,
      timeoutMs,
      signal,
      ...(stream ? { onSse: assembler.push } : {})
    }, { retries: 2 });
    return { response, assembler };
  };
  const endpoint = `${url} ${model}`;
  let { response, assembler } = await send(!!onDelta && !NON_STREAMING_ENDPOINTS.has(endpoint));
  // Some relays reject `stream` / `stream_options`; retry once without streaming.
  if (assembler && !response.ok && Number(response.status) === 400 && /stream/i.test(modelError(response))) {
    NON_STREAMING_ENDPOINTS.add(endpoint);
    ({ response, assembler } = await send(false));
  }
  const assertOk = () => {
    if (response.ok) return;
    const detail = modelError(response);
    throw new Error(`${detail}\n\n${transientModelFailureMessage(response.status, detail)}`);
  };
  assertOk();
  if (response.streamed && assembler) {
    const reply = assembler.result();
    if (reply.stop) return reply;
    // Stream closed without a finish reason (relays cut idle streams while reasoning models think):
    // the reply is incomplete, so ask again without streaming and stop streaming to this endpoint.
    NON_STREAMING_ENDPOINTS.add(endpoint);
    ({ response } = await send(false));
    assertOk();
  }
  return anthropic ? parseAnthropic(response.data) : parseOpenai(response.data);
}

/**
 * Rebuilds a complete reply from streamed chunks. OpenAI tool-call deltas are merged by `index`
 * (id/name arrive once, `arguments` arrives in pieces); Anthropic tool input arrives as
 * input_json_delta fragments per content block.
 */
// Endpoints (url + model) whose streaming proved unusable in this process; they get plain requests.
const NON_STREAMING_ENDPOINTS = new Set();

function createStreamAssembler(format, onDelta = () => {}) {
  let content = '';
  let stop = '';
  const usage = { input: 0, output: 0 };
  const calls = new Map();
  const callAt = key => {
    if (!calls.has(key)) calls.set(key, { id: '', name: '', args: '' });
    return calls.get(key);
  };
  const addText = text => {
    if (!text) return;
    content += text;
    onDelta(text, content);
  };
  const push = event => {
    if (format === 'anthropic') {
      if (event.type === 'message_start') usage.input = Number(event.message?.usage?.input_tokens || 0);
      if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
        Object.assign(callAt(event.index), { id: event.content_block.id || '', name: event.content_block.name || '' });
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') addText(event.delta.text);
        if (event.delta?.type === 'input_json_delta') callAt(event.index).args += event.delta.partial_json || '';
      }
      if (event.type === 'message_delta') {
        stop = event.delta?.stop_reason || stop;
        usage.output = Number(event.usage?.output_tokens || usage.output);
      }
      return;
    }
    if (event.usage) Object.assign(usage, usageOf(event));
    const choice = event.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) stop = choice.finish_reason;
    addText(choice.delta?.content || '');
    for (const delta of choice.delta?.tool_calls || []) {
      const call = callAt(delta.index ?? 0);
      if (delta.id) call.id = delta.id;
      if (delta.function?.name) call.name += delta.function.name;
      if (delta.function?.arguments) call.args += delta.function.arguments;
    }
  };
  const result = () => ({
    role: 'assistant',
    content,
    toolCalls: [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([, call]) => ({
      id: call.id || `call_${Math.random().toString(16).slice(2)}`,
      name: call.name,
      arguments: safeArgs(call.args)
    })).filter(call => call.name),
    usage: { ...usage },
    stop
  });
  return { push, result };
}

function visionParts(text, images = []) {
  const parts = [];
  if (text) parts.push({ type: 'text', text: String(text) });
  for (const image of images || []) {
    if (!image?.base64) continue;
    const mime = image.mime || 'image/png';
    parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${image.base64}` } });
  }
  return parts;
}

function toOpenaiMessage(message) {
  if (message.role === 'tool') {
    // OpenAI tool messages are text-only; attach images as a follow-up user vision turn via flattenMessages.
    return { role: 'tool', tool_call_id: message.toolCallId, content: String(message.content || '') };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map(call => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } }))
    };
  }
  if (message.images?.length) return { role: message.role === 'assistant' ? 'assistant' : 'user', content: visionParts(message.content, message.images) };
  return { role: message.role, content: String(message.content || '') };
}

/** Expand tool messages that carry screenshots into tool text + user image message. */
function flattenMessagesForOpenai(messages = []) {
  const out = [];
  for (const message of messages || []) {
    out.push(toOpenaiMessage(message));
    if (message.role === 'tool' && message.images?.length) {
      out.push({
        role: 'user',
        content: visionParts('（工具返回的截图，请结合图像继续）', message.images)
      });
    }
  }
  return out;
}

function toAnthropicMessage(message) {
  if (message.role === 'tool') {
    const content = [{ type: 'text', text: String(message.content || '') }];
    for (const image of message.images || []) {
      if (!image?.base64) continue;
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: image.mime || 'image/png', data: image.base64 }
      });
    }
    return { role: 'user', content: [{ type: 'tool_result', tool_use_id: message.toolCallId, content }] };
  }
  if (message.role === 'assistant' && message.toolCalls?.length) {
    return {
      role: 'assistant',
      content: [
        ...(message.content ? [{ type: 'text', text: message.content }] : []),
        ...message.toolCalls.map(call => ({ type: 'tool_use', id: call.id, name: call.name, input: call.arguments || {} }))
      ]
    };
  }
  if (message.images?.length) {
    const content = [];
    if (message.content) content.push({ type: 'text', text: String(message.content) });
    for (const image of message.images) {
      if (!image?.base64) continue;
      content.push({ type: 'image', source: { type: 'base64', media_type: image.mime || 'image/png', data: image.base64 } });
    }
    return { role: message.role === 'assistant' ? 'assistant' : 'user', content };
  }
  return { role: message.role === 'assistant' ? 'assistant' : 'user', content: String(message.content || '') };
}

function modelError(response) {
  const data = response.data || {};
  return data.error?.message || data.message || data.error || `模型请求失败 HTTP ${response.status}`;
}

function summarizeResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return truncateSummary(result);
  try { return truncateSummary(JSON.stringify(redact(result))); } catch (_err) { return '[unserializable]'; }
}

function truncateSummary(text, limit = 400) {
  const value = String(text || '');
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

module.exports = {
  chat,
  isTransientModelStatus,
  isTransientModelError,
  requestModelWithRetry,
  transientModelFailureMessage,
  detectFormat,
  flattenMessagesForOpenai,
  openaiTools,
  anthropicTools,
  parseOpenai,
  parseAnthropic,
  createSseParser,
  createStreamAssembler,
  redact,
  requestJson,
  summarizeResult,
  toOpenaiMessage,
  toAnthropicMessage,
  visionParts
};
