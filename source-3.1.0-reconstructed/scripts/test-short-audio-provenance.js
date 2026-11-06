const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'media', 'short-workbench.js'), 'utf8').replace(/\r\n/g, '\n');

if (!source.includes('item.audioProvenance = Provenance?.normalizeRecord?.({')) {
  throw new Error('short workbench does not record audio provenance');
}
if (!source.includes('const prompt = shortVoiceText(item);') || !source.includes('prompt,\n')) {
  throw new Error('audio provenance prompt is not sourced from the generated item');
}
if (source.includes('prompt: input,')) {
  throw new Error('audio provenance references an out-of-scope input variable');
}
if (!source.includes('item.ttsSettings = {') || source.includes('item.ttsSettings = settings')) {
  throw new Error('TTS settings are not persisted through the redacted settings object');
}
if (!source.includes('fileHash')) {
  throw new Error('audio provenance does not include a file hash');
}

console.log('Short audio provenance tests passed.');
