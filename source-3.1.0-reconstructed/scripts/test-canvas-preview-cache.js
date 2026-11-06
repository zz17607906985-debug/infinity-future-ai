'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {spawnSync} = require('node:child_process');
const {createCanvasPreviewCache} = require('../src/runtime/canvas-preview-cache');

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-preview-test-'));
  try {
    const source = path.join(root, 'source.png');
    await fs.writeFile(source, 'image-one');
    let conversions = 0;
    const cache = createCanvasPreviewCache({
      cacheDir: path.join(root, 'previews'),
      resolveSource: async url => {
        if (url !== pathToFileURL(source).href) throw new Error('Unauthorized source');
        return source;
      },
      convert: async (_source, output) => {
        conversions++;
        await fs.writeFile(output, 'preview');
      }
    });
    assert.equal(await cache.previewUrl('https://example.com/image.png'), '');
    await assert.rejects(cache.previewUrl(pathToFileURL(path.join(root, 'outside.png')).href), /Unauthorized/);
    const [first, duplicate] = await Promise.all([
      cache.previewUrl(pathToFileURL(source).href),
      cache.previewUrl(pathToFileURL(source).href)
    ]);
    assert.equal(first, duplicate);
    assert.equal(conversions, 1);
    assert.equal(await cache.previewUrl(pathToFileURL(source).href), first);
    await fs.writeFile(source, 'image-two-changed');
    assert.notEqual(await cache.previewUrl(pathToFileURL(source).href), first);
    assert.equal(conversions, 2);
    const failing = createCanvasPreviewCache({
      cacheDir: path.join(root, 'errors'),
      resolveSource: async () => source,
      convert: async () => { throw new Error('decode failed'); }
    });
    await assert.rejects(failing.previewUrl(pathToFileURL(source).href), /decode failed/);
    assert.equal((await fs.readdir(path.join(root, 'errors'))).length, 0);
    const ffmpeg = process.argv[2];
    if (ffmpeg) {
      const raw = path.join(root, 'rgba.raw');
      const png = path.join(root, 'alpha.png');
      await fs.writeFile(raw, Buffer.from([255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 128, 255, 255, 255, 255]));
      const encode = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', '2x2', '-i', raw, '-frames:v', '1', png], {encoding: 'utf8', windowsHide: true});
      assert.equal(encode.status, 0, encode.stderr);
      const alphaCache = createCanvasPreviewCache({
        cacheDir: path.join(root, 'alpha-cache'),
        resolveSource: async () => png,
        convert: async (input, output) => {
          const conversion = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1', '-vf', 'scale=768:768:force_original_aspect_ratio=decrease:flags=fast_bilinear,format=rgba', '-c:v', 'png', '-compression_level', '3', output], {encoding: 'utf8', windowsHide: true});
          assert.equal(conversion.status, 0, conversion.stderr);
        }
      });
      const {fileURLToPath} = require('node:url');
      const alphaPreview = fileURLToPath(await alphaCache.previewUrl(pathToFileURL(png).href));
      const decoded = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-i', alphaPreview, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], {windowsHide: true, maxBuffer: 8 * 1024 * 1024});
      assert.equal(decoded.status, 0, String(decoded.stderr));
      assert.equal(decoded.stdout[3], 0);
      assert.equal(decoded.stdout[decoded.stdout.length - 1], 255);
    }
    console.log('Canvas preview cache tests passed');
  } finally {
    await fs.rm(root, {recursive: true, force: true});
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
