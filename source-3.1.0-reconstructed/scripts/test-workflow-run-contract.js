const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const marker = 'async function runWorkflowGroup(groupId)';
const start = source.indexOf(marker);
if (start < 0) throw new Error('workflow group runner is missing');
const body = source.slice(start, source.indexOf('\n  function exportWorkflowDefinition', start));
for (const required of [
  "node.type === 'prompt' || node.type === 'character'",
  "node.type === 'image'",
  "node.type === 'video'",
  "node.type === 'media-tool'",
  "node.type === 'comfyui'"
]) {
  if (!body.includes(required)) throw new Error(`workflow runner does not execute ${required}`);
}
if (!body.includes('workflowGroupRunOrder(group)')) throw new Error('workflow runner does not use dependency order');
if (!body.includes('已完成的结果均已保留')) throw new Error('workflow runner does not preserve completed results on failure');
console.log('Workflow run contract tests passed.');
