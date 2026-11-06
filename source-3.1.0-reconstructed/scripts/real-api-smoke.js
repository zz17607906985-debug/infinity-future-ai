'use strict';

const fs = require('fs');
const path = require('path');

const env = process.env;
const baseUrl = String(env.FUTUREAI_API_URL || '').trim().replace(/\/$/, '');
const apiKey = String(env.FUTUREAI_API_KEY || '').trim();
const mode = String(env.FUTUREAI_SMOKE_MODE || 'all').toLowerCase();
const timeoutMs = Math.max(5000, Math.min(900000, Number(env.FUTUREAI_SMOKE_TIMEOUT_MS || 180000)));

function join(endpoint) {
  const value = String(endpoint || '').trim();
  return /^https?:\/\//i.test(value) ? value : `${baseUrl}/${value.replace(/^\//, '')}`;
}

function redact(value) {
  const text = String(value || '');
  return apiKey ? text.replaceAll(apiKey, '[REDACTED]') : text;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { return {raw: text}; }
}

function extractUrl(data) {
  const first = data?.data?.[0] || data?.output?.[0] || data;
  return String(first?.url || first?.video_url || first?.videoUrl || first?.content_url || data?.url || '').trim();
}

function extractInlineImage(data) {
  const first = data?.data?.[0] || data?.output?.[0] || data;
  return String(first?.b64_json || first?.base64 || first?.image_base64 || '').trim();
}

function extractTaskId(data) {
  return String(data?.id || data?.task_id || data?.video_id || data?.data?.id || '').trim();
}

async function requestJson(endpoint, body) {
  const res = await fetchWithTimeout(join(endpoint), {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}`},
    body: JSON.stringify(body)
  });
  const data = await readResponse(res);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${redact(data?.error?.message || data?.message || data?.raw || res.statusText)}`);
  return data;
}

async function smokeText() {
  const model = String(env.FUTUREAI_TEXT_MODEL || '').trim();
  if (!model) throw new Error('缺少 FUTUREAI_TEXT_MODEL');
  const data = await requestJson(env.FUTUREAI_TEXT_ENDPOINT || '/chat/completions', {
    model,
    messages: [{role: 'user', content: env.FUTUREAI_TEXT_PROMPT || 'Reply with exactly: FUTUREAI_SMOKE_OK'}],
    max_tokens: 32,
    temperature: 0
  });
  const text = data?.choices?.[0]?.message?.content || data?.output_text || data?.text || '';
  if (!String(text).trim()) throw new Error('文本接口未返回可读内容');
  return {kind: 'text', model, responseText: String(text).slice(0, 200)};
}

async function smokeImage() {
  const model = String(env.FUTUREAI_IMAGE_MODEL || '').trim();
  if (!model) throw new Error('缺少 FUTUREAI_IMAGE_MODEL');
  const size = env.FUTUREAI_IMAGE_SIZE || '1024x576';
  const data = await requestJson(env.FUTUREAI_IMAGE_ENDPOINT || '/images/generations', {
    model,
    prompt: env.FUTUREAI_IMAGE_PROMPT || 'A simple neutral geometric composition, no text',
    size,
    n: 1
  });
  const url = extractUrl(data);
  const inline = extractInlineImage(data);
  if (url || inline) return {kind: 'image', model, requestedSize: size, status: 'completed', urlReturned: Boolean(url), inlineDataReturned: Boolean(inline)};
  const id = extractTaskId(data);
  const queryTemplate = env.FUTUREAI_IMAGE_QUERY_ENDPOINT || '';
  if (!id || !queryTemplate) throw new Error('图片接口未返回图片 URL、内联数据或可查询任务 ID');
  let last = {};
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const res = await fetchWithTimeout(join(queryTemplate.replace('{id}', encodeURIComponent(id))), {
      headers: {Accept: 'application/json', Authorization: `Bearer ${apiKey}`}
    });
    last = await readResponse(res);
    if (!res.ok) throw new Error(`图片任务查询失败 HTTP ${res.status}: ${redact(last?.message || last?.raw || res.statusText)}`);
    const resultUrl = extractUrl(last);
    const resultInline = extractInlineImage(last);
    if (resultUrl || resultInline) return {kind: 'image', model, requestedSize: size, status: 'completed', taskId: id, urlReturned: Boolean(resultUrl), inlineDataReturned: Boolean(resultInline)};
    const status = String(last.status || last.state || last.detail?.status || '').toLowerCase();
    if (/failed|error|cancel|reject/.test(status)) throw new Error(`图片任务失败：${redact(last.message || last.detail?.failure_reason || status)}`);
  }
  throw new Error(`图片任务超时，任务 ID ${id}，最后状态：${redact(JSON.stringify(last).slice(0, 300))}`);
}

