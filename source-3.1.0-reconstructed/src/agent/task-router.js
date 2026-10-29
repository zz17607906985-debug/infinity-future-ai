'use strict';

// Classifies an agent prompt so the loop can send only the tools a task needs and take a short
// path for simple single-action local file tasks. Pure functions; no I/O.
const path = require('path');

const TOOL_GROUPS = {
  files: ['read_file', 'edit_file', 'write_file', 'list_dir', 'grep', 'glob', 'shell', 'read_document', 'write_document'],
  scripts: ['run_script', 'process_status', 'process_kill'],
  web: ['web_search', 'fetch_url', 'download_file'],
  browser: ['browser_navigate', 'browser_click', 'browser_type', 'browser_extract', 'browser_screenshot', 'browser_screenshot_marked', 'browser_element_click', 'browser_element_type'],
  desktop: ['screenshot', 'screenshot_marked', 'ui_click', 'ui_type', 'list_ui_elements', 'mouse_move', 'mouse_click', 'mouse_drag', 'mouse_scroll', 'keyboard_type', 'keyboard_hotkey', 'list_windows', 'focus_window'],
  canvas: ['canvas_action', 'canvas_batch'],
  memory: ['remember', 'forget', 'list_memory'],
  plan: ['update_plan'],
  delegate: ['delegate']
};

// Folder path without spaces; anything fancier (spaces, several drives) is left to the model.
const WINDOWS_PATH = /[A-Za-z]:\\(?:[^\s\\/:*?"<>|，。,；;：、]+\\?)*/;
const FILE_ACTION = /(创建|新建|建立|写入|保存|删除|重命名|改名|移动|复制|打开)/;
const FILE_OBJECT = /(文件夹|目录|文件|文档|文本|txt|\.md|\.json|\.csv)/i;
const COMPLEX_HINTS = /(然后|并且|之后|再把|接着|批量|所有|每个|整理|分析|总结|对比|修复|调试|代码|项目|脚本|网页|网站|浏览器|搜索|下载|截图|屏幕|点击|画布|生成图|视频|重构|迁移|模块)/;

function categoriesFor(text) {
  const groups = new Set(['files']);
  if (/(脚本|运行|执行|安装|npm|node|python|git|编译|构建|后台|测试失败|单测|单元测试|重构|迁移|模块|命令行|argv|--[a-z])/i.test(text)) groups.add('scripts');
  if (/(搜索|查一下|网上|网页|网站|链接|https?:\/\/|下载|新闻|天气)/i.test(text)) groups.add('web');
  if (/(浏览器|网页上|登录|表单|https?:\/\/)/i.test(text)) groups.add('browser');
  if (/(屏幕|截图|截屏|窗口|点击|鼠标|键盘|桌面上的|界面|软件里)/.test(text)) groups.add('desktop');
  if (/(画布|节点|分镜|变体|排版|导出画布)/.test(text)) groups.add('canvas');
  if (/(记住|忘记|记忆|偏好)/.test(text)) groups.add('memory');
  // Plan only for multi-step or multi-domain work; skip it on short local file chores.
  if (COMPLEX_HINTS.test(text) || groups.size > 1) groups.add('plan');
  // Delegation only pays off for multi-part work, never for single quick chores.
  if (/(分别|各自|并行|同时|批量|每个|所有)/.test(text)) groups.add('delegate');
  return groups;
}

/**
 * @returns {{simple: boolean, groups: string[], toolNames: string[]}}
 */
function classifyTask(prompt = '') {
  const text = String(prompt || '');
  const groups = categoriesFor(text);
  const simple = text.length <= 160
    && FILE_ACTION.test(text)
    && FILE_OBJECT.test(text)
    && !COMPLEX_HINTS.test(text)
    && ![...groups].some(group => group !== 'files' && group !== 'plan');
  if (simple) groups.delete('plan');
  const toolNames = [...groups].flatMap(group => TOOL_GROUPS[group]);
  return { simple, groups: [...groups], toolNames: [...new Set(toolNames)] };
}

function cleanFileName(raw = '') {
  return String(raw || '')
    .trim()
    .replace(/^[“"'「『《]+|[”"'」』》]+$/g, '')
    .replace(/[。.!！?？，,；;\s]+$/u, '')
    .trim();
}

/**
 * Deterministic plan for an unambiguous "create a text file named X in folder Y" request.
 * Returns a tool call (still permission-gated by the loop) or null when anything is unclear.
 */
function directFileAction(prompt = '') {
  const text = String(prompt || '').trim();
  if (text.length > 160 || COMPLEX_HINTS.test(text)) return null;
  if (!/(创建|新建)/.test(text) || !/(文本文档|文本文件|txt\s*文件|记事本文件|\.txt)/i.test(text)) return null;
  if (/(内容|写上|写入|写着|里面)/.test(text)) return null;
  if ((text.match(/[A-Za-z]:[\\/]/g) || []).length !== 1) return null;
  const dirs = text.match(new RegExp(WINDOWS_PATH.source, 'g')) || [];
  if (dirs.length !== 1) return null;
  const dir = dirs[0].replace(/\\+$/, '');
  const nameMatch = text.match(/(?:文件名|名字|名称|命名为|叫做|叫)\s*(?:叫|为|是)?\s*[:：]?\s*([^\s\\/:*?"<>|，,。；;]{1,80})/);
  if (!nameMatch) return null;
  let name = cleanFileName(nameMatch[1]);
  if (!name || /^(?:CON|PRN|AUX|NUL|COM\d|LPT\d)$/i.test(name) || name.startsWith('.')) return null;
  if (!/\.txt$/i.test(name)) name = `${name}.txt`;
  return { name: 'write_file', arguments: { path: path.win32.join(dir, name), content: '' } };
}

module.exports = { TOOL_GROUPS, classifyTask, directFileAction };
