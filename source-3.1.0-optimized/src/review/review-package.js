(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.FutureAIReviewPackage = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const COMMENT_TYPES = new Set(['comment', 'approval', 'revision', 'summary']);
  const SECRET_KEY = /api[_-]?key|apikey|secret|token|authorization|password|credential/i;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function stableHash(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function isPrivateAbsolutePath(value) {
    const text = String(value || '').trim();
    return /^[a-zA-Z]:[\\/]/.test(text) || /^\\\\/.test(text) || /^file:/i.test(text)
      || /^(?:future-ai-media|local-media|app-media):/i.test(text);
  }

  function mediaTypeFor(node = {}, url = '', provenance = {}) {
    if (['image', 'video', 'audio'].includes(provenance.mediaType)) return provenance.mediaType;
    if (node.type === 'video' || /\.(mp4|webm|mov|mkv)(?:$|[?#])/i.test(url)) return 'video';
    if (node.type === 'audio' || /\.(mp3|wav|m4a|aac|ogg|flac)(?:$|[?#])/i.test(url)) return 'audio';
    return 'image';
  }

  function outputVersion(value = {}) {
    return `v-${stableHash([
      value.outputId,
      value.sourceUrl || value.url,
      value.createdAt || value.generatedAt,
      value.size,
      value.actualDuration ?? value.duration
    ].join('|'))}`;
  }

  function reviewOutputsFromNode(node = {}) {
    const data = node.data || {};
    const variants = (Array.isArray(data.variants) ? data.variants : []).filter(item => item?.url);
    const sources = variants.length
      ? variants.map(item => ({...item, sourceUrl: item.url}))
      : (Array.isArray(data.urls) && data.urls.length ? data.urls : [data.url]).filter(Boolean).map((sourceUrl, index) => ({sourceUrl, createdAt: Number(data.generatedAt || 0) + index}));
    const seen = new Set();
    return sources.flatMap((source, index) => {
      const sourceUrl = String(source.sourceUrl || '');
      if (!sourceUrl || seen.has(sourceUrl)) return [];
      seen.add(sourceUrl);
      const provenance = (Array.isArray(data.provenanceRecords) ? data.provenanceRecords : []).find(item => item?.url === sourceUrl) || {};
      const outputId = String(provenance.outputId || source.id || `output-${node.id || 'node'}-${stableHash(sourceUrl)}`);
      const item = {
        outputId,
        nodeId: String(node.id || ''),
        nodeType: String(node.type || ''),
        title: String(data.title || data.name || `${node.type === 'video' ? '视频' : node.type === 'audio' ? '音频' : '图片'}产出 ${index + 1}`),
        mediaType: mediaTypeFor(node, sourceUrl, provenance),
        sourceUrl,
        prompt: String(source.prompt || provenance.prompt || data.prompt || ''),
        model: String(source.model || provenance.modelId || data.model || ''),
        provider: String(source.provider || provenance.providerName || provenance.providerId || ''),
        size: String(data.size || ''),
        duration: source.actualDuration ?? provenance.actual?.duration ?? data.outputMetadata?.actualDuration ?? data.duration ?? null,
        status: String(source.status || provenance.approvalStatus || data.approval?.status || 'unseen'),
        createdAt: Number(source.createdAt || provenance.generatedAt || data.generatedAt || 0)
      };
      item.outputVersion = outputVersion(item);
      return [item];
    });
  }

  function buildReviewPayload({project = {}, nodes = [], createdAt = Date.now()} = {}) {
    const outputs = (Array.isArray(nodes) ? nodes : []).flatMap(reviewOutputsFromNode);
    return {
      schemaVersion: 1,
      packageId: `review-${String(project.id || 'project')}-${createdAt}-${stableHash(outputs.map(item => item.outputVersion).join('|'))}`,
      project: {id: String(project.id || ''), name: String(project.name || '未命名项目')},
      createdAt,
      outputs
    };
  }

  function sanitizeReviewValue(value, key = '') {
    if (SECRET_KEY.test(key) || key === 'sourceUrl') return undefined;
    if (Array.isArray(value)) return value.map(item => sanitizeReviewValue(item)).filter(item => item !== undefined);
    if (value && typeof value === 'object') {
      const output = {};
      Object.entries(value).forEach(([childKey, child]) => {
        const clean = sanitizeReviewValue(child, childKey);
        if (clean !== undefined) output[childKey] = clean;
      });
      return output;
    }
    if (typeof value === 'string' && isPrivateAbsolutePath(value)) return '';
    return value;
  }

  function sanitizeReviewPackage(value = {}) {
    return sanitizeReviewValue(clone(value)) || {};
  }

  function normalizeComment(value = {}, index = 0) {
    const type = COMMENT_TYPES.has(value.type) ? value.type : 'comment';
    const text = String(value.text || '').trim().slice(0, 12000);
    if (!text) return null;
    return {
      id: String(value.id || `review-comment-${Date.now()}-${index}-${stableHash(text)}`),
      outputId: String(value.outputId || ''),
      outputVersion: String(value.outputVersion || ''),
      mediaType: ['image', 'video', 'audio'].includes(value.mediaType) ? value.mediaType : '',
      type,
      text,
      timeSeconds: value.timeSeconds == null || value.timeSeconds === '' ? null : Math.max(0, Number(value.timeSeconds) || 0),
      createdAt: Number(value.createdAt || Date.now()),
      reviewer: String(value.reviewer || '').slice(0, 120)
    };
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
  }

  function applyDecision(node, output, comment) {
    const data = node.data || (node.data = {});
    if (comment.type === 'approval') {
      data.approval = {status: 'approved', outputId: output.outputId, outputUrl: output.sourceUrl, outputVersion: output.outputVersion, approvedAt: comment.createdAt, source: 'offline-review'};
    } else if (comment.type === 'revision') {
      data.approval = {status: 'revision', outputId: output.outputId, outputUrl: output.sourceUrl, outputVersion: output.outputVersion, invalidatedAt: comment.createdAt, reason: comment.text, source: 'offline-review'};
    }
    if (Array.isArray(data.variants)) {
      data.variants.forEach(variant => {
        if (variant.url === output.sourceUrl) variant.status = comment.type === 'approval' ? 'approved' : 'revision';
        else if (comment.type === 'approval' && variant.status === 'approved') variant.status = 'candidate';
      });
    }
    if (Array.isArray(data.provenanceRecords)) {
      data.provenanceRecords.forEach(record => {
        if (record.outputId === output.outputId || record.url === output.sourceUrl) record.approvalStatus = comment.type === 'approval' ? 'approved' : 'revision';
      });
    }
  }

  function mergeReviewComments({nodes = [], projectComments = [], projectId = ''} = {}, payload = {}) {
    if (projectId && payload.projectId && String(projectId) !== String(payload.projectId)) {
      return {imported: 0, stale: 0, invalid: 0, wrongProject: true, projectComments: clone(projectComments) || []};
    }
    const nodeList = Array.isArray(nodes) ? nodes : [];
    const outputMap = new Map();
    nodeList.forEach(node => reviewOutputsFromNode(node).forEach(output => outputMap.set(output.outputId, {node, output})));
    const normalized = (Array.isArray(payload.comments) ? payload.comments : []).slice(0, 5000).map(normalizeComment).filter(Boolean);
    const nextProjectComments = Array.isArray(projectComments) ? projectComments.map(item => clone(item)) : [];
    let imported = 0;
    let stale = 0;
    let invalid = 0;
    normalized.forEach(comment => {
      if (comment.type === 'summary' && !comment.outputId) {
        if (!nextProjectComments.some(item => item.id === comment.id)) {
          nextProjectComments.push(comment);
          imported += 1;
        }
        return;
      }
      const match = outputMap.get(comment.outputId);
      if (!match) { invalid += 1; return; }
      if (!comment.outputVersion || comment.outputVersion !== match.output.outputVersion) { stale += 1; return; }
      const data = match.node.data || (match.node.data = {});
      const comments = Array.isArray(data.reviewComments) ? data.reviewComments : [];
      if (comments.some(item => item.id === comment.id)) return;
      comments.push({...comment, outputUrl: match.output.sourceUrl, importedAt: Date.now()});
      data.reviewComments = comments.slice(-1000);
      if (comment.type === 'approval' || comment.type === 'revision') applyDecision(match.node, match.output, comment);
      imported += 1;
    });
    return {imported, stale, invalid, wrongProject: false, projectComments: nextProjectComments.slice(-1000)};
  }

  function renderReviewHtml(reviewPackage = {}) {
    const safePackage = sanitizeReviewPackage(reviewPackage);
    const data = JSON.stringify(safePackage).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' data: blob:; img-src 'self' data: blob:; media-src 'self' data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(safePackage.project?.name || '项目')} · 离线审片</title>
<style>
:root{color-scheme:dark;--bg:#11161a;--panel:#192127;--line:#35424b;--text:#edf3f6;--muted:#9daab2;--accent:#55c2a4;--warn:#efb45c}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,"Microsoft YaHei",sans-serif}header{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 20px;border-bottom:1px solid var(--line);background:rgba(17,22,26,.96)}h1{margin:0;font-size:18px}header span,.meta{color:var(--muted);font-size:12px}button{height:34px;border:1px solid var(--line);border-radius:6px;background:#222c33;color:var(--text);padding:0 12px;cursor:pointer}button.primary{border-color:var(--accent);background:var(--accent);color:#08110f}button.warn{border-color:var(--warn);color:#ffdca6}main{width:min(1180px,calc(100% - 28px));margin:22px auto 60px}.output{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.55fr);gap:16px;padding:16px 0;border-bottom:1px solid var(--line)}.media{min-height:260px;display:grid;place-items:center;background:#080b0d;overflow:auto}.media img,.media video,.media audio{max-width:100%;max-height:70vh;object-fit:contain}.media img{cursor:zoom-in}.media img.zoomed{max-width:none;max-height:none;cursor:zoom-out}.review{min-width:0}.review h2{margin:0 0 6px;font-size:16px}.meta{display:grid;gap:3px;margin-bottom:12px}.review textarea,.summary textarea{width:100%;min-height:88px;resize:vertical;border:1px solid var(--line);border-radius:6px;background:#11171b;color:var(--text);padding:10px}.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.comments{display:grid;gap:7px;margin-top:12px}.comment{padding:8px 10px;border-left:3px solid var(--line);background:#131a1f}.comment.approval{border-color:var(--accent)}.comment.revision{border-color:var(--warn)}.comment small{display:block;color:var(--muted)}.summary{margin-top:26px;padding-top:20px;border-top:1px solid var(--line)}.empty{padding:60px 10px;text-align:center;color:var(--muted)}@media(max-width:760px){header{align-items:flex-start;flex-direction:column}.output{grid-template-columns:1fr}.media{min-height:190px}}
</style></head><body>
<header><div><h1 id="projectTitle"></h1><span>本地只读审片包 · 意见只保存在下载的 JSON 中</span></div><button id="download" class="primary" type="button">下载审阅意见</button></header>
<main><div id="outputs"></div><section class="summary"><h2>整体总结</h2><textarea id="summaryText" placeholder="填写全片或整组图片的总体意见"></textarea><div class="actions"><button id="addSummary" type="button">加入总结</button></div><div id="summaryComments" class="comments"></div></section></main>
<script id="reviewData" type="application/json">${data}</script>
<script>
(()=>{'use strict';const review=JSON.parse(document.getElementById('reviewData').textContent);const comments=[];const labels={comment:'评论',approval:'通过',revision:'返工',summary:'总结'};document.getElementById('projectTitle').textContent=(review.project&&review.project.name)||'未命名项目';
function el(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!=null)node.textContent=text;return node}
function addComment(output,type,text,timeSeconds){const clean=String(text||'').trim();if(!clean)return;comments.push({id:'comment-'+Date.now()+'-'+Math.random().toString(36).slice(2,7),outputId:output?output.outputId:'',outputVersion:output?output.outputVersion:'',mediaType:output?output.mediaType:'',type,text:clean,timeSeconds:timeSeconds==null?null:Number(timeSeconds.toFixed(3)),createdAt:Date.now()});renderComments()}
function renderComments(){document.querySelectorAll('[data-comments]').forEach(box=>{const id=box.dataset.comments;box.replaceChildren(...comments.filter(item=>item.outputId===id).map(comment=>{const row=el('div','comment '+comment.type,labels[comment.type]+'：'+comment.text);row.appendChild(el('small','',comment.timeSeconds==null?new Date(comment.createdAt).toLocaleString():'时间点 '+comment.timeSeconds.toFixed(3)+' 秒'));return row}))});const summary=document.getElementById('summaryComments');summary.replaceChildren(...comments.filter(item=>item.type==='summary'&&!item.outputId).map(comment=>el('div','comment summary',comment.text)))}
function outputSection(output){const section=el('section','output');const mediaBox=el('div','media');let media;if(output.mediaType==='video'){media=el('video');media.controls=true;media.playsInline=true}else if(output.mediaType==='audio'){media=el('audio');media.controls=true}else{media=el('img');media.alt=output.title||'审阅图片';media.addEventListener('click',()=>media.classList.toggle('zoomed'))}media.src=output.mediaPath||'';mediaBox.appendChild(media);const reviewBox=el('div','review');reviewBox.appendChild(el('h2','',output.title||'待审产出'));const meta=el('div','meta');[output.model&&'模型：'+output.model,output.size&&'尺寸：'+output.size,output.duration!=null&&'时长：'+output.duration+' 秒',output.prompt&&'提示词：'+output.prompt].filter(Boolean).forEach(text=>meta.appendChild(el('span','',text)));reviewBox.appendChild(meta);const textarea=el('textarea');textarea.placeholder=output.mediaType==='video'?'指定时间点评论':'填写这张图片的修改意见';reviewBox.appendChild(textarea);const actions=el('div','actions');const commentButton=el('button','',output.mediaType==='video'?'指定时间点评论':'添加评论');commentButton.type='button';commentButton.addEventListener('click',()=>{addComment(output,'comment',textarea.value,output.mediaType==='video'?media.currentTime:null);textarea.value=''});const approve=el('button','primary','通过');approve.type='button';approve.addEventListener('click',()=>addComment(output,'approval',textarea.value||'确认通过',output.mediaType==='video'?media.currentTime:null));const revision=el('button','warn','返工');revision.type='button';revision.addEventListener('click',()=>addComment(output,'revision',textarea.value||'需要返工',output.mediaType==='video'?media.currentTime:null));actions.append(commentButton,approve,revision);reviewBox.appendChild(actions);const list=el('div','comments');list.dataset.comments=output.outputId;reviewBox.appendChild(list);section.append(mediaBox,reviewBox);return section}
const outputRoot=document.getElementById('outputs');if(review.outputs&&review.outputs.length)review.outputs.forEach(output=>outputRoot.appendChild(outputSection(output)));else outputRoot.appendChild(el('div','empty','没有可审阅的图片、视频或音频产出。'));document.getElementById('addSummary').addEventListener('click',()=>{const input=document.getElementById('summaryText');addComment(null,'summary',input.value,null);input.value=''});document.getElementById('download').addEventListener('click',()=>{const payload={schemaVersion:1,packageId:review.packageId||'',projectId:(review.project&&review.project.id)||'',exportedAt:new Date().toISOString(),comments};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='review-comments-'+((review.project&&review.project.id)||'project')+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)});renderComments()})();
</script></body></html>`;
  }

  return {
    buildReviewPayload,
    isPrivateAbsolutePath,
    mergeReviewComments,
    normalizeComment,
    outputVersion,
    renderReviewHtml,
    reviewOutputsFromNode,
    sanitizeReviewPackage,
    stableHash
  };
});
