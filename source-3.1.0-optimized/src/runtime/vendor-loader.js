(() => {
  'use strict';

  const inflight = new Map();

  function loadScript(src) {
    const key = `script:${src}`;
    if (inflight.has(key)) return inflight.get(key);
    const existing = document.querySelector(`script[data-future-vendor="${src}"]`);
    if (existing) {
      const done = Promise.resolve();
      inflight.set(key, done);
      return done;
    }
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.dataset.futureVendor = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`脚本加载失败：${src}`));
      document.head.appendChild(script);
    });
    inflight.set(key, promise);
    return promise;
  }

  function loadStylesheet(href) {
    const key = `style:${href}`;
    if (inflight.has(key)) return inflight.get(key);
    if (document.querySelector(`link[data-future-vendor="${href}"],link[href="${href}"]`)) {
      const done = Promise.resolve();
      inflight.set(key, done);
      return done;
    }
    const promise = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.futureVendor = href;
      link.onload = () => resolve();
      link.onerror = () => reject(new Error(`样式加载失败：${href}`));
      document.head.appendChild(link);
    });
    inflight.set(key, promise);
    return promise;
  }

  const VENDORS = {
    fabric: {
      scripts: ['./vendor/fabric.min.js'],
      ready: () => Boolean(window.fabric)
    },
    cropper: {
      styles: ['./vendor/cropper.min.css'],
      scripts: ['./vendor/cropper.min.js'],
      ready: () => Boolean(window.Cropper)
    },
    hls: {
      scripts: ['./vendor/hls.min.js'],
      ready: () => Boolean(window.Hls)
    },
    iro: {
      scripts: ['./vendor/iro.min.js'],
      ready: () => Boolean(window.iro)
    }
  };

  async function ensure(name) {
    const spec = VENDORS[name];
    if (!spec) throw new Error(`未知前端依赖：${name}`);
    if (spec.ready()) return true;
    for (const href of spec.styles || []) await loadStylesheet(href);
    for (const src of spec.scripts || []) await loadScript(src);
    if (!spec.ready()) throw new Error(`${name} 已加载但全局对象不可用`);
    return true;
  }

  window.FutureAIVendors = {
    ensure,
    loadScript,
    loadStylesheet,
    list: () => Object.keys(VENDORS)
  };
})();
