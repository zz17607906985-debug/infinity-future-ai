const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const releaseRoot = process.env.FUTURE_AI_RELEASE_ROOT
  ? path.resolve(process.env.FUTURE_AI_RELEASE_ROOT)
  : path.resolve(appRoot, '..');
const resourcesDir = path.join(releaseRoot, 'resources');

const allowedFiles = new Set([
  'app.asar',
  'elevate.exe',
  'meshopt_decoder.cjs'
]);

const allowedDirectories = new Set([
  'codex',
  'ffmpeg',
  'ffmpeg-lgpl',
  'legal',
  'runtime-data'
]);

function fail(messages) {
  console.error('Release resources check failed:');
  for (const message of messages) console.error(`- ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(resourcesDir)) {
  fail([`Resources directory does not exist: ${resourcesDir}`]);
  return;
}

const entries = fs.readdirSync(resourcesDir, {withFileTypes: true});
const errors = [];

for (const entry of entries) {
  if (entry.isFile()) {
    if (/^app\.asar\./i.test(entry.name)) {
      errors.push(`Stale ASAR backup or hotfix found: ${entry.name}`);
    } else if (!allowedFiles.has(entry.name)) {
      errors.push(`Unexpected file: ${entry.name}`);
    }
  } else if (entry.isDirectory()) {
    if (!allowedDirectories.has(entry.name)) errors.push(`Unexpected directory: ${entry.name}`);
  } else {
    errors.push(`Unsupported resource entry: ${entry.name}`);
  }
}

for (const required of allowedFiles) {
  const target = path.join(resourcesDir, required);
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    errors.push(`Required file is missing: ${required}`);
  }
}

if (errors.length) {
  fail(errors);
} else {
  console.log(`Release resources check passed: ${entries.length} top-level entries are allowed.`);
}
