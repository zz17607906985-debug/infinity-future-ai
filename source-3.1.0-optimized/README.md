# Infinity Future AI - optimized internal source

This directory is the source used for the November 3, 2026 canvas and image-generation update. It is an internal Electron ASAR project, not a signed public installer.

## Changes

- Canvas dragging avoids repeated layout reads for edge geometry and only updates groups touched by the drag.
- Image and uploaded-reference previews use a stable canvas footprint while retaining the media aspect ratio with `object-fit: contain`.
- Image nodes can request 2-4 outputs in one OpenAI-compatible `n` request. An explicit unsupported-count response falls back to individual requests; ambiguous failures do not retry automatically.
- GPT Image 2.5 on an OpenAI Images-compatible provider can request a transparent PNG. Other unverified models reject that option instead of silently discarding it.
- AI drama and media-center workspaces are removed from the active UI and startup path. Existing project data is not deleted.

## Build

The build requires Node.js, `build-tools` dependencies, and the existing Windows runtime directory with its legal, FFmpeg and meshopt resources. Run the scripts from this directory after setting `FUTURE_AI_RELEASE_ROOT` to that runtime directory:

```text
node scripts/test-provider-runtime.js
node scripts/smoke-test.js
node scripts/build-release.js
```

The build creates an ASAR, not an installer. The current update framework only accepts a signed NSIS installer and a signed update manifest. Its trusted signing keys and publisher certificates must be configured before automatic delivery can be enabled. Do not publish an unsigned installer as an automatic update.
