'use strict';

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const appRoot = path.resolve(__dirname, '..');
const packageMetadata = require('../package.json');
const executableName = '∞未来 AI 无限画布.exe';
const includedRuntimeEntries = new Set([
  'chrome_100_percent.pak',
  'chrome_200_percent.pak',
  'd3dcompiler_47.dll',
  'ffmpeg.dll',
  'icudtl.dat',
  'libEGL.dll',
  'libGLESv2.dll',
  'LICENSE.electron.txt',
  'LICENSES.chromium.html',
  'locales',
  'NVIDIA Corporation',
  'resources',
  'resources.pak',
  'snapshot_blob.bin',
  '使用说明.md',
  'v8_context_snapshot.bin',
  'vk_swiftshader.dll',
  'vk_swiftshader_icd.json',
  'vulkan-1.dll',
  'wallpapers',
  executableName
]);

function resolveReleaseRoot() {
  const candidates = [
    process.env.FUTURE_AI_RELEASE_ROOT,
    path.resolve(appRoot, '..', '..', '..', '∞未来AI'),
    path.resolve(appRoot, '..', '..')
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (require('fs').existsSync(path.join(candidate, 'resources', 'app.asar'))
      && require('fs').existsSync(path.join(candidate, executableName))) {
      return path.resolve(candidate);
    }
  }
  throw new Error('Set FUTURE_AI_RELEASE_ROOT to the installed app folder.');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: appRoot, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited with ${result.status}`);
}

async function copyRuntime(releaseRoot, stageRoot) {
  const entries = await fs.readdir(releaseRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!includedRuntimeEntries.has(entry.name)) {
      if (entry.name === '源码工程' || entry.name === '.git' || entry.name === 'dist'
        || entry.name.startsWith('Uninstall ') || entry.name === 'debug.log'
        || entry.name === 'uninstallerIcon.ico' || entry.name === '启动.cmd') {
        continue;
      }
      throw new Error(`Unexpected runtime folder entry; refusing to package it: ${entry.name}`);
    }
    if (entry.isSymbolicLink()) throw new Error(`Runtime symlinks are not allowed: ${entry.name}`);
    await fs.cp(
      path.join(releaseRoot, entry.name),
      path.join(stageRoot, entry.name),
      { recursive: true, errorOnExist: true, force: false }
    );
  }

  const appAsar = path.join(stageRoot, 'resources', 'app.asar');
  const appExecutable = path.join(stageRoot, executableName);
  await fs.access(appAsar);
  await fs.access(appExecutable);
  await fs.writeFile(path.join(stageRoot, 'package.json'), JSON.stringify({
    name: packageMetadata.name,
    version: packageMetadata.version,
    productName: '∞未来 AI',
    main: packageMetadata.main
  }, null, 2) + '\n', 'utf8');
}

async function main() {
  const releaseRoot = resolveReleaseRoot();
  const outputRoot = path.resolve(
    process.env.FUTURE_AI_INSTALLER_OUTPUT || path.resolve(appRoot, '..', '..', '..')
  );
  const builderCli = path.join(appRoot, 'build-tools', 'node_modules', 'electron-builder', 'cli.js');
  const nodeExecutable = process.execPath;
  const icon = path.join(appRoot, 'build', 'icon.ico');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'future-ai-installer-'));
  const stageRoot = path.join(tempRoot, 'win-unpacked');
  const configFile = path.join(tempRoot, 'electron-builder.json');

  try {
    await fs.mkdir(stageRoot, { recursive: true });
    await copyRuntime(releaseRoot, stageRoot);
    await fs.mkdir(outputRoot, { recursive: true });
    await fs.writeFile(configFile, JSON.stringify({
      appId: 'com.infinityfutureai.canvas',
      productName: '∞未来 AI',
      electronVersion: '31.7.7',
      directories: { output: outputRoot, buildResources: path.join(appRoot, 'build') },
      win: {
        executableName: path.basename(executableName, '.exe'),
        icon,
        signAndEditExecutable: false,
        target: [{ target: 'nsis', arch: ['x64'] }]
      },
      nsis: {
        oneClick: false,
        perMachine: false,
        allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: '∞未来 AI',
        runAfterFinish: true,
        deleteAppDataOnUninstall: false,
        installerIcon: icon,
        uninstallerIcon: icon,
      artifactName: 'FutureAI-Setup-${version}-x64.${ext}'
      }
    }, null, 2), 'utf8');

    run(nodeExecutable, [
      builderCli,
      '--win',
      'nsis',
      '--x64',
      '--prepackaged',
      stageRoot,
      '--config',
      configFile
    ]);

    const installers = (await fs.readdir(outputRoot))
      .filter(name => /^FutureAI-Setup-\d{1,3}\.\d{1,3}\.\d{1,3}-x64\.exe$/i.test(name))
      .map(name => path.join(outputRoot, name));
    if (!installers.length) throw new Error(`Installer was not created in ${outputRoot}`);
    const installer = installers.sort().at(-1);
    const stats = await fs.stat(installer);
    console.log(`Windows installer created: ${installer} (${stats.size} bytes)`);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
