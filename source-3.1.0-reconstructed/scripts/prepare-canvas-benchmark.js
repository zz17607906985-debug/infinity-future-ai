'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {fileURLToPath, pathToFileURL} = require('node:url');

async function main() {
  const [sourceFile, fixtureRoot, localAppData] = process.argv.slice(2);
  if (!sourceFile || !fixtureRoot || !localAppData) {
    throw new Error('Usage: node scripts/prepare-canvas-benchmark.js <projects.json> <fixture-root> <local-appdata>');
  }
  const projects = JSON.parse(await fs.readFile(sourceFile, 'utf8'));
  if (!Array.isArray(projects) || !projects[0]?.state?.nodes?.length) throw new Error('Missing first project');
  await fs.mkdir(fixtureRoot, {recursive: true});
  const mediaRoot = path.join(fixtureRoot, 'media');
  await fs.mkdir(mediaRoot, {recursive: true});
  const copied = new Map();
  async function localize(value) {
    if (typeof value === 'string' && value.startsWith('file:')) {
      if (!copied.has(value)) {
        copied.set(value, (async () => {
          const source = fileURLToPath(value);
          const target = path.join(mediaRoot, crypto.createHash('sha256').update(source).digest('hex') + path.extname(source));
          await fs.copyFile(source, target);
          return pathToFileURL(target).href;
        })());
      }
      return copied.get(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map(localize));
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await localize(item)]));
      return Object.fromEntries(entries);
    }
    return value;
  }
  projects[0].state.nodes = await Promise.all(projects[0].state.nodes.map(async node => ({...node, data: await localize(node.data)})));
  await fs.writeFile(path.join(fixtureRoot, 'projects.json'), JSON.stringify([projects[0]]));
  const runtimeRoot = path.join(localAppData, 'InfinityFutureAI', 'user-data');
  await fs.mkdir(runtimeRoot, {recursive: true});
  // All project and media I/O is restricted to the fixture. The original remains read-only.
  await fs.writeFile(path.join(runtimeRoot, 'allowed-storage-roots.json'), JSON.stringify([fixtureRoot]));
  console.log(JSON.stringify({nodes: projects[0].state.nodes.length, edges: projects[0].state.edges?.length || 0, mediaFiles: copied.size, fixtureRoot, localAppData}));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
