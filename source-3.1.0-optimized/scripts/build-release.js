'use strict';

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const releaseRoot = path.resolve(process.env.FUTURE_AI_RELEASE_ROOT || path.resolve(appRoot, '..'));
const toolsRoot = path.join(appRoot, 'build-tools');
const asarPackageFile = path.join(toolsRoot, 'node_modules', '@electron', 'asar', 'package.json');
const meshoptDecoderFile = path.join(releaseRoot, 'resources', 'meshopt_decoder.cjs');
const excludedTopLevel = new Set(['build-tools', 'node_modules', 'docs']);

function parseArgs(argv) {
  const args = {
    install: false,
    output: path.resolve(process.env.FUTURE_AI_BUILD_OUTPUT || path.join(releaseRoot, 'dist', 'app.asar'))
  };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--install') args.install = true;
    else if (argv[index] === '--output') args.output = path.resolve(argv[++index] || '');
    else throw new Error(`Unknown build argument: ${argv[index]}`);
  }
  return args;
}

function compareNames(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

async function copySorted(source, target, relative = '') {
  await fsp.mkdir(target, {recursive: true});
  const entries = (await fsp.readdir(source, {withFileTypes: true})).sort(compareNames);
  for (const entry of entries) {
    if (!relative && excludedTopLevel.has(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await copySorted(sourcePath, targetPath, childRelative);
    else if (entry.isFile()) {
      await fsp.copyFile(sourcePath, targetPath);
      await fsp.chmod(targetPath, 0o644).catch(() => {});
    } else {
      throw new Error(`Unsupported build input: ${childRelative}`);
    }
  }
}

async function sourceDigest(root) {
  const files = [];
  const visit = async (dir, relative = '') => {
    const entries = (await fsp.readdir(dir, {withFileTypes: true})).sort(compareNames);
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(child, childRelative);
      else if (entry.isFile()) files.push({file: child, relative: childRelative});
    }
  };
  await visit(root);
  const digest = crypto.createHash('sha256');
  for (const item of files) {
    const bytes = await fsp.readFile(item.file);
    digest.update(item.relative, 'utf8');
    digest.update('\0');
    digest.update(String(bytes.length), 'ascii');
    digest.update('\0');
    digest.update(bytes);
  }
  return {sha256: digest.digest('hex'), fileCount: files.length};
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {stdio: 'inherit', ...options});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
}

function runPack(asarCli, source, output) {
  run(process.execPath, [asarCli, 'pack', source, output]);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(asarPackageFile)) {
    throw new Error('Build tools are missing. Run "npm run build:tools" first.');
  }
  const packageMetadata = JSON.parse(await fsp.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  const asarMetadata = JSON.parse(await fsp.readFile(asarPackageFile, 'utf8'));
  const asarBin = typeof asarMetadata.bin === 'string' ? asarMetadata.bin : Object.values(asarMetadata.bin || {})[0];
  const asarCli = path.resolve(path.dirname(asarPackageFile), asarBin || '');
  if (!asarBin || !fs.existsSync(asarCli)) throw new Error(`ASAR CLI is missing: ${asarCli}`);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'future-ai-repro-build-'));
  const stagedSource = path.join(tempRoot, 'source');
  const firstAsar = path.join(tempRoot, 'first.asar');
  const secondAsar = path.join(tempRoot, 'second.asar');
  const extracted = path.join(tempRoot, 'extracted');
  try {
    await copySorted(appRoot, stagedSource);
    const input = await sourceDigest(stagedSource);
    runPack(asarCli, stagedSource, firstAsar);
    runPack(asarCli, stagedSource, secondAsar);
    const firstHash = sha256(firstAsar);
    const secondHash = sha256(secondAsar);
    if (firstHash !== secondHash) throw new Error(`ASAR build is not reproducible: ${firstHash} != ${secondHash}`);

    run(process.execPath, [asarCli, 'extract', firstAsar, extracted]);
    const extractedResources = path.join(tempRoot, 'resources');
    await fsp.mkdir(extractedResources, {recursive: true});
    await fsp.copyFile(meshoptDecoderFile, path.join(extractedResources, 'meshopt_decoder.cjs'));
    const testEnv = {...process.env, FUTURE_AI_RELEASE_ROOT: releaseRoot};
    for (const script of ['smoke-test.js', 'test-generation-count.js', 'test-skill-market.js', 'test-zip-utils.js', 'test-provider-key-pool.js', 'test-project-store-save.js', 'test-operational-contracts.js', 'test-director-characters.js', 'verify-url-dom-safety.js', 'verify-release-version.js', 'check-release-resources.js', 'test-ffmpeg-runtime.js']) {
      run(process.execPath, [path.join(extracted, 'scripts', script)], {cwd: extracted, env: testEnv});
    }

    await fsp.mkdir(path.dirname(args.output), {recursive: true});
    await fsp.copyFile(firstAsar, args.output);
    const manifest = {
      schema: 'future-ai-reproducible-build/v1',
      package: packageMetadata.name,
      version: packageMetadata.version,
      asarVersion: asarMetadata.version,
      sourceFileCount: input.fileCount,
      sourceSha256: input.sha256,
      artifactSha256: firstHash
    };
    const manifestFile = path.join(path.dirname(args.output), 'build-manifest.json');
    await fsp.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    if (args.install) {
      const installed = path.join(releaseRoot, 'resources', 'app.asar');
      await fsp.copyFile(firstAsar, installed);
      if (sha256(installed) !== firstHash) throw new Error('Installed app.asar hash mismatch');
    }
    console.log(`Reproducible ASAR verified: ${firstHash}`);
    console.log(`Build manifest: ${manifestFile}`);
    if (args.install) console.log(`Installed: ${path.join(releaseRoot, 'resources', 'app.asar')}`);
  } finally {
    await fsp.rm(tempRoot, {recursive: true, force: true});
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
