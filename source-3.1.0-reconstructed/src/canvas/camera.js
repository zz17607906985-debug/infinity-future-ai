(() => {
  'use strict';

  function defaultCameraState() {
    return {yaw: 0, pitch: 0, distance: 5};
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
  }

  function normalizeYaw(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    const wrapped = ((((n + 180) % 360) + 360) % 360) - 180;
    return wrapped === -180 ? 180 : wrapped;
  }

  function normalizeCameraState(value = {}) {
    const base = defaultCameraState();
    return {
      yaw: normalizeYaw(value.yaw, base.yaw),
      pitch: clampNumber(value.pitch, -30, 30, base.pitch),
      distance: clampNumber(value.distance, 1, 10, base.distance)
    };
  }

  function cameraSceneMetrics(camera) {
    camera = normalizeCameraState(camera);
    const center = {x: 165, y: 96};
    const orbit = 92 + camera.distance * 9;
    const yawRad = camera.yaw * Math.PI / 180;
    const eyeX = center.x + Math.sin(yawRad) * orbit;
    const eyeY = center.y + 58 - camera.pitch * 2.3 + Math.cos(yawRad) * 18;
    const dx = center.x - eyeX;
    const dy = center.y - eyeY;
    return {
      center,
      eyeX,
      eyeY,
      length: Math.hypot(dx, dy),
      angle: Math.atan2(dy, dx) * 180 / Math.PI
    };
  }

  function cameraSummary(camera) {
    camera = normalizeCameraState(camera);
    const absYaw = Math.abs(camera.yaw);
    const side = absYaw >= 157 ? '背面' : camera.yaw >= 112 ? '右后侧' : camera.yaw <= -112 ? '左后侧' : camera.yaw >= 67 ? '右侧' : camera.yaw <= -67 ? '左侧' : camera.yaw > 12 ? '右前侧' : camera.yaw < -12 ? '左前侧' : '正面';
    const pitch = camera.pitch > 8 ? '俯拍' : camera.pitch < -8 ? '仰拍' : '平视';
    const distance = camera.distance <= 3 ? '特写' : camera.distance >= 7 ? '远景' : '中景';
    return `${side} · ${pitch} · ${distance}`;
  }

  function cameraPrompt(camera) {
    if (!camera) return '';
    camera = normalizeCameraState(camera);
    const absYaw = Math.abs(camera.yaw);
    const backRule = absYaw >= 157
      ? '背面视角硬约束：镜头位于主体背后，主要看到后脑勺、背部、后发型、背面服装轮廓和背向空间关系；不要生成正脸、正面五官、正面站位或把角色转回镜头。'
      : '';
    return [`3D 相机角度：${cameraSummary(camera)}，方位角 ${Math.round(camera.yaw)}°，仰角 ${Math.round(camera.pitch)}°，镜头距离 ${camera.distance.toFixed(1)}；保持画面透视、主体朝向、空间纵深和镜头感一致。`, backRule].filter(Boolean).join('\n');
  }

  window.FutureAICanvasCamera = {
    defaultCameraState,
    clampNumber,
    normalizeYaw,
    normalizeCameraState,
    cameraSceneMetrics,
    cameraSummary,
    cameraPrompt
  };
})();
