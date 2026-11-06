'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const {spawn} = require('child_process');

const root = path.resolve(__dirname, '..');
const evidenceFile = path.join(os.tmpdir(), `future-ai-image-fixture-${process.pid}.json`);
let requestBody = null;
let requestAuth = '';

function runSmoke(port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'real-api-smoke.js')], {
      cwd: root,
      env: {
        ...process.env,
        FUTUREAI_API_URL: `http://127.0.0.1:${port}`,
        FUTUREAI_API_KEY: 'fixture-secret',
        FUTUREAI_REAL_API_CONFIRM: '1',
        FUTUREAI_SMOKE_MODE: 'image',
        FUTUREAI_IMAGE_MODEL: 'fixture-image',
        FUTUREAI_IMAGE_SIZE: '1024x576',
        FUTUREAI_SMOKE_EVIDENCE: evidenceFile
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({stdout, stderr}) : reject(new Error(stderr || stdout || `smoke exited ${code}`)));
  });
}

async function main() {
  const server = http.createServer((req, res) => {
    requestAuth = String(req.headers.authorization || '');
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      requestBody = JSON.parse(body || '{}');
      if (req.method !== 'POST' || req.url !== '/images/generations') {
        res.writeHead(404, {'content-type': 'application/json'});
        return res.end('{}');
      }
      res.writeHead(200, {'content-type': 'application/json'});
      res.end(JSON.stringify({data: [{b64_json: 'Zml4dHVyZS1pbWFnZQ=='}]}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await runSmoke(server.address().port);
    const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
    assert.equal(requestBody.model, 'fixture-image');
    assert.equal(requestBody.size, '1024x576');
    assert.equal(requestBody.n, 1);
    assert.equal(requestAuth, 'Bearer fixture-secret');
    assert.equal(evidence.requests?.[0]?.kind, 'image');
    assert.equal(evidence.requests?.[0]?.inlineDataReturned, true);
    console.log('Real API image fixture passed: request contract, auth, size, and inline result evidence are consistent.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    try { fs.rmSync(evidenceFile, {force: true}); } catch {}
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
