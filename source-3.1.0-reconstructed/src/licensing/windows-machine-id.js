const { execFile: defaultExecFile } = require('node:child_process');
const { promisify } = require('node:util');

async function queryMachineGuid(execFile, registryView) {
  const { stdout } = await execFile('reg.exe', [
    'query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', `/reg:${registryView}`
  ], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024
  });
  const match = String(stdout || '').match(/^\s*MachineGuid\s+REG_[A-Z0-9_]+\s+(.+?)\s*$/im);
  const value = match?.[1]?.trim();
  if (!value || value.length < 8 || value.length > 256) throw new Error('MachineGuid 返回格式无效');
  return value;
}

async function readWindowsMachineGuid(options = {}) {
  if (process.platform !== 'win32' && !options.allowNonWindows) {
    throw new Error('设备授权当前仅支持 Windows');
  }
  const execFile = options.execFile || promisify(defaultExecFile);
  let firstError;
  for (const registryView of ['64', '32']) {
    try {
      return await queryMachineGuid(execFile, registryView);
    } catch (error) {
      firstError ||= error;
    }
  }
  throw new Error(`无法读取 Windows 设备标识：${firstError?.message || '未知错误'}`);
}

module.exports = { readWindowsMachineGuid };
