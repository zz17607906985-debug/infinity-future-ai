(function initBalanceSpend(global) {
  'use strict';

  // Generation spend tracking for the top-bar balance chip ("−$0.04" flash).
  // A generation takes a balance snapshot of its provider when it starts (reusing a recent one),
  // and once it — and every generation overlapping it on the same relay account — has finished,
  // the balance is re-read with backoff until the relay has booked the cost. Overlapping
  // generations share one baseline, so they end in one combined flash. Every lookup goes through
  // the existing provider:balance channel (main-process cache, key never leaves main).
  const RETRY_DELAYS_MS = [1500, 4000, 8000]; // waits between re-reads after the last finish
  const FAILED_RETRY_DELAYS_MS = [4000]; // a failed run is rarely billed: one late look only
  const SNAPSHOT_FRESH_MS = 15000; // a baseline this recent is reused instead of asking again
  // A generation that never reports back (crash between start and finish) must not keep its
  // account's session open forever and swallow later flashes; long video jobs fit well inside.
  const STALE_SESSION_MS = 30 * 60 * 1000;
  const EPSILON = 1e-9;

  const isNum = value => typeof value === 'number' && Number.isFinite(value);

  // Spend between two snapshots of the same account (positive = spent, negative = top-up/reset).
  // Sub2API reports what this key was actually billed (usage.total.actual_cost → used), which is
  // exact per key; elsewhere the drop in remaining balance is the best measure.
  function spendBetween(before, after) {
    if (before?.status !== 'ok' || after?.status !== 'ok') return null;
    if (String(before.unit || '').toUpperCase() !== String(after.unit || '').toUpperCase()) return null;
    if (before.source === 'sub2api' && after.source === 'sub2api' && isNum(before.used) && isNum(after.used)) {
      return {amount: after.used - before.used, unit: after.unit, via: 'used'};
    }
    if (isNum(before.remaining) && isNum(after.remaining)) return {amount: before.remaining - after.remaining, unit: after.unit, via: 'remaining'};
    if (isNum(before.used) && isNum(after.used)) return {amount: after.used - before.used, unit: after.unit, via: 'used'};
    return null;
  }

  // "−$0.04"; small image costs keep up to 4 decimals so they do not round to $0.00.
  // Returns '' when there is nothing worth showing.
  function formatSpend(amount, unit) {
    if (!isNum(amount) || amount <= EPSILON) return '';
    const code = String(unit || '').toUpperCase();
    if (code === 'QUOTA') {
      const units = Math.round(amount);
      return units > 0 ? `−${units.toLocaleString('zh-CN')} 额度` : '';
    }
    const digits = amount >= 0.1 ? 2 : amount >= 0.01 ? 3 : 4;
    const text = amount.toFixed(digits).replace(/(\.\d\d\d*?)0+$/, '$1');
    if (!(Number(text) > 0)) return '';
    const symbol = code === 'USD' ? '$' : (code === 'CNY' || code === 'RMB') ? '¥' : '';
    return symbol ? `−${symbol}${text}` : `−${text} ${unit || ''}`.trim();
  }

  function createSpendTracker(deps) {
    const {fetchFresh, state, onSpend, onSettled} = deps;
    const now = deps.now || Date.now;
    const schedule = deps.schedule || ((fn, ms) => setTimeout(fn, ms));
    const cancel = deps.cancel || (timer => clearTimeout(timer));
    const sessions = new Map();

    function live(session) {
      if (!session) return null;
      if (session.active > 0 && now() - session.touchedAt > STALE_SESSION_MS) {
        if (session.timer) cancel(session.timer);
        sessions.delete(session.key);
        return null;
      }
      return session;
    }
    const sessionFor = providerId => live([...sessions.values()].find(session => session.providerIds.has(providerId)));

    function fresh(provider) {
      return Promise.resolve().then(() => fetchFresh(provider)).catch(() => null);
    }

    function baseline(provider) {
      const running = sessionFor(provider.id);
      if (running) return Promise.resolve({session: running});
      const cached = state(provider.id);
      if (cached?.status === 'ok' && isNum(cached.checkedAt) && now() - cached.checkedAt <= SNAPSHOT_FRESH_MS) return Promise.resolve({snap: cached});
      return fresh(provider).then(snap => ({snap}));
    }

    // Returns a ticket for finish(); null when there is no provider to measure.
    function start(provider) {
      if (!provider?.id) return null;
      const ticket = {provider, session: null, finished: false};
      ticket.ready = baseline(provider).then(({session, snap}) => {
        if (!session) {
          if (snap?.status !== 'ok') return; // unsupported / lookup failed: nothing to measure
          const key = snap.account ? `account:${snap.account}` : `provider:${provider.id}`;
          session = live(sessions.get(key));
          if (!session) {
            session = {key, provider, baseline: snap, latest: snap, providerIds: new Set(), active: 0, completed: 0, attempt: 0, timer: null, touchedAt: now()};
            sessions.set(key, session);
          }
        }
        session.providerIds.add(provider.id);
        session.active += 1;
        session.touchedAt = now();
        // Joining a session that was already settling: keep its baseline (so both costs add up)
        // and settle again once this generation finishes too.
        if (session.timer) {
          cancel(session.timer);
          session.timer = null;
        }
        ticket.session = session;
      });
      return ticket;
    }

    // Resolves true when the ticket is being measured (false: caller may fall back).
    function finish(ticket, {status = 'completed'} = {}) {
      if (!ticket || ticket.finished) return Promise.resolve(false);
      ticket.finished = true;
      return ticket.ready.then(() => {
        const session = ticket.session;
        if (!session || sessions.get(session.key) !== session) return false;
        if (status !== 'failed') session.completed += 1;
        session.active -= 1;
        if (session.active <= 0) {
          session.active = 0;
          session.attempt = 0;
          settle(session);
        }
        return true;
      });
    }

    function settle(session) {
      const delays = session.completed ? RETRY_DELAYS_MS : FAILED_RETRY_DELAYS_MS;
      if (session.attempt >= delays.length) return finalize(session);
      session.timer = schedule(async () => {
        session.timer = null;
        session.attempt += 1;
        const snap = await fresh(session.provider);
        if (session.active > 0 || session.timer || !sessions.has(session.key)) return; // a new generation joined meanwhile
        if (snap?.status === 'ok') session.latest = snap;
        const spend = spendBetween(session.baseline, session.latest);
        if (spend && Math.abs(spend.amount) > EPSILON) return finalize(session);
        return settle(session);
      }, delays[session.attempt]);
      return null;
    }

    function finalize(session) {
      sessions.delete(session.key);
      const spend = spendBetween(session.baseline, session.latest);
      // A rise (top-up) or no change shows nothing; the chip already shows the new balance.
      if (spend && spend.amount > EPSILON) onSpend?.({amount: spend.amount, unit: spend.unit, via: spend.via, provider: session.provider, providerIds: [...session.providerIds], tasks: Math.max(1, session.completed)});
      onSettled?.({provider: session.provider, providerIds: [...session.providerIds], spend});
    }

    return {start, finish, activeSessions: () => sessions.size};
  }

  global.FutureAIBalanceSpend = {createSpendTracker, spendBetween, formatSpend, RETRY_DELAYS_MS, FAILED_RETRY_DELAYS_MS, SNAPSHOT_FRESH_MS, STALE_SESSION_MS};
})(typeof window !== 'undefined' ? window : globalThis);
