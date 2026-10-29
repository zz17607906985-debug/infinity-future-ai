'use strict';

/**
 * Relay (API 中转站) balance lookup, main process only.
 * Read-only GETs; the API key is only ever sent as the Authorization header and is never
 * returned, logged or put into error text. Results are cached per (base URL, key) so the
 * settings page can refresh freely without hammering the relay.
 */
const crypto = require('crypto');

const REQUEST_TIMEOUT_MS = 8000;
// How long a result is reused before the relay is asked again (force bypasses this).
const CACHE_MS = {ok: 60 * 1000, unsupported: 10 * 60 * 1000, error: 15 * 1000};
// new-api / one-api report an unlimited token as hard_limit_usd = 100000000.
const UNLIMITED_USD = 1e8;

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

class BalanceError extends Error {}

function balanceBaseUrl(apiUrl) {
  let url;
  try { url = new URL(String(apiUrl || '').trim()); } catch { throw new BalanceError('API 地址无效'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BalanceError('API 地址无效');
  if (url.username || url.password) throw new BalanceError('API 地址不能包含登录凭据');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

function okResult(fields) {
  return {status: 'ok', remaining: null, used: null, total: null, unit: 'USD', unlimited: false, ...fields};
}

// Sub2API: GET /v1/usage (same call as its public "Key Usage" page).
function fromSub2ApiUsage(data) {
  if (!data || typeof data !== 'object' || !('isValid' in data || 'mode' in data)) return null;
  if (data.isValid === false) throw new BalanceError('Key 已失效');
  const unit = String(data.unit || 'USD').toUpperCase();
  if (data.mode === 'quota_limited' && data.quota && typeof data.quota === 'object') {
    const total = num(data.quota.limit);
    return okResult({
      remaining: num(data.quota.remaining),
      used: num(data.quota.used),
      total: total > 0 ? total : null,
      unlimited: !(total > 0),
      unit,
      source: 'sub2api'
    });
  }
  const remaining = num(data.remaining) ?? num(data.balance);
  if (remaining === null) return null;
  return okResult({remaining, used: num(data.usage?.total?.actual_cost), unit, source: 'sub2api'});
}

// OpenAI-compatible billing (new-api / one-api / many relays):
// /v1/dashboard/billing/subscription + /v1/dashboard/billing/usage (total_usage in cents).
function fromOpenAiBilling(subscription, usage) {
  const total = num(subscription?.hard_limit_usd) ?? num(subscription?.system_hard_limit_usd);
  if (total === null) return null;
  const usedCents = num(usage?.total_usage);
  const used = usedCents === null ? null : usedCents / 100;
  if (total >= UNLIMITED_USD) return okResult({unlimited: true, used, source: 'openai-billing'});
  return okResult({total, used, remaining: used === null ? null : Math.max(0, total - used), source: 'openai-billing'});
}

// new-api: GET /api/usage/token with the sk key (values are raw quota units).
function fromNewApiTokenUsage(body) {
  const data = body?.data;
  if (!data || typeof data !== 'object' || body.code === false || body.success === false) return null;
  if (data.unlimited_quota === true) return okResult({unlimited: true, used: num(data.total_used), unit: 'quota', source: 'new-api-token'});
  const remaining = num(data.total_available);
  if (remaining === null) return null;
  return okResult({remaining, used: num(data.total_used), total: num(data.total_granted), unit: 'quota', source: 'new-api-token'});
}

function usageDateRange(now) {
  const end = new Date(now);
  const start = new Date(now - 99 * 24 * 60 * 60 * 1000);
  const day = d => d.toISOString().slice(0, 10);
  return `start_date=${day(start)}&end_date=${day(end)}`;
}

// Returns parsed JSON, or null when the endpoint does not exist on this relay
// (404/405, HTML fallback page, non-JSON). Throws BalanceError for failures worth showing.
async function getJson(fetchImpl, url, apiKey, timeoutMs) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: {Authorization: `Bearer ${apiKey}`, Accept: 'application/json'},
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (err) {
    throw new BalanceError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? '请求超时' : '网络错误');
  }
  if (response.status === 401 || response.status === 403) throw new BalanceError('Key 无效或无权限');
  if (response.status === 429) throw new BalanceError('请求过于频繁');
  if (response.status >= 500) throw new BalanceError(`服务器错误 ${response.status}`);
  if (!response.ok) return null;
  if (!/json/i.test(response.headers.get('content-type') || '')) return null;
  try { return await response.json(); } catch { return null; }
}

async function lookupBalance({base, apiKey, fetchImpl, timeoutMs, now}) {
  const get = endpoint => getJson(fetchImpl, base + endpoint, apiKey, timeoutMs);
  const sub2api = fromSub2ApiUsage(await get('/v1/usage'));
  if (sub2api) return sub2api;
  const subscription = await get('/v1/dashboard/billing/subscription');
  if (num(subscription?.hard_limit_usd) !== null || num(subscription?.system_hard_limit_usd) !== null) {
    const billing = fromOpenAiBilling(subscription, await get(`/v1/dashboard/billing/usage?${usageDateRange(now())}`));
    if (billing) return billing;
  }
  const tokenUsage = fromNewApiTokenUsage(await get('/api/usage/token'));
  if (tokenUsage) return tokenUsage;
  return {status: 'unsupported'};
}

function createBalanceService({readKey, fetchImpl = (...args) => fetch(...args), timeoutMs = REQUEST_TIMEOUT_MS, now = Date.now} = {}) {
  if (typeof readKey !== 'function') throw new TypeError('readKey is required');
  const cache = new Map();

  async function query({providerId, apiUrl, useGlobalKey = false, force = false} = {}) {
    let base;
    let apiKey;
    try {
      base = balanceBaseUrl(apiUrl);
      apiKey = String(await readKey({providerId, useGlobalKey}) || '').trim();
    } catch (err) {
      return {status: 'error', reason: err instanceof BalanceError ? err.message : '无法读取 Key', checkedAt: now()};
    }
    if (!apiKey) return {status: 'error', reason: '未保存 Key', checkedAt: now()};
    // Providers sharing one relay account (same base + key) share one lookup.
    const id = crypto.createHash('sha256').update(`${base}\n${apiKey}`).digest('hex');
    const hit = cache.get(id);
    if (hit?.pending) return hit.pending;
    if (hit && !force && now() - hit.result.checkedAt < CACHE_MS[hit.result.status]) return hit.result;
    const pending = lookupBalance({base, apiKey, fetchImpl, timeoutMs, now})
      .catch(err => ({status: 'error', reason: err instanceof BalanceError ? err.message : '查询异常'}))
      .then(result => {
        // account: a short one-way tag of (base URL, key) so the renderer can tell when two
        // providers bill the same relay account. It cannot be turned back into the key.
        const done = {...result, account: id.slice(0, 12), checkedAt: now()};
        cache.set(id, {result: done});
        return done;
      });
    cache.set(id, {pending});
    return pending;
  }

  return {query};
}

module.exports = {createBalanceService, balanceBaseUrl, fromSub2ApiUsage, fromOpenAiBilling, fromNewApiTokenUsage, CACHE_MS};
