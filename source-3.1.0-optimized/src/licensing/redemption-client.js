'use strict';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 256 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeRedemptionCode(input) {
  const compact = String(input || '').toUpperCase().replace(/[\s-]+/g, '');
  if (!/^FAI1[A-Z0-9]{16}$/.test(compact)) throw new Error('兑换码格式无效');
  return compact.match(/.{4}/g).join('-');
}

function normalizeEndpoint(input, {allowInsecureLocalhost = false} = {}) {
  let url;
  try { url = new URL(String(input || '')); } catch { throw new Error('授权服务地址无效'); }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowInsecureLocalhost && local && url.protocol === 'http:')) {
    throw new Error('授权服务必须使用 HTTPS');
  }
  if (url.username || url.password || url.hash || url.search) throw new Error('授权服务地址无效');
  return url.toString().replace(/\/$/, '');
}

async function readJsonResponse(response) {
  let value;
  if (typeof response.text === 'function') {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('授权服务响应过大');
    try { value = JSON.parse(text); } catch { throw new Error('授权服务响应格式无效'); }
  } else {
    value = await response.json();
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('授权服务响应格式无效');
  return value;
}

function createRedemptionClient(options = {}) {
  const endpoint = normalizeEndpoint(options.endpoint, options);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const timeoutMs = Number(options.timeoutMs || DEFAULT_TIMEOUT_MS);
  if (typeof fetchImpl !== 'function') throw new Error('当前环境不支持在线激活');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw new Error('授权服务超时配置无效');

  async function post(route, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`${endpoint}/${route}`, {
        method: 'POST',
        headers: {'content-type': 'application/json', accept: 'application/json'},
        body: JSON.stringify(payload),
        signal: controller.signal,
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store'
      });
      const body = await readJsonResponse(response);
      if (!response.ok) {
        const code = String(body.code || 'ACTIVATION_REJECTED').slice(0, 64);
        throw new Error(code);
      }
      return body;
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('ACTIVATION_TIMEOUT');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({
    async resolve(redemptionCode) {
      const result = await post('resolve', {redemptionCode: normalizeRedemptionCode(redemptionCode)});
      if (!UUID.test(String(result.licenseId || ''))) throw new Error('授权服务返回的许可证无效');
      return Object.freeze({licenseId: result.licenseId.toLowerCase()});
    },
    async activate(redemptionCode, activationRequest) {
      const request = String(activationRequest || '').trim();
      if (!request || Buffer.byteLength(request, 'utf8') > 128 * 1024) throw new Error('设备激活请求无效');
      const result = await post('activate', {
        redemptionCode: normalizeRedemptionCode(redemptionCode),
        activationRequest: request
      });
      const activationCode = typeof result.activationCode === 'string'
        ? result.activationCode
        : JSON.stringify(result.activationCode || null);
      if (!activationCode || activationCode === 'null' || Buffer.byteLength(activationCode, 'utf8') > 128 * 1024) {
        throw new Error('授权服务返回的激活证书无效');
      }
      return Object.freeze({activationCode});
    },
    async deactivate(receipt) {
      if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
        || Buffer.byteLength(JSON.stringify(receipt), 'utf8') > 64 * 1024) {
        throw new Error('停用回执无效');
      }
      const result = await post('deactivate', {receipt});
      if (result.deactivated !== true) throw new Error('授权服务未确认解除');
      return Object.freeze({deactivated: true});
    }
  });
}

module.exports = {createRedemptionClient, normalizeEndpoint, normalizeRedemptionCode};
