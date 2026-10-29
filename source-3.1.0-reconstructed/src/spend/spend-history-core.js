(function initSpendHistory(global) {
  'use strict';

  // 花费记录：每次生成结束后，顶栏余额的真实变化（balance-spend.js 量到的「−$0.04」）记一条。
  // 只记真实扣费，不记估算；估算仍在 budget-guard 的账本里，面板里两者分开显示。
  const MAX_EVENTS = 3000;
  const EPSILON = 1e-9;

  const isNum = value => typeof value === 'number' && Number.isFinite(value);
  const round = value => Math.round(Number(value || 0) * 1000000) / 1000000;

  function dayKey(value = Date.now()) {
    const date = value instanceof Date ? value : new Date(value);
    return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
  }

  function normalizeUnit(unit) {
    const code = String(unit || '').trim().toUpperCase();
    if (code === 'RMB') return 'CNY';
    return code || 'USD';
  }

  function addEvent(history, event = {}) {
    const list = Array.isArray(history) ? history.filter(Boolean) : [];
    const amount = Number(event.amount);
    if (!isNum(amount) || amount <= EPSILON) return list;
    const at = isNum(Number(event.at)) && Number(event.at) > 0 ? Number(event.at) : Date.now();
    list.push({
      id: String(event.id || `spend-${at}-${Math.random().toString(16).slice(2, 7)}`),
      at,
      day: dayKey(at),
      amount: round(amount),
      unit: normalizeUnit(event.unit),
      providerId: String(event.providerId || ''),
      providerName: String(event.providerName || ''),
      projectId: String(event.projectId || ''),
      projectName: String(event.projectName || ''),
      tasks: Math.max(1, Math.round(Number(event.tasks || 1)))
    });
    return list.slice(-MAX_EVENTS);
  }

  function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  function addTo(map, unit, amount) {
    map[unit] = round((map[unit] || 0) + amount);
  }

  // 今天 / 近 7 天 / 本月 / 当前项目 / 全部，按币种分开累计（不同币种不能相加）。
  function summarize(history, {now = Date.now(), projectId = ''} = {}) {
    const today = startOfDay(now);
    const week = today - 6 * 86400000;
    const monthDate = new Date(now);
    const month = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getTime();
    const out = {today: {}, week: {}, month: {}, project: {}, all: {}, count: 0, tasks: 0};
    for (const item of Array.isArray(history) ? history : []) {
      if (!item || !isNum(item.amount) || !isNum(item.at)) continue;
      const unit = normalizeUnit(item.unit);
      out.count += 1;
      out.tasks += Math.max(1, Number(item.tasks || 1));
      addTo(out.all, unit, item.amount);
      if (item.at >= today) addTo(out.today, unit, item.amount);
      if (item.at >= week) addTo(out.week, unit, item.amount);
      if (item.at >= month) addTo(out.month, unit, item.amount);
      if (projectId && item.projectId === projectId) addTo(out.project, unit, item.amount);
    }
    return out;
  }

  // 最近 N 天每天的花费（主币种），给小柱状图用；没有花费的日子也保留为 0。
  function dailySeries(history, {now = Date.now(), days = 14, unit = ''} = {}) {
    const list = Array.isArray(history) ? history : [];
    const main = unit ? normalizeUnit(unit) : mainUnit(list);
    const today = startOfDay(now);
    const series = [];
    for (let index = days - 1; index >= 0; index -= 1) {
      const start = new Date(today);
      start.setDate(start.getDate() - index);
      series.push({day: dayKey(start), label: `${start.getMonth() + 1}/${start.getDate()}`, amount: 0});
    }
    const byDay = new Map(series.map(item => [item.day, item]));
    for (const item of list) {
      if (!item || normalizeUnit(item.unit) !== main) continue;
      const slot = byDay.get(item.day || dayKey(item.at));
      if (slot) slot.amount = round(slot.amount + Number(item.amount || 0));
    }
    return {unit: main, series, max: Math.max(0, ...series.map(item => item.amount))};
  }

  function mainUnit(history) {
    const totals = {};
    for (const item of Array.isArray(history) ? history : []) {
      if (item && isNum(item.amount)) addTo(totals, normalizeUnit(item.unit), item.amount);
    }
    const best = Object.entries(totals).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : 'USD';
  }

  function formatAmount(amount, unit) {
    const value = Number(amount || 0);
    const code = normalizeUnit(unit);
    if (code === 'QUOTA') return `${Math.round(value).toLocaleString('zh-CN')} 额度`;
    // 至少 2 位小数；小额保留到 4 位，避免 $0.004 显示成 $0.00。
    const text = value.toFixed(value >= 1 ? 2 : 4).replace(/(\.\d\d\d*?)0+$/, '$1');
    if (code === 'USD') return `$${text}`;
    if (code === 'CNY') return `¥${text}`;
    return `${text} ${code}`;
  }

  // {USD: 0.12, CNY: 3} → "$0.12 + ¥3.00"；没有花费时 "$0.00"
  function formatTotals(totals, fallbackUnit = 'USD') {
    const entries = Object.entries(totals || {}).filter(([, amount]) => amount > EPSILON);
    if (!entries.length) return formatAmount(0, fallbackUnit);
    return entries.map(([unit, amount]) => formatAmount(amount, unit)).join(' + ');
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function pad(value) { return String(value).padStart(2, '0'); }

  function timeText(at) {
    const date = new Date(at);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  // 带 BOM 的 CSV，Excel 直接双击打开中文不乱码。
  function toCsv(history) {
    const rows = [['时间', '金额', '币种', 'API 服务', '项目', '生成次数']];
    for (const item of Array.isArray(history) ? history : []) {
      if (!item) continue;
      rows.push([timeText(item.at), item.amount, normalizeUnit(item.unit), item.providerName || '', item.projectName || '', item.tasks || 1]);
    }
    return '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  // 余额提醒：剩余余额（同币种）低于设定值时返回 true；0 或未设置表示不提醒。
  function isLowBalance(state, threshold) {
    const limit = Number(threshold || 0);
    if (!(limit > 0) || !state || state.status !== 'ok' || state.unlimited) return false;
    if (String(state.unit || '').toUpperCase() === 'QUOTA') return false;
    return isNum(state.remaining) && state.remaining < limit;
  }

  global.FutureAISpendHistory = {MAX_EVENTS, dayKey, addEvent, summarize, dailySeries, mainUnit, formatAmount, formatTotals, toCsv, timeText, isLowBalance};
})(typeof window !== 'undefined' ? window : globalThis);
