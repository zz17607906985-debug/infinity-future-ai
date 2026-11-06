'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(appRoot, 'src', 'update', 'update-public-keys.json'), 'utf8'));
const privateKeyFile = path.join(process.env.LOCALAPPDATA || '', 'InfinityFutureAI', 'secrets', 'update-signing-private.pem');
const entry = config.keys?.find(item => item.kid === 'update-release-1');
if (!entry) throw new Error('update-release-1 public key is not configured');

const privateKey = crypto.createPrivateKey(fs.readFileSync(privateKeyFile));
const publicKey = crypto.createPublicKey({key: Buffer.from(entry.publicKey, 'base64url'), type: 'spki', format: 'der'});
const derived = crypto.createPublicKey(privateKey).export({type: 'spki', format: 'der'});
const configured = publicKey.export({type: 'spki', format: 'der'});
if (!derived.equals(configured)) throw new Error('Private key does not match the configured update public key');
console.log('Update signing key pair matches.');
