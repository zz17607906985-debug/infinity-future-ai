# Infinity Future AI Release Notes

## 3.1.1 Update Fix

- Read the signed update manifest from the public GitHub Release download URL instead of the rate-limited Releases API.
- Preserve Ed25519 manifest verification, installer SHA-256 verification, pre-update backup, health checks, and rollback.
- Support direct upgrades from version 3.1.0.
