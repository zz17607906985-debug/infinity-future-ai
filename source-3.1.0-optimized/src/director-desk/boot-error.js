(() => {
  const reveal = message => {
    const node = document.getElementById('directorDeskBootError');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  };

  window.addEventListener('error', event => {
    reveal('3D导演台运行错误：' + (event && event.message ? event.message : '未知错误'));
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event && event.reason;
    const message = reason && typeof reason === 'object' && 'message' in reason
      ? reason.message
      : String(reason || '未知错误');
    reveal('3D导演台运行错误：' + message);
  });

  window.__directorDeskBootError = reveal;
})();
