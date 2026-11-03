'use strict';

const assert = require('assert/strict');
const {
  expandedSkillMarketQueries,
  humanizeSkillName,
  normalizeMarketSkill,
  searchSkillMarket
} = require('../src/skills/skill-market');

async function main() {
  assert.match(humanizeSkillName('video-storyboard-director'), /视频导演/);
  assert.ok(expandedSkillMarketQueries('分镜').some(query => query.includes('storyboard')));

  const normalizedA = normalizeMarketSkill({name: 'plain-skill'});
  const normalizedB = normalizeMarketSkill({name: 'plain-skill'});
  assert.equal(normalizedA.id, normalizedB.id, 'normalized IDs must be deterministic');

  const curatedOnly = await searchSkillMarket({query: '分镜'}, {fetchImpl: null});
  assert.equal(curatedOnly.source, 'curated');
  assert.ok(curatedOnly.skills.some(skill => skill.id === 'market-storyboard-director'));

  let requestCount = 0;
  const fetchImpl = async url => {
    requestCount += 1;
    const isCode = url.includes('/search/code');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        items: isCode ? [] : [{name: 'security-audit-skill', full_name: 'example/security-audit-skill', html_url: 'https://example.test/skill'}]
      })
    };
  };
  const remote = await searchSkillMarket({query: '安全'}, {fetchImpl, limit: 5});
  assert.ok(requestCount >= 2);
  assert.equal(remote.source, 'github+curated');
  assert.ok(remote.skills.some(skill => skill.id === 'market-example-security-audit-skill'));
  assert.ok(remote.skills.length <= 5);

  console.log('Skill market tests passed.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
