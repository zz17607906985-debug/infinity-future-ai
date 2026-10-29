(() => {
  'use strict';

  /**
   * 自动重试规则（纯函数，无界面）。
   * 只重试“肯定没扣费”的临时故障：服务方明确拒绝（HTTP 429 / 502 / 503），或电脑当时处于断网状态。
   * 超时、500、504、取消、审核拦截、余额/Key 问题都不自动重试，避免重复扣费。
   */
  const SAFE_STATUSES = [429, 502, 503];
  const DELAYS_MS = [15000, 45000, 90000];
  const MAX_RETRIES = 3;

  function normalizeLimit(value, fallback = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.max(0, Math.min(MAX_RETRIES, Math.round(number)));
  }

  function errorStatus(err) {
    const direct = Number(err?.status || err?.statusCode || 0);
    if (direct) return direct;
    const match = String(err?.message || '').match(/^HTTP\s+(\d{3})\b/);
    return match ? Number(match[1]) : 0;
  }

  function isNetworkFailure(err) {
    const detail = `${err?.code || ''} ${err?.message || ''} ${err?.name || ''}`;
    return /failed to fetch|fetch failed|network|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(detail);
  }

  function isRetrySafeError(err, {online = true} = {}) {
    if (!err || err.afterSubmit || err.canceled || err.name === 'AbortError') return false;
    if (/取消|cancel/i.test(String(err.message || ''))) return false;
    const status = errorStatus(err);
    if (SAFE_STATUSES.includes(status)) return true;
    if (status) return false;
    return online === false && isNetworkFailure(err);
  }

  function delayFor(retryNumber, err) {
    const index = Math.max(1, Number(retryNumber) || 1) - 1;
    const base = DELAYS_MS[Math.min(index, DELAYS_MS.length - 1)];
    const retryAfter = Number(err?.retryAfterMs || 0);
    return Number.isFinite(retryAfter) && retryAfter > base ? Math.min(retryAfter, 120000) : base;
  }

  function waitingMessage(retryNumber, limit, delayMs) {
    const seconds = Math.max(1, Math.round(Number(delayMs || 0) / 1000));
    return `临时故障，${seconds} 秒后自动重试（第 ${retryNumber}/${limit} 次）`;
  }

  const api = {SAFE_STATUSES, MAX_RETRIES, normalizeLimit, errorStatus, isRetrySafeError, delayFor, waitingMessage};
  if (typeof window !== 'undefined') window.FutureAIAutoRetry = api;
  else globalThis.FutureAIAutoRetry = api;
})();
