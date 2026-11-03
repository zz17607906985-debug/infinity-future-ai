const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');

const { verifySignedUpdateManifest } = require('./update-signature');

const execFileAsync = promisify(execFile);
const INSTALLER_PATTERN = /^FutureAI-Setup-(\d{1,3}\.\d{1,3}\.\d{1,3})-(x64|arm64|ia32)\.exe$/i;
const MAX_MANIFEST_BYTES = 64 * 1024;

function pathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function compareVersions(a, b) {
  const left = String(a).split('.').map(Number);
  const right = String(b).split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function normalizeThumbprint(value) {
  return String(value || '').replace(/[^A-Fa-f0-9]/g, '').toUpperCase();
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fsSync.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function defaultAuthenticodeVerifier(file) {
  const escaped = file.replace(/'/g, "''");
  const script = [
    `$signature=Get-AuthenticodeSignature -LiteralPath '${escaped}'`,
    "$certificate=$signature.SignerCertificate",
    "$timestamp=$signature.TimeStamperCertificate",
    "[pscustomobject]@{status=[string]$signature.Status;thumbprint=if($certificate){$certificate.Thumbprint}else{''};subject=if($certificate){$certificate.Subject}else{''};timestampThumbprint=if($timestamp){$timestamp.Thumbprint}else{''};timestampSubject=if($timestamp){$timestamp.Subject}else{''}} | ConvertTo-Json -Compress"
  ].join(';');
  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 64 * 1024
  });
  return JSON.parse(result.stdout.trim());
}

function validatePublisherSet(value) {
  if (!(value instanceof Set) || value.size < 1) throw new Error('尚未配置可信代码签名证书指纹');
  return new Set([...value].map(normalizeThumbprint).filter(item => /^[A-F0-9]{40,128}$/.test(item)));
}

function loadTrustedPublisherThumbprints(file) {
  const raw = fsSync.readFileSync(file, 'utf8');
  if (Buffer.byteLength(raw, 'utf8') > 16 * 1024) throw new Error('可信发布者配置超过安全限制');
  const doc = JSON.parse(raw);
  if (!doc || Object.keys(doc).sort().join(',') !== 'schema,thumbprints'
    || doc.schema !== 'future-ai-code-signing-publishers/v1'
    || !Array.isArray(doc.thumbprints) || doc.thumbprints.length > 8) {
    throw new Error('可信发布者配置格式无效');
  }
  const result = new Set(doc.thumbprints.map(normalizeThumbprint));
  if ([...result].some(item => !/^[A-F0-9]{40,128}$/.test(item))) throw new Error('可信发布者证书指纹无效');
  return result;
}

async function verifyAuthenticode(file, trustedPublisherThumbprints, authenticodeVerifier) {
  const trusted = validatePublisherSet(trustedPublisherThumbprints);
  const signature = await (authenticodeVerifier || defaultAuthenticodeVerifier)(file);
  const status = String(signature?.status || '');
  const thumbprint = normalizeThumbprint(signature?.thumbprint);
  const timestampThumbprint = normalizeThumbprint(signature?.timestampThumbprint);
  const timestampSubject = String(signature?.timestampSubject || '');
  if (status !== 'Valid') throw new Error(`安装器 Authenticode 验证失败：${status || 'Unknown'}`);
  if (!trusted.has(thumbprint)) throw new Error('安装器代码签名发布者不受信任');
  if (!/^[A-F0-9]{40,128}$/.test(timestampThumbprint) || !timestampSubject) {
    throw new Error('安装器代码签名缺少可信时间戳');
  }
  return Object.freeze({
    status,
    thumbprint,
    subject: String(signature?.subject || ''),
    timestamp: Object.freeze({thumbprint: timestampThumbprint, subject: timestampSubject})
  });
}

async function readManifest(packageDir) {
  const file = path.join(packageDir, 'update-manifest.json');
  const stats = await fs.stat(file).catch(error => {
    if (error.code === 'ENOENT') throw new Error('更新包缺少 update-manifest.json');
    throw error;
  });
  if (!stats.isFile() || stats.size > MAX_MANIFEST_BYTES) throw new Error('更新清单超过安全限制');
  return { file, raw: await fs.readFile(file, 'utf8') };
}

async function verifyInstallerPackage(options = {}) {
  const packageDir = path.resolve(String(options.packageDir || ''));
  if (!packageDir || !fsSync.existsSync(packageDir) || !fsSync.statSync(packageDir).isDirectory()) throw new Error('更新包目录无效');
  const manifestFile = await readManifest(packageDir);
  const manifest = verifySignedUpdateManifest(manifestFile.raw, options.keyRing);
  if (compareVersions(manifest.minimumVersion, options.currentVersion) > 0) throw new Error('当前版本过旧，不能直接安装此更新');
  if (compareVersions(manifest.version, options.currentVersion) <= 0) throw new Error('更新版本必须高于当前版本');
  const installerPath = path.resolve(packageDir, manifest.artifact);
  if (!pathInside(packageDir, installerPath) || path.basename(installerPath) !== manifest.artifact) throw new Error('更新安装器路径越界');
  const stats = await fs.stat(installerPath).catch(error => {
    if (error.code === 'ENOENT') throw new Error('更新包缺少签名安装器');
    throw error;
  });
  if (!stats.isFile() || stats.size !== manifest.bytes) throw new Error('安装器文件大小与签名清单不一致');
  const sha256 = await sha256File(installerPath);
  if (sha256 !== manifest.sha256) throw new Error('安装器 SHA-256 与签名清单不一致');
  const authenticode = await verifyAuthenticode(
    installerPath,
    options.trustedPublisherThumbprints,
    options.authenticodeVerifier
  );
  return Object.freeze({
    version: manifest.version,
    minimumVersion: manifest.minimumVersion,
    notes: manifest.notes,
    releasedAt: manifest.releasedAt,
    installerPath,
    artifact: manifest.artifact,
    bytes: stats.size,
    sha256,
    authenticode,
    manifestFile: manifestFile.file
  });
}

async function cachedInstaller(file, currentVersion, trustedPublisherThumbprints, authenticodeVerifier) {
  const match = path.basename(file).match(INSTALLER_PATTERN);
  if (!match || compareVersions(match[1], currentVersion) > 0) return null;
  const stats = await fs.stat(file);
  if (!stats.isFile() || stats.size < 1) return null;
  const authenticode = await verifyAuthenticode(file, trustedPublisherThumbprints, authenticodeVerifier);
  return {
    path: file,
    version: match[1],
    bytes: stats.size,
    sha256: await sha256File(file),
    thumbprint: authenticode.thumbprint,
    timestampThumbprint: authenticode.timestamp.thumbprint
  };
}

async function findCurrentInstaller(cacheDir, currentVersion, trustedPublisherThumbprints, authenticodeVerifier) {
  let entries;
  try { entries = await fs.readdir(cacheDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('找不到上一版安装器缓存，无法保证失败回滚');
    throw error;
  }
  const candidates = entries
    .filter(entry => entry.isFile() && INSTALLER_PATTERN.test(entry.name))
    .map(entry => path.join(cacheDir, entry.name));
  for (const file of candidates) {
    const match = path.basename(file).match(INSTALLER_PATTERN);
    if (match?.[1] !== currentVersion) continue;
    try { return await cachedInstaller(file, currentVersion, trustedPublisherThumbprints, authenticodeVerifier); }
    catch {}
  }
  throw new Error('找不到通过签名验证的上一版安装器缓存，无法保证失败回滚');
}

async function findPreviousInstaller(cacheDir, currentVersion, trustedPublisherThumbprints, authenticodeVerifier) {
  let entries;
  try { entries = await fs.readdir(cacheDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error('找不到可回滚的历史安装器');
    throw error;
  }
  const candidates = entries
    .filter(entry => entry.isFile())
    .map(entry => ({ entry, match: entry.name.match(INSTALLER_PATTERN) }))
    .filter(item => item.match && compareVersions(item.match[1], currentVersion) < 0)
    .sort((a, b) => compareVersions(b.match[1], a.match[1]));
  for (const candidate of candidates) {
    try {
      return await cachedInstaller(
        path.join(cacheDir, candidate.entry.name),
        currentVersion,
        trustedPublisherThumbprints,
        authenticodeVerifier
      );
    } catch {}
  }
  throw new Error('找不到通过签名验证的上一版安装器');
}

async function atomicWriteJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function validateWorkspaceBackupReceipt(receipt, stateDir) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw new Error('installer transaction requires a verified workspace backup');
  const keys = Object.keys(receipt).sort().join(',');
  if (keys !== 'backupDir,bytes,files,manifestFile,manifestSha256,schema,verifiedAt'
    || receipt.schema !== 'future-ai-verified-workspace-backup/v1') {
    throw new Error('verified workspace backup receipt is invalid');
  }
  const root = path.resolve(stateDir);
  const backupDir = path.resolve(String(receipt.backupDir || ''));
  const manifestFile = path.resolve(String(receipt.manifestFile || ''));
  if (!pathInside(root, backupDir) || !pathInside(backupDir, manifestFile)
    || path.dirname(manifestFile) !== backupDir || path.basename(manifestFile).toLowerCase() !== 'manifest.json') {
    throw new Error('verified workspace backup is outside the update state directory');
  }
  if (!/^[a-f0-9]{64}$/i.test(String(receipt.manifestSha256 || ''))
    || !Number.isSafeInteger(receipt.files) || receipt.files < 2
    || !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 1) {
    throw new Error('verified workspace backup receipt totals are invalid');
  }
  const verifiedAt = new Date(receipt.verifiedAt);
  if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt.toISOString() !== receipt.verifiedAt) {
    throw new Error('verified workspace backup receipt time is invalid');
  }
  const stats = await fs.stat(manifestFile).catch(() => null);
  if (!stats?.isFile() || stats.size < 2 || stats.size > 16 * 1024 * 1024
    || await sha256File(manifestFile) !== receipt.manifestSha256.toLowerCase()) {
    throw new Error('verified workspace backup manifest SHA-256 does not match');
  }
  return Object.freeze({
    schema: receipt.schema,
    backupDir,
    manifestFile,
    manifestSha256: receipt.manifestSha256.toLowerCase(),
    files: receipt.files,
    bytes: receipt.bytes,
    verifiedAt: receipt.verifiedAt
  });
}

async function prepareInstallerUpdate(options = {}) {
  const stateDir = path.resolve(String(options.stateDir || ''));
  const cacheDir = path.resolve(String(options.cacheDir || ''));
  const installDir = path.resolve(String(options.installDir || ''));
  const applicationExecutable = path.resolve(String(options.applicationExecutable || ''));
  if (!pathInside(installDir, applicationExecutable) || path.extname(applicationExecutable).toLowerCase() !== '.exe') {
    throw new Error('应用程序路径不在安装目录内');
  }
  if (!Number.isInteger(options.sourcePid) || options.sourcePid < 1) throw new Error('更新源进程无效');
  const workspaceBackup = await validateWorkspaceBackupReceipt(options.workspaceBackup, stateDir);
  const target = await verifyInstallerPackage(options);
  const rollback = await findCurrentInstaller(
    cacheDir,
    options.currentVersion,
    options.trustedPublisherThumbprints,
    options.authenticodeVerifier
  );
  await fs.mkdir(path.join(stateDir, 'packages'), { recursive: true });
  const stagedInstaller = path.join(stateDir, 'packages', target.artifact);
  await fs.copyFile(target.installerPath, stagedInstaller);
  if (await sha256File(stagedInstaller) !== target.sha256) {
    await fs.rm(stagedInstaller, { force: true });
    throw new Error('安装器暂存后 SHA-256 校验失败');
  }
  const token = crypto.randomUUID();
  const transactionFile = path.join(stateDir, 'pending-update.json');
  const transaction = {
    schema: 'future-ai-installer-update-transaction/v1',
    mode: 'update',
    token,
    createdAt: new Date().toISOString(),
    sourcePid: options.sourcePid,
    currentVersion: options.currentVersion,
    targetVersion: target.version,
    installDir,
    applicationExecutable,
    healthFile: path.join(stateDir, `health-${token}.json`),
    workspaceBackup,
    targetInstaller: {
      path: stagedInstaller,
      version: target.version,
      bytes: target.bytes,
      sha256: target.sha256,
      thumbprint: target.authenticode.thumbprint,
      timestampThumbprint: target.authenticode.timestamp.thumbprint
    },
    rollbackInstaller: rollback
  };
  await atomicWriteJson(transactionFile, transaction);
  const transactionSha256 = await sha256File(transactionFile);
  return { transaction, transactionFile, transactionSha256 };
}

async function prepareInstallerRollback(options = {}) {
  const stateDir = path.resolve(String(options.stateDir || ''));
  const cacheDir = path.resolve(String(options.cacheDir || ''));
  const installDir = path.resolve(String(options.installDir || ''));
  const applicationExecutable = path.resolve(String(options.applicationExecutable || ''));
  if (!pathInside(installDir, applicationExecutable) || path.extname(applicationExecutable).toLowerCase() !== '.exe') {
    throw new Error('应用程序路径不在安装目录内');
  }
  if (!Number.isInteger(options.sourcePid) || options.sourcePid < 1) throw new Error('更新源进程无效');
  const workspaceBackup = await validateWorkspaceBackupReceipt(options.workspaceBackup, stateDir);
  const [target, recovery] = await Promise.all([
    findPreviousInstaller(cacheDir, options.currentVersion, options.trustedPublisherThumbprints, options.authenticodeVerifier),
    findCurrentInstaller(cacheDir, options.currentVersion, options.trustedPublisherThumbprints, options.authenticodeVerifier)
  ]);
  const token = crypto.randomUUID();
  const transactionFile = path.join(stateDir, 'pending-update.json');
  const transaction = {
    schema: 'future-ai-installer-update-transaction/v1',
    mode: 'rollback',
    token,
    createdAt: new Date().toISOString(),
    sourcePid: options.sourcePid,
    currentVersion: options.currentVersion,
    targetVersion: target.version,
    installDir,
    applicationExecutable,
    healthFile: path.join(stateDir, `health-${token}.json`),
    workspaceBackup,
    targetInstaller: target,
    rollbackInstaller: recovery
  };
  await atomicWriteJson(transactionFile, transaction);
  return { transaction, transactionFile, transactionSha256: await sha256File(transactionFile) };
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildUpdateHelperCommand({ transactionFile, transactionSha256 }) {
  const file = path.resolve(String(transactionFile || ''));
  if (!/^[a-f0-9]{64}$/i.test(transactionSha256 || '')) throw new Error('更新事务 SHA-256 无效');
  const script = `
$ErrorActionPreference='Stop'
$TransactionPath=${powershellQuote(file)}
$ExpectedTransactionHash=${powershellQuote(transactionSha256.toLowerCase())}
function Write-TransactionStatus([string]$Status,[string]$Detail) {
  $state=[ordered]@{schema='future-ai-installer-update-status/v1';token=$tx.token;status=$Status;detail=$Detail;updatedAt=[DateTime]::UtcNow.ToString('o')}
  $statusPath=$TransactionPath + '.status.json'
  $statusTemp=$statusPath + '.' + [Guid]::NewGuid().ToString('N') + '.tmp'
  try {
    $state | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $statusTemp -Encoding UTF8
    Move-Item -LiteralPath $statusTemp -Destination $statusPath -Force
  } finally {
    Remove-Item -LiteralPath $statusTemp -Force -ErrorAction SilentlyContinue
  }
  $event=[ordered]@{
    schema='future-ai-installer-update-event/v1';token=$tx.token;mode=$tx.mode
    currentVersion=$tx.currentVersion;targetVersion=$tx.targetVersion;status=$Status
    targetSha256=$tx.targetInstaller.sha256;rollbackSha256=$tx.rollbackInstaller.sha256
    workspaceBackupPresent=[bool]$tx.workspaceBackup;updatedAt=$state.updatedAt
  }
  try {
    $event | ConvertTo-Json -Compress | Add-Content -LiteralPath ($TransactionPath + '.events.jsonl') -Encoding UTF8
  } catch {
    # Audit evidence may be incomplete, but logging failure must never prevent rollback safety.
  }
}
function Test-WorkspaceBackup($Backup) {
  if(-not $Backup -or $Backup.schema -ne 'future-ai-verified-workspace-backup/v1'){throw 'verified workspace backup receipt missing'}
  $backupRoot=[IO.Path]::GetFullPath([string]$Backup.backupDir).TrimEnd('\')
  $manifestPath=[IO.Path]::GetFullPath([string]$Backup.manifestFile)
  if([IO.Path]::GetDirectoryName($manifestPath) -ne $backupRoot){throw 'workspace backup manifest path mismatch'}
  if(-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)){throw 'workspace backup manifest missing'}
  if((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Backup.manifestSha256){throw 'workspace backup manifest hash mismatch'}
  $manifest=Get-Content -Raw -LiteralPath $manifestPath -Encoding UTF8 | ConvertFrom-Json
  if($manifest.format -ne 'future-ai-workspace-backup' -or [int]$manifest.version -ne 1){throw 'workspace backup manifest format invalid'}
  $seen=@{}
  [int64]$totalBytes=0
  [int]$fileCount=0
  $prefix=$backupRoot + '\'
  foreach($entry in @($manifest.files)) {
    $relative=([string]$entry.path).Replace('/','\')
    $parts=@($relative.Split('\'))
    if(-not $relative -or [IO.Path]::IsPathRooted($relative) -or $parts -contains '..' -or $parts -contains '.' -or $seen.ContainsKey($relative)){throw 'workspace backup path invalid'}
    $itemPath=[IO.Path]::GetFullPath((Join-Path $backupRoot $relative))
    if(-not $itemPath.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)){throw 'workspace backup path escaped root'}
    if(-not (Test-Path -LiteralPath $itemPath -PathType Leaf)){throw 'workspace backup file missing'}
    $item=Get-Item -LiteralPath $itemPath
    if($item.Length -ne [int64]$entry.size){throw 'workspace backup file size mismatch'}
    if((Get-FileHash -LiteralPath $itemPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne ([string]$entry.sha256).ToLowerInvariant()){throw 'workspace backup file hash mismatch'}
    $seen[$relative]=$true
    $totalBytes += $item.Length
    $fileCount++
  }
  if(-not $seen.ContainsKey('stores\projects.json') -or -not $seen.ContainsKey('settings.json')){throw 'workspace backup required snapshots missing'}
  if($fileCount -ne [int]$manifest.totals.files -or $totalBytes -ne [int64]$manifest.totals.bytes){throw 'workspace backup manifest totals mismatch'}
  if($fileCount -ne [int]$Backup.files -or $totalBytes -ne [int64]$Backup.bytes){throw 'workspace backup receipt totals mismatch'}
}
function Test-Installer($Item) {
  if(-not (Test-Path -LiteralPath $Item.path -PathType Leaf)){throw 'installer missing'}
  if((Get-Item -LiteralPath $Item.path).Length -ne [int64]$Item.bytes){throw 'installer size mismatch'}
  if((Get-FileHash -LiteralPath $Item.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Item.sha256){throw 'installer hash mismatch'}
  $signature=Get-AuthenticodeSignature -LiteralPath $Item.path
  if([string]$signature.Status -ne 'Valid'){throw 'installer Authenticode invalid'}
  if($signature.SignerCertificate.Thumbprint.ToUpperInvariant() -ne $Item.thumbprint){throw 'installer publisher mismatch'}
  if(-not $signature.TimeStamperCertificate){throw 'installer timestamp missing'}
  if($signature.TimeStamperCertificate.Thumbprint.ToUpperInvariant() -ne $Item.timestampThumbprint){throw 'installer timestamp mismatch'}
}
function Start-Installer($Item,[string]$InstallDir) {
  Test-Installer $Item
  & $Item.path '/S' ("/D=" + $InstallDir)
  if($LASTEXITCODE -ne 0){throw ("installer exit " + $LASTEXITCODE)}
}
if((Get-FileHash -LiteralPath $TransactionPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ExpectedTransactionHash){throw 'transaction hash mismatch'}
$tx=Get-Content -Raw -LiteralPath $TransactionPath -Encoding UTF8 | ConvertFrom-Json
Test-WorkspaceBackup $tx.workspaceBackup
Get-Process -Id $tx.sourcePid -ErrorAction SilentlyContinue | Wait-Process -ErrorAction SilentlyContinue
try {
  Write-TransactionStatus 'installing' $tx.targetVersion
  Start-Installer $tx.targetInstaller $tx.installDir
  Remove-Item -LiteralPath $tx.healthFile -Force -ErrorAction SilentlyContinue
  $newApp=Start-Process -FilePath $tx.applicationExecutable -ArgumentList ("--future-ai-update-health=" + $tx.token) -PassThru
  $deadline=[DateTime]::UtcNow.AddSeconds(90)
  $healthy=$false
  while([DateTime]::UtcNow -lt $deadline) {
    if(Test-Path -LiteralPath $tx.healthFile) {
      $health=Get-Content -Raw -LiteralPath $tx.healthFile -Encoding UTF8 | ConvertFrom-Json
      if($health.token -eq $tx.token -and $health.phase -eq 'target' -and $health.version -eq $tx.targetVersion){$healthy=$true;break}
    }
    if($newApp.HasExited){break}
    Start-Sleep -Milliseconds 500
    $newApp.Refresh()
  }
  if(-not $healthy){throw 'new version health check failed'}
  Write-TransactionStatus 'completed' $tx.targetVersion
} catch {
  Write-TransactionStatus 'rolling-back' $_.Exception.Message
  if($newApp -and -not $newApp.HasExited){Stop-Process -Id $newApp.Id -Force -ErrorAction SilentlyContinue}
  Start-Installer $tx.rollbackInstaller $tx.installDir
  Remove-Item -LiteralPath $tx.healthFile -Force -ErrorAction SilentlyContinue
  $rollbackApp=Start-Process -FilePath $tx.applicationExecutable -ArgumentList ("--future-ai-rollback-health=" + $tx.token) -PassThru
  $rollbackDeadline=[DateTime]::UtcNow.AddSeconds(90)
  $rollbackHealthy=$false
  while([DateTime]::UtcNow -lt $rollbackDeadline) {
    if(Test-Path -LiteralPath $tx.healthFile) {
      $rollbackHealth=Get-Content -Raw -LiteralPath $tx.healthFile -Encoding UTF8 | ConvertFrom-Json
      if($rollbackHealth.token -eq $tx.token -and $rollbackHealth.phase -eq 'rollback' -and $rollbackHealth.version -eq $tx.currentVersion -and $rollbackHealth.workspaceBackupVerified -eq $true){$rollbackHealthy=$true;break}
    }
    if($rollbackApp.HasExited){break}
    Start-Sleep -Milliseconds 500
    $rollbackApp.Refresh()
  }
  if(-not $rollbackHealthy) {
    Write-TransactionStatus 'rollback-failed' $tx.currentVersion
    throw 'rollback health check failed'
  }
  Write-TransactionStatus 'rolled-back' $tx.currentVersion
}
`;
  return {
    executable: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
  };
}

module.exports = {
  buildUpdateHelperCommand,
  compareVersions,
  defaultAuthenticodeVerifier,
  loadTrustedPublisherThumbprints,
  prepareInstallerRollback,
  prepareInstallerUpdate,
  verifyInstallerPackage
};
