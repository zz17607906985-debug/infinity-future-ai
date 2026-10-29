// What each permission mode allows, per action category. The mode is the only permission setting;
// shared by the main process (permissions.js) and the settings UI (agent-ui.js).
(() => {
  'use strict';

  const MODES = ['readonly', 'workspace', 'full'];
  const MODE_LABELS = { readonly: '只读', workspace: '工作区可写', full: '完全访问' };
  const CATEGORIES = ['write', 'overwrite', 'command', 'background', 'network', 'outside', 'screenshot', 'gui', 'browser', 'memory', 'canvas'];
  const CATEGORY_LABELS = {
    write: '写入文件', overwrite: '删除/覆盖', command: '运行命令/脚本', background: '后台进程', network: '联网',
    outside: '工作区外访问', screenshot: '截屏/查看窗口', gui: '控制鼠标键盘', browser: '浏览器操作', memory: '记忆读写', canvas: '画布批量操作'
  };
  // 只读 may still look (read files, screenshots) but never changes anything or talks to the network.
  const READ_ONLY_FORBIDDEN = ['write', 'overwrite', 'command', 'background', 'network', 'gui', 'browser', 'canvas'];
  const WORKSPACE_ALLOWED = ['write', 'screenshot', 'canvas'];
  const MODE_SUMMARIES = {
    readonly: '只能看文件和截图，不能改任何东西。',
    workspace: '在工作区内写文件、截图、改画布直接做；其余操作先问你。',
    full: '全部直接做，不再询问。'
  };

  const validMode = mode => (MODES.includes(mode) ? mode : 'workspace');

  /** Rule map (allow / ask / deny per category) implied by a mode. */
  function modeRules(mode) {
    const m = validMode(mode);
    return Object.fromEntries(CATEGORIES.map(key => {
      if (m === 'full') return [key, 'allow'];
      if (m === 'readonly' && READ_ONLY_FORBIDDEN.includes(key)) return [key, 'deny'];
      return [key, WORKSPACE_ALLOWED.includes(key) ? 'allow' : 'ask'];
    }));
  }

  /** Category labels grouped by verdict, for plain-language descriptions. */
  function describeMode(mode) {
    const rules = modeRules(mode);
    const pick = verdict => CATEGORIES.filter(key => rules[key] === verdict).map(key => CATEGORY_LABELS[key]);
    return { summary: MODE_SUMMARIES[validMode(mode)], allow: pick('allow'), ask: pick('ask'), deny: pick('deny') };
  }

  const api = { MODES, MODE_LABELS, CATEGORIES, CATEGORY_LABELS, READ_ONLY_FORBIDDEN, validMode, modeRules, describeMode };
  if (typeof window !== 'undefined') window.FutureAIAgentRules = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
