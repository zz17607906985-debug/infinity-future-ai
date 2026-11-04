'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/assistant/dialog-runtime.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
const context = {window: {}};
vm.createContext(context);
vm.runInContext(source, context);
const runtime = context.window.FutureAIDialogRuntime.create({
  host: {dialogEditMessages: []},
  messageRunKind: () => 'chat',
  shouldUseLatestContextImage: () => false
});
const localTask = '在 D:\\projects\\demo 创建 README.md 文件';
assert.equal(runtime.isLocalFileTaskRequest(localTask), true);
assert.equal(runtime.fallbackDialogRunPlan(localTask).kind, 'codex');
assert.equal(runtime.isLocalFileTaskRequest('生成一张场景图片'), false);
assert.match(source, /if \(isLocalFileTaskRequest\(directTask\) \|\| isCodexTaskRequest\(directTask\)\)/);
assert.match(source, /storageDir: host\.storageDir/);
assert.match(app, /dialogRuntime:\s*\{\s*host:[\s\S]*?get storageDir\(\) \{ return storageDir; \}/);
for (const dependency of [
  'reportProviderKeyResult', 'createProviderApiError', 'clearCurrentDialogConversation',
  'downloadImage', 'fileToDataUrl', 'connectSilently', 'drawEdges',
  'agentProjectSummary', 'renderAgentConsole', 'codexApiConfig',
  'multimodalVideoUnderstand', 'multimodalImageUnderstand', 'optimizeDialogImagePrompt'
]) {
  assert.match(source, new RegExp(`const ${dependency} = deps\\.${dependency};`));
  assert.match(app, new RegExp(`\\n\\s+${dependency},`));
}
console.log('Dialog runtime restoration tests passed.');
