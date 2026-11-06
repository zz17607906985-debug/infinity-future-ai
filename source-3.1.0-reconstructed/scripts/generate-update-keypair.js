'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const keyId = process.env.FUTURE_AI_UPDATE_KEY_ID || 'update-release-1';
if (!/^update-[A-Za-z0-9._-]{1,56}$/.test(keyId)) throw new Error('Invalid update key id');
if (!process.env.LOCALAPPDATA) throw new Error('LOCALAPPDATA is unavailable');

const secretDir = path.join(process.env.LOCALAPPDATA, 'InfinityFutureAI', 'secrets');
const privateKeyFile = path.join(secretDir, 'update-signing-private.pem');
fs.mkdirSync(secretDir, {recursive: true});
const {privateKey, publicKey} = crypto.generateKeyPairSync('ed25519');
fs.writeFileSync(privateKeyFile, privateKey.export({type: 'pkcs8', format: 'pem'}), {flag: 'wx', mode: 0o600});
console.log(`Private key saved outside the repository: ${privateKeyFile}`);
console.log(`Key id: ${keyId}`);
console.log(`Public key (SPKI DER, base64url): ${publicKey.export({type: 'spki', format: 'der'}).toString('base64url')}`);
