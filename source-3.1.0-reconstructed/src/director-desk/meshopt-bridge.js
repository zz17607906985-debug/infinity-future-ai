(() => {
  'use strict';
  // Meshopt-compressed GLB support for the director desk. The decoder (WebAssembly)
  // runs in this page; failures reject the model load instead of silently disabling it.
  const decoder = window.MeshoptDecoder;
  const unavailable = () => new Error('Meshopt 解码器不可用：' + (decoder ? '当前环境不支持 WebAssembly' : '解码器脚本未加载'));
  window.meshoptBridge = {
    supported: true,
    decodeGltfBufferAsync: (...args) => {
      if (!decoder?.supported) return Promise.reject(unavailable());
      return decoder.ready.then(() => decoder.decodeGltfBufferAsync(...args));
    }
  };
  if (!decoder?.supported) console.error(unavailable().message);
})();
