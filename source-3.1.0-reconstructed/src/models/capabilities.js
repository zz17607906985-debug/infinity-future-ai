(() => {
  'use strict';

  const SCHEMA_VERSION = 1;
  const IMAGE_ASPECTS = Object.freeze(['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9', '9:21', '6:19', '19:6', 'custom']);
  const IMAGE_RESOLUTIONS = Object.freeze(['1K', '2K', '4K']);
  const VIDEO_SIZES = Object.freeze(['1280x720', '720x1280', '1792x1024', '1024x1792', '1024x1024']);
  const VIDEO_DURATIONS = Object.freeze([5, 8, 10, 15]);
  const REFERENCE_ROLES = Object.freeze([
    'character', 'costume', 'pose', 'scene', 'object', 'style', 'composition', 'source',
    'first-frame', 'last-frame', 'keyframe', 'motion', 'audio', 'reference'
  ]);
  const SINGLETON_REFERENCE_ROLES = new Set(['source', 'first-frame', 'last-frame']);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function unique(values = []) {
    return [...new Set(values.filter(value => value !== '' && value != null))];
  }

  function normalizeLifecycleDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : `${match[1]}-${match[2]}-${match[3]}`;
  }

  function lifecycleAt(lifecycle = {}, now = Date.now()) {
    const availableFrom = normalizeLifecycleDate(lifecycle.availableFrom);
    const deprecatedAt = normalizeLifecycleDate(lifecycle.deprecatedAt);
    const shutdownAt = normalizeLifecycleDate(lifecycle.shutdownAt);
    const today = new Date(now);
    const todayKey = Number.isNaN(today.getTime()) ? new Date().toISOString().slice(0, 10) : today.toISOString().slice(0, 10);
    let status = ['active', 'deprecated', 'retired'].includes(lifecycle.status) ? lifecycle.status : 'active';
    if (shutdownAt && todayKey >= shutdownAt) status = 'retired';
    else if (deprecatedAt && todayKey >= deprecatedAt && status === 'active') status = 'deprecated';
    return {
      status,
      configuredStatus: ['active', 'deprecated', 'retired'].includes(lifecycle.status) ? lifecycle.status : 'active',
      availableFrom,
      deprecatedAt,
      shutdownAt,
      replacementModelId: String(lifecycle.replacementModelId || ''),
      today: todayKey,
      daysUntilAvailable: availableFrom ? Math.ceil((Date.parse(`${availableFrom}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000) : null,
      daysUntilShutdown: shutdownAt ? Math.ceil((Date.parse(`${shutdownAt}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / 86400000) : null
    };
  }

  function modelFieldsInNode(node = {}) {
    const data = node.data && typeof node.data === 'object' ? node.data : {};
    const output = [];
    if (typeof data.model === 'string' && data.model) output.push({path: 'data.model', value: data.model});
    if (typeof data.imageModel === 'string' && data.imageModel) output.push({path: 'data.imageModel', value: data.imageModel});
    if (typeof data.videoModel === 'string' && data.videoModel) output.push({path: 'data.videoModel', value: data.videoModel});
    if (typeof data.chatModel === 'string' && data.chatModel) output.push({path: 'data.chatModel', value: data.chatModel});
    return output;
  }

  function scanModelUsage(projects, {modelId = '', providerId = ''} = {}) {
    const wantedModel = String(modelId || '').trim().toLowerCase();
    const wantedProvider = String(providerId || '').trim();
    if (!wantedModel) return [];
    const matches = [];
    for (const project of Array.isArray(projects) ? projects : []) {
      for (const node of Array.isArray(project?.state?.nodes) ? project.state.nodes : []) {
        const nodeProvider = String(node?.data?.providerId || '');
        if (wantedProvider && nodeProvider && nodeProvider !== wantedProvider) continue;
        for (const field of modelFieldsInNode(node)) {
          if (String(field.value).trim().toLowerCase() !== wantedModel) continue;
          matches.push({projectId: String(project?.id || ''), projectName: String(project?.name || ''), nodeId: String(node?.id || ''), nodeType: String(node?.type || ''), field: field.path, providerId: nodeProvider, modelId: field.value});
        }
      }
    }
    return matches;
  }

  function migrateModelUsage(projects, {fromModelId = '', toModelId = '', providerId = '', toProviderId = '', at = Date.now()} = {}) {
    const source = String(fromModelId || '').trim();
    const target = String(toModelId || '').trim();
    if (!source || !target) throw new Error('迁移必须同时指定原模型和替代模型');
    const next = clone(Array.isArray(projects) ? projects : []);
    const changes = [];
    for (const project of next) {
      const originalState = clone(project?.state || null);
      const projectChangeStart = changes.length;
      for (const node of Array.isArray(project?.state?.nodes) ? project.state.nodes : []) {
        const nodeProvider = String(node?.data?.providerId || '');
        if (providerId && nodeProvider && nodeProvider !== providerId) continue;
        for (const field of modelFieldsInNode(node)) {
          if (String(field.value).trim().toLowerCase() !== source.toLowerCase()) continue;
          const property = field.path.split('.').pop();
          node.data[property] = target;
          if (toProviderId) node.data.providerId = toProviderId;
          changes.push({projectId: String(project?.id || ''), nodeId: String(node?.id || ''), field: field.path, from: field.value, to: target, previousProviderId: nodeProvider, nextProviderId: toProviderId || nodeProvider});
        }
      }
      if (changes.length > projectChangeStart) {
        if (originalState) {
          project.history = [...(Array.isArray(project.history) ? project.history : []), {
            id: `model_migration_${Number(at || Date.now())}`,
            createdAt: Number(at || Date.now()),
            label: `模型迁移前：${source}`,
            state: originalState
          }].slice(-24);
        }
        project.updatedAt = Number(at || Date.now());
      }
    }
    return {projects: next, changes, migration: {schemaVersion: 1, fromModelId: source, toModelId: target, providerId: String(providerId || ''), toProviderId: String(toProviderId || ''), at: Number(at || Date.now()), changes: clone(changes)}};
  }

  function rollbackModelMigration(projects, migration = {}) {
    const next = clone(Array.isArray(projects) ? projects : []);
    const projectMap = new Map(next.map(project => [String(project?.id || ''), project]));
    let restored = 0;
    for (const change of Array.isArray(migration.changes) ? migration.changes : []) {
      const project = projectMap.get(String(change.projectId || ''));
      const node = project?.state?.nodes?.find(item => String(item?.id || '') === String(change.nodeId || ''));
      const property = String(change.field || '').split('.').pop();
      if (!node?.data || !property || node.data[property] !== change.to) continue;
      node.data[property] = change.from;
      if (change.previousProviderId !== undefined) node.data.providerId = change.previousProviderId;
      restored += 1;
    }
    return {projects: next, restored};
  }

  function mergeProfile(base, override) {
    if (!override || typeof override !== 'object') return clone(base);
    const output = clone(base);
    for (const [key, value] of Object.entries(override)) {
      if (Array.isArray(value)) output[key] = clone(value);
      else if (value && typeof value === 'object') output[key] = mergeProfile(output[key] || {}, value);
      else if (value !== undefined) output[key] = value;
    }
    return output;
  }

  function providerSupportsEdit(provider = {}) {
    if (provider.supports?.edit === false) return false;
    if (provider.supports?.edit === true) return true;
    return ['openai-images', 'custom-sync'].includes(String(provider.type || '')) || Boolean(provider.editEndpoint);
  }

  function safeDefaultProfile({provider = {}, modelId = '', kind = 'image'} = {}) {
    const isImage = kind === 'image';
    const isVideo = kind === 'video';
    const isChat = kind === 'chat' || kind === 'text';
    const isAudio = kind === 'audio';
    const canEdit = isImage && providerSupportsEdit(provider);
    return {
      schemaVersion: SCHEMA_VERSION,
      profileVersion: 1,
      providerType: String(provider.type || 'openai-compatible'),
      modelId: String(modelId || ''),
      modalities: [kind],
      operations: isImage
        ? unique(['generate', canEdit ? 'edit' : ''])
        : isVideo ? ['generate'] : isChat ? ['complete'] : isAudio ? ['synthesize'] : ['generate'],
      inputs: {
        prompt: true,
        image: {
          maxCount: isImage ? (canEdit ? 6 : 0) : isVideo ? 1 : 0,
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          maxFileSizeMB: 0,
          maxTotalSizeMB: 0,
          roles: isImage
            ? ['character', 'costume', 'pose', 'scene', 'object', 'style', 'composition', 'source', 'reference']
            : ['character', 'scene', 'style', 'composition', 'source', 'first-frame', 'reference']
        },
        video: {maxCount: 0, mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'], maxFileSizeMB: 0, maxTotalSizeMB: 0, roles: ['source', 'motion', 'reference']},
        audio: {maxCount: 0, mimeTypes: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac', 'audio/ogg', 'audio/flac'], maxFileSizeMB: 0, maxTotalSizeMB: 0, roles: ['audio', 'reference']}
      },
      outputs: isImage
        ? {image: {aspects: [...IMAGE_ASPECTS], resolutions: [...IMAGE_RESOLUTIONS], nativeSizes: [], allowPostProcessSizing: true}}
        : isVideo
          ? {video: {sizes: [...VIDEO_SIZES], durations: [...VIDEO_DURATIONS], allowArbitrarySize: false}}
          : isChat
            ? {text: {maxOutputTokens: null, structuredOutput: null}}
            : isAudio
              ? {audio: {formats: ['mp3', 'wav'], maxDuration: null}}
              : {},
      billing: {
        unit: isImage ? 'image' : isVideo ? 'video-task' : isChat ? 'token' : isAudio ? 'audio-second' : 'task',
        estimatedPrice: null,
        currency: 'USD',
        tokensPerUnit: 1000,
        inputReferencePrice: 0,
        minimumCharge: 0,
        uncertaintyPercent: 0,
        resolutionMultipliers: {}
      },
      lifecycle: {status: 'active', availableFrom: null, deprecatedAt: null, shutdownAt: null, replacementModelId: ''},
      source: {kind: 'safe-default', updatedAt: ''}
    };
  }

  function builtInProfile({provider = {}, modelId = '', kind = 'image'} = {}) {
    const id = String(modelId || '').trim().toLowerCase();
    const base = safeDefaultProfile({provider, modelId, kind});
    if (kind === 'image' && /^(?:gpt[-_]?image|image2|dall-e)/i.test(id)) {
      return mergeProfile(base, {
        operations: ['generate', 'edit'],
        inputs: {image: {maxCount: 6}},
        outputs: {image: {nativeSizes: ['1024x1024', '1536x1024', '1024x1536']}},
        source: {kind: 'built-in', updatedAt: '2026-08-09'}
      });
    }
    if (kind === 'image' && /(?:flux|seedream|wanx|stable|sdxl|kolors|recraft|ideogram)/i.test(id)) {
      const operations = ['generate'];
      if (/(?:edit|kontext|fill|inpaint|outpaint)/i.test(id)) operations.push('edit');
      return mergeProfile(base, {
        operations,
        inputs: {image: {maxCount: operations.includes('edit') ? 6 : 0}},
        source: {kind: 'built-in', updatedAt: '2026-08-09'}
      });
    }
    if (kind === 'video' && /(?:sora|kling|wan|hailuo|runway|veo|luma|pika|seedance|vidu|pixverse|omni)/i.test(id)) {
      const operations = ['generate'];
      if (/(?:first.?last|first-last|首尾|components)/i.test(id)) operations.push('first-last-frame');
      if (/(?:key.?frame|multi.?frame|director)/i.test(id)) operations.push('keyframes');
      if (/(?:extend|extension)/i.test(id)) operations.push('extend');
      if (/(?:edit|modify|remix)/i.test(id)) operations.push('edit');
      if (/(?:style|stylize)/i.test(id)) operations.push('stylize');
      if (/(?:loop)/i.test(id)) operations.push('loop');
      return mergeProfile(base, {
        operations,
        inputs: {
          video: {maxCount: operations.some(value => ['edit', 'stylize', 'extend', 'loop'].includes(value)) ? 1 : 0},
          audio: {maxCount: /(?:audio|sound|music)/i.test(id) ? 1 : 0}
        },
        source: {kind: 'built-in', updatedAt: '2026-08-09'}
      });
    }
    if ((kind === 'chat' || kind === 'text') && /(?:gpt|claude|gemini|qwen|deepseek|kimi|doubao|glm|llama|mistral|moonshot|instruct)/i.test(id)) {
      return mergeProfile(base, {source: {kind: 'built-in', updatedAt: '2026-08-09'}});
    }
    if (kind === 'audio' && /(?:tts|speech|voice|audio)/i.test(id)) {
      return mergeProfile(base, {source: {kind: 'built-in', updatedAt: '2026-08-09'}});
    }
    return base;
  }

  function customProfileFor(provider = {}, modelId = '') {
    const profiles = provider.modelCapabilityProfiles;
    if (!profiles || typeof profiles !== 'object') return null;
    const exact = profiles[String(modelId || '')];
    if (exact && typeof exact === 'object') return exact;
    const target = String(modelId || '').toLowerCase();
    const key = Object.keys(profiles).find(item => item.toLowerCase() === target);
    return key ? profiles[key] : null;
  }

  function normalizeProfile(profile, context = {}) {
    const kind = context.kind || profile?.modalities?.[0] || 'image';
    const base = safeDefaultProfile({...context, kind});
    const normalized = mergeProfile(base, profile || {});
    normalized.schemaVersion = SCHEMA_VERSION;
    normalized.profileVersion = Math.max(1, Number(normalized.profileVersion || 1));
    normalized.modelId = String(context.modelId || normalized.modelId || '');
    normalized.providerType = String(context.provider?.type || normalized.providerType || 'openai-compatible');
    normalized.modalities = unique(normalized.modalities || [kind]);
    normalized.operations = unique(normalized.operations || ['generate']);
    normalized.inputs.image.maxCount = Math.max(0, Math.min(32, Number(normalized.inputs.image.maxCount || 0)));
    normalized.inputs.image.roles = unique(Array.isArray(normalized.inputs.image.roles) ? normalized.inputs.image.roles : []);
    // 姿势动作 is described in the prompt like 角色一致, so any profile that accepts character refs accepts pose refs.
    if (normalized.inputs.image.roles.includes('character') && !normalized.inputs.image.roles.includes('pose')) normalized.inputs.image.roles.push('pose');
    normalized.inputs.video.maxCount = Math.max(0, Math.min(8, Number(normalized.inputs.video.maxCount || 0)));
    normalized.inputs.video.roles = unique(Array.isArray(normalized.inputs.video.roles) ? normalized.inputs.video.roles : []);
    normalized.inputs.audio.maxCount = Math.max(0, Math.min(8, Number(normalized.inputs.audio.maxCount || 0)));
    normalized.inputs.audio.roles = unique(Array.isArray(normalized.inputs.audio.roles) ? normalized.inputs.audio.roles : []);
    for (const type of ['image', 'video', 'audio']) {
      const input = normalized.inputs[type];
      input.mimeTypes = unique(Array.isArray(input.mimeTypes) ? input.mimeTypes.map(value => String(value).trim().toLowerCase()) : []);
      input.maxFileSizeMB = Math.max(0, Number(input.maxFileSizeMB || 0));
      input.maxTotalSizeMB = Math.max(0, Number(input.maxTotalSizeMB || 0));
    }
    if (normalized.outputs.image) {
      normalized.outputs.image.aspects = unique(Array.isArray(normalized.outputs.image.aspects) ? normalized.outputs.image.aspects.map(String) : []);
      normalized.outputs.image.resolutions = unique(Array.isArray(normalized.outputs.image.resolutions) ? normalized.outputs.image.resolutions.map(String) : []);
      normalized.outputs.image.nativeSizes = unique(Array.isArray(normalized.outputs.image.nativeSizes) ? normalized.outputs.image.nativeSizes.map(String) : []);
    }
    if (normalized.outputs.video) {
      normalized.outputs.video.sizes = unique(Array.isArray(normalized.outputs.video.sizes) ? normalized.outputs.video.sizes.map(String) : []);
      normalized.outputs.video.durations = unique(Array.isArray(normalized.outputs.video.durations) ? normalized.outputs.video.durations.map(value => Number(value)).filter(value => Number.isFinite(value) && value > 0) : []);
    }
    normalized.lifecycle.availableFrom = normalizeLifecycleDate(normalized.lifecycle.availableFrom);
    normalized.lifecycle.deprecatedAt = normalizeLifecycleDate(normalized.lifecycle.deprecatedAt);
    normalized.lifecycle.shutdownAt = normalizeLifecycleDate(normalized.lifecycle.shutdownAt);
    normalized.lifecycle = {...normalized.lifecycle, ...lifecycleAt(normalized.lifecycle, context.now)};
    normalized.billing.estimatedPrice = normalized.billing.estimatedPrice == null
      ? null
      : Math.max(0, Number(normalized.billing.estimatedPrice) || 0);
    normalized.billing.tokensPerUnit = Math.max(1, Number(normalized.billing.tokensPerUnit || 1000));
    normalized.billing.inputReferencePrice = Math.max(0, Number(normalized.billing.inputReferencePrice || 0));
    normalized.billing.minimumCharge = Math.max(0, Number(normalized.billing.minimumCharge || 0));
    normalized.billing.uncertaintyPercent = Math.max(0, Math.min(100, Number(normalized.billing.uncertaintyPercent || 0)));
    const multipliers = normalized.billing.resolutionMultipliers && typeof normalized.billing.resolutionMultipliers === 'object'
      ? normalized.billing.resolutionMultipliers
      : {};
    normalized.billing.resolutionMultipliers = Object.fromEntries(Object.entries(multipliers)
      .map(([key, value]) => [String(key), Number(value)])
      .filter(([key, value]) => key && Number.isFinite(value) && value > 0));
    return normalized;
  }

  function resolveProfile({provider = {}, modelId = '', kind = 'image'} = {}) {
    const builtIn = builtInProfile({provider, modelId, kind});
    const custom = customProfileFor(provider, modelId);
    if (!custom) return normalizeProfile(builtIn, {provider, modelId, kind});
    return normalizeProfile(mergeProfile(builtIn, {
      ...custom,
      source: {
        ...(custom.source || {}),
        kind: 'provider-custom',
        updatedAt: custom.source?.updatedAt || ''
      }
    }), {provider, modelId, kind});
  }

  function issue(code, message, field = '') {
    return {code, message, field};
  }

  function referenceMediaType(reference = {}) {
    const explicit = String(reference.mediaType || reference.kind || '').toLowerCase();
    if (['image', 'video', 'audio'].includes(explicit)) return explicit;
    const mime = String(reference.mime || '').toLowerCase();
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (reference.role === 'audio') return 'audio';
    const url = String(reference.url || '');
    if (/^(?:data:)?video\//i.test(url) || /\.(?:mp4|webm|mov|m4v|avi)(?:[?#]|$)/i.test(url)) return 'video';
    if (/^(?:data:)?audio\//i.test(url) || /\.(?:mp3|wav|m4a|aac|ogg|flac)(?:[?#]|$)/i.test(url)) return 'audio';
    return 'image';
  }

  function validateReferences(profile, references, operation, errors) {
    const list = Array.isArray(references) ? references : [];
    const groups = {image: [], video: [], audio: []};
    list.forEach(reference => groups[referenceMediaType(reference)].push(reference));
    for (const type of ['image', 'video', 'audio']) {
      const input = profile.inputs?.[type] || {};
      const maxCount = Math.max(0, Number(input.maxCount || 0));
      if (groups[type].length > maxCount) {
        const label = type === 'image' ? '图片' : type === 'video' ? '视频' : '音频';
        errors.push(issue('TOO_MANY_REFERENCES', `当前模型最多接收 ${maxCount} 份${label}参考，现有 ${groups[type].length} 份。`, 'references'));
      }
      const allowedMimeTypes = Array.isArray(input.mimeTypes) ? input.mimeTypes.map(value => String(value).toLowerCase()) : [];
      const maxFileSizeMB = Math.max(0, Number(input.maxFileSizeMB || 0));
      const maxTotalSizeMB = Math.max(0, Number(input.maxTotalSizeMB || 0));
      let totalBytes = 0;
      for (const reference of groups[type]) {
        const mime = String(reference?.mime || reference?.mimeType || '').trim().toLowerCase();
        const sizeBytes = Math.max(0, Number(reference?.sizeBytes ?? reference?.fileSize ?? reference?.bytes ?? 0) || 0);
        totalBytes += sizeBytes;
        if (mime && allowedMimeTypes.length && !allowedMimeTypes.includes(mime) && !allowedMimeTypes.includes(`${type}/*`)) {
          errors.push(issue('UNSUPPORTED_REFERENCE_FILE_TYPE', `当前模型不支持 ${mime} 类型的${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}参考。`, 'references'));
        }
        if (sizeBytes && maxFileSizeMB && sizeBytes > maxFileSizeMB * 1024 * 1024) {
          errors.push(issue('REFERENCE_FILE_TOO_LARGE', `单份${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}参考不能超过 ${maxFileSizeMB} MB。`, 'references'));
        }
      }
      if (totalBytes && maxTotalSizeMB && totalBytes > maxTotalSizeMB * 1024 * 1024) {
        errors.push(issue('REFERENCE_TOTAL_TOO_LARGE', `${type === 'image' ? '图片' : type === 'video' ? '视频' : '音频'}参考总大小不能超过 ${maxTotalSizeMB} MB。`, 'references'));
      }
    }
    const counts = new Map();
    for (const reference of list) {
      const role = String(reference?.role || 'reference');
      counts.set(role, (counts.get(role) || 0) + 1);
      const input = profile.inputs?.[referenceMediaType(reference)] || {};
      const allowedRoles = Array.isArray(input.roles) ? input.roles : [];
      if (allowedRoles.length && !allowedRoles.includes(role)) {
        const roleName = (typeof window !== 'undefined' && window.FutureAIReferenceRoles?.roleLabel?.(role)) || role;
        errors.push(issue('UNSUPPORTED_REFERENCE_ROLE', `当前模型不支持“${roleName}”类型的参考素材。`, 'references'));
      }
    }
    for (const role of SINGLETON_REFERENCE_ROLES) {
      if ((counts.get(role) || 0) > 1) errors.push(issue('DUPLICATE_REFERENCE_ROLE', `“${role}”只能设置一个。`, 'references'));
    }
    if (operation === 'first-last-frame') {
      if ((counts.get('first-frame') || 0) !== 1 || (counts.get('last-frame') || 0) !== 1) {
        errors.push(issue('MISSING_REQUIRED_REFERENCE', '首尾帧模式必须各有一个首帧和尾帧。', 'references'));
      }
    }
  }

  function validateRequest(profile, request = {}) {
    const errors = [];
    const warnings = [];
    const requestedOperation = String(request.operation || 'generate');
    const operation = ({
      'text-to-video': 'generate',
      'image-to-video': 'generate',
      'extend-forward': 'extend',
      'extend-backward': 'extend',
      'local-edit': 'edit'
    })[requestedOperation] || requestedOperation;
    const operationSupported = profile.operations.includes(operation)
      || operation === 'stylize' && profile.operations.includes('edit')
      || operation === 'extend' && profile.operations.some(value => value === 'extend-forward' || value === 'extend-backward');
    if (!operationSupported) errors.push(issue('UNSUPPORTED_OPERATION', `当前模型不支持“${requestedOperation}”操作。`, 'operation'));
    if (profile.lifecycle?.status === 'retired') {
      const replacement = profile.lifecycle.replacementModelId ? `，建议改用 ${profile.lifecycle.replacementModelId}` : '';
      errors.push(issue('MODEL_RETIRED', `当前模型已停用${replacement}。`, 'model'));
    } else if (profile.lifecycle?.status === 'deprecated') {
      const replacement = profile.lifecycle.replacementModelId ? `，建议迁移到 ${profile.lifecycle.replacementModelId}` : '';
      warnings.push(issue('MODEL_DEPRECATED', `当前模型即将停用${replacement}。`, 'model'));
    }
    if (profile.lifecycle?.availableFrom && profile.lifecycle?.today && profile.lifecycle.today < profile.lifecycle.availableFrom) {
      errors.push(issue('MODEL_NOT_AVAILABLE', `当前模型将在 ${profile.lifecycle.availableFrom} 启用，尚不能提交请求。`, 'model'));
    }
    const imageOutput = profile.outputs?.image;
    if (imageOutput) {
      const aspect = String(request.aspect || '');
      const resolution = String(request.resolution || '');
      if (aspect && Array.isArray(imageOutput.aspects) && imageOutput.aspects.length && !imageOutput.aspects.includes(aspect)) {
        errors.push(issue('UNSUPPORTED_ASPECT', `当前模型不支持 ${aspect} 图片比例。`, 'aspect'));
      }
      if (resolution && Array.isArray(imageOutput.resolutions) && imageOutput.resolutions.length && !imageOutput.resolutions.includes(resolution)) {
        errors.push(issue('UNSUPPORTED_RESOLUTION', `当前模型不支持 ${resolution} 清晰度。`, 'resolution'));
      }
    }
    const videoOutput = profile.outputs?.video;
    if (videoOutput) {
      const size = String(request.size || '');
      const duration = Number(request.duration || 0);
      if (size && !videoOutput.allowArbitrarySize && Array.isArray(videoOutput.sizes) && videoOutput.sizes.length && !videoOutput.sizes.includes(size)) {
        errors.push(issue('UNSUPPORTED_SIZE', `当前模型不支持 ${size} 视频尺寸。`, 'size'));
      }
      if (duration && Array.isArray(videoOutput.durations) && videoOutput.durations.length && !videoOutput.durations.map(Number).includes(duration)) {
        errors.push(issue('UNSUPPORTED_DURATION', `当前模型不支持 ${duration} 秒时长。`, 'duration'));
      }
    }
    validateReferences(profile, request.references, requestedOperation, errors);
    if (profile.source?.kind === 'safe-default') warnings.push(issue('CAPABILITY_UNCONFIRMED', '该模型尚无专属能力档案，将使用兼容默认值并在提交前保留提醒。', 'model'));
    return {valid: errors.length === 0, errors, warnings};
  }

  function estimateCost(profile, request = {}) {
    const price = profile.billing?.estimatedPrice;
    if (price == null || !Number.isFinite(Number(price))) return null;
    const count = Math.max(1, Number(request.count || 1));
    const duration = Math.max(0, Number(request.duration || 0));
    const unit = String(profile.billing.unit || 'task');
    const tokens = Math.max(0, Number(request.tokens ?? request.totalTokens ?? 0));
    const tokensPerUnit = Math.max(1, Number(profile.billing.tokensPerUnit || 1000));
    const multiplier = unit === 'video-second' || unit === 'audio-second'
      ? duration * count
      : unit === 'token'
        ? tokens / tokensPerUnit
        : count;
    const resolutionKey = String(request.resolution || request.size || request.aspect || '');
    const resolutionMultiplier = Number(profile.billing.resolutionMultipliers?.[resolutionKey] || 1);
    const referenceCount = Array.isArray(request.references) ? request.references.length : Math.max(0, Number(request.inputReferences || 0));
    const referenceCost = Math.max(0, Number(profile.billing.inputReferencePrice || 0)) * referenceCount;
    const minimumCharge = Math.max(0, Number(profile.billing.minimumCharge || 0));
    const amount = Math.max(minimumCharge, Number(price) * multiplier * resolutionMultiplier + referenceCost);
    const roundedAmount = Math.round(amount * 1000000) / 1000000;
    const uncertainty = Math.max(0, Math.min(100, Number(profile.billing.uncertaintyPercent || 0))) / 100;
    return {
      amount: roundedAmount,
      minAmount: Math.round(Math.max(0, roundedAmount * (1 - uncertainty)) * 1000000) / 1000000,
      maxAmount: Math.round(roundedAmount * (1 + uncertainty) * 1000000) / 1000000,
      currency: String(profile.billing.currency || 'USD'),
      unit,
      estimated: true,
      exact: uncertainty === 0,
      basis: {count, duration, tokens, tokensPerUnit, referenceCount, resolutionKey, resolutionMultiplier}
    };
  }

  function formatEstimate(estimate) {
    if (!estimate || estimate.amount == null) return '费用待接口确认';
    const currency = String(estimate.currency || 'USD');
    const min = Number(estimate.minAmount ?? estimate.amount);
    const max = Number(estimate.maxAmount ?? estimate.amount);
    if (Number.isFinite(min) && Number.isFinite(max) && Math.abs(max - min) > 0.0000005) {
      return `${currency} ${min} - ${max}`;
    }
    return `${currency} ${Number(estimate.amount)}`;
  }

  function profileSummary(profile) {
    if (!profile) return '能力档案不可用';
    if (profile.lifecycle?.status === 'retired') return `模型已停用${profile.lifecycle.replacementModelId ? ` · 替代：${profile.lifecycle.replacementModelId}` : ''}`;
    if (profile.lifecycle?.availableFrom && profile.lifecycle?.today && profile.lifecycle.today < profile.lifecycle.availableFrom) return `模型尚未启用 · ${profile.lifecycle.availableFrom}`;
    const prefix = profile.source?.kind === 'safe-default' ? '能力待确认' : '能力已识别';
    const operations = (profile.operations || []).map(value => ({
      generate: '生成', edit: '编辑', stylize: '风格化', extend: '延长', loop: '循环', keyframes: '多关键帧', 'first-last-frame': '首尾帧'
    })[value] || value).join('、');
    return `${prefix}${operations ? ` · ${operations}` : ''}`;
  }

  window.FutureAIModelCapabilities = {
    SCHEMA_VERSION,
    IMAGE_ASPECTS,
    IMAGE_RESOLUTIONS,
    VIDEO_SIZES,
    VIDEO_DURATIONS,
    REFERENCE_ROLES,
    normalizeLifecycleDate,
    lifecycleAt,
    scanModelUsage,
    migrateModelUsage,
    rollbackModelMigration,
    normalizeProfile,
    resolveProfile,
    validateRequest,
    estimateCost,
    formatEstimate,
    profileSummary
  };
})();
