const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const resourcesDir = path.resolve(appRoot, '..', 'resources');
const activeAsar = path.join(resourcesDir, 'app.asar');

if (!fs.existsSync(activeAsar) || !fs.statSync(activeAsar).isFile()) {
  throw new Error(`Refusing cleanup because the active ASAR is missing: ${activeAsar}`);
}

const staleAsars = fs.readdirSync(resourcesDir, {withFileTypes: true})
  .filter(entry => entry.isFile() && /^app\.asar\./i.test(entry.name))
  .map(entry => {
    const file = path.resolve(resourcesDir, entry.name);
    if (path.dirname(file) !== resourcesDir) {
      throw new Error(`Refusing path outside resources directory: ${file}`);
    }
    return {file, name: entry.name, size: fs.statSync(file).size};
  });

for (const item of staleAsars) fs.unlinkSync(item.file);

const freedBytes = staleAsars.reduce((sum, item) => sum + item.size, 0);
console.log(`Removed ${staleAsars.length} stale ASAR files (${(freedBytes / 1024 / 1024).toFixed(1)} MB).`);
