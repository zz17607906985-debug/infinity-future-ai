'use strict';

// Subtask delegation: the parent agent hands independent subtasks to child runs, each with its own
// context. Children share the parent's abort signal, permission mode and approval path, run at most
// MAX_PARALLEL at a time, and cannot delegate further. Finished child results are recorded in the
// parent's snapshot so a resumed parent reuses them instead of redoing the work.

const MAX_PARALLEL = 3;
const MAX_SUBTASKS = 6;
const CHILD_MAX_STEPS = 40;
const SUMMARY_CHARS = 2000;

const SPEC = {
  name: 'delegate',
  description: `把彼此独立的子任务交给子智能体并行完成（最多 ${MAX_SUBTASKS} 个，同时运行 ${MAX_PARALLEL} 个），每个子任务有独立上下文，返回各自的结果摘要。子任务说明必须自包含（写清路径、目标、产出）；有先后依赖的步骤不要拆开。`,
  parameters: {
    type: 'object',
    properties: {
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { title: { type: 'string', description: '简短标题' }, prompt: { type: 'string', description: '自包含的子任务说明' } },
          required: ['prompt']
        }
      }
    },
    required: ['tasks']
  }
};

function childSessionId(parentId, index) {
  return `${parentId}_s${index + 1}`;
}

function normalizeTasks(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const tasks = list
    .map((item, index) => ({ title: String(item?.title || '').trim().slice(0, 80) || `子任务 ${index + 1}`, prompt: String(item?.prompt || '').trim() }))
    .filter(item => item.prompt);
  if (!tasks.length) throw new Error('delegate 需要至少一个带 prompt 的子任务');
  if (tasks.length > MAX_SUBTASKS) throw new Error(`delegate 最多 ${MAX_SUBTASKS} 个子任务，请合并或分批`);
  return tasks;
}

function childOutcome(result) {
  if (result?.ok) return 'done';
  if (result?.cancelled) return 'stopped';
  if (result?.truncated) return 'truncated';
  return 'error';
}

/**
 * Runs the subtasks through a pool of `parallel` workers.
 * runChild({ task, index, sessionId, onEvent }) → runAgent result; it must honor the shared signal.
 * completed: { [childSessionId]: record } from an earlier (resumed) run; reused as-is.
 * onRecord(record) persists each finished child; onEvent reports progress under the parent.
 */
async function runDelegation({ parentSessionId, tasks: rawTasks, runChild, completed = {}, onRecord = async () => {}, onEvent = async () => {}, signal, parallel = MAX_PARALLEL }) {
  const tasks = normalizeTasks(rawTasks);
  const records = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const task = tasks[index];
      const sessionId = childSessionId(parentSessionId, index);
      const base = { childSessionId: sessionId, index, total: tasks.length, title: task.title };
      const previous = completed[sessionId];
      if (previous?.status === 'done') {
        records[index] = previous;
        await onEvent({ ...base, status: 'reused', summary: previous.summary });
        continue;
      }
      if (signal?.aborted) {
        records[index] = { ...base, status: 'stopped', summary: '' };
        continue;
      }
      await onEvent({ ...base, status: 'running' });
      let record;
      try {
        const result = await runChild({ task, index, sessionId, onEvent: evt => onEvent({ ...base, status: 'progress', event: evt }) });
        record = { ...base, status: childOutcome(result), summary: String(result?.content || '').slice(0, SUMMARY_CHARS) };
      } catch (err) {
        record = { ...base, status: 'error', summary: '', error: err?.message || String(err) };
      }
      records[index] = record;
      await onRecord(record);
      await onEvent({ ...record });
    }
  }
  const width = Math.min(Math.max(Number(parallel) || 1, 1), MAX_PARALLEL, tasks.length);
  await Promise.all(Array.from({ length: width }, worker));
  return {
    ok: records.every(item => item.status === 'done'),
    results: records.map(({ title, status, summary, error }) => ({ title, status, summary, ...(error ? { error } : {}) }))
  };
}

// Child events are condensed so the parent's UI can show a one-line progress entry per child step.
function progressLine(evt = {}) {
  if (evt.type === 'tool' && evt.status !== 'output' && evt.status !== 'running') return `${evt.status === 'ok' ? '✓' : evt.status === 'error' ? '!' : '✗'} ${evt.name}${evt.summary ? ` · ${evt.summary}` : ''}${evt.error ? ` · ${evt.error}` : ''}`;
  if (evt.type === 'approval') return `等待批准：${evt.name}`;
  if (evt.type === 'plan') return `计划更新（${(evt.steps || []).length} 步）`;
  return '';
}

module.exports = { SPEC, MAX_PARALLEL, MAX_SUBTASKS, CHILD_MAX_STEPS, childSessionId, normalizeTasks, runDelegation, progressLine };
