'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(appRoot, relative), 'utf8');

function sortedFiles(root, accept) {
  const output = [];
  const visit = dir => {
    const entries = fs.readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name, 'en'));
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && accept(file)) output.push(file);
    }
  };
  visit(root);
  return output;
}

const packageMetadata = JSON.parse(read('package.json'));
assert.equal(packageMetadata.version, '3.1.2');
assert.equal(packageMetadata.main, 'src/main.js');
for (const relative of ['src/main.js', 'src/preload.js', 'src/index.html', 'src/app.js', 'src/skills/skill-market.js']) {
  assert.ok(fs.statSync(path.join(appRoot, relative)).isFile(), `missing ${relative}`);
}

const firstPartyJs = sortedFiles(appRoot, file => {
  const relative = path.relative(appRoot, file).replace(/\\/g, '/');
  if (!relative.endsWith('.js')) return false;
  return !relative.startsWith('build-tools/')
    && !relative.startsWith('src/vendor/')
    && !relative.startsWith('src/director-desk/assets/');
});
for (const file of firstPartyJs) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    new Function('require', 'module', 'exports', '__filename', '__dirname', source);
  } catch (error) {
    error.message = `${path.relative(appRoot, file)}: ${error.message}`;
    throw error;
  }
}

const indexHtml = read('src/index.html');
const scriptSources = [...indexHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*><\/script>/gi)].map(match => match[1]);
assert.ok(scriptSources.length > 0, 'index.html must load renderer scripts');
for (const source of scriptSources) {
  assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(source), `remote renderer script is not allowed: ${source}`);
  const relative = path.posix.normalize(path.posix.join('src', source.replace(/^\.\//, '')));
  assert.ok(fs.existsSync(path.join(appRoot, ...relative.split('/'))), `missing renderer script: ${source}`);
}
assert.equal(scriptSources.at(-1), './app.js', 'app.js must remain the final renderer script');

const preload = read('src/preload.js');
const main = read('src/main.js');
const invokedChannels = new Set([...preload.matchAll(/ipcRenderer\.invoke\(['"]([^'"]+)['"]/g)].map(match => match[1]));
const handledChannels = new Set([...main.matchAll(/ipcMain\.handle\(['"]([^'"]+)['"]/g)].map(match => match[1]));
const missingHandlers = [...invokedChannels].filter(channel => !handledChannels.has(channel));
assert.deepEqual(missingHandlers, [], `preload channels without main handlers: ${missingHandlers.join(', ')}`);
assert.match(main, /contextIsolation:\s*true/);
assert.match(main, /nodeIntegration:\s*false/);
assert.match(main, /sandbox:\s*true/);

console.log(`Smoke test passed: ${firstPartyJs.length} scripts parsed, ${scriptSources.length} renderer scripts resolved, ${invokedChannels.size} IPC channels matched.`);
