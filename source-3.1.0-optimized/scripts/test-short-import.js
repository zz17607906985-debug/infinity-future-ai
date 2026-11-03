'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {buildZip} = require('../src/runtime/zip-utils');
const {readScriptImport, parseSkillImport, storeSkillImport, readSkillPackage, decodeText} = require('../src/media/short-import-service');
const payload = (name, bytes, extra = {}) => ({name, bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), ...extra});
async function main() {
  const story = Array.from({length: 80}, (_, index) => '第' + (index + 1) + '集\n' + '林青在车站与旅人对话，拿出钥匙。'.repeat(100)).join('\n');
  assert.ok(story.length > 60000);
  for (const name of ['剧本.txt', '剧本.MD', '剧本.markdown']) {
    const result = readScriptImport(payload(name, story));
    assert.equal(result.text, story);
    assert.equal(result.truncated, false);
  }
  assert.equal(readScriptImport(payload('utf16.txt', Buffer.concat([Buffer.from([255, 254]), Buffer.from(story, 'utf16le')]))).text, story);
  assert.equal(decodeText(Buffer.from([0xd6, 0xd0, 0xce, 0xc4])).text, '中文');
  const document = buildZip([{name: 'word/document.xml', data: '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + story.split('\n').map(line => '<w:p><w:r><w:t>' + line + '</w:t></w:r></w:p>').join('') + '</w:body></w:document>'}]);
  const imported = readScriptImport(payload('80集.docx', document));
  assert.ok(imported.text.endsWith('钥匙。'));
  assert.ok(imported.text.includes('第80集'));
  assert.equal(imported.text, story);
  const json = readScriptImport(payload('分集.json', JSON.stringify({episodes: [{episode: 1, content: '第一集完整剧本正文。'.repeat(3)}, {episode: 80, scenes: [{title: '车站', text: '最后一集完整剧本正文。'.repeat(3)}]}]})));
  assert.ok(json.text.includes('第80集'));
  assert.throws(() => readScriptImport(payload('假.docx', '这是改扩展名的普通文件')), /ZIP/);
  assert.throws(() => readScriptImport(payload('旧.doc', story)), /请先转换/);
  assert.throws(() => readScriptImport(payload('坏.json', '{"data":1}')), /未找到/);
  assert.throws(() => readScriptImport(payload('空.docx', buildZip([{name: 'word/document.xml', data: '<w:document><w:body/></w:document>'}]))), /不足/);
  assert.throws(() => readScriptImport(payload('二进制.txt', Buffer.from([0, 1, 2]))), /二进制/);
  const skillId = 'visual-prompt-engineer';
  const skill = '---\nname: visual-prompt-engineer\n---\n# 图片提示词 Skill\n' + '严格遵循用户事实，编译提示词。'.repeat(10) + '\n[资料](references/style.md)';
  const zip = buildZip([{name: '包/SKILL.md', data: skill}, {name: '包/references/style.md', data: '# 角色风格\n服装固定，保留光线约束。'}, {name: '包/scripts/run.py', data: 'raise Exception("must never execute")'}, {name: '包/assets/image.png', data: Buffer.from([0, 1, 2])}]);
  const parsed = parseSkillImport(payload('提示词.zip', zip, {skillId}));
  assert.equal(parsed.files.length, 4);
  assert.equal(parsed.references.length, 1);
  assert.deepEqual(parsed.missingReferences, []);
  assert.throws(() => parseSkillImport(payload('提示词.zip', zip, {skillId: 'script-to-asset-ledger'})), /槽位/);
  assert.throws(() => parseSkillImport(payload('没有入口.zip', buildZip([{name: 'README.md', data: skill}]), {skillId})), /SKILL.md/);
  assert.throws(() => parseSkillImport(payload('多个入口.zip', buildZip([{name: 'a/SKILL.md', data: skill}, {name: 'b/SKILL.md', data: skill}]), {skillId})), /只包含一个/);
  assert.throws(() => parseSkillImport(payload('穿越.zip', buildZip([{name: '../SKILL.md', data: skill}]), {skillId})), /不安全/);
  assert.throws(() => parseSkillImport(payload('重复.zip', buildZip([{name: 'SKILL.md', data: skill}, {name: 'skill.md', data: skill}]), {skillId})), /重复/);
  assert.equal(parseSkillImport(payload('单文件.md', skill, {skillId})).missingReferences.length, 1);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'short-import-test-'));
  try {
    const saved = await storeSkillImport(directory, payload('提示词.zip', zip, {skillId}));
    assert.deepEqual(await fs.readFile(path.join(directory, saved.packageId + '.zip')), zip);
    const restored = await readSkillPackage(directory, saved.packageId, '角色风格');
    assert.ok(restored.text.includes('服装固定'));
    assert.ok(!restored.text.includes('raise Exception'));
    await assert.rejects(readSkillPackage(directory, '../secret'), /无效/);
    if (process.env.FUTURE_AI_SKILL_TEST_DIR) {
      for (const name of ['script-to-asset-ledger', 'visual-prompt-engineer', 'seedance2-director-prompts']) {
        const bytes = await fs.readFile(path.join(process.env.FUTURE_AI_SKILL_TEST_DIR, name + '-skill.zip'));
        const actual = await storeSkillImport(directory, payload(name + '.zip', bytes, {skillId: name}));
        const loaded = await readSkillPackage(directory, actual.packageId, '人物 场景 道具 角色 服装 视频镜头');
        assert.ok(actual.files.length > 0);
        assert.ok(loaded.text.includes('SKILL') || loaded.text.length > 80);
        console.log('Original archive verified:', name, actual.files.length, 'files;', actual.referenceCount, 'references; loaded', loaded.selectedPaths.length);
      }
    }
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('short-import-test-'));
    await fs.rm(resolved, {recursive: true, force: true});
  }
  console.log('Short import tests passed: full 80-episode DOCX/text, JSON episodes, UTF-16/GB18030, corrupt files, ZIP entry validation, archive preservation and reference loading.');
}
main().catch(error => {console.error(error); process.exitCode = 1;});