async function smokeVideoCase(label, body) {
  const data = await requestJson(env.FUTUREAI_VIDEO_ENDPOINT || '/videos', body);
  const immediate = extractUrl(data);
  if (immediate) return {label, model: body.model, status: 'completed', urlReturned: true};
  const id = extractTaskId(data);
  if (!id) throw new Error(`${label} 未返回视频 URL 或任务 ID`);
  const queryTemplate = env.FUTUREAI_VIDEO_QUERY_ENDPOINT || '/videos/{id}';
  const contentTemplate = env.FUTUREAI_VIDEO_CONTENT_ENDPOINT || '/videos/{id}/content';
  let last = {};
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 2500));
    const queryEndpoint = queryTemplate.replace('{id}', encodeURIComponent(id));
    const res = await fetchWithTimeout(join(queryEndpoint), {headers: {Accept: 'application/json', Authorization: `Bearer ${apiKey}`}});
    last = await readResponse(res);
    if (!res.ok) throw new Error(`${label} 查询失败 HTTP ${res.status}: ${redact(last?.message || last?.raw || res.statusText)}`);
    if (extractUrl(last)) return {label, model: body.model, status: 'completed', taskId: id, urlReturned: true};
    const status = String(last.status || last.state || last.detail?.status || '').toLowerCase();
    if (/failed|error|cancel|reject/.test(status)) throw new Error(`${label} 任务失败：${redact(last.message || last.detail?.failure_reason || status)}`);
    if (/completed|succeeded|success/.test(status)) {
      const content = await fetchWithTimeout(join(contentTemplate.replace('{id}', encodeURIComponent(id))), {headers: {Authorization: `Bearer ${apiKey}`}});
      if (content.ok) return {label, model: body.model, status: 'completed', taskId: id, contentStatus: content.status};
    }
  }
  throw new Error(`${label} 超时，任务 ID ${id}，最后状态：${redact(JSON.stringify(last).slice(0, 300))}`);
}

async function main() {
  if (!baseUrl || !apiKey) throw new Error('需要 FUTUREAI_API_URL 和 FUTUREAI_API_KEY');
  if (env.FUTUREAI_REAL_API_CONFIRM !== '1') throw new Error('真实 API 可能产生费用；设置 FUTUREAI_REAL_API_CONFIRM=1 后才允许执行');
  const evidence = {startedAt: new Date().toISOString(), baseUrl, mode, requests: []};
  if (mode === 'all' || mode === 'text') evidence.requests.push(await smokeText());
  if (mode === 'all' || mode === 'image') evidence.requests.push(await smokeImage());
  if (mode === 'all' || mode === 'video') {
    const model = String(env.FUTUREAI_VIDEO_MODEL || '').trim();
    if (!model) throw new Error('缺少 FUTUREAI_VIDEO_MODEL');
    const prompt = env.FUTUREAI_VIDEO_PROMPT || 'A simple 2 second neutral camera movement, no text';
    const size = env.FUTUREAI_VIDEO_SIZE || '1280x720';
    const seconds = Number(env.FUTUREAI_VIDEO_SECONDS || 2);
    evidence.requests.push(await smokeVideoCase('text-to-video', {model, prompt, size, seconds, operation: 'text-to-video'}));
    if (env.FUTUREAI_FIRST_FRAME_URL && env.FUTUREAI_LAST_FRAME_URL) {
      evidence.requests.push(await smokeVideoCase('first-last-frame', {model, prompt, size, seconds, operation: 'first-last-frame', input_reference: env.FUTUREAI_FIRST_FRAME_URL, last_frame: env.FUTUREAI_LAST_FRAME_URL}));
    }
    if (env.FUTUREAI_EXTEND_VIDEO_URL) {
      evidence.requests.push(await smokeVideoCase('extend', {model, prompt, size, seconds, operation: 'extend', input_video: env.FUTUREAI_EXTEND_VIDEO_URL, extend_direction: env.FUTUREAI_EXTEND_DIRECTION || 'forward'}));
    }
  }
  evidence.finishedAt = new Date().toISOString();
  const out = path.resolve(env.FUTUREAI_SMOKE_EVIDENCE || path.join('dist', 'real-api-smoke-evidence.json'));
  fs.mkdirSync(path.dirname(out), {recursive: true});
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2), 'utf8');
  console.log(JSON.stringify({...evidence, evidenceFile: out}, null, 2));
}

main().catch(err => {
  console.error(`真实 API 抽样未通过：${redact(err.message || err)}`);
  process.exitCode = 1;
});
