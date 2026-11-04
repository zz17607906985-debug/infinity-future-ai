'use strict';

const fs = require('node:fs');
const {fileURLToPath} = require('node:url');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/inspect-canvas-project.js <projects.json>');
  process.exitCode = 1;
} else {
  const projects = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(projects)) throw new Error('Expected a project list');
  const summary = projects.map(project => {
    const state = project?.state || {};
    const nodes = Array.isArray(state.nodes) ? state.nodes : [];
    const types = {};
    for (const node of nodes) types[node.type || 'unknown'] = (types[node.type || 'unknown'] || 0) + 1;
    const media = {dataUrls: 0, fileUrls: 0, remoteUrls: 0, otherLargeStrings: 0, embeddedBytes: 0, largestEmbeddedBytes: 0};
    const files = new Set();
    const visit = value => {
      if (typeof value === 'string') {
        if (value.startsWith('data:image/') || value.startsWith('data:video/')) {
          media.dataUrls++;
          media.embeddedBytes += value.length;
          media.largestEmbeddedBytes = Math.max(media.largestEmbeddedBytes, value.length);
        } else if (value.startsWith('file:')) {
          media.fileUrls++;
          try { files.add(fileURLToPath(value)); } catch {}
        }
        else if (/^https?:\/\//.test(value)) media.remoteUrls++;
        else if (value.length > 100000) media.otherLargeStrings++;
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    nodes.forEach(node => visit(node.data));
    const fileSizes = [...files].map(path => {
      try { return fs.statSync(path).size; } catch { return null; }
    });
    media.uniqueFiles = files.size;
    media.missingFiles = fileSizes.filter(size => size === null).length;
    media.totalFileBytes = fileSizes.reduce((sum, size) => sum + (size || 0), 0);
    media.largestFileBytes = Math.max(0, ...fileSizes.filter(size => size !== null));
    return {
      nodeCount: nodes.length,
      edgeCount: Array.isArray(state.edges) ? state.edges.length : 0,
      types,
      media,
      updatedAt: project?.updatedAt || project?.createdAt || null
    };
  });
  console.log(JSON.stringify({projectCount: summary.length, projects: summary}, null, 2));
}
