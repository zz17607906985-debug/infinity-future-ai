const assert = require('assert');
const ReviewPackage = require('../src/review/review-package');

const node = {
  id: 'node-1',
  type: 'video',
  data: {
    url: 'E:\\private\\media\\shot.mp4',
    prompt: '镜头提示词',
    model: 'video-model',
    size: '1920x1080',
    duration: '5',
    variants: [{id: 'variant-1', url: 'E:\\private\\media\\shot.mp4', status: 'candidate', createdAt: 10}],
    provenanceRecords: [{outputId: 'output-1', url: 'E:\\private\\media\\shot.mp4', mediaType: 'video', generatedAt: 10}]
  }
};

const review = ReviewPackage.buildReviewPayload({project: {id: 'project-1', name: '测试项目'}, nodes: [node]});
assert.equal(review.outputs.length, 1);
assert.equal(review.outputs[0].outputId, 'output-1');
assert.equal(review.outputs[0].mediaType, 'video');
assert.ok(review.outputs[0].outputVersion);

const publicReview = ReviewPackage.sanitizeReviewPackage({
  ...review,
  apiKey: 'sk-secret-value',
  outputs: review.outputs.map(item => ({...item, sourceUrl: item.sourceUrl, mediaPath: 'media/001-shot.mp4'}))
});
const publicJson = JSON.stringify(publicReview);
assert.ok(!publicJson.includes('sk-secret-value'));
assert.ok(!publicJson.includes('E:\\private'));
assert.ok(publicJson.includes('media/001-shot.mp4'));

const html = ReviewPackage.renderReviewHtml(publicReview);
assert.ok(html.includes('指定时间点评论'));
assert.ok(html.includes('下载审阅意见'));
assert.ok(!html.includes('sk-secret-value'));
assert.ok(!html.includes('E:\\private'));
const hostileHtml = ReviewPackage.renderReviewHtml({...publicReview, project: {id: 'p', name: '</title><script>alert(1)</script>'}});
assert.ok(!hostileHtml.includes('</title><script>'));

const comments = {
  schemaVersion: 1,
  projectId: 'project-1',
  comments: [
    {id: 'comment-1', outputId: 'output-1', outputVersion: review.outputs[0].outputVersion, type: 'comment', text: '2 秒处节奏太快', timeSeconds: 2, createdAt: 20},
    {id: 'approval-1', outputId: 'output-1', outputVersion: review.outputs[0].outputVersion, type: 'approval', text: '通过', createdAt: 21},
    {id: 'summary-1', outputId: '', outputVersion: '', type: 'summary', text: '整体方向正确', createdAt: 22}
  ]
};
const merge = ReviewPackage.mergeReviewComments({nodes: [node], projectComments: []}, comments);
assert.equal(merge.imported, 3);
assert.equal(node.data.reviewComments.length, 2);
assert.equal(node.data.approval.status, 'approved');
assert.equal(node.data.variants[0].status, 'approved');
assert.equal(merge.projectComments.length, 1);

const stale = ReviewPackage.mergeReviewComments({nodes: [node], projectComments: []}, {
  schemaVersion: 1,
  comments: [{id: 'stale-1', outputId: 'output-1', outputVersion: 'old-version', type: 'revision', text: '旧版意见', createdAt: 30}]
});
assert.equal(stale.imported, 0);
assert.equal(stale.stale, 1);

console.log('Review package tests passed.');
