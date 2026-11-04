'use strict';

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {spawn} = require('node:child_process');
const {fileURLToPath} = require('node:url');
const {createCanvasPreviewCache} = require('../src/runtime/canvas-preview-cache');

const [projectFile, ffmpeg] = process.argv.slice(2);
if (!projectFile || !ffmpeg) throw new Error('Usage: node scripts/benchmark-canvas-previews.js <projects.json> <ffmpeg.exe>');

function convert(source, output) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-threads', '1', '-i', source, '-frames:v', '1', '-threads', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease:flags=fast_bilinear,format=rgba', '-c:v', 'png', '-compression_level', '3', output], {windowsHide: true});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exited with ${code}`)));
  });
}

async function main() {
  const projects = JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const nodes = projects[0].state.nodes;
  const urls = new Set();
  const visit = value => {
    if (typeof value === 'string' && value.startsWith('file:')) urls.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  nodes.forEach(node => visit(node.data));
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-preview-benchmark-'));
  try {
    const cache = createCanvasPreviewCache({cacheDir: path.join(temp, 'previews'), resolveSource: async fileUrl => fileURLToPath(fileUrl), convert});
    let originalBytes = 0;
    let previewBytes = 0;
    const started = performance.now();
    for (const url of urls) {
      const source = fileURLToPath(url);
      const preview = fileURLToPath(await cache.previewUrl(url));
      originalBytes += (await fs.stat(source)).size;
      previewBytes += (await fs.stat(preview)).size;
    }
    const coldMs = performance.now() - started;
    const warmStart = performance.now();
    await Promise.all([...urls].map(url => cache.previewUrl(url)));
    console.log(JSON.stringify({images: urls.size, originalMiB: +(originalBytes / 1048576).toFixed(2), previewMiB: +(previewBytes / 1048576).toFixed(2), coldMs: Math.round(coldMs), warmLookupMs: Math.round(performance.now() - warmStart)}, null, 2));
  } finally {
    await fs.rm(temp, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
