'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const releaseRoot = process.env.FUTURE_AI_RELEASE_ROOT
  ? path.resolve(process.env.FUTURE_AI_RELEASE_ROOT)
  : path.resolve(appRoot, '..');
const ffmpeg = path.join(releaseRoot, 'resources', 'ffmpeg', 'ffmpeg.exe');

function run(args, label) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {
    cwd: appRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${label}: ${result.stderr || `exit ${result.status}`}`.trim());
  return result;
}

function assertMedia(file, label) {
  const stat = fs.statSync(file);
  assert(stat.size > 1024, `${label} is unexpectedly small`);
  run(['-i', file, '-map', '0:v:0', '-frames:v', '1', '-f', 'null', '-'], `${label} decode`);
}

function assertImage(file, label) {
  const stat = fs.statSync(file);
  assert(stat.size > 100, `${label} is unexpectedly small`);
  run(['-i', file, '-frames:v', '1', '-f', 'null', '-'], `${label} decode`);
}

async function main() {
  if (!fs.existsSync(ffmpeg)) {
    if (process.env.FUTURE_AI_REQUIRE_FFMPEG === '1') throw new Error(`FFmpeg runtime missing: ${ffmpeg}`);
    console.log('FFmpeg runtime smoke skipped: release resources are not present.');
    return;
  }
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'future-ai-ffmpeg-smoke-'));
  const sourceA = path.join(tempRoot, 'source-a.mp4');
  const sourceB = path.join(tempRoot, 'source-b.mp4');
  const trimmed = path.join(tempRoot, 'trimmed.mp4');
  const sped = path.join(tempRoot, 'sped.mp4');
  const resized = path.join(tempRoot, 'resized.mp4');
  const joined = path.join(tempRoot, 'joined.mp4');
  const firstFrame = path.join(tempRoot, 'first-frame.png');
  const lastFrame = path.join(tempRoot, 'last-frame.png');
  const timedFrame = path.join(tempRoot, 'timed-frame.png');
  const resizedImage = path.join(tempRoot, 'resized.png');
  const canvasImage = path.join(tempRoot, 'canvas.png');
  const imageJpg = path.join(tempRoot, 'image.jpg');
  const looped = path.join(tempRoot, 'looped.mp4');
  const muted = path.join(tempRoot, 'muted.mp4');
  const audioA = path.join(tempRoot, 'audio-a.m4a');
  const audioB = path.join(tempRoot, 'audio-b.m4a');
  const audioExtract = path.join(tempRoot, 'audio-extract.m4a');
  const audioVolume = path.join(tempRoot, 'audio-volume.m4a');
  const audioMix = path.join(tempRoot, 'audio-mix.m4a');
  const audioAlign = path.join(tempRoot, 'audio-align.m4a');
  const subtitles = path.join(tempRoot, 'captions.srt');
  const shifted = path.join(tempRoot, 'captions-shifted.srt');
  const converted = path.join(tempRoot, 'captions.vtt');
  const burned = path.join(tempRoot, 'burned.mp4');
  const list = path.join(tempRoot, `concat-${crypto.randomBytes(3).toString('hex')}.txt`);
  try {
    const makeSource = async (file, color, frequency) => {
      run([
        '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=320x180:d=2`,
        '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=2`,
        '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', file
      ], `create ${color} source`);
      assertMedia(file, `${color} source`);
    };
    await makeSource(sourceA, 'red', 440);
    await makeSource(sourceB, 'blue', 660);

    run(['-y', '-ss', '0.25', '-i', sourceA, '-t', '0.75', '-c:v', 'libx264', '-c:a', 'aac', trimmed], 'trim video');
    assertMedia(trimmed, 'trimmed video');

    run(['-y', '-i', sourceA, '-filter:v', 'setpts=0.5*PTS', '-filter:a', 'atempo=2', '-c:v', 'libx264', '-c:a', 'aac', sped], 'change video speed');
    assertMedia(sped, 'speed-adjusted video');

    run(['-y', '-i', sourceA, '-vf', 'scale=640:360', '-c:v', 'libx264', '-c:a', 'aac', resized], 'resize video');
    assertMedia(resized, 'resized video');

    await fsp.writeFile(list, `file '${sourceA.replace(/\\/g, '/').replace(/'/g, "'\\\\''")}'\nfile '${sourceB.replace(/\\/g, '/').replace(/'/g, "'\\\\''")}'\n`, 'utf8');
    run(['-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], 'concat videos');
    assertMedia(joined, 'concatenated video');

    run(['-y', '-i', sourceA, '-frames:v', '1', firstFrame], 'extract first frame');
    run(['-y', '-sseof', '-0.15', '-i', sourceA, '-frames:v', '1', lastFrame], 'extract last frame');
    run(['-y', '-ss', '0.5', '-i', sourceA, '-frames:v', '1', timedFrame], 'extract timed frame');
    [firstFrame, lastFrame, timedFrame].forEach((file, index) => assertImage(file, `frame ${index + 1}`));

    run(['-y', '-i', firstFrame, '-vf', 'scale=160:90:flags=lanczos', resizedImage], 'resize image');
    run(['-y', '-i', firstFrame, '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:0x112233', canvasImage], 'pad image canvas');
    run(['-y', '-i', firstFrame, '-frames:v', '1', imageJpg], 'convert image format');
    [resizedImage, canvasImage, imageJpg].forEach((file, index) => assertImage(file, `image output ${index + 1}`));

    run(['-y', '-stream_loop', '1', '-i', sourceA, '-t', '3', '-c:v', 'libx264', '-c:a', 'aac', '-movflags', '+faststart', looped], 'loop video');
    run(['-y', '-i', sourceA, '-map', '0:v:0', '-c:v', 'copy', '-an', '-movflags', '+faststart', muted], 'mute video');
    assertMedia(looped, 'looped video');
    assertMedia(muted, 'muted video');

    run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-b:a', '192k', audioA], 'create audio A');
    run(['-y', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=1.5', '-c:a', 'aac', '-b:a', '192k', audioB], 'create audio B');
    run(['-y', '-i', sourceA, '-vn', '-c:a', 'aac', '-b:a', '192k', audioExtract], 'extract audio');
    run(['-y', '-i', audioA, '-filter:a', 'volume=0.5', '-c:a', 'aac', '-b:a', '192k', audioVolume], 'change volume');
    run(['-y', '-i', audioA, '-i', audioB, '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[a]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', audioMix], 'mix audio');
    run(['-y', '-i', audioA, '-filter:a', 'apad,atrim=0:2', '-c:a', 'aac', '-b:a', '192k', audioAlign], 'align audio');
    [audioExtract, audioVolume, audioMix, audioAlign].forEach((file, index) => {
      assert(fs.statSync(file).size > 1024, `audio output ${index + 1} is unexpectedly small`);
      run(['-y', '-i', file, '-map', '0:a:0', '-t', '0.2', '-f', 'null', '-'], `audio output ${index + 1} decode`);
    });

    await fsp.writeFile(subtitles, '1\n00:00:00,000 --> 00:00:01,000\nHello\n', 'utf8');
    await fsp.writeFile(shifted, '1\n00:00:00,000 --> 00:00:01,000\nHello\n', 'utf8');
    const shiftedText = (await fsp.readFile(shifted, 'utf8')).replace('00:00:00,000', '00:00:00,250').replace('00:00:01,000', '00:00:01,250');
    await fsp.writeFile(shifted, shiftedText, 'utf8');
    await fsp.writeFile(converted, `WEBVTT\n\n${shiftedText.replace(/,/g, '.')}`, 'utf8');
    assert.match(await fsp.readFile(converted, 'utf8'), /^WEBVTT/);
    const subtitleFilterPath = subtitles.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    run(['-y', '-i', sourceA, '-vf', `subtitles='${subtitleFilterPath}'`, '-c:a', 'copy', burned], 'burn subtitles');
    assertMedia(burned, 'burned subtitles');

    console.log('FFmpeg runtime smoke passed: video, image, audio, looping, mute, subtitles, and versioned outputs.');
  } finally {
    await fsp.rm(tempRoot, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exitCode = 1;
});
