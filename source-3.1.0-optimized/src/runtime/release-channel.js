function readReleaseChannel(metadata = {}) {
  return String(metadata?.releaseChannel || '').trim().toLowerCase();
}

function internalTestChannelsAllowed(metadata = {}) {
  return readReleaseChannel(metadata) === 'internal';
}

module.exports = {
  internalTestChannelsAllowed,
  readReleaseChannel
};
