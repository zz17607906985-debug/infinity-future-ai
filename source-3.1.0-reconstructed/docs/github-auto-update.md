# GitHub automatic updates

The application checks the latest non-draft, non-prerelease release in
`zz17607906985-debug/infinity-future-ai`. A release must contain exactly one
`update-manifest.json` and one versioned Windows installer. The application
verifies the Ed25519 manifest, installer size and SHA-256, then Authenticode
publisher and timestamp before it offers installation. The existing installer
transaction creates a workspace backup, runs a health check, and rolls back
on failure.

## First private-repository test

Private GitHub releases are not anonymously readable. For a local maintainer
test, set `FUTURE_AI_GITHUB_TOKEN` only in the environment of the application
process. Use a fine-grained token scoped to this repository with Contents:
read-only access. Do not put the token in source, settings, logs, a release
asset, or the installed application. Customers cannot use this private-repo
configuration unless each customer is separately granted GitHub access and
provides their own credential; use a public release repository or an
authenticated distribution service for customer updates.

## Signing requirements

Release signing keys are separate from GitHub authentication:

- Create an Ed25519 key pair dedicated to update manifests with
  `node scripts/generate-update-keypair.js`. The command writes the PEM private
  key to `%LOCALAPPDATA%\InfinityFutureAI\secrets\update-signing-private.pem`
  without overwriting an existing key, and prints only the public SPKI DER key
  (base64url). The corresponding public key is pinned in
  `src/update/update-public-keys.json` with key id `update-release-1`.
- Keep the PEM private key offline or in a protected release secret. Never
  commit it or ship it with the app. Check the local pair with
  `npm run verify:update-keypair`.
- Sign the installer with an Authenticode code-signing certificate that has a
  trusted timestamp. Add the exact publisher thumbprint to
  `src/update/trusted-publishers.json`.
- These trust files are currently empty, so clients correctly reject all
  update installers until trust is configured and a new application installer
  ships with those pinned trust values.

## Prepare a release

Build and Authenticode-sign the versioned installer
`FutureAI-Setup-<version>-x64.exe`. Then prepare a signed manifest from a
protected release environment:

```powershell
$env:FUTURE_AI_UPDATE_KEY_ID = "update-release-1"
$env:FUTURE_AI_UPDATE_PRIVATE_KEY = Get-Content -Raw "C:\secure\future-ai-update-private.pem"
npm run prepare:update-manifest
```

Set `FUTURE_AI_RELEASE_DIR` when the installer is not under `dist`, set
`FUTURE_AI_RELEASE_NOTES_FILE` for notes, and set
`FUTURE_AI_UPDATE_MINIMUM_VERSION` only when the release intentionally drops
direct upgrade compatibility. The script refuses to replace an existing
manifest. Upload the installer and `update-manifest.json` to a GitHub Release
whose tag is `v<version>`.

The repository may remain private while validating this pipeline. For normal
customer auto-updates, the release API and assets must be available through a
client-accessible distribution endpoint; do not embed a GitHub token into the
desktop client.
