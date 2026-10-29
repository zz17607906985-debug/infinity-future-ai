(function initShortBatchCoordinator(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIShortBatch = api;
})(typeof window !== 'undefined' ? window : globalThis, () => {
  'use strict';

  class ShortTaskBusyError extends Error {
    constructor(activeLabel) {
      super(`已有漫剧生成任务正在运行：${activeLabel || '未知任务'}`);
      this.name = 'ShortTaskBusyError';
      this.code = 'SHORT_TASK_BUSY';
      this.activeLabel = activeLabel || '';
    }
  }

  function createCoordinator() {
    let active = null;
    let sequence = 0;
    const listeners = new Set();

    function snapshot() {
      if (!active) return {status: 'idle', busy: false};
      return {...active, busy: active.status === 'running', elapsedMs: Math.max(0, Date.now() - active.startedAt)};
    }

    function notify() {
      const state = snapshot();
      for (const listener of listeners) {
        try { listener(state); } catch (error) { console.warn('short task listener failed', error); }
      }
      return state;
    }

    function update(patch = {}) {
      if (!active) return snapshot();
      active = {...active, ...patch};
      return notify();
    }

    async function runExclusive(label, task, ownerToken = null, metadata = {}) {
      if (ownerToken && active?.token === ownerToken) return await task(ownerToken);
      if (active) throw new ShortTaskBusyError(active.label);

      const token = `short-task-${++sequence}`;
      active = {
        token,
        label: String(label || '漫剧生成任务'),
        status: 'running',
        phase: String(metadata.phase || label || '生成'),
        startedAt: Date.now(),
        total: Number(metadata.total || 0),
        completed: 0,
        success: 0,
        skipped: 0,
        failed: 0,
        currentItem: '',
        model: String(metadata.model || ''),
        provider: String(metadata.provider || ''),
        keyId: String(metadata.keyId || ''),
        estimatedRequests: Number(metadata.estimatedRequests || metadata.total || 0),
        error: ''
      };
      notify();
      try {
        return await task(token);
      } catch (error) {
        update({status: 'failed', error: String(error?.message || error || '未知错误')});
        throw error;
      } finally {
        if (active?.token === token) {
          active = {...active, status: active.status === 'failed' ? 'failed' : 'completed', finishedAt: Date.now()};
          notify();
          setTimeout(() => {
            if (active?.token === token) {
              active = null;
              notify();
            }
          }, 2200);
        }
      }
    }

    return {
      runExclusive,
      isBusy: () => Boolean(active && active.status === 'running'),
      activeLabel: () => active?.label || '',
      snapshot,
      update,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        listener(snapshot());
        return () => listeners.delete(listener);
      }
    };
  }

  async function runBatch({items, worker, render, save, isComplete, formatError, onProgress, getItemLabel}) {
    let success = 0;
    let failed = 0;
    let skipped = 0;
    const list = Array.isArray(items) ? items : [];
    const report = (index, item, extra = {}) => onProgress?.({
      index,
      total: list.length,
      completed: success + failed + skipped,
      success,
      failed,
      skipped,
      currentItem: getItemLabel ? getItemLabel(item, index) : String(item?.name || item?.title || `#${index + 1}`),
      ...extra
    });

    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      if (isComplete?.(item, index)) {
        skipped++;
        report(index, item, {result: 'skipped'});
        continue;
      }
      report(index, item, {result: 'running'});
      try {
        await worker(index);
        success++;
        report(index, item, {result: 'success'});
      } catch (err) {
        failed++;
        const detail = formatError ? formatError(err) : String(err?.message || err || '未知错误');
        if (item) item.status = `失败：${detail}`;
        report(index, item, {result: 'failed', error: detail});
      } finally {
        render?.();
        await save?.();
      }
    }
    return {success, failed, skipped};
  }

  function recoverInterruptedItems(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const transient = options.isTransient || (item => /生成中|正在生成|正在创建|已提交|正在等待|排队中|等待中|处理中/i.test(String(item?.status || '')));
    let recovered = 0;
    for (const item of list) {
      if (!item || !transient(item)) continue;
      item.status = options.isResumable?.(item)
        ? String(options.resumableMessage || '发现未完成任务，可继续查询')
        : String(options.interruptedMessage || '上次生成中断，可重新生成');
      recovered++;
    }
    return recovered;
  }

  return {ShortTaskBusyError, createCoordinator, recoverInterruptedItems, runBatch};
});
