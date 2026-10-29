'use strict';

const ReviewPackage = require('./review-package');

function buildOfflineReviewEntries(review = {}, mediaEntries = []) {
  const safeReview = ReviewPackage.sanitizeReviewPackage(review);
  const html = ReviewPackage.renderReviewHtml(safeReview);
  const reviewJson = JSON.stringify(safeReview, null, 2);
  const readme = [
    '# ∞未来 AI 离线审片包', '',
    '1. 解压压缩包。',
    '2. 双击 index.html 查看图片、播放视频并填写意见。',
    '3. 点击“下载审阅意见”生成 JSON。',
    '4. 将 JSON 发回创作者，并在软件中点击“导入审阅意见”。', '',
    '本包不包含 API Key，也不会连接云端服务。'
  ].join('\n');
  const entries = [
    {name: 'index.html', data: html},
    {name: 'review.json', data: reviewJson},
    {name: 'README.md', data: readme}
  ];
  for (const item of Array.isArray(mediaEntries) ? mediaEntries : []) {
    const name = String(item?.name || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!/^media\/[^/]+$/.test(name)) throw new Error(`审片媒体路径不安全：${name}`);
    entries.push({name, data: item.data});
  }
  return {review: safeReview, html, reviewJson, readme, entries};
}

module.exports = {buildOfflineReviewEntries};
