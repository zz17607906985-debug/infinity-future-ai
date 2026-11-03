const fs = require('fs');
const p = process.argv[2];
const t = fs.readFileSync(p, 'utf8');
const samples = ['项目已创建', '默认项目', '新建项目', '删除项目', '确认删除'];
for (const s of samples) {
  console.log(s, t.includes(s) ? 'OK' : 'MISSING');
}
const i = t.indexOf('blankDialogTopicState');
console.log('sample', JSON.stringify(t.slice(i, i + 100)));
