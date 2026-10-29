'use strict';

/**
 * Serialize GUI / mouse / keyboard control across concurrent agent sessions.
 * Screenshots and window listing stay concurrent; only input actions take the lock.
 */

let chain = Promise.resolve();
let holder = '';
let waiters = 0;

function status() {
  return { holder: holder || null, waiters };
}

async function withGuiLock(sessionId, fn) {
  const id = String(sessionId || 'anon');
  waiters += 1;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const prev = chain;
  chain = prev.then(() => gate).catch(() => gate);
  try {
    await prev.catch(() => {});
    holder = id;
    waiters = Math.max(0, waiters - 1);
    return await fn();
  } finally {
    if (holder === id) holder = '';
    release();
  }
}

function wrapComputer(computer, sessionId) {
  if (!computer) return computer;
  const locked = [
    'mouse_move', 'mouse_click', 'mouse_drag', 'mouse_scroll',
    'keyboard_type', 'keyboard_hotkey', 'focus_window',
    'ui_click', 'ui_type'
  ];
  const out = { ...computer };
  for (const name of locked) {
    if (typeof computer[name] !== 'function') continue;
    out[name] = (...args) => withGuiLock(sessionId, () => computer[name](...args));
  }
  return out;
}

function _resetForTests() {
  chain = Promise.resolve();
  holder = '';
  waiters = 0;
}

module.exports = { withGuiLock, wrapComputer, status, _resetForTests };
