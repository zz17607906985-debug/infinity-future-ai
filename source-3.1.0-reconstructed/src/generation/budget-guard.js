(() => {
  'use strict';

  function money(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.round(number * 1000000) / 1000000 : 0;
  }

  function dayKey(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function normalizeEstimates(estimates) {
    const totals = new Map();
    for (const estimate of Array.isArray(estimates) ? estimates : []) {
      const amount = money(estimate?.maxAmount ?? estimate?.amount);
      if (!amount) continue;
      const currency = String(estimate?.currency || 'USD').toUpperCase();
      totals.set(currency, money((totals.get(currency) || 0) + amount));
    }
    return [...totals.entries()].map(([currency, amount]) => ({currency, amount}));
  }

  function usageFor(ledger, {projectId = '', day = dayKey(), currency = 'USD'} = {}) {
    const entries = Array.isArray(ledger) ? ledger : [];
    const normalizedCurrency = String(currency || 'USD').toUpperCase();
    const relevant = entries.filter(item => String(item?.currency || 'USD').toUpperCase() === normalizedCurrency);
    const sum = items => money(items.reduce((total, item) => total + money(item?.estimatedMaxAmount ?? item?.estimatedAmount), 0));
    return {
      daily: sum(relevant.filter(item => item.day === day)),
      project: sum(relevant.filter(item => item.projectId === projectId))
    };
  }

  function evaluateBudget({estimates = [], currency = 'USD', singleLimit = 0, dailyLimit = 0, projectLimit = 0, projectId = '', day = dayKey(), ledger = []} = {}) {
    const normalizedCurrency = String(currency || 'USD').toUpperCase();
    const normalized = normalizeEstimates(estimates);
    const activeLimits = {
      single: money(singleLimit),
      daily: money(dailyLimit),
      project: money(projectLimit)
    };
    const hasLimit = Object.values(activeLimits).some(Boolean);
    const currencyMismatch = hasLimit && normalized.some(item => item.currency !== normalizedCurrency);
    const estimate = money(normalized.find(item => item.currency === normalizedCurrency)?.amount || 0);
    const usage = usageFor(ledger, {projectId, day, currency: normalizedCurrency});
    const exceededScopes = [];
    if (activeLimits.single && estimate > activeLimits.single) exceededScopes.push('single');
    if (activeLimits.daily && usage.daily + estimate > activeLimits.daily) exceededScopes.push('daily');
    if (activeLimits.project && usage.project + estimate > activeLimits.project) exceededScopes.push('project');
    return {
      allowed: !currencyMismatch && !exceededScopes.length,
      currency: normalizedCurrency,
      estimates: normalized,
      estimate,
      limits: activeLimits,
      usage,
      projected: {daily: money(usage.daily + estimate), project: money(usage.project + estimate)},
      currencyMismatch,
      exceededScopes
    };
  }

  function recordEstimate(ledger, entry = {}) {
    const next = (Array.isArray(ledger) ? ledger : []).map(item => Object.assign({}, item));
    next.push({
      id: String(entry.id || `budget-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`),
      projectId: String(entry.projectId || ''),
      nodeId: String(entry.nodeId || ''),
      day: String(entry.day || dayKey()),
      currency: String(entry.currency || 'USD').toUpperCase(),
      estimatedAmount: money(entry.estimatedAmount),
      estimatedMinAmount: money(entry.estimatedMinAmount ?? entry.estimatedAmount),
      estimatedMaxAmount: money(entry.estimatedMaxAmount ?? entry.estimatedAmount),
      actualRequests: 0,
      kind: String(entry.kind || ''),
      model: String(entry.model || ''),
      priceSource: String(entry.priceSource || 'unknown'),
      sourceUpdatedAt: String(entry.sourceUpdatedAt || ''),
      status: 'submitted',
      override: Boolean(entry.override),
      differenceReason: '',
      createdAt: Number(entry.createdAt || Date.now()),
      finishedAt: 0
    });
    return next.slice(-5000);
  }

  function completeEntry(ledger, id, result = {}) {
    return (Array.isArray(ledger) ? ledger : []).map(item => item.id !== id ? Object.assign({}, item) : Object.assign({}, item, {
      actualRequests: Math.max(0, Number(result.actualRequests || 0)),
      actualAmount: result.actualAmount == null || !Number.isFinite(Number(result.actualAmount)) ? null : money(result.actualAmount),
      differenceAmount: result.actualAmount == null || !Number.isFinite(Number(result.actualAmount))
        ? null
        : money(Number(result.actualAmount) - Number(item.estimatedAmount || 0)),
      status: String(result.status || 'completed'),
      differenceReason: String(result.differenceReason || (Number(result.actualRequests || 0) !== 1 ? `实际请求 ${Number(result.actualRequests || 0)} 次` : '')),
      finishedAt: Number(result.finishedAt || Date.now())
    }));
  }

  function routeSuggestions(candidates = [], preference = 'balanced') {
    const list = (Array.isArray(candidates) ? candidates : []).map((item, index) => ({
      providerId: String(item.providerId || ''),
      modelId: String(item.modelId || item.model || ''),
      price: item.price == null ? null : money(item.price),
      latencyMs: Number.isFinite(Number(item.latencyMs)) ? Math.max(0, Number(item.latencyMs)) : null,
      quality: Number.isFinite(Number(item.quality)) ? Number(item.quality) : null,
      index
    })).filter(item => item.modelId);
    const score = item => {
      const price = item.price == null ? .5 : Math.min(1, item.price / Math.max(1, ...list.filter(x => x.price != null).map(x => x.price)));
      const latency = item.latencyMs == null ? .5 : Math.min(1, item.latencyMs / Math.max(1, ...list.filter(x => x.latencyMs != null).map(x => x.latencyMs)));
      const quality = item.quality == null ? .5 : 1 - Math.max(0, Math.min(1, item.quality / 100));
      if (preference === 'price') return price * .7 + latency * .2 + quality * .1;
      if (preference === 'speed') return latency * .7 + price * .2 + quality * .1;
      if (preference === 'quality') return quality * .7 + price * .15 + latency * .15;
      return price * .33 + latency * .33 + quality * .34;
    };
    return list.map(item => ({...item, score: Math.round(score(item) * 1000) / 1000})).sort((a, b) => a.score - b.score);
  }

  function decisionText(decision) {
    if (!decision) return '';
    if (decision.currencyMismatch) {
      const currencies = decision.estimates.map(item => item.currency).join(' + ');
      return `预算币种是 ${decision.currency}，但模型价格使用 ${currencies}，无法直接比较。`;
    }
    const labels = {single: '单次任务', daily: '今日累计', project: '当前项目累计'};
    return decision.exceededScopes.map(scope => `${labels[scope]}将超过预算 ${decision.currency} ${decision.limits[scope]}`).join('\n');
  }

  window.FutureAIBudgetGuard = {
    money,
    dayKey,
    normalizeEstimates,
    usageFor,
    evaluateBudget,
    recordEstimate,
    completeEntry,
    routeSuggestions,
    decisionText
  };
})();
