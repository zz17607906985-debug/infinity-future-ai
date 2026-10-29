(() => {
  'use strict';

  const {STORE, FILE_STORE_BY_KEY, compactHistoryItem, compactBrowserStoreValue, shouldUseCompactBrowserStore, isQuotaError} = window.FutureAICanvasStorage;
  const {scopedHistoryItems, historyRestoreUrls, historyCardsHtml} = window.FutureAICanvasHistory;
  const RendererDiagnostics = window.FutureAIRendererDiagnostics;
  const CleanupRendering = window.FutureAICleanupRendering;
  const BatchExportPayload = window.FutureAIBatchExportPayload;
  const ReviewPackage = window.FutureAIReviewPackage;
  const {clampScale, screenToWorldPoint, viewportCenter, zoomAroundPoint, visibleWorldRect} = window.FutureAICanvasCore;
  const {portCenterFromRects, fallbackPortCenter, edgePathD, segmentIntersectsView, edgeClassName} = window.FutureAICanvasEdges;
  const CanvasNodes = window.FutureAICanvasNodes;
  const CanvasArrange = window.FutureAICanvasArrange;
  const CanvasCamera = window.FutureAICanvasCamera;
  const UIRenderHelpers = window.FutureAIUIRenderHelpers;
  const MediaUtils = window.FutureAIMediaUtils;
  const MediaLibraryRendering = window.FutureAIMediaLibraryRendering;
  const ModelRendering = window.FutureAIModelRendering;
  const ModelCapabilities = window.FutureAIModelCapabilities;
  const BudgetGuard = window.FutureAIBudgetGuard;
  const WorkflowLibrary = window.FutureAIWorkflowLibrary;
  const VariantManager = window.FutureAIVariantManager;
  const Provenance = window.FutureAIProvenance;
  const VariantWorkbench = window.FutureAIVariantWorkbench;
  const CanvasExecutor = window.FutureAICanvasExecutor;
  const AgentUI = window.FutureAIAgentUI;
  const ProjectTemplates = window.FutureAIProjectTemplates;
  const ShortBatch = window.FutureAIShortBatch;
  const {buildPromptContext, getFullCanvasSummary} = window.FutureAICanvasContext;
  const {shouldUseLatestContextImage, generationReferenceUrls, messageRunKind, referenceIntent, referenceInstructions} = window.FutureAIAssistantAttachments;
  const AssistantTopics = window.FutureAIAssistantTopics;
  const {API_TIMEOUTS, fetchJsonWithRetry, wait} = window.FutureAICanvasAIClient;
  const {
    normalizeComfyUrl,
    parseComfyWorkflow,
    parseComfyWorkflowSafe,
    prepareComfyWorkflow,
    submitComfyWorkflow,
    pollComfyHistory,
    comfyViewUrl,
    comfyWorkflowMapHtml
  } = window.FutureAICanvasComfyUIClient;
  const WAITING_ANIMATION_SRC = './assets/generation-waiting.mp4';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const safeMediaUrl = value => MediaUtils.safeMediaUrl?.(value) || '';
  const safeExternalUrl = value => MediaUtils.safeExternalUrl?.(value) || '';

  async function ensureVendor(name, friendlyName = name) {
    try {
      if (!window.FutureAIVendors?.ensure) throw new Error('依赖加载器未就绪');
      await window.FutureAIVendors.ensure(name);
      return true;
    } catch (error) {
      console.error('vendor load failed', name, error);
      toast(`${friendlyName}加载失败，请确认安装文件完整后重试。`, 'error');
      return false;
    }
  }

  let projects = [];
  let currentProjectId = null;
  let projectUndoStack = [];
  let projectRedoStack = [];
  let projectHistoryBusy = false;
  let nodes = new Map();
  let groups = new Map();
  let edges = [];
  let nodeSeq = 0;
  let groupSeq = 0;
  let scale = 1;
  let offsetX = 170;
  let offsetY = 120;
  let dragging = null;
  let panning = null;
  let selecting = null;
  let selectedNodes = new Set();
  let selectedPort = null;
  let linkDrag = null;
  let suppressPortClickUntil = 0;
  let modalResolve = null;
  let budgetBatchOverride = null;
  let modalPreviousFocus = null;
  let imageModalPreviousFocus = null;
  let commandPalettePreviousFocus = null;
  let commandPaletteActiveIndex = 0;
  const drawerPreviousFocus = new Map();
  let saveTimer = null;
  let apiKeySaveTimer = null;
  let importedModels = [];
  let history = [];
  let dialogAgentRun = null;
  let assetLibrary = [];
  let assetLibraryFolders = [];
  let comfyWorkflowCache = null;
  let chatMessages = [];
  let chatAttachments = [];
  let shortStoryboardItems = [];
  let shortAssetItems = [];
  let shortStoryApproved = false;
  let shortStoryApprovedRevision = '';
  let shortQcItems = [];
  let shortAudioPlan = [];
  let shortTimelineItems = [];
  let shortExportRunning = false;
  let shortExportStatus = '尚未开始导出';
  let shortVoiceReferenceUrl = '';
  let shortVoiceReferenceName = '';
  let promptTopics = [];
  let promptWorkbenchActiveId = '';
  let dialogEditActive = false;
  let dialogEditActiveNodeId = '';
  let dialogEditMessages = [];
  let dialogEditAttachments = [];
  let directorDeskReady = false;
  let directorDeskPendingMessages = [];
  let dialogEditVersions = [];
  let dialogEditInput = '';
  let dialogEditMode = 'edit';
  let dialogEditEditingIndex = -1;
  let dialogEditRunning = false;
  let dialogRun = {id: 0, kind: 'idle', startedAt: 0, status: '', steps: [], cancelled: false, controller: null};
  let dialogRunTimer = 0;
  let assistantActiveTab = 'dialog';
  let assistantProfiles = [];
  let assistantActiveId = '';
  let activeWorkspace = 'canvas';
  let mascotDrag = null;
  let mascotWasDragged = false;
  let linkMode = false;
  let nodeTypeMenuCloser = null;
  let nodeContextMenuCloser = null;
  let selectedProjectTemplate = 'default';
  let canvasSearchQuery = '';
  let canvasTypeFilter = 'all';
  let canvasFavoritesOnly = false;
  let fastCanvasMode = localStorage.getItem('futureai.fastCanvasMode') !== 'off';
  let canvasMinimapEnabled = localStorage.getItem('futureai.canvasMinimap') !== 'off';
  let canvasMinimap = null;
  // Default off; OS reduce-motion still soft-hints. Explicit setting wins.
  let reduceMotionMode = localStorage.getItem('futureai.reduceMotion') === 'on';
  let assetLibrarySearch = '';
  let assetLibraryType = 'all';
  let assetLibraryFolderId = 'all';
  let assetLibraryTrashOnly = false;
  let assetLibrarySmartCollection = 'all';
  let assetLibraryVisualQuery = null;
  let musicSearchQuery = '';
  let musicResults = [];
  let musicLocalTracks = [];
  let musicFavorites = [];
  let musicCurrentTrack = null;
  let musicCurrentTime = 0;
  let musicDuration = 0;
  let musicPlayerVolume = Number(localStorage.getItem('futureai.musicVolume') || '0.8');
  let musicShuffleEnabled = localStorage.getItem('futureai.musicShuffle') === 'on';
  let musicRepeatMode = localStorage.getItem('futureai.musicRepeat') || 'off';
  let uiSoundEnabled = true;
  let autoOpenLastProject = false;
  let uiSoundVolume = .35;
  let uiSoundController = null;
  let canvasWallpaper = null;
  let balanceChip = null;
  let colorTheme = 'ocean';
  let customThemeColor = '#4fd6e8';
  let customThemePalette = {accent:'#4fd6e8',deep:'#07090e',workspace:'#0b0f16',panel:'#12161e',control:'#0e141c'};
  let activeThemeZone = 'accent';
  let customColorPicker = null;
  let syncingColorPicker = false;
  let colorThemeSaveTimer = null;
  let savedColorThemes = [];
  let activeSavedColorThemeId = '';
  let musicAutoSearchTimer = null;
  let musicSearchRequestSeq = 0;
  let musicLastAutoSearchKey = '';
  let musicStatus = '未搜索';
  let musicSourcePlugins = [];
  let musicSourcePluginRegistry = null;
  let enabledMusicSourceIds = [];
  let musicUnavailableTrackIds = new Set();
  let musicLXCore = null;
  let mediaMode = 'music';
  let mediaVideoHls = null;
  let mediaTvHls = null;
  let mediaVideoSearchQuery = '';
  let mediaVideoResults = [];
  let mediaVideoStatus = '未搜索';
  let storageDir = '';
  let defaultStorageDir = '';
  let storageDefaultNoticeDismissed = false;
  let apiProviders = [];
  let globalModelProviders = {chat: '', image: '', video: ''};
  let imageFallback = {enabled: true, version: 2, customized: false, chain: []};
  const providerKeyCache = new Map();
  let providerKeySaveTimers = new Map();
  let variantWorkbenchInstance = null;
  let canvasExecutorInstance = null;
  let agentUiInstance = null;
  let agentSessionId = '';
  let agentRunning = false;
  let agentStatus = '空闲';
  let agentOutput = '';

  let generationQueue = [];
  let queueSeq = 0;
  let queuePaused = false;
  const providerRunningCounts = new Map();
  const providerConcurrency = new Map();
  const shortTaskCoordinator = ShortBatch.createCoordinator();

  const MEDIA_TV_CHANNELS = [
    {id: 'cgtndoc', name: 'CGTN 纪录', group: '公开直播', url: 'https://news.cgtn.com/resource/live/document/cgtn-doc.m3u8'}, 
    {id: 'cgtn', name: 'CGTN 国际', group: '公开直播', url: 'https://news.cgtn.com/resource/live/english/cgtn-news.m3u8'}, 
    {id: 'bloomberg', name: 'Bloomberg TV', group: '公开直播', url: 'https://bloomberg-bloomberg-1-eu.rakuten.wurl.tv/playlist.m3u8'}, 
    {id: 'nasa', name: 'NASA TV', group: '公开直播', url: 'https://ntv1.akamaized.net/hls/live/2014475/NASA-NTV1-MASTER.m3u8'}
  ];

  const IMAGE_PROVIDER_TYPES = [
    {id: 'openai-images', label: 'API 中转站 / OpenAI 兼容', capabilities: ['文本', '文生图', '图生图', '视频', '多参考'], supports: {text: true, image: true, edit: true, video: true}},
    {id: 'chat-image', label: '聊天接口返回图片', capabilities: ['文本', '文生图'], supports: {text: true, image: true, edit: false, video: false}},
    {id: 'custom-sync', label: '自定义同步图片接口', capabilities: ['文生图', '自定义返回'], supports: {text: true, image: true, edit: true, video: true}},
    {id: 'siliconflow', label: '兼容接口：文本/图片', capabilities: ['文本', '文生图'], supports: {text: true, image: true, edit: false, video: true}},
    {id: 'dashscope-wanx', label: '通用异步任务接口', capabilities: ['文生图', '视频', '异步'], supports: {text: true, image: true, edit: false, video: true}},
    {id: 'volcengine-ark', label: '通用异步任务接口', capabilities: ['文本', '文生图', '视频', '异步'], supports: {text: true, image: true, edit: false, video: true}}
  ];
  let fileStoreCache = {};
  let storageQuotaWarned = false;
  let activeTextArea = null;
  let visibilityTimer = null;
  let edgeFrame = null;
  let edgeThrottleTimer = null;
  let edgeDrawLastAt = 0;
  let groupFrame = null;
  let transformFrame = null;
  let viewportInteractionTimer = null;
  let lastZoomPercent = '';
  let canvasProxyFrame = null;
  let canvasProxyActive = false;
  let dragFrame = null;
  let dragPoint = null;
  let refSorting = null;
  let modalZoom = 1;
  let modalPan = {x: 0, y: 0};
  let modalDrag = null;
  let modalSuppressClick = false;
  let imageModalSrc = '';
  let modalWheelRaf = 0;
  let modalWheelDelta = 0;
  let modalWheelPoint = {x: 0, y: 0};
  let cameraTargetNodeId = '';
  let cameraDraft = defaultCameraState();
  let cameraDrag = null;
  // Image editor state lives in media/image-editors.js (FutureAIImageEditors)
  let domains = null;
  let codexSessionId = '';
  let codexRunning = false;
  // The one Codex detection state shared by settings, the agent backend and the console.
  const codexState = window.FutureAICodexState?.create({ bridge: window.codexBridge }) || null;
  let codexOutput = '等待检测本地 Codex。';
  let codexStatus = '未检测';
  let codexPermission = 'project';
  let appReleaseChannel = 'internal';
  let codexPromptDraft = ''; 
  let codexExpanded = false;
  let codexDialogRun = null;
  let codexNavView = 'tasks';
  let codexSchedules = [];
  let codexScheduleTimer = 0;
  const codexScheduleSessions = new Map();
  const codexProjectTreeExpanded = new Set();
  let skillLibrarySearch = '';
  let skillMarketSearch = '';
  let skillMarketResults = [];
  let skillMarketStatus = '未搜索';
  let sharedCodexSkills = [];
  let sharedCodexPlugins = [];
  let sharedCodexHome = '';


  function ensureDomains() {
    if (domains) return domains;
    if (!window.FutureAIDomainRegistry?.createDomains) {
      console.error('domain registry missing');
      return {};
    }
    domains = window.FutureAIDomainRegistry.createDomains({
      imageEditors: {
        $,
        toast,
        ensureVendor,
        getNode: id => nodes.get(id),
        nodeDisplayTitle,
        persistMediaUrl,
        addResultNode: (node, url, suffix) => batchVariants()?.addResultNode?.(node, url, suffix)
      },
      localEdit: {
        $,
        toast,
        getNode: id => nodes.get(id),
        nodeDisplayTitle,
        persistMediaUrl,
        hydrateNode,
        saveProject,
        refreshDownstreamLinkedInputs,
        addNode,
        connectSilently,
        selectSingleNode,
        deleteNode,
        nodeSize,
        drawEdges,
        scheduleDrawEdges,
        getStorageDir: () => storageDir,
        Core: window.FutureAILocalEditCore,
        Variants: window.FutureAIVariantManager,
        resolveImageCapability: node => {
          const provider = currentProviderForNode(node, 'image');
          const modelId = String(node?.data?.model || provider?.imageModel || '');
          const profile = ModelCapabilities?.resolveProfile?.({provider, modelId, kind: 'image'});
          return {
            provider,
            modelId,
            providerType: provider?.type || profile?.providerType || '',
            operations: Array.isArray(profile?.operations) ? profile.operations : []
          };
        },
        runImageEdit: async ({node, prompt, refUrls, maskUrl, size, tool, label}) => {
          const provider = currentProviderForNode(node, 'image');
          if (!provider) throw new Error('请先在设置里配置图片供应商');
          const apiKey = await providerApiKey(provider);
          if (!apiKey) throw new Error('缺少 API Key');
          const model = String(node?.data?.model || provider.imageModel || '').trim();
          const profile = ModelCapabilities?.resolveProfile?.({provider, modelId: model, kind: 'image'});
          const budgetRequest = {count: 1, operation: 'edit', hasMask: Boolean(maskUrl)};
          const budgetEntryId = await authorizeGenerationBudget({
            node,
            provider,
            model,
            kind: 'image',
            request: budgetRequest,
            profile
          }) || '';
          try {
            const result = await imageEditRequest({
              provider,
              apiUrl: provider.apiUrl || provider.baseUrl || '',
              apiKey,
              model,
              prompt,
              refUrls: Array.isArray(refUrls) ? refUrls.filter(Boolean) : [refUrls].filter(Boolean),
              maskUrl: maskUrl || '',
              size: size || node?.data?.size || '1024x1024',
              quality: node?.data?.quality || 'auto',
              seed: node?.data?.seed,
              allowModelFallback: false
            });
            completeGenerationBudget(budgetEntryId, {actualRequests: 1, status: 'completed'});
            balanceChip?.refresh?.();
            return {url: result?.url || result, model: result?.model || model, tool, label};
          } catch (err) {
            completeGenerationBudget(budgetEntryId, {actualRequests: 0, status: 'failed', differenceReason: err?.message || '局部编辑失败'});
            throw err;
          }
        }
      },
      batchVariants: {
        $,
        toast,
        getNode: id => nodes.get(id),
        getNodes: () => [...nodes.values()],
        getEdges: () => edges.slice(),
        nodeDisplayTitle,
        hydrateNode,
        saveProject,
        addNode,
        connectSilently,
        selectSingleNode,
        deleteNode,
        nodeSize,
        drawEdges,
        scheduleDrawEdges,
        enqueueImageGeneration,
        diagnoseGenerationError,
        Core: window.FutureAIBatchVariantsCore,
        resolveImageCapability: node => {
          const provider = currentProviderForNode(node, 'image');
          const modelId = String(node?.data?.model || provider?.imageModel || '');
          const profile = ModelCapabilities?.resolveProfile?.({provider, modelId, kind: 'image'});
          return {
            provider,
            modelId,
            providerType: provider?.type || profile?.providerType || '',
            operations: Array.isArray(profile?.operations) ? profile.operations : [],
            hasUsableKey: Boolean(provider) && (window.FutureAIModelAvailability?.providerHasUsableKey
              ? window.FutureAIModelAvailability.providerHasUsableKey(provider, FutureAIApiDefaults.get('apiKey'))
              : true)
          };
        }
      },
      promptAssist: {
        $,
        toast,
        esc,
        getStore,
        setStore,
        getNode: id => nodes.get(id),
        hydrateNode,
        saveProject,
        optimizePrompt,
        Core: window.FutureAIPromptAssistCore
      },
      supportUI: {
        $,
        toast,
        getStore,
        setStore,
        STORE,
        RendererDiagnostics,
        getStorageDir: () => storageDir,
        getCurrentProjectId: () => currentProjectId,
        getAppReleaseChannel: () => appReleaseChannel,
        setAppReleaseChannel: value => { appReleaseChannel = value; },
        getCodexPermission: () => codexPermission,
        setCodexPermission: value => { codexPermission = value; }
      },
      performanceMode: {
        $,
        toast,
        getReduceMotion: () => reduceMotionMode,
        setReduceMotion: value => { reduceMotionMode = Boolean(value); },
        persistSettings: () => saveSettings()
      },
      providerApi: {
        host: {
          get apiProviders() { return apiProviders; },
          set apiProviders(v) { apiProviders = v; },
          get importedModels() { return importedModels; },
          set importedModels(v) { importedModels = v; },
          get storageDir() { return storageDir; },
          get providerConcurrency() { return providerConcurrency; },
          get providerRunningCounts() { return providerRunningCounts; },
          get generationQueue() { return generationQueue; },
          get imageFallback() { return imageFallback; },
          get globalModelProviders() { return globalModelProviders; }
        },
        $,
        toast,
        wait,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        cleanAiText,
        persistMediaUrl,
        saveSettings,
        renderApiProviders,
        unique,
        MediaUtils: window.FutureAIMediaUtils,
        MediaDimensions: window.FutureAIMediaDimensions,
        ModelCapabilities,
        ReferenceRoles: window.FutureAIReferenceRoles,
        VideoDirector: window.FutureAIVideoDirector,
        MediaProcessContract: window.FutureAIMediaProcessContract,
        VariantManager,
        Provenance,
        getNode: id => nodes.get(id),
        hydrateNode,
        saveProject,
        addHistory,
        getInputPrompt,
        promptWithCanvasContext,
        ensureInputImageRefs,
        currentProviderForNode,
        providerApiKey,
        globalProviderForKind,
        setGlobalModelValue,
        classifyModelKind,
        compactModelId,
        effectiveImageModel,
        extractModelRecords,
        applyImportedModelRecordsToProvider,
        providerTypeLabel,
        mediaUrlToBlob,
        assertImageProviderCapability,
        normalizeKnownImageModelAlias,
        markImageProviderCapability,
        imageCapabilityError,
        multimodalImageUnderstand,
        isImageProviderCapabilityError,
        assertUsableApiBaseAddress,
        normalizeShortVideoTask,
        formatError,
        isSafetyError,
        authorizeGenerationBudget,
        completeGenerationBudget
      },
      providerUI: {
        host: {
          get apiProviders() { return apiProviders; },
          set apiProviders(v) { apiProviders = v; },
          get importedModels() { return importedModels; },
          set importedModels(v) { importedModels = v; },
          get globalModelProviders() { return globalModelProviders; },
          set globalModelProviders(v) { globalModelProviders = v; },
          get imageFallback() { return imageFallback; },
          set imageFallback(v) { imageFallback = v; },
          get providerRunningCounts() { return providerRunningCounts; },
          get projects() { return projects; },
          set projects(v) { projects = Array.isArray(v) ? v : []; },
          get currentProjectId() { return currentProjectId; }
        },
        $,
        esc,
        toast,
        wait,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        IMAGE_PROVIDER_TYPES,
        ModelCapabilities,
        STORE,
        getStore,
        setStore,
        saveSettings,
        onBalanceDisplayChange: () => balanceChip?.render(),
        renderModels,
        refreshNodeModelSelects,
        refreshNodeCapabilityControls,
        unique,
        applyImportedModelsToProvider,
        applyImportedModelRecordsToProvider,
        extractModelIds,
        extractModelRecords,
        assertUsableApiBaseAddress,
        assertModelListResponse,
        modelImportSummary,
        modelsForKind,
        firstImportedModelForKind,
        effectiveImageModel,
        expandKnownModelAliases,
        providerModelsForKind,
        normalizeModelRecords,
        fetchApiWithBaseFallback,
        safeJson,
        apiErrorMessage,
        imageGenerateRequest,
        imageEditWithFallback,
        videoGenerateRequest,
        chatCompletionTextRequest,
        joinApiPath,
        applyKnownImageProtocol,
        saveKnownImageProtocolCorrection,
        openModal,
        getNode: id => nodes.get(id),
        saveProject,
        saveProjects,
        loadProject,
        classifyModelKind,
        modelFieldForKind,
        isZexImageGateway,
        normalizeKnownImageModelAlias,
        globalProviderForKind,
        setGlobalModelValue,
        setGlobalProviderValue,
        syncGlobalModelInputs,
        modelKindLabel,
        requestImageGenerationWithModel,
        loadImageForCanvas,
        rawImageEditRequest,
        rawImageGenerationWithModel
      },
      generationQueue: {
        host: {
          get generationQueue() { return generationQueue; },
          set generationQueue(v) { generationQueue = v; },
          get queueSeq() { return queueSeq; },
          set queueSeq(v) { queueSeq = v; },
          nextQueueSeq() { return ++queueSeq; },
          get queuePaused() { return queuePaused; },
          set queuePaused(v) { queuePaused = v; },
          get generationQueue() { return generationQueue; },
          set generationQueue(v) { generationQueue = Array.isArray(v) ? v : []; },
          get providerRunningCounts() { return providerRunningCounts; },
          get providerConcurrency() { return providerConcurrency; },
          get apiProviders() { return apiProviders; }
        },
        $,
        esc,
        toast,
        getNode: id => nodes.get(id),
        generateImageKeepingOriginal,
        setActiveWorkspace,
        focusQueueNode: id => {
          if (!nodes.has(id)) return false;
          closeQueueDrawer();
          selectSingleNode(id);
          nodes.get(id)?.el?.scrollIntoView?.({block: 'center', inline: 'center'});
          return true;
        },
        hydrateNode,
        saveProject,
        addHistory,
        currentProviderForNode,
        providerTypeLabel,
        providerApiKey,
        nodeDisplayTitle,
        getInputPrompt,
        withCameraPrompt,
        ensureInputImageRefs,
        effectiveImageModel,
        setImageStatus,
        imageTargetSize,
        apiCompatibleImageSize,
        imageRequestDimensionFields,
        imageRequestSeedFields: (...args) => providerApi()?.imageRequestSeedFields(...args),
        imageEditWithFallback,
        imageGenerateRequest,
        persistGeneratedImageResult,
        isApiGatewayTimeoutError,
        referenceGuidedImageFallback,
        refreshDownstreamLinkedInputs,
        refreshNodeModelSelects,
        isSafetyError,
        formatImageGenerationError,
        imageErrorTitle,
        diagnoseGenerationError,
        ModelCapabilities,
        ReferenceRoles: window.FutureAIReferenceRoles,
        VideoDirector: window.FutureAIVideoDirector,
        VariantManager,
        Provenance,
        authorizeGenerationBudget,
        completeGenerationBudget,
        AutoRetry: window.FutureAIAutoRetry,
        getAutoRetryLimit: () => Number($('generationAutoRetry')?.value ?? 1)
      },
      canvasRuntime: {
        host: {
          get nodes() { return nodes; },
          get edges() { return edges; },
          set edges(v) { edges = v; },
          get nodeSeq() { return nodeSeq; },
          nextNodeSeq() { return ++nodeSeq; },
          get scale() { return scale; },
          set scale(v) { scale = v; },
          get offsetX() { return offsetX; },
          set offsetX(v) { offsetX = v; },
          get offsetY() { return offsetY; },
          set offsetY(v) { offsetY = v; },
          get dragging() { return dragging; },
          set dragging(v) { dragging = v; },
          get selectedNodes() { return selectedNodes; },
          get selectedPort() { return selectedPort; },
          set selectedPort(v) { selectedPort = v; },
          get suppressPortClickUntil() { return suppressPortClickUntil; },
          set suppressPortClickUntil(v) { suppressPortClickUntil = v; },
          get linkDrag() { return linkDrag; },
          set linkDrag(v) { linkDrag = v; },
          get linkMode() { return linkMode; },
          set linkMode(v) { linkMode = v; },
          get edgeFrame() { return edgeFrame; },
          set edgeFrame(v) { edgeFrame = v; },
          get edgeThrottleTimer() { return edgeThrottleTimer; },
          set edgeThrottleTimer(v) { edgeThrottleTimer = v; },
          get edgeDrawLastAt() { return edgeDrawLastAt; },
          set edgeDrawLastAt(v) { edgeDrawLastAt = v; },
          get canvasSearchQuery() { return canvasSearchQuery; },
          set canvasSearchQuery(v) { canvasSearchQuery = v; },
          get canvasTypeFilter() { return canvasTypeFilter; },
          set canvasTypeFilter(v) { canvasTypeFilter = v; },
          get canvasFavoritesOnly() { return canvasFavoritesOnly; },
          set canvasFavoritesOnly(v) { canvasFavoritesOnly = v; },
          get refSorting() { return refSorting; },
          set refSorting(v) { refSorting = v; },
          get apiProviders() { return apiProviders; },
          get importedModels() { return importedModels; }
        },
        $,
        esc,
        safeMediaUrl,
        toast,
        CanvasNodes: window.FutureAICanvasNodes,
        MediaUtils: window.FutureAIMediaUtils,
        MediaDimensions: window.FutureAIMediaDimensions,
        ReferenceRoles: window.FutureAIReferenceRoles,
        VideoDirector: window.FutureAIVideoDirector,
        MediaProcessContract: window.FutureAIMediaProcessContract,
        UIRenderHelpers: window.FutureAIUIRenderHelpers,
        canvasEdges: window.FutureAICanvasEdges,
        saveProject,
        mountNode,
        shouldVirtualizeNode,
        currentWorldBounds,
        scheduleVisibilityUpdate,
        enhanceTextareas,
        globalProviderForKind,
        normalizeKnownImageModelAlias,
        generateImageKeepingOriginal,
        runVideoKeepingOriginal,
        runMediaToolKeepingOriginal,
        spawnRight: (source, type, seed) => batchVariants().spawnRight(source, type, seed),
        runComfyUI,
        runPrompt,
        openFabricEditor,
        openLocalEdit,
        openCropperEditor,
        openCameraModal,
        openMediaViewer,
        downloadMedia,
        openDirectorDesk,
        openDialogEditWorkbench,
        persistMediaUrl,
        modelPickerGroups,
        modelsForKind,
        effectiveImageModel,
        ModelCapabilities,
        currentProviderForNode,
        openModal,
        WAITING_ANIMATION_SRC: './assets/generation-waiting.mp4',
        screenToWorldPoint,
        viewportCenter,
        releaseDrags,
        setCanvasProxyActive,
        closeFloatingCanvasUi,
        unique,
        renderSelection,
        queueSave,
        screenToWorld,
        setSelectedPort: (v) => { selectedPort = v; },
        importComfyWorkflowIntoNode,
        closeNodeContextMenu,
        runNodeContextAction,
        openCanvasMenu,
        testComfyUI,
        saveComfyNodeWorkflowGlobal,
        exportComfyWorkflowText,
        optimizePrompt,
        softenPrompt,
        openMediaUrl,
        showNodeContextMenu,
        expandNodeIdsForGroups,
        fitNodeIntoView,
        comfyWorkflowMapHtml,
        removeNodeFromGroups,
        mediaExtFromMime
      },
      canvasLayout: {
        host: {
        get nodes() { return nodes; },
        get edges() { return edges; },
        get scale() { return scale; },
        set scale(v) { scale = v; },
        get offsetX() { return offsetX; },
        set offsetX(v) { offsetX = v; },
        get offsetY() { return offsetY; },
        set offsetY(v) { offsetY = v; },
        get dragging() { return dragging; },
        set dragging(v) { dragging = v; },
        get selectedNodes() { return selectedNodes; },
        get groups() { return groups; },
        set groups(v) { groups = v; },
        get groupSeq() { return groupSeq; },
        nextGroupSeq() { return ++groupSeq; },
        get edgeFrame() { return edgeFrame; },
        set edgeFrame(v) { edgeFrame = v; },
        get edgeThrottleTimer() { return edgeThrottleTimer; },
        set edgeThrottleTimer(v) { edgeThrottleTimer = v; },
        get edgeDrawLastAt() { return edgeDrawLastAt; },
        set edgeDrawLastAt(v) { edgeDrawLastAt = v; },
        get canvasProxyFrame() { return canvasProxyFrame; },
        set canvasProxyFrame(v) { canvasProxyFrame = v; },
        get canvasProxyActive() { return canvasProxyActive; },
        set canvasProxyActive(v) { canvasProxyActive = v; },
        get viewportInteractionTimer() { return viewportInteractionTimer; },
        set viewportInteractionTimer(v) { viewportInteractionTimer = v; },
        get transformFrame() { return transformFrame; },
        set transformFrame(v) { transformFrame = v; },
        get visibilityTimer() { return visibilityTimer; },
        set visibilityTimer(v) { visibilityTimer = v; },
        get groupFrame() { return groupFrame; },
        set groupFrame(v) { groupFrame = v; },
        get fastCanvasMode() { return fastCanvasMode; },
        set fastCanvasMode(v) { fastCanvasMode = v; },
        },
        $,
        esc,
        toast,
        canvasCore: window.FutureAICanvasCore,
        MediaDimensions: window.FutureAIMediaDimensions,
        saveProject,
        scheduleDrawEdges,
        drawEdges,
        nodeDisplayTitle,
        nodeSize,
        hydrateNode,
        selectSingleNode,
        clearSelection,
        releaseDrags,
        setCanvasProxyActive,
        updateZoomLabel,
        scheduleViewportInteractionEnd,
        scheduleTransform,
        applyTransform,
        updateSelectionToolbar,
        renderSelection,
        queueSave,
        runWorkflowGroup,
        beginNodeDrag,
        openModal
      },
      canvasEvents: {
        $,
        state: {
          get activeWorkspace() { return activeWorkspace; },
          get scale() { return scale; },
          set scale(v) { scale = v; },
          get offsetX() { return offsetX; },
          set offsetX(v) { offsetX = v; },
          get offsetY() { return offsetY; },
          set offsetY(v) { offsetY = v; },
          get selecting() { return selecting; },
          set selecting(v) { selecting = v; },
          get panning() { return panning; },
          set panning(v) { panning = v; },
          get dragging() { return dragging; },
          set dragging(v) { dragging = v; },
          get linkDrag() { return linkDrag; },
          set linkDrag(v) { linkDrag = v; },
          get refSorting() { return refSorting; },
          set refSorting(v) { refSorting = v; }
        },
        isCanvasOverlayTarget,
        closeFloatingCanvasUi,
        clearSelection,
        releaseDrags,
        updateSelectionBox,
        isCanvasMenuBlockedTarget,
        showNodeTypeMenu,
        hasAssetTransfer,
        assetFromDataTransfer,
        dropAssetOnCanvas,
        isSupportedUploadFile,
        screenToWorld,
        addNode,
        readUpload,
        saveProject,
        toast,
        zoomAroundPoint,
        setCanvasProxyActive,
        scheduleTransform,
        scheduleViewportInteractionEnd,
        updateLinkDrag,
        updateReferenceSort,
        finishSelection,
        updateNodeDrag,
        finishPortDrag,
        finishReferenceSort,
        safeReleasePointerCapture,
        cancelPortDrag
      },
      projectStore: {
        host: {
          get projects() { return projects; },
          set projects(v) { projects = v; },
          get currentProjectId() { return currentProjectId; },
          set currentProjectId(v) { currentProjectId = v; },
          get autoOpenLastProject() { return autoOpenLastProject; },
          get projectUndoStack() { return projectUndoStack; },
          set projectUndoStack(v) { projectUndoStack = Array.isArray(v) ? v : []; },
          get projectRedoStack() { return projectRedoStack; },
          set projectRedoStack(v) { projectRedoStack = Array.isArray(v) ? v : []; },
          get projectHistoryBusy() { return projectHistoryBusy; },
          set projectHistoryBusy(v) { projectHistoryBusy = Boolean(v); },
          get storageDir() { return storageDir; },
          set storageDir(v) { storageDir = v; },
          get usingDefaultStorageDir() { return usingDefaultStorageDir(); },
          get fileStoreCache() { return fileStoreCache; },
          set fileStoreCache(v) { fileStoreCache = v; },
          get storageQuotaWarned() { return storageQuotaWarned; },
          set storageQuotaWarned(v) { storageQuotaWarned = v; },
          get saveTimer() { return saveTimer; },
          set saveTimer(v) { saveTimer = v; },
          get nodeSeq() { return nodeSeq; },
          set nodeSeq(v) { nodeSeq = v; },
          get groupSeq() { return groupSeq; },
          set groupSeq(v) { groupSeq = v; },
          get scale() { return scale; },
          set scale(v) { scale = v; },
          get offsetX() { return offsetX; },
          set offsetX(v) { offsetX = v; },
          get offsetY() { return offsetY; },
          set offsetY(v) { offsetY = v; },
          get nodes() { return nodes; },
          set nodes(v) { nodes = v; },
          get edges() { return edges; },
          set edges(v) { edges = v; },
          get groups() { return groups; },
          set groups(v) { groups = v; },
          get selectedNodes() { return selectedNodes; },
          set selectedNodes(v) { selectedNodes = v; },
          get history() { return history; },
          set history(v) { history = v; },
          get assetLibrary() { return assetLibrary; },
          set assetLibrary(v) { assetLibrary = v; },
          get assetLibraryFolders() { return assetLibraryFolders; },
          set assetLibraryFolders(v) { assetLibraryFolders = v; },
          get importedModels() { return importedModels; },
          set importedModels(v) { importedModels = v; },
          get promptTopics() { return promptTopics; },
          set promptTopics(v) { promptTopics = v; },
          get promptWorkbenchActiveId() { return promptWorkbenchActiveId; },
          set promptWorkbenchActiveId(v) { promptWorkbenchActiveId = v; },
          get assistantProfiles() { return assistantProfiles; },
          set assistantProfiles(v) { assistantProfiles = v; },
          get assistantActiveId() { return assistantActiveId; },
          set assistantActiveId(v) { assistantActiveId = v; },
          get assistantActiveTab() { return assistantActiveTab; },
          set assistantActiveTab(v) { assistantActiveTab = v; },
          get activeWorkspace() { return activeWorkspace; },
          set activeWorkspace(v) { activeWorkspace = v; },
          get codexSchedules() { return codexSchedules; },
          set codexSchedules(v) { codexSchedules = v; },
          get shortStoryboardItems() { return shortStoryboardItems; },
          set shortStoryboardItems(v) { shortStoryboardItems = v; },
          get shortAssetItems() { return shortAssetItems; },
          set shortAssetItems(v) { shortAssetItems = v; },
          get shortQcItems() { return shortQcItems; },
          set shortQcItems(v) { shortQcItems = v; },
          get shortAudioPlan() { return shortAudioPlan; },
          set shortAudioPlan(v) { shortAudioPlan = v; },
          get shortTimelineItems() { return shortTimelineItems; },
          set shortTimelineItems(v) { shortTimelineItems = v; },
          get shortStoryApproved() { return shortStoryApproved; },
          set shortStoryApproved(v) { shortStoryApproved = v; },
          get shortStoryApprovedRevision() { return shortStoryApprovedRevision; },
          set shortStoryApprovedRevision(v) { shortStoryApprovedRevision = v; },
          get shortVoiceReferenceUrl() { return shortVoiceReferenceUrl; },
          set shortVoiceReferenceUrl(v) { shortVoiceReferenceUrl = v; },
          get shortVoiceReferenceName() { return shortVoiceReferenceName; },
          set shortVoiceReferenceName(v) { shortVoiceReferenceName = v; },
          get dialogEditActive() { return dialogEditActive; },
          set dialogEditActive(v) { dialogEditActive = v; },
          get dialogEditActiveNodeId() { return dialogEditActiveNodeId; },
          set dialogEditActiveNodeId(v) { dialogEditActiveNodeId = v; },
          get dialogEditMessages() { return dialogEditMessages; },
          set dialogEditMessages(v) { dialogEditMessages = v; },
          get dialogEditAttachments() { return dialogEditAttachments; },
          set dialogEditAttachments(v) { dialogEditAttachments = v; },
          get dialogEditVersions() { return dialogEditVersions; },
          set dialogEditVersions(v) { dialogEditVersions = v; },
          get dialogEditInput() { return dialogEditInput; },
          set dialogEditInput(v) { dialogEditInput = v; },
          get dialogEditMode() { return dialogEditMode; },
          set dialogEditMode(v) { dialogEditMode = v; },
          get dialogEditEditingIndex() { return dialogEditEditingIndex; },
          set dialogEditEditingIndex(v) { dialogEditEditingIndex = v; },
          get dialogEditRunning() { return dialogEditRunning; },
          set dialogEditRunning(v) { dialogEditRunning = v; },
          set dialogEditMode(v) { dialogEditMode = v; },
          nextNodeSeq() { return ++nodeSeq; },
          nextGroupSeq() { return ++groupSeq; },
          get STORE() { return STORE; },
          get selectedProjectTemplate() { return selectedProjectTemplate; },
          set selectedProjectTemplate(v) { selectedProjectTemplate = v; },
          get codexProjectTreeExpanded() { return codexProjectTreeExpanded; }
        },
        $,
        esc,
        toast,
        wait,
        unique,
        openModal,
        setActiveWorkspace,
        drawEdges,
        resetView,
        fitView,
        addNode,
        hydrateNode,
        clearCanvasSearch,
        applyCanvasFilters,
        scheduleVisibilityUpdate,
        scheduleTransform,
        scheduleDrawEdges,
        updateZoomLabel,
        setCanvasProxyActive,
        renderAll,
        renderHistory,
        renderAssetLibrary,
        renderModels,
        renderApiProviders,
        renderMusicPlayer,
        renderShortWorkbench,
        renderAssistantWorkspace,
        renderDialogEditWorkbench,
        restoreShortWorkbenchState,
        normalizeCodexSchedules,
        dialogTopicState,
        saveActiveTopicDialogState,
        loadActiveTopicDialogState,
        resetDialogRun,
        shortProductionBrief,
        normalizeAssetFolders,
        FILE_STORE_BY_KEY: window.FutureAICanvasStorage?.FILE_STORE_BY_KEY,
        compactBrowserStoreValue: window.FutureAICanvasStorage?.compactBrowserStoreValue,
        shouldUseCompactBrowserStore: window.FutureAICanvasStorage?.shouldUseCompactBrowserStore,
        isQuotaError: window.FutureAICanvasStorage?.isQuotaError,
        AssistantTopics: window.FutureAIAssistantTopics,
        blankDialogTopicState,
        globalProviderForKind,
        connectSilently,
        setSelectedPort: (v) => { selectedPort = v; },
        saveSettings,
        closeHistory,
        restoreCanvasInteractivity,
        normalizeWorkspace,
        applyTransform,
        addGroup,
        refreshAllLinkedInputs,
        renderGroups,
        persistMediaUrl,
        mediaExtFromDataUrl,
        syncStoragePathField,
        getActiveProjectWork,
        CanvasNodes: window.FutureAICanvasNodes,
        ProjectTemplates: window.FutureAIProjectTemplates
      },
      mediaWorkbench: {
        host: {
          get mediaMode() { return mediaMode; },
          set mediaMode(v) { mediaMode = v; },
          get mediaVideoHls() { return mediaVideoHls; },
          set mediaVideoHls(v) { mediaVideoHls = v; },
          get mediaTvHls() { return mediaTvHls; },
          set mediaTvHls(v) { mediaTvHls = v; },
          get mediaVideoSearchQuery() { return mediaVideoSearchQuery; },
          set mediaVideoSearchQuery(v) { mediaVideoSearchQuery = v; },
          get mediaVideoResults() { return mediaVideoResults; },
          set mediaVideoResults(v) { mediaVideoResults = v; },
          get mediaVideoStatus() { return mediaVideoStatus; },
          set mediaVideoStatus(v) { mediaVideoStatus = v; },
          get musicSearchQuery() { return musicSearchQuery; },
          set musicSearchQuery(v) { musicSearchQuery = v; },
          get musicResults() { return musicResults; },
          set musicResults(v) { musicResults = v; },
          get musicLocalTracks() { return musicLocalTracks; },
          set musicLocalTracks(v) { musicLocalTracks = v; },
          get musicFavorites() { return musicFavorites; },
          set musicFavorites(v) { musicFavorites = v; },
          get musicCurrentTrack() { return musicCurrentTrack; },
          set musicCurrentTrack(v) { musicCurrentTrack = v; },
          get musicCurrentTime() { return musicCurrentTime; },
          set musicCurrentTime(v) { musicCurrentTime = v; },
          get musicDuration() { return musicDuration; },
          set musicDuration(v) { musicDuration = v; },
          get musicPlayerVolume() { return musicPlayerVolume; },
          set musicPlayerVolume(v) { musicPlayerVolume = v; },
          get musicShuffleEnabled() { return musicShuffleEnabled; },
          set musicShuffleEnabled(v) { musicShuffleEnabled = v; },
          get musicRepeatMode() { return musicRepeatMode; },
          set musicRepeatMode(v) { musicRepeatMode = v; },
          get musicAutoSearchTimer() { return musicAutoSearchTimer; },
          set musicAutoSearchTimer(v) { musicAutoSearchTimer = v; },
          get musicSearchRequestSeq() { return musicSearchRequestSeq; },
          set musicSearchRequestSeq(v) { musicSearchRequestSeq = v; },
          get musicLastAutoSearchKey() { return musicLastAutoSearchKey; },
          set musicLastAutoSearchKey(v) { musicLastAutoSearchKey = v; },
          get musicStatus() { return musicStatus; },
          set musicStatus(v) { musicStatus = v; },
          get musicSourcePlugins() { return musicSourcePlugins; },
          set musicSourcePlugins(v) { musicSourcePlugins = v; },
          get musicSourcePluginRegistry() { return musicSourcePluginRegistry; },
          set musicSourcePluginRegistry(v) { musicSourcePluginRegistry = v; },
          get enabledMusicSourceIds() { return enabledMusicSourceIds; },
          set enabledMusicSourceIds(v) { enabledMusicSourceIds = v; },
          get musicUnavailableTrackIds() { return musicUnavailableTrackIds; },
          set musicUnavailableTrackIds(v) { musicUnavailableTrackIds = v; },
          get musicLXCore() { return musicLXCore; },
          set musicLXCore(v) { musicLXCore = v; },
          get history() { return history; },
          set history(v) { history = v; },
          get assetLibrary() { return assetLibrary; },
          set assetLibrary(v) { assetLibrary = v; },
          get assetLibraryFolders() { return assetLibraryFolders; },
          set assetLibraryFolders(v) { assetLibraryFolders = v; },
          get assetLibrarySearch() { return assetLibrarySearch; },
          set assetLibrarySearch(v) { assetLibrarySearch = v; },
          get assetLibraryType() { return assetLibraryType; },
          set assetLibraryType(v) { assetLibraryType = v; },
          get assetLibraryFolderId() { return assetLibraryFolderId; },
          set assetLibraryFolderId(v) { assetLibraryFolderId = v; },
          get assetLibraryTrashOnly() { return assetLibraryTrashOnly; },
          set assetLibraryTrashOnly(v) { assetLibraryTrashOnly = Boolean(v); },
          get assetLibrarySmartCollection() { return assetLibrarySmartCollection; },
          set assetLibrarySmartCollection(v) { assetLibrarySmartCollection = String(v || 'all'); },
          get assetLibraryVisualQuery() { return assetLibraryVisualQuery; },
          set assetLibraryVisualQuery(v) { assetLibraryVisualQuery = v || null; },
          get storageDir() { return storageDir; },
          get currentProjectId() { return currentProjectId; },
          get activeWorkspace() { return activeWorkspace; },
          get MEDIA_TV_CHANNELS() { return MEDIA_TV_CHANNELS; }
        },
        $,
        esc,
        toast,
        wait,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        saveSettings,
        getStore,
        setStore,
        unique,
        openModal,
        persistMediaUrl,
        mediaExtFromMime,
        isVideoMedia,
        isSupportedUploadFile,
        fileToDataUrl,
        ensureVendor,
        MediaLibraryRendering: window.FutureAIMediaLibraryRendering,
        MediaUtils: window.FutureAIMediaUtils,
        HistoryApi: window.FutureAICanvasHistory,
        LXCoreFactory: window.FutureAILXPlayerCore,
        SmartIndex: window.FutureAIAssetSmartIndex,
        STORE,
        compactHistoryItem,
        renderVideoResults,
        searchFreeVideos,
        viewCenter,
        getAssetReferences: url => {
          const target = String(url || '');
          const matches = [];
          const containsTarget = (value, seen = new WeakSet(), depth = 0) => {
            if (value === target) return true;
            if (!value || typeof value !== 'object' || depth > 6 || seen.has(value)) return false;
            seen.add(value);
            if (Array.isArray(value)) return value.some(item => containsTarget(item, seen, depth + 1));
            return Object.values(value).some(item => containsTarget(item, seen, depth + 1));
          };
          const scanState = (state, projectId, projectName) => {
            (state?.nodes || []).forEach(node => {
              if (containsTarget(node.data)) matches.push({type: 'project', projectId, projectName, nodeId: node.id, nodeType: node.type});
            });
          };
          projects.forEach(project => scanState(project.state, project.id, project.name));
          nodes.forEach(node => {
            if (containsTarget(node.data)) matches.push({type: 'current', projectId: currentProjectId, nodeId: node.id, nodeType: node.type});
          });
          history.forEach(item => {
            if (containsTarget(item)) matches.push({type: 'history', id: item.id});
          });
          return matches;
        },
        addNode,
        selectSingleNode,
        closeHistory,
        fitNodeIntoView,
        saveProject,
        openImageModal,
        dropAssetOnCanvas,
        sendAssetToAssistant,
        sendAssetToShortWorkbench
      },
      assistantChrome: {
        host: {
          get globalModelProviders() { return globalModelProviders; },
          get promptTopics() { return promptTopics; },
          set promptTopics(v) { promptTopics = v; },
          get promptWorkbenchActiveId() { return promptWorkbenchActiveId; },
          set promptWorkbenchActiveId(v) { promptWorkbenchActiveId = v; },
          get assistantActiveTab() { return assistantActiveTab; },
          set assistantActiveTab(v) { assistantActiveTab = v; },
          get assistantProfiles() { return assistantProfiles; },
          set assistantProfiles(v) { assistantProfiles = v; },
          get assistantActiveId() { return assistantActiveId; },
          set assistantActiveId(v) { assistantActiveId = v; },
          get dialogEditActive() { return dialogEditActive; },
          set dialogEditActive(v) { dialogEditActive = v; },
          get dialogEditActiveNodeId() { return dialogEditActiveNodeId; },
          set dialogEditActiveNodeId(v) { dialogEditActiveNodeId = v; },
          get dialogEditMessages() { return dialogEditMessages; },
          set dialogEditMessages(v) { dialogEditMessages = v; },
          get dialogEditAttachments() { return dialogEditAttachments; },
          set dialogEditAttachments(v) { dialogEditAttachments = v; },
          get dialogEditVersions() { return dialogEditVersions; },
          set dialogEditVersions(v) { dialogEditVersions = v; },
          get dialogEditInput() { return dialogEditInput; },
          set dialogEditInput(v) { dialogEditInput = v; },
          get dialogEditMode() { return dialogEditMode; },
          set dialogEditMode(v) { dialogEditMode = v; },
          get dialogEditEditingIndex() { return dialogEditEditingIndex; },
          set dialogEditEditingIndex(v) { dialogEditEditingIndex = v; },
          get dialogEditRunning() { return dialogEditRunning; },
          set dialogEditRunning(v) { dialogEditRunning = v; },
          get dialogRun() { return dialogRun; },
          set dialogRun(v) { dialogRun = v; },
          get dialogRunTimer() { return dialogRunTimer; },
          set dialogRunTimer(v) { dialogRunTimer = v; },
          get codexSessionId() { return codexSessionId; },
          set codexSessionId(v) { codexSessionId = v; },
          get codexRunning() { return codexRunning; },
          set codexRunning(v) { codexRunning = v; },
          get codexCli() { return codexState?.cli || null; },
          set codexCli(v) { codexState?.set(v); },
          get codexState() { return codexState; },
          get codexOutput() { return codexOutput; },
          set codexOutput(v) { codexOutput = v; },
          get codexStatus() { return codexStatus; },
          set codexStatus(v) { codexStatus = v; },
          get codexPermission() { return codexPermission; },
          set codexPermission(v) { codexPermission = v; },
          get codexPromptDraft() { return codexPromptDraft; },
          set codexPromptDraft(v) { codexPromptDraft = v; },
          get codexExpanded() { return codexExpanded; },
          set codexExpanded(v) { codexExpanded = v; },
          get codexDialogRun() { return codexDialogRun; },
          set codexDialogRun(v) { codexDialogRun = v; },
          get codexNavView() { return codexNavView; },
          set codexNavView(v) { codexNavView = v; },
          get codexSchedules() { return codexSchedules; },
          set codexSchedules(v) { codexSchedules = v; },
          get codexScheduleTimer() { return codexScheduleTimer; },
          set codexScheduleTimer(v) { codexScheduleTimer = v; },
          get sharedCodexHome() { return sharedCodexHome; },
          set sharedCodexHome(v) { sharedCodexHome = v; },
          get currentProjectId() { return currentProjectId; },
          get storageDir() { return storageDir; },
          get appReleaseChannel() { return appReleaseChannel; },
          get projects() { return projects; },
          get nodes() { return nodes; },
          get edges() { return edges; },
          get selectedNodes() { return selectedNodes; },
          get importedModels() { return importedModels; },
          get history() { return history; },
          get assetLibrary() { return assetLibrary; },
          get apiProviders() { return apiProviders; },
          get codexScheduleSessions() { return codexScheduleSessions; },
          get codexProjectTreeExpanded() { return codexProjectTreeExpanded; },
          get STORE() { return STORE; }
        },
        $,
        esc,
        toast,
        wait,
        saveProject,
        saveSettings,
        getStore,
        setStore,
        setActiveWorkspace,
        openDialogEditWorkbench,
        closeDialogEditWorkbench,
        renderDialogEditWorkbench,
        resetDialogRun,
        globalProviderForKind,
        providerApiKey,
        unique,
        openModal,
        serialize,
        nodeDisplayTitle,
        drawEdges,
        ensurePromptWorkbenchState,
        validAssistantContextMode,
        activeAssistantProfile,
        assistantSystemPrompt,
        API_TIMEOUTS,
        fetchJsonWithRetry,
        ensureAssistantProfiles,
        createAssistantProject,
        ensureDialogEditState,
        getActivePromptTopic,
        providerModelsForKind,
        modelsForKind,
        fillSelect,
        syncAssistantContextModeControls,
        dialogRunIsActive,
        updateDialogRun,
        finishDialogRun,
        pushDialogMessage,
        ensureApiProviders,
        viewCenter,
        addNode,
        connectSilently,
        renderAll,
        openDirectorDesk,
        renameProject,
        loadProject,
        buildCodexAssistantPrompt,
        chooseStorageDir,
        openSettings,
        providerOptionsForKind,
        AssistantTopics: window.FutureAIAssistantTopics
      },
      dialogRuntime: {
        host: {
          get dialogEditActive() { return dialogEditActive; },
          set dialogEditActive(v) { dialogEditActive = v; },
          get dialogEditActiveNodeId() { return dialogEditActiveNodeId; },
          set dialogEditActiveNodeId(v) { dialogEditActiveNodeId = v; },
          get dialogEditMessages() { return dialogEditMessages; },
          set dialogEditMessages(v) { dialogEditMessages = v; },
          get dialogEditAttachments() { return dialogEditAttachments; },
          set dialogEditAttachments(v) { dialogEditAttachments = v; },
          get dialogEditVersions() { return dialogEditVersions; },
          set dialogEditVersions(v) { dialogEditVersions = v; },
          get dialogEditInput() { return dialogEditInput; },
          set dialogEditInput(v) { dialogEditInput = v; },
          get dialogEditMode() { return dialogEditMode; },
          set dialogEditMode(v) { dialogEditMode = v; },
          get dialogEditEditingIndex() { return dialogEditEditingIndex; },
          set dialogEditEditingIndex(v) { dialogEditEditingIndex = v; },
          get dialogEditRunning() { return dialogEditRunning; },
          set dialogEditRunning(v) { dialogEditRunning = v; },
          get dialogRun() { return dialogRun; },
          set dialogRun(v) { dialogRun = v; },
          get dialogRunTimer() { return dialogRunTimer; },
          set dialogRunTimer(v) { dialogRunTimer = v; },
          get assistantActiveTab() { return assistantActiveTab; },
          set assistantActiveTab(v) { assistantActiveTab = v; },
          get assistantProfiles() { return assistantProfiles; },
          get assistantActiveId() { return assistantActiveId; },
          get promptTopics() { return promptTopics; },
          get promptWorkbenchActiveId() { return promptWorkbenchActiveId; },
          get codexDialogRun() { return codexDialogRun; },
          set codexDialogRun(v) { codexDialogRun = v; },
          get codexSessionId() { return codexSessionId; },
          set codexSessionId(v) { codexSessionId = v; },
          get codexRunning() { return codexRunning; },
          set codexRunning(v) { codexRunning = v; },
          get codexOutput() { return codexOutput; },
          set codexOutput(v) { codexOutput = v; },
          get codexStatus() { return codexStatus; },
          set codexStatus(v) { codexStatus = v; },
          get codexPermission() { return codexPermission; },
          get codexCli() { return codexState?.cli || null; },
          get codexState() { return codexState; },
          get codexExpanded() { return codexExpanded; },
          set codexExpanded(v) { codexExpanded = v; },
          get codexPromptDraft() { return codexPromptDraft; },
          set codexPromptDraft(v) { codexPromptDraft = v; },
          get storageDir() { return storageDir; },
          get selectedNodes() { return selectedNodes; },
          get nodes() { return nodes; }
        },
        $,
        esc,
        toast,
        wait,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        saveProject,
        queueSave,
        setActiveWorkspace,
        renderAssistantWorkspace,
        activeAssistantProfile,
        assistantSystemPrompt,
        activePromptTopic,
        saveActiveTopicDialogState,
        loadActiveTopicDialogState,
        globalProviderForKind,
        providerApiKey,
        imageGenerateRequest,
        imageEditWithFallback,
        chatCompletionTextRequest,
        applyModelAgnosticGenerationRules,
        applyModelAgnosticTextRules,
        formatImageGenerationError,
        persistGeneratedImageResult,
        apiCompatibleImageSize,
        imageTargetSize,
        persistMediaUrl,
        blobToDataUrl,
        mediaExtFromMime,
        isSafetyError,
        softenPrompt,
        openModal,
        nodeDisplayTitle,
        hydrateNode,
        addNode,
        viewCenter,
        getSelectedImageNode,
        joinApiPath,
        safeJson,
        imageSizeFromDialogPrompt,
        openImageModal,
        shouldUseLatestContextImage,
        generationReferenceUrls,
        messageRunKind,
        referenceIntent,
        referenceInstructions,
        cleanAiText,
        localizeAssistantText,
        ensureAssistantProfiles,
        createAssistantProject,
        createProviderApiError,
        clearCurrentDialogConversation,
        downloadImage,
        connectSilently,
        drawEdges,
        fileToDataUrl,
        agentProjectSummary,
        renderAgentConsole,
        codexApiConfig,
        multimodalVideoUnderstand,
        multimodalImageUnderstand,
        optimizeDialogImagePrompt,
        runLocalTask: runDialogCodexAssistant,
        AssistantTopics: window.FutureAIAssistantTopics,
        AssistantAttachments: window.FutureAIAssistantAttachments
      },
      e2eSmoke: {
        host: {
          get projects() { return projects; },
          set projects(v) { projects = v; },
          get currentProjectId() { return currentProjectId; },
          set currentProjectId(v) { currentProjectId = v; },
          get apiProviders() { return apiProviders; },
          set apiProviders(v) { apiProviders = Array.isArray(v) ? v : []; },
          get storageDir() { return storageDir; },
          set storageDir(v) { storageDir = v; },
          get nodes() { return nodes; },
          get edges() { return edges; },
          get selectedNodes() { return selectedNodes; },
          get fileStoreCache() { return fileStoreCache; },
          get history() { return history; },
          set history(v) { history = Array.isArray(v) ? v : []; },
          get canvasSearchQuery() { return canvasSearchQuery; },
          set canvasSearchQuery(v) { canvasSearchQuery = v; },
          get canvasTypeFilter() { return canvasTypeFilter; },
          set canvasTypeFilter(v) { canvasTypeFilter = v; },
          get canvasFavoritesOnly() { return canvasFavoritesOnly; },
          set canvasFavoritesOnly(v) { canvasFavoritesOnly = v; },
          get shortStoryboardItems() { return shortStoryboardItems; },
          set shortStoryboardItems(v) { shortStoryboardItems = v; },
          get shortAssetItems() { return shortAssetItems; },
          set shortAssetItems(v) { shortAssetItems = v; },
          get shortQcItems() { return shortQcItems; },
          set shortQcItems(v) { shortQcItems = v; },
          get shortAudioPlan() { return shortAudioPlan; },
          set shortAudioPlan(v) { shortAudioPlan = v; },
          get shortTimelineItems() { return shortTimelineItems; },
          set shortTimelineItems(v) { shortTimelineItems = v; },
          get STORE() { return STORE; }
        },
        $,
        esc,
        toast,
        wait,
        showApp,
        showHome,
        setActiveWorkspace,
        createProject,
        loadProject,
        loadProjects,
        saveProject,
        saveProjects,
        saveSettings,
        loadLocalStores,
        loadSettings,
        addNode,
        hydrateNode,
        applyCanvasFilters,
        nodeMatchesCanvasFilters,
        clearCanvasSearch,
        cacheBrowserStore,
        syncLocalStore,
        getStore,
        setStore,
        runImage,
        runImageNow,
        runComfyUI,
        buildPromptContext,
        canvasContextSnapshot,
        promptWithCanvasContext,
        buildBatchExportPayload,
        exportDiagnosticsPackage,
        scanMediaLibrary,
        runOneClickCleanup,
        normalizeApiProvider,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        shortProductionBrief,
        normalizeShortTimeline,
        buildShortAudioPlan,
        renderAll,
        drawEdges,
        connectSilently,
        selectSingleNode,
        diagnosticsSettingsSummary,
        renderMediaLibraryReport,
        optimizePromptRequest,
        planDialogRunWithTextModel,
        dialogTextChatReply,
        imageGenerateRequest,
        persistGeneratedImageResult,
        videoGenerateRequest,
        shortTimelineSrtText,
        renderShortAudioPlan,
        renderShortTimeline,
        renderShortDelivery,
        shortProductionPackage,
      },
      shortWorkbench: {
        host: {
          get history() { return history; },
          get storyboardItems() { return shortStoryboardItems; },
          set storyboardItems(v) { shortStoryboardItems = v; },
          get assetItems() { return shortAssetItems; },
          set assetItems(v) { shortAssetItems = v; },
          get storyApproved() { return shortStoryApproved; },
          set storyApproved(v) { shortStoryApproved = v; },
          get storyApprovedRevision() { return shortStoryApprovedRevision; },
          set storyApprovedRevision(v) { shortStoryApprovedRevision = v; },
          get qcItems() { return shortQcItems; },
          set qcItems(v) { shortQcItems = v; },
          get audioPlan() { return shortAudioPlan; },
          set audioPlan(v) { shortAudioPlan = v; },
          get timelineItems() { return shortTimelineItems; },
          set timelineItems(v) { shortTimelineItems = v; },
          get exportRunning() { return shortExportRunning; },
          set exportRunning(v) { shortExportRunning = v; },
          get exportStatus() { return shortExportStatus; },
          set exportStatus(v) { shortExportStatus = v; },
          get voiceReferenceUrl() { return shortVoiceReferenceUrl; },
          set voiceReferenceUrl(v) { shortVoiceReferenceUrl = v; },
          get voiceReferenceName() { return shortVoiceReferenceName; },
          set voiceReferenceName(v) { shortVoiceReferenceName = v; },
          get projects() { return projects; },
          get currentProjectId() { return currentProjectId; },
          get storageDir() { return storageDir; },
          get shortTaskCoordinator() { return shortTaskCoordinator; }
        },
        $,
        esc,
        toast,
        wait,
        fetchJsonWithRetry,
        API_TIMEOUTS,
        ShortBatch,
        addNode,
        drawEdges,
        connect,
        viewCenter,
        getSelectedImageNode,
        joinApiPath,
        safeJson,
        imageSizeFromDialogPrompt,
        openImageModal,
        openModal,
        saveProject,
        queueSave,
        addHistory,
        shortError,
        isTerminalShortVideoTaskError,
        resumeShortVideoTask,
        imageGenerateRequest,
        imageEditWithFallback,
        videoGenerateRequest,
        chatCompletionTextRequest,
        apiErrorMessage,
        joinApiPath,
        applyModelAgnosticGenerationRules,
        applyModelAgnosticTextRules,
        globalProviderForKind,
        providerApiKey,
        persistGeneratedImageResult,
        persistMediaUrl,
        blobToDataUrl,
        mediaExtFromMime,
        unique
      }
    });
    return domains;
  }

  function imageEditors() { return ensureDomains().imageEditors; }
  function localEdit() { return ensureDomains().localEdit; }
  function batchVariants() { return ensureDomains().batchVariants; }
  function promptAssist() { return ensureDomains().promptAssist; }
  let shareExportUi = null;
  function shareExport() {
    if (shareExportUi) return shareExportUi;
    if (!window.FutureAIShareExportUi?.create) return null;
    shareExportUi = window.FutureAIShareExportUi.create({
      $,
      toast,
      getNodes: () => nodes,
      getSelectedIds: () => [...selectedNodes],
      getProjectName: () => (projects.find(item => item.id === currentProjectId)?.name || $('projectTitle')?.textContent || '未命名项目'),
      getStorageDir: () => storageDir,
      exportSnapshot: (opts) => exportCanvasSnapshot(opts || {}),
      Core: window.FutureAISharePackage
    });
    shareExportUi.bind();
    return shareExportUi;
  }
  function openExportShare(opts) { return shareExport()?.open?.(opts || {}); }
  let spendPanelUi = null;
  function spendSettings() {
    const value = getStore('futureai.spendSettings', {});
    return value && typeof value === 'object' ? value : {};
  }
  function spendHistory() {
    const value = getStore('futureai.spendHistory', []);
    return Array.isArray(value) ? value : [];
  }
  function currentProjectInfo() {
    const project = projects.find(item => item.id === currentProjectId);
    return {id: currentProjectId || '', name: project?.name || $('projectTitle')?.textContent || '未命名项目'};
  }
  // balance-spend 量到一次真实扣费（可能合并了同一账户并发的几次生成）就记一条。
  function recordSpend({amount, unit, provider, tasks} = {}) {
    const core = window.FutureAISpendHistory;
    if (!core) return;
    const project = currentProjectInfo();
    setStore('futureai.spendHistory', core.addEvent(spendHistory(), {
      amount, unit, tasks,
      providerId: provider?.id || '',
      providerName: provider?.name || '',
      projectId: project.id,
      projectName: project.name
    }));
    if (spendPanelUi?.isOpen()) spendPanelUi.render();
  }
  function spendPanel() {
    if (spendPanelUi) return spendPanelUi;
    if (!window.FutureAISpendPanelUi?.create) return null;
    spendPanelUi = window.FutureAISpendPanelUi.create({
      $,
      esc,
      toast,
      Core: window.FutureAISpendHistory,
      getHistory: spendHistory,
      setHistory: value => setStore('futureai.spendHistory', Array.isArray(value) ? value : []),
      getSettings: spendSettings,
      setSettings: value => setStore('futureai.spendSettings', value || {}),
      getProject: currentProjectInfo,
      getEstimates: currency => (BudgetGuard ? BudgetGuard.usageFor(generationBudgetLedger(), {projectId: currentProjectId || '', currency}) : null),
      confirm: () => openModal({title: '清空扣费记录', text: '清空后这台电脑上的扣费记录和图表都会归零，预算设置不受影响。确定吗？', okText: '清空', cancelText: '取消', confirm: true}),
      saveCsv: payload => window.exportBridge?.exportSpendCsv?.(payload),
      onLowBalanceChange: () => balanceChip?.resetLowBalanceWarnings?.()
    });
    spendPanelUi.bind();
    return spendPanelUi;
  }
  function openSpendPanel() { return spendPanel()?.open?.(); }
  function supportUI() { return ensureDomains().supportUI; }
  function performanceMode() { return ensureDomains().performanceMode; }
  function shortWorkbench() { return ensureDomains().shortWorkbench; }
  function providerApi() { return ensureDomains().providerApi; }
  function providerUI() { return ensureDomains().providerUI; }
  function generationQueueApi() { return ensureDomains().generationQueue; }
  function canvasRuntime() { return ensureDomains().canvasRuntime; }
  function canvasLayout() { return ensureDomains().canvasLayout; }
  function canvasEvents() { return ensureDomains().canvasEvents; }
  function e2eSmoke() { return ensureDomains().e2eSmoke; }
  function dialogRuntime() { return ensureDomains().dialogRuntime; }
  function assistantChrome() { return ensureDomains().assistantChrome; }
  function mediaWorkbench() { return ensureDomains().mediaWorkbench; }
  function projectStore() { return ensureDomains().projectStore; }

  function getActiveProjectWork() {
    const imageTask = generationQueue.find(item => item.status === 'queued' || item.status === 'running');
    if (imageTask) return `图片生成任务“${imageTask.title || '未命名任务'}”`;
    if (shortTaskCoordinator.isBusy()) return `漫剧任务“${shortTaskCoordinator.activeLabel() || '生成任务'}”`;
    if (shortExportRunning) return '漫剧 MP4 导出任务';
    if (codexRunning) return 'Codex 任务';
    if (dialogEditRunning) return '对话改图任务';
    return '';
  }


  async function init() {
    installDiagnosticsHandlers();
    installStorageRecoveryHandler();
    installCodexOutputHandler();
    installManjuExportProgressHandler();
    movePanelsIntoSettings();
    ensureShortWorkbenchProductionSections();
    bindEvents();
    shareExport();
    applyFastCanvasMode();
    installCanvasMinimap();
    applyReduceMotionMode();
    canvasWallpaper = window.FutureAICanvasWallpaper?.createCanvasWallpaper({document, bridge: window.wallpaperBridge, onChange: saveSettings, toast});
    canvasWallpaper?.bind();
    balanceChip = window.FutureAIBalanceChip?.createBalanceChip({
      document,
      esc,
      getProviders: () => apiProviders,
      getDefaultProviderId: () => globalProviderForKind('image')?.id,
      balance: {
        queryable: provider => Boolean(providerUI()?.providerBalanceQueryable?.(provider)),
        state: id => providerUI()?.providerBalanceState?.(id) || null,
        view: provider => providerUI()?.providerBalanceView?.(provider) || {text: '余额 —', title: '', tone: ''},
        format: (value, unit) => providerUI()?.formatBalanceAmount?.(value, unit) ?? String(value),
        refresh: (provider, options) => providerUI()?.refreshProviderBalance?.(provider, options)
      },
      onChange: saveSettings,
      onSpend: recordSpend,
      onOpenSpend: openSpendPanel,
      isLowBalance: state => Boolean(window.FutureAISpendHistory?.isLowBalance(state, spendSettings().lowBalance)),
      onLowBalance: (provider, view) => toast(`${provider?.name || 'API 服务'}余额不多了（${view?.text || ''}），记得充值`, 'warn')
    });
    balanceChip?.bind();
    loadSettings();
    // Before anything (agent memory, wallpaper, stores) touches the storage folder: follow a moved/copied folder.
    await followMovedStorageDir();
    balanceChip?.refresh();
    // Color wheel stays visible in 外观 so a fresh PC can edit without hunting.
    void ensureColorThemePicker();
    initUISoundFeedback();
    scheduleHomeBackgroundVideo();
    // Every Codex detection change (startup, 重新检测, 浏览) re-renders the agent settings and console.
    codexState?.subscribe(() => { agentUi()?.renderSettings(); renderAgentConsole(); });
    void refreshCodexCli();
    agentUi()?.install();
    agentUi()?.renderSettings();
    agentUi()?.renderPanel();
    await loadApiKeySecret();
    await recoverStorageDir();
    await useDefaultStorageDirIfUnset();
    await loadLocalStores();
    await loadSupportCenter();
    supportUI()?.showRecoveryNotice?.();
    supportUI()?.initUpdateCheck?.();
    syncInstalledSkillCatalog();
    await loadSharedCodexExtensions();
    importedModels = getStore(STORE.models, []);
    history = getStore(STORE.history, []);
    assetLibrary = getStore(STORE.assets, []);
    assetLibraryFolders = normalizeAssetFolders(getStore(STORE.assetFolders, []));
    musicFavorites = getStore('musicFavorites', []).filter(track => track?.local || track?.url);
    setStore('musicFavorites', musicFavorites);
    await loadMusicPluginRegistry();
    initLXMusicCore();
    loadProjects();
    startCodexScheduleTimer();
    renderAll();
    showStartupScreen();
    if (FutureAIApiDefaults.get('apiUrl').trim() && FutureAIApiDefaults.get('apiKey').trim()) scheduleGlobalApiAutoImport();
    startE2ESmokeTest();
    startAgentEvalIfRequested();
  }

  // Benchmark mode: pass the configured chat provider to the main-process eval runner.
  async function startAgentEvalIfRequested() {
    const config = await window.agentEvalBridge?.config?.().catch(() => null);
    if (!config?.enabled) return;
    const api = await agentApiConfig();
    await window.agentEvalBridge.run({ ...api, fastModel: agentUi()?.settings?.().fastModel || '' });
  }

  function applyReduceMotionMode() {
    return performanceMode()?.applyReduceMotionMode?.();
  }

  function setReduceMotionMode(enabled, options) {
    return performanceMode()?.setReduceMotionMode?.(enabled, options);
  }

  function scheduleHomeBackgroundVideo() {
    return performanceMode()?.scheduleHomeBackgroundVideo?.();
  }

  function installStorageRecoveryHandler() {
    if (!window.localStorageBridge?.onRecovery || window.__futureStorageRecoveryInstalled) return;
    window.__futureStorageRecoveryInstalled = true;
    const labels = {projects: '项目', history: '历史记录', assets: '资产库', 'asset-folders': '资产分类', models: '模型列表'};
    window.localStorageBridge.onRecovery(payload => {
      const label = labels[payload?.store] || '本地数据';
      toast(`检测到${label}文件损坏，已自动恢复最近可用备份。损坏原件已保留。`, 'warn');
    });
  }


  function bindEvents() {
    $('homeCreateProject').addEventListener('click', () => createProject(true));
    $('homeCreateFromTemplate')?.addEventListener('click', () => openTemplateGallery({mode: 'new-project'}));
    $('homeChooseStorageDir')?.addEventListener('click', chooseStorageDir);
    $('homeOpenSettings')?.addEventListener('click', openSettings);
    $('homeQuickCreate')?.addEventListener('click', () => $('homeCreateProject')?.click());
    $('homeQuickStorage')?.addEventListener('click', () => $('homeChooseStorageDir')?.click());
    $('homeQuickSettings')?.addEventListener('click', openSettings);
    $('homeResumeLast')?.addEventListener('click', () => {
      if (!hasStorageDir()) return toast('请先选择本地存储路径', 'warn');
      if (!openLastProject()) toast('上次的项目不存在或已损坏，请从最近项目中选择', 'warn');
    });
    $('autoOpenLastProject')?.addEventListener('change', e => {
      autoOpenLastProject = Boolean(e.target.checked);
      saveSettings();
    });
    $('workspaceMenuToggle')?.addEventListener('click', () => {
      const menu = $('workspaceMenu');
      if (!menu) return;
      const open = menu.classList.toggle('hidden') === false;
      $('workspaceMenuToggle').setAttribute('aria-expanded', String(open));
    });
    $('workspaceMenu')?.addEventListener('click', e => {
      const button = e.target.closest('[data-workspace-mobile]');
      if (!button) return;
      const name = button.dataset.workspaceMobile;
      if (name === 'director') openDirectorDesk();
      else setActiveWorkspace(name);
      $('workspaceMenu')?.classList.add('hidden');
      $('workspaceMenuToggle')?.setAttribute('aria-expanded', 'false');
    });
    document.addEventListener('click', e => {
      if (e.target.closest('#workspaceMenuToggle,#workspaceMenu')) return;
      $('workspaceMenu')?.classList.add('hidden');
      $('workspaceMenuToggle')?.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('[data-canvas-empty]').forEach(button => button.addEventListener('click', () => {
      const action = button.dataset.canvasEmpty;
      if (action === 'prompt') addPromptAtCenter();
      if (action === 'upload') addUploadAtCenter();
      if (action === 'template') openTemplateGallery({mode: 'insert'});
    }));
    const canvasRoot = $('canvas');
    if (canvasRoot && !canvasRoot.dataset.emptyObserver) {
      canvasRoot.dataset.emptyObserver = '1';
      new MutationObserver(syncCanvasEmptyState).observe(canvasRoot, {childList: true});
      const viewportRoot = $('viewport');
      if (viewportRoot) new MutationObserver(syncCanvasEmptyState).observe(viewportRoot, {childList: true});
    }
    $('homeLogo').addEventListener('click', showHome);
    document.querySelector('.topbar')?.addEventListener('pointerdown', e => {
      if (e.target.closest('button, input, select, textarea, a, .nav-pills, .top-actions, .top-left')) {
        e.stopPropagation();
      }
    }, true);
    $('topLogo').addEventListener('click', goProjectCenter);
    $('topLogo').addEventListener('mousedown', e => {
      e.stopPropagation();
      $('topLogo').classList.add('pressed');
      setTimeout(() => $('topLogo')?.classList.remove('pressed'), 160);
    }, true);
    $('topLogo').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      goProjectCenter();
    }, true);
    document.querySelector('.nexus-mode-btn')?.addEventListener('click', openShortWorkbench);
    $('closeShortWorkbench')?.addEventListener('click', closeShortWorkbench);
    $('openDirectorDesk')?.addEventListener('click', openDirectorDesk);
    $('openDirectorDeskInline')?.addEventListener('click', openDirectorDesk);
    $('directorDeskClose')?.addEventListener('click', closeDirectorDesk);
    document.querySelectorAll('[data-short-jump]').forEach(btn => btn.addEventListener('click', () => jumpShortSection(btn.dataset.shortJump)));
    bindShortProductionBriefInputs();
    $('shortGenerateStory')?.addEventListener('click', generateShortStory);
    $('shortImportStory')?.addEventListener('click', () => $('shortStoryFile')?.click());
    $('shortAnalyzeStory')?.addEventListener('click', analyzeShortScript);
    $('shortStoryFile')?.addEventListener('change', async event => { const files = Array.from(event.target.files || []); try { await importShortScript(files); } finally { event.target.value = ''; } });
    $('shortApproveStory')?.addEventListener('click', approveShortStory);
    $('shortStoryToStoryboard')?.addEventListener('click', storyToShortStoryboard);
    $('shortGenerateAssets')?.addEventListener('click', generateShortAssets);
    $('shortGenerateAllAssets')?.addEventListener('click', () => generateAllShortAssetImages('all'));
    $('shortAssetPipelinePrompts')?.addEventListener('click', () => shortWorkbench()?.runShortAssetPipeline({images: false}));
    $('shortAssetPipelineImages')?.addEventListener('click', () => shortWorkbench()?.runShortAssetPipeline({images: true}));
    $('shortAssetPipelineStop')?.addEventListener('click', () => shortWorkbench()?.stopShortAssetPipeline());
    $('shortExportAssetPrompts')?.addEventListener('click', () => shortWorkbench()?.exportShortAssetPrompts());
    $('shortArtDirection')?.addEventListener('input', queueSave);
    $('shortAssetSearch')?.addEventListener('input', event => shortWorkbench()?.updateShortAssetBrowser(event));
    $('shortAssetColumns')?.addEventListener('change', event => shortWorkbench()?.updateShortAssetBrowser(event));
    $('shortAssetBrowserTools')?.addEventListener('click', onShortAssetsListClick);
    $('shortGenerateAllFirstFrames')?.addEventListener('click', generateAllShortFirstFrames);
    $('shortGenerateAllVideos')?.addEventListener('click', generateAllShortVideos);
    shortTaskCoordinator.subscribe(state => shortWorkbench()?.renderShortTaskSidebar?.(state));
    const shortSkillSelector = $('shortSkillSelector');
    if (shortSkillSelector) {
      shortSkillSelector.value = localStorage.getItem('futureai.shortSkill.active') || shortSkillSelector.value;
      shortWorkbench()?.renderShortSkillVersion?.(shortSkillSelector.value);
      shortSkillSelector.addEventListener('change', () => {
        localStorage.setItem('futureai.shortSkill.active', shortSkillSelector.value);
        shortWorkbench()?.renderShortSkillVersion?.(shortSkillSelector.value);
        toast('默认 skill 已切换：' + shortSkillSelector.options[shortSkillSelector.selectedIndex].text, 'success');
      });
    }
    $('shortImportSkill')?.addEventListener('click', () => $('shortSkillFile')?.click());
    $('shortManageSkill')?.addEventListener('click', () => shortWorkbench()?.openShortSkillManager?.(shortSkillSelector?.value));
    $('shortSkillFile')?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (!file || !shortSkillSelector) return;
      try {
        const installed = await shortWorkbench()?.installShortSkill?.(file, shortSkillSelector.value);
        if (!installed) return;
        shortSkillSelector.value = localStorage.getItem('futureai.shortSkill.active') || shortSkillSelector.value;
        shortWorkbench()?.renderShortSkillVersion?.(shortSkillSelector.value);
        toast('已替换当前 skill：' + (installed?.fileName || file.name), 'success');
      } catch (error) {
        toast(error?.message || 'skill 替换失败', 'error');
      } finally {
        event.target.value = '';
      }
    });
    $('shortRunLocalQc')?.addEventListener('click', runShortLocalQc);
    $('shortRunAiQc')?.addEventListener('click', runShortAiQc);
    $('shortBuildAudioPlan')?.addEventListener('click', buildShortAudioPlan);
    $('shortBuildTimeline')?.addEventListener('click', () => { shortTimelineItems = []; normalizeShortTimeline(); renderShortTimeline(); saveProject(); });
    $('shortDownloadSrt')?.addEventListener('click', downloadShortSrt);
    $('shortDownloadProductionJson')?.addEventListener('click', downloadShortProductionJson);
    $('shortDownloadQcReport')?.addEventListener('click', downloadShortQcReport);
    $('shortGenerateAllVoices')?.addEventListener('click', generateAllShortVoices);
    $('shortExportMp4')?.addEventListener('click', exportShortMp4);
    $('shortVoiceReferenceInput')?.addEventListener('change', onShortVoiceReferenceChange);
    $('shortTtsEngine')?.addEventListener('change', renderShortTtsConfigState);
    document.querySelectorAll('[data-workspace]').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      setActiveWorkspace(btn.dataset.workspace);
    }));
    $('assistantWorkbench')?.addEventListener('click', onAssistantWorkbenchClick);
    $('assistantWorkbench')?.addEventListener('dblclick', onAssistantWorkbenchDoubleClick);
    $('assistantWorkbench')?.addEventListener('input', e => {
      if (e.target?.id === 'codexPromptInput') codexPromptDraft = e.target.value;
    });
    $('assistantWorkbench')?.addEventListener('change', e => {
      if (e.target?.id !== 'codexPermissionSelect') return;
      codexPermission = e.target.value;
      const settings = getStore(STORE.settings, {});
      setStore(STORE.settings, { ...settings, codexPermission });
    });
    $('assistantModelSelect')?.addEventListener('change', e => {
      const profile = activeAssistantProfile();
      if (!profile) return;
      profile.model = e.target.value;
      FutureAIApiDefaults.set('chatModel', e.target.value);
      const provider = globalProviderForKind('chat');
      if (provider) provider.chatModel = e.target.value;
      saveSettings();
      saveProject();
      renderAssistantChrome();
    });
    $('dialogEditWorkbench')?.addEventListener('click', onDialogEditWorkbenchClick);
    $('dialogEditWorkbench')?.addEventListener('pointerdown', ensureDialogComposerEditable, true);
    $('assistantOpenCanvas')?.addEventListener('click', () => setActiveWorkspace('canvas'));
    $('assistantOpenSettings')?.addEventListener('click', openCodexSettings);
    $('dialogEditWorkbench')?.addEventListener('input', onDialogEditWorkbenchInput);
    $('dialogEditWorkbench')?.addEventListener('change', onDialogEditWorkbenchInput);
    $('dialogEditWorkbench')?.addEventListener('dragover', e => {
      if (!e.target.closest('[data-dialog-dropzone]')) return;
      e.preventDefault();
      e.target.closest('[data-dialog-dropzone]')?.classList.add('drag-over');
    });
    $('dialogEditWorkbench')?.addEventListener('dragleave', e => {
      e.target.closest('[data-dialog-dropzone]')?.classList.remove('drag-over');
    });
    $('dialogEditWorkbench')?.addEventListener('drop', e => {
      const zone = e.target.closest('[data-dialog-dropzone]');
      if (!zone) return;
      e.preventDefault();
      zone.classList.remove('drag-over');
      handleDialogEditUploads(e.dataTransfer?.files);
    });
    $('dialogEditRefInput')?.addEventListener('change', e => {
      handleDialogEditUploads(e.target.files);
      e.target.value = '';
    });
    $('shortStoryboardList')?.addEventListener('click', onShortStoryboardListClick);
    $('shortStoryboardList')?.addEventListener('input', onShortStoryboardListInput);
    $('shortStoryboardList')?.addEventListener('change', onShortStoryboardListInput);
    $('shortStoryboardList')?.addEventListener('dragstart', onShortStoryboardListDragStart);
    $('shortStoryboardList')?.addEventListener('dragover', e => e.preventDefault());
    $('shortStoryboardList')?.addEventListener('drop', onShortStoryboardListDrop);
    $('shortAssetsList')?.addEventListener('click', onShortAssetsListClick);
    $('shortAssetsList')?.addEventListener('input', onShortAssetsListInput);
    $('shortFramesList')?.addEventListener('click', onShortFramesListClick);
    $('shortFramesList')?.addEventListener('input', onShortFramesListInput);
    $('shortVideoList')?.addEventListener('click', onShortVideoListClick);
    $('shortQcList')?.addEventListener('click', onShortQcListClick);
    $('shortAudioPlanList')?.addEventListener('input', onShortAudioPlanInput);
    $('shortAudioPlanList')?.addEventListener('change', onShortAudioPlanInput);
    $('shortAudioPlanList')?.addEventListener('click', onShortAudioPlanClick);
    $('shortTimelineList')?.addEventListener('input', onShortTimelineInput);
    $('shortTimelineList')?.addEventListener('change', onShortTimelineInput);
    $('shortTimelineList')?.addEventListener('click', onShortTimelineClick);
    $('musicSearchBtn')?.addEventListener('click', () => searchFreeMusic());
    $('musicRadioBtn')?.addEventListener('click', () => searchOpenRadio());
    $('musicSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchFreeMusic(); });
    $('musicSearchInput')?.addEventListener('input', () => scheduleAutoMusicSearch(700, true));
    $('musicResultsList')?.addEventListener('click', onMusicListClick);
    $('musicFavoritesList')?.addEventListener('click', onMusicListClick);
    $('musicQueueList')?.addEventListener('click', onMusicListClick);
    $('musicImportBtn')?.addEventListener('click', () => $('musicLocalAudioInput')?.click());
    $('musicLocalAudioInput')?.addEventListener('change', e => {
      importLocalMusicFiles(e.target.files);
      e.target.value = '';
    });
    $('musicPluginList')?.addEventListener('change', onMusicPluginToggle);
    $('musicPlayPause')?.addEventListener('click', toggleMusicPlayback);
    $('musicPrev')?.addEventListener('click', () => playAdjacentMusic(-1));
    $('musicNext')?.addEventListener('click', () => playAdjacentMusic(1));
    $('musicShuffle')?.addEventListener('click', toggleMusicShuffle);
    $('musicRepeat')?.addEventListener('click', toggleMusicRepeat);
    $('musicSeek')?.addEventListener('input', seekMusicPlayback);
    $('musicVolume')?.addEventListener('input', changeMusicVolume);
    $('musicAudio')?.addEventListener('play', renderMusicTransport);
    $('musicAudio')?.addEventListener('pause', renderMusicTransport);
    $('musicAudio')?.addEventListener('timeupdate', updateMusicProgress);
    $('musicAudio')?.addEventListener('loadedmetadata', updateMusicProgress);
    $('musicFavoriteCurrent')?.addEventListener('click', () => toggleMusicFavorite(musicCurrentTrack));
    $('musicOpenSource')?.addEventListener('click', () => openMusicSource(musicCurrentTrack));
    document.querySelectorAll('[data-media-mode]').forEach(btn => btn.addEventListener('click', () => setMediaMode(btn.dataset.mediaMode || 'music')));
    $('mediaOpenVideoFile')?.addEventListener('click', () => $('mediaVideoFileInput')?.click());
    $('mediaVideoFileInput')?.addEventListener('change', e => playLocalVideoFile(e.target.files?.[0]));
    $('mediaPlayVideoUrl')?.addEventListener('click', () => playMediaUrl('video', $('mediaVideoUrlInput')?.value));
    $('mediaSearchVideoBtn')?.addEventListener('click', () => searchFreeVideos());
    $('mediaVideoSearchInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') searchFreeVideos(); });
    $('mediaVideoList')?.addEventListener('click', e => {
      const id = e.target.closest('[data-video-id]')?.dataset.videoId;
      const item = mediaVideoResults.find(video => video.id === id);
      if (!item) return;
      if (e.target.closest('[data-video-source]')) {
        const sourceUrl = safeExternalUrl(item.pageUrl);
        return sourceUrl ? window.open(sourceUrl, '_blank') : toast('来源地址不安全，已阻止打开', 'warn');
      }
      playMediaUrl('video', item.url, item.title);
    });
    $('mediaPlayTvUrl')?.addEventListener('click', () => playMediaUrl('tv', $('mediaTvUrlInput')?.value));
    $('mediaTvList')?.addEventListener('click', e => {
      const id = e.target.closest('[data-tv-id]')?.dataset.tvId;
      const channel = MEDIA_TV_CHANNELS.find(item => item.id === id);
      if (channel) playMediaUrl('tv', channel.url, channel.name);
    });
    $('sideCreateProject').addEventListener('click', () => createProject(true));
    $('projectGrid').addEventListener('click', onProjectGridClick);
    $('sideProjects').addEventListener('click', onSideProjectClick);
    $('openSettings').addEventListener('click', openSettings);
    $('topSettings').addEventListener('click', openSettings);
    $('queueToggle')?.addEventListener('click', toggleQueueDrawer);
    $('closeQueue')?.addEventListener('click', closeQueueDrawer);
    $('pauseQueue')?.addEventListener('click', pauseQueue);
    $('resumeQueue')?.addEventListener('click', resumeQueue);
    $('clearQueue')?.addEventListener('click', clearQueue);
    $('retryFailedQueue')?.addEventListener('click', retryFailedQueue);
    $('queueList')?.addEventListener('click', onQueueListClick);
    $('historyToggle').addEventListener('click', toggleHistory);
    $('undoProject')?.addEventListener('click', undoProject);
    $('redoProject')?.addEventListener('click', redoProject);
    $('restoreProjectVersion')?.addEventListener('click', () => restoreProjectVersion($('projectVersionSelect')?.value));
    $('projectVersionSelect')?.addEventListener('change', () => renderProjectVersionControls());
    $('closeHistory').addEventListener('click', closeHistory);
    $('railAssets')?.addEventListener('click', toggleAssetLibrary);
    $('railVariants')?.addEventListener('click', openVariantWorkbench);
    $('railCanvasAssistant')?.addEventListener('click', openCanvasExecutor);
    $('railMedia')?.addEventListener('click', () => {
      setActiveWorkspace(activeWorkspace === 'music' ? 'canvas' : 'music');
    });
    $('closeAssetLibrary')?.addEventListener('click', closeAssetLibrary);
    $('assetLibraryList')?.addEventListener('dragstart', onAssetLibraryDragStart);
    $('assetLibraryList')?.addEventListener('dragend', onAssetLibraryDragEnd);
    $('assetLibraryList')?.addEventListener('click', onAssetLibraryActionClick);
    $('assetLibraryReport')?.addEventListener('click', onAssetLibraryReportClick);
    $('assetLibraryFolderSelect')?.addEventListener('change', e => {
      assetLibraryFolderId = e.target.value || 'all';
      renderAssetLibrary();
    });
    $('assetLibraryTrashToggle')?.addEventListener('click', toggleAssetLibraryTrash);
    $('assetLibraryDedupe')?.addEventListener('click', dedupeAssetLibrary);
    $('assetLibraryReindex')?.addEventListener('click', () => rebuildAssetVisualIndex().catch(error => toast('重建视觉索引失败：\n' + (error?.message || error), 'error')));
    $('assetLibraryNewFolder')?.addEventListener('click', createAssetLibraryFolder);
    $('assetLibrarySearch')?.addEventListener('input', e => {
      assetLibrarySearch = e.target.value || '';
      renderAssetLibrary();
    });
    $('assetLibraryType')?.addEventListener('change', e => {
      assetLibraryType = e.target.value || 'all';
      renderAssetLibrary();
    });
    $('assetSmartCollection')?.addEventListener('change', e => {
      assetLibrarySmartCollection = e.target.value || 'all';
      assetLibraryVisualQuery = null;
      renderAssetLibrary();
    });
    $('assetLibraryImport')?.addEventListener('click', () => $('assetLibraryFileInput')?.click());
    $('assetLibraryFileInput')?.addEventListener('change', e => {
      importAssetLibraryFiles(e.target.files).catch(err => toast('导入资产失败：\n' + (err.message || err), 'error'));
      e.target.value = '';
    });
    $('railPan').addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleWorkflowBar();
    });
    document.addEventListener('pointerdown', e => {
      const bar = document.querySelector('.workflow-bar');
      if (!bar?.classList.contains('open')) return;
      if (e.target.closest('.workflow-bar, #railPan')) return;
      closeWorkflowBar();
    }, true);
    $('railSelect').addEventListener('click', openSettings);
    $('railLink')?.addEventListener('click', toggleLinkMode);
    $('railHistory')?.addEventListener('click', toggleHistory);
    $('railStorage')?.addEventListener('click', chooseStorageDir);
    $('canvasSearchInput')?.addEventListener('input', e => {
      canvasSearchQuery = e.target.value || '';
      applyCanvasFilters();
    });
    $('canvasTypeFilter')?.addEventListener('change', e => {
      canvasTypeFilter = e.target.value || 'all';
      applyCanvasFilters();
    });
    $('canvasFavoritesOnly')?.addEventListener('click', () => {
      canvasFavoritesOnly = !canvasFavoritesOnly;
      applyCanvasFilters();
    });
    $('clearCanvasSearch')?.addEventListener('click', clearCanvasSearch);
    $('canvasSearchBtn')?.addEventListener('click', () => (isCanvasSearchOpen() ? closeCanvasSearch() : openCanvasSearch()));
    $('closeCanvasSearch')?.addEventListener('click', () => closeCanvasSearch());
    document.addEventListener('pointerdown', e => {
      if (isCanvasSearchOpen() && !e.target.closest?.('.canvas-search-tool')) closeCanvasSearch(false);
    }, true);
    $('toggleMinimapBtn')?.addEventListener('click', toggleCanvasMinimap);
    $('focusCanvasSearchResult')?.addEventListener('click', () => focusCanvasSearchResult());
    $('zoomFitBtn')?.addEventListener('click', () => fitView(true));
    $('zoomMinusBtn')?.addEventListener('click', () => zoomCanvas(.87));
    $('zoomPlusBtn')?.addEventListener('click', () => zoomCanvas(1.15));
    $('zoomSlider')?.addEventListener('input', e => setCanvasZoom(Number(e.target.value) / 100));
    $('tidyCanvasBtn')?.addEventListener('click', () => tidyCanvasGrid(true));
    $('exportCanvasSnapshotBtn')?.addEventListener('click', async () => {
      try {
        const result = await exportCanvasSnapshot({});
        if (result) toast(`画布快照已保存（${result.nodeCount} 个节点）`, 'success');
      } catch (err) {
        toast(err?.message || String(err), 'error');
      }
    });
    $('fastCanvasBtn')?.addEventListener('click', toggleFastCanvasMode);
    $('projectDetailBtn')?.addEventListener('click', openSettings);
    $('disconnectBtn')?.addEventListener('click', goProjectCenter);
    $('textEditorClose')?.addEventListener('click', closeTextEditor);
    $('textEditorInput')?.addEventListener('input', syncExpandedText);
    $('textEditorModal')?.addEventListener('click', e => { if (e.target === $('textEditorModal')) closeTextEditor(); });
    $('themeToggle').addEventListener('click', toggleFocusMode);
    $('closeSettings').addEventListener('click', closeSettings);
    $('settingsDrawer').addEventListener('click', e => {
      if (e.target === $('settingsDrawer')) return closeSettings();
      const tab = e.target.closest('[data-settings-tab]');
      if (tab) switchSettingsTab(tab.dataset.settingsTab);
    });
    $('deleteSelection').addEventListener('click', deleteSelectedNodes);
    $('groupSelection')?.addEventListener('click', groupSelectedNodes);
    $('saveSelectionWorkflow')?.addEventListener('click', () => openTemplateGallery({mode: 'insert', focusSave: true}));
    $('ungroupSelection')?.addEventListener('click', ungroupSelectedNodes);
    $('downloadSelection')?.addEventListener('click', () => downloadNodes([...selectedNodes]));
    $('selectionToolbar')?.addEventListener('click', e => {
      const align = e.target.closest('[data-align]');
      const distribute = e.target.closest('[data-distribute]');
      if (align) arrangeSelection('align', align.dataset.align);
      else if (distribute) arrangeSelection('distribute', distribute.dataset.distribute);
    });
    $('shortcutHelpBtn')?.addEventListener('click', () => toggleShortcutHelp());
    $('openWorkflowLibrary')?.addEventListener('click', () => openTemplateGallery({mode: 'insert'}));
    $('closeWorkflowLibrary')?.addEventListener('click', closeWorkflowLibrary);
    $('saveWorkflowSelection')?.addEventListener('click', saveSelectedWorkflow);
    $('importWorkflowDefinition')?.addEventListener('click', () => $('workflowImportFile')?.click());
    $('workflowImportFile')?.addEventListener('change', importWorkflowDefinitions);
    $('workflowLibraryList')?.addEventListener('click', handleWorkflowLibraryClick);
    $('closeTemplateGallery')?.addEventListener('click', closeTemplateGallery);
    $('templateGalleryModal')?.addEventListener('click', e => { if (e.target === $('templateGalleryModal')) closeTemplateGallery(); });
    $('templateGalleryTabs')?.addEventListener('click', handleTemplateGalleryTabClick);
    $('templateGalleryGrid')?.addEventListener('click', handleTemplateGalleryGridClick);
    $('templateGallerySaveBtn')?.addEventListener('click', saveSelectedAsUserTemplate);
    $('testApi')?.addEventListener('click', testApi);
    $('importModels')?.addEventListener('click', importModels);
    $('addApiProvider')?.addEventListener('click', addApiProvider);
    $('apiProviderList')?.addEventListener('input', handleApiProviderInput);
    $('apiProviderList')?.addEventListener('change', handleApiProviderInput);
    $('apiProviderList')?.addEventListener('click', handleApiProviderClick);
    $('testComfyUI')?.addEventListener('click', testComfyUI);
    $('importComfyWorkflow')?.addEventListener('click', () => $('comfyWorkflowFile')?.click());
    $('comfyWorkflowFile')?.addEventListener('change', importComfyWorkflowFile);
    $('exportComfyWorkflow')?.addEventListener('click', exportComfyWorkflow);
    $('clearComfyWorkflow')?.addEventListener('click', clearComfyWorkflow);
    $('chooseStorageDir')?.addEventListener('click', chooseStorageDir);
    $('storageDirDefaultChoose')?.addEventListener('click', chooseStorageDir);
    $('storageDefaultBannerChoose')?.addEventListener('click', chooseStorageDir);
    $('storageDefaultBannerDismiss')?.addEventListener('click', () => {
      storageDefaultNoticeDismissed = true;
      syncStoragePathField();
    });
    $('openStorageDir')?.addEventListener('click', openStorageDir);
    $('exportWorkspaceBackup')?.addEventListener('click', exportWorkspaceBackup);
    $('restoreWorkspaceBackup')?.addEventListener('click', restoreWorkspaceBackup);
    $('restoreProjectBackup')?.addEventListener('click', restoreProjectBackup);
    $('batchExport')?.addEventListener('click', runBatchExport);
    $('exportReviewPackage')?.addEventListener('click', runReviewPackageExport);
    $('importReviewComments')?.addEventListener('click', () => $('reviewCommentsFile')?.click());
    $('reviewCommentsFile')?.addEventListener('change', importReviewCommentsFile);
    $('scanMediaLibrary')?.addEventListener('click', scanMediaLibrary);
    $('exportDiagnostics')?.addEventListener('click', exportDiagnosticsPackage);
    $('runCleanup')?.addEventListener('click', runOneClickCleanup);
    $('previewBudgetRoutes')?.addEventListener('click', previewBudgetRoutes);
    $('openSpendFromSettings')?.addEventListener('click', openSpendPanel);
    ['generationMaxTasks', 'generationFailureStop', 'generationAutoRetry', 'generationDailyReminder', 'generationRequireStorage', 'generationBudgetCurrency', 'generationSingleBudget', 'generationDailyBudget', 'generationProjectBudget'].forEach(id => $(id)?.addEventListener('change', saveSettings));
    document.querySelectorAll('[data-support-document]').forEach(button => button.addEventListener('click', () => openSupportDocument(button.dataset.supportDocument)));
    $('supportDocumentClose')?.addEventListener('click', closeSupportDocument);
    $('supportDocumentModal')?.addEventListener('click', event => {
      if (event.target === $('supportDocumentModal')) closeSupportDocument();
    });
    $('imageModelSelect')?.addEventListener('change', e => setGlobalModelValue('image', e.target.value));
    $('videoModelSelect')?.addEventListener('change', e => setGlobalModelValue('video', e.target.value));
    $('chatModelSelect')?.addEventListener('change', e => setGlobalModelValue('chat', e.target.value));
    document.querySelectorAll('[data-global-provider]').forEach(sel => sel.addEventListener('change', e => setGlobalProviderValue(e.target.dataset.globalProvider, e.target.value)));
    document.querySelectorAll('[data-global-model]').forEach(input => input.addEventListener('change', e => setGlobalModelValue(e.target.dataset.globalModel, e.target.value)));
    $('appearanceMode')?.addEventListener('change', e => {
      applyAppearanceMode(e.target.value);
      saveSettings();
    });
    $('perfReduceMotion')?.addEventListener('change', e => {
      setReduceMotionMode(Boolean(e.target.checked), {persist: true, toastUser: true});
    });
    document.querySelectorAll('input[name="colorTheme"]').forEach(input => input.addEventListener('change', e => {
      if (!e.target.checked) return;
      colorTheme = normalizeColorTheme(e.target.value);
      if (colorTheme !== 'custom') {
        activeSavedColorThemeId = '';
        const resolved = window.FutureAIColorThemes?.resolveTheme?.(colorTheme);
        if (resolved?.palette) {
          customThemePalette = window.FutureAIColorThemes.normalizePalette(resolved.palette);
          customThemeColor = customThemePalette.accent;
        }
      } else if (!activeSavedColorThemeId && $('customThemeName')) {
        $('customThemeName').value = nextSavedColorThemeName();
      }
      applyColorTheme(colorTheme, customThemeColor, customThemePalette);
      void ensureColorThemePicker().then(() => setActiveThemeZone(activeThemeZone, true));
      saveSettings();
    }));
    $('customThemeRow')?.addEventListener('click', e => {
      const zoneButton = e.target.closest('[data-theme-zone]');
      if (!zoneButton) return;
      setActiveThemeZone(zoneButton.dataset.themeZone);
    });
    $('customThemeHex')?.addEventListener('input', e => {
      const value = String(e.target.value || '').trim();
      if (!/^#[0-9a-f]{6}$/i.test(value)) return;
      setCustomThemeColor(value, true);
    });
    $('customThemeHex')?.addEventListener('change', e => {
      setCustomThemeColor(e.target.value, true);
      saveSettings();
    });
    $('saveCustomTheme')?.addEventListener('click', () => saveCurrentColorTheme());
    $('savedColorThemeList')?.addEventListener('click', handleSavedColorThemeClick);
    $('resetColorTheme')?.addEventListener('click', () => {
      colorTheme = 'ocean';
      customThemeColor = '#4fd6e8';
      customThemePalette = window.FutureAIColorThemes?.normalizePalette(window.FutureAIColorThemes.DEFAULT_PALETTE) || customThemePalette;
      activeThemeZone = 'accent';
      activeSavedColorThemeId = '';
      applyColorTheme(colorTheme, customThemeColor, customThemePalette);
      void ensureColorThemePicker().then(() => setActiveThemeZone(activeThemeZone, true));
      if ($('customThemeName')) $('customThemeName').value = nextSavedColorThemeName();
      saveSettings();
    });
    $('uiSoundEnabled')?.addEventListener('change', e => {
      const nextEnabled = Boolean(e.target.checked);
      if (!nextEnabled) uiSoundController?.play('toggle');
      uiSoundEnabled = nextEnabled;
      uiSoundController?.setEnabled(uiSoundEnabled);
      syncUISoundControls();
      saveSettings();
      if (nextEnabled) uiSoundController?.play('toggle');
    });
    $('uiSoundVolume')?.addEventListener('input', e => {
      uiSoundVolume = Math.max(0, Math.min(1, Number(e.target.value || 0) / 100));
      uiSoundController?.setVolume(uiSoundVolume);
      syncUISoundControls();
    });
    $('uiSoundVolume')?.addEventListener('change', () => {
      saveSettings();
      uiSoundController?.play('confirm');
    });
    $('uiSoundPreview')?.addEventListener('click', () => uiSoundController?.play('preview'));
    ['assistantContextModeInline','comfyUrl','comfyWorkflowName','comfyWorkflowJson'].forEach(id => $(id)?.addEventListener('input', () => {
      syncAssistantContextModeControls();
      syncLegacyApiProvider();
      saveSettings();
      syncGlobalModelInputs();
      renderModels();
      refreshNodeModelSelects();
    }));
    $('commandPalette')?.addEventListener('click', onCommandPaletteClick);
    $('commandPaletteInput')?.addEventListener('input', renderCommandPalette);
    $('commandPaletteInput')?.addEventListener('keydown', onCommandPaletteKeydown);
    $('addPrompt').addEventListener('click', addPromptAtCenter);
    $('addUpload')?.addEventListener('click', addUploadAtCenter);
    $('addImage').addEventListener('click', addImageAtCenter);
    $('addVideo').addEventListener('click', addVideoAtCenter);
    $('addMediaTool')?.addEventListener('click', addMediaToolAtCenter);
    $('addComfyUI')?.addEventListener('click', addComfyUIAtCenter);
    $('addStoryboard').addEventListener('click', addStoryboard);
    $('addCharacter').addEventListener('click', addCharacterAtCenter);
    $('autoLayout').addEventListener('click', () => autoLayout(true));
    $('fitView').addEventListener('click', () => fitView(true));
    $('runAll').addEventListener('click', runAll);
    $('resetView').addEventListener('click', () => resetView(true));
    $('modalOk').addEventListener('click', () => submitModal());
    $('modalCancel').addEventListener('click', () => closeModal(modalResolve?.cancelValue ?? null));
    $('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(null); });
    $('imageModalClose').addEventListener('click', closeImageModal);
    $('imageModalZoomOut')?.addEventListener('click', () => zoomImageModal(0.82));
    $('imageModalZoomIn')?.addEventListener('click', () => zoomImageModal(1.22));
    $('imageModalZoomReset')?.addEventListener('click', () => {
      modalZoom = 1;
      modalPan = {x: 0, y: 0};
      applyImageModalZoom();
    });
    $('imageModalDownload')?.addEventListener('click', () => {
      const src = imageModalSrc || $('imageModalImg')?.getAttribute('src') || $('videoModalPlayer')?.getAttribute('src') || '';
      if (!src) return toast('暂无可下载内容', 'warn');
      if (isVideoMedia('', src)) return downloadMedia(src);
      return downloadImage(src);
    });
    $('imageModal').addEventListener('wheel', handleImageModalWheel, {passive: false});
    $('imageModal').addEventListener('pointerdown', startImageModalDrag);
    document.addEventListener('pointermove', updateImageModalDrag);
    document.addEventListener('pointerup', endImageModalDrag);
    document.addEventListener('pointercancel', endImageModalDrag);
    $('imageModal').addEventListener('click', e => {
      if (e.target.closest('.image-modal-toolbar button')) return;
      if (modalSuppressClick) {
        modalSuppressClick = false;
        return;
      }
      if (e.target === $('imageModal')) closeImageModal();
    });
    $('fabricEditorClose')?.addEventListener('click', closeFabricEditor);
    $('fabricEditorSave')?.addEventListener('click', () => saveFabricEditor());
    $('fabricEditorModal')?.addEventListener('click', e => { if (e.target === $('fabricEditorModal')) closeFabricEditor(); });
    $('fabricEditorModal')?.addEventListener('click', onFabricEditorClick);
    $('fabricEditorColor')?.addEventListener('input', syncFabricBrush);
    $('fabricEditorStroke')?.addEventListener('input', syncFabricBrush);
    $('cropperClose')?.addEventListener('click', closeCropperEditor);
    $('cropperSave')?.addEventListener('click', () => saveCropperEditor());
    $('cropperModal')?.addEventListener('click', e => { if (e.target === $('cropperModal')) closeCropperEditor(); });
    $('cropperModal')?.addEventListener('click', onCropperEditorClick);
    $('cameraClose')?.addEventListener('click', closeCameraModal);
    $('cameraCancel')?.addEventListener('click', closeCameraModal);
    $('cameraApply')?.addEventListener('click', applyCameraModal);
    $('cameraYaw')?.addEventListener('input', updateCameraFromControls);
    $('cameraPitch')?.addEventListener('input', updateCameraFromControls);
    $('cameraDistance')?.addEventListener('input', updateCameraFromControls);
    $('cameraModal')?.addEventListener('click', e => { if (e.target === $('cameraModal')) closeCameraModal(); });
    $('cameraModal')?.addEventListener('click', onCameraPresetClick);
    $('cameraModal')?.addEventListener('wheel', onCameraWheel, {passive: false});
    $('cameraModal')?.addEventListener('pointerdown', startCameraDrag);
    document.addEventListener('pointermove', updateCameraDrag);
    document.addEventListener('pointerup', endCameraDrag);
    document.addEventListener('pointercancel', endCameraDrag);
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('selectionchange', clearAccidentalPageSelection);
    $('historyList').addEventListener('click', onHistoryClick);
    $('mascotButton').addEventListener('mousedown', startMascotDrag);
    $('mascotButton').addEventListener('click', toggleChat);
    $('mascotSwitch').addEventListener('click', switchMascot);
    $('chatPreview')?.addEventListener('click', () => {
      $('chatPanel').classList.remove('hidden');
      $('chatPreview').classList.add('hidden');
      renderChat();
    });
    $('closeChat').addEventListener('click', () => $('chatPanel').classList.add('hidden'));
    $('sendChat').addEventListener('click', sendChat);
    $('chatUploadBtn')?.addEventListener('click', () => $('chatUploadInput')?.click());
    $('chatUploadInput')?.addEventListener('change', addChatUploads);
    $('chatInput').addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
    canvasEvents()?.bindCanvas?.();
    enhanceTextareas(document);
    window.addEventListener('message', onDirectorDeskMessage);
    document.addEventListener('pointerdown', interactionRescueOnPointerDown, true);
    installAssetDropTargets();
    window.addEventListener('beforeunload', () => { projectStore()?.flushPendingSave?.(); saveProject(); saveSettings(); });
    // Closing the window waits for this (see installCloseFlush in main.js).
    window.lifecycleBridge?.onFlushRequest?.(() => projectStore()?.flushBeforeClose?.());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') projectStore()?.flushPendingSave?.(); });
    document.addEventListener('futureai:media-relocate', onMediaRelocateRequest);
  }

  function normalizeWorkspace(name = 'short') {
    if (name === 'prompt') {
      assistantActiveTab = 'dialog';
      return 'assistant';
    }
    if (name === 'dialog') {
      assistantActiveTab = 'dialog';
      return 'assistant';
    }
    return ['short', 'assistant', 'canvas', 'music'].includes(name) ? name : 'short';
  }

  function setActiveWorkspace(name = 'short') {
    activeWorkspace = normalizeWorkspace(name);
    document.body.classList.toggle('workspace-short', activeWorkspace === 'short');
    document.body.classList.toggle('workspace-assistant', activeWorkspace === 'assistant');
    document.body.classList.toggle('workspace-canvas', activeWorkspace === 'canvas');
    document.body.classList.toggle('workspace-music', activeWorkspace === 'music');
    document.querySelectorAll('[data-workspace]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.workspace === activeWorkspace);
    });
    const workspaceLabels = {short: 'AI 漫剧工作台', assistant: '∞ 灵枢万象', canvas: '无限画布', music: '媒体中心'};
    if ($('workspaceMenuLabel')) $('workspaceMenuLabel').textContent = workspaceLabels[activeWorkspace] || '当前工作区';
    syncCanvasEmptyState();
    if (activeWorkspace === 'canvas') balanceChip?.refresh();
    $('railMedia')?.classList.toggle('active', activeWorkspace === 'music');
    $('shortWorkbench')?.classList.toggle('hidden', activeWorkspace !== 'short');
    $('assistantWorkbench')?.classList.toggle('hidden', activeWorkspace !== 'assistant');
    $('musicWorkbench')?.classList.toggle('hidden', activeWorkspace !== 'music');
    closeWorkflowBar();
    if (activeWorkspace === 'music' && linkMode) {
      linkMode = false;
      selectedPort = null;
      document.querySelectorAll('.port.selected').forEach(p => p.classList.remove('selected'));
      updateLinkMode();
    }
    if (activeWorkspace === 'assistant') {
      dialogEditActive = true;
      ensureDialogEditState();
      renderAssistantWorkspace();
    } else if (activeWorkspace === 'music') {
      setMediaMode(mediaMode);
      renderMusicPlayer();
      scheduleAutoMusicSearch(250);
    } else {
      drawEdges();
      requestAnimationFrame(drawEdges);
    }
  }
  function commandPaletteActions() {
    return window.FutureAICommandPalette.buildActions({
      setActiveWorkspace,
      openShortWorkbench,
      createAssistantTopic,
      addPromptAtCenter,
      addImageAtCenter,
      addUploadAtCenter,
      addVideoAtCenter,
      addComfyUIAtCenter,
      openSettings,
      pauseQueue,
      retryFailedQueue,
      fitView,
      openCanvasSearch,
      selectedNodes,
      duplicateNodes,
      toggleShortcutHelp,
      toast
    });
  }

  function openCommandPalette() {
    const modal = $('commandPalette');
    if (!modal) return;
    commandPalettePreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    commandPaletteActiveIndex = 0;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    $('commandPaletteInput').value = '';
    renderCommandPalette();
    requestAnimationFrame(() => $('commandPaletteInput')?.focus());
  }

  function closeCommandPalette() {
    const modal = $('commandPalette');
    if (!modal || modal.classList.contains('hidden')) return;
    modal.classList.add('hidden');
    modal.setAttribute('aria-hidden', 'true');
    const restore = commandPalettePreviousFocus;
    commandPalettePreviousFocus = null;
    if (restore && document.contains(restore)) requestAnimationFrame(() => restore.focus());
  }

  function openDirectorDesk() {
    const modal = $('directorDeskModal');
    const frame = $('directorDeskFrame');
    if (!modal || !frame) return;
    const src = new URL(frame.dataset.src || './director-desk/index.html', window.location.href).toString();
    if (!frame.getAttribute('src')) {
      directorDeskReady = false;
      frame.addEventListener('load', flushDirectorDeskMessages, {once: true});
      frame.setAttribute('src', src);
    } else {
      requestAnimationFrame(flushDirectorDeskMessages);
    }
    frame.style.pointerEvents = 'auto';
    modal.classList.remove('hidden');
    modal.removeAttribute('aria-hidden');
    document.body.classList.add('director-desk-open');
    queueDirectorDeskMessage('storyai:director-desk-session', {
      instanceId: currentProjectId || 'canvas',
      theme: document.documentElement.classList.contains('dark') || document.body.classList.contains('dark-mode') ? 'dark' : 'light'
    });
  }

  function closeDirectorDesk() {
    const modal = $('directorDeskModal');
    const frame = $('directorDeskFrame');
    if (frame) frame.style.pointerEvents = 'none';
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('director-desk-open');
    restoreCanvasInteractivity();
  }

  function postDirectorDeskMessage(type, payload = {}) {
    const frame = $('directorDeskFrame');
    if (!frame?.contentWindow) return false;
    frame.contentWindow.postMessage({type, payload}, '*');
    return true;
  }

  function queueDirectorDeskMessage(type, payload = {}) {
    directorDeskPendingMessages.push({type, payload});
    flushDirectorDeskMessages();
    window.setTimeout(flushDirectorDeskMessages, 120);
    window.setTimeout(flushDirectorDeskMessages, 420);
  }

  function flushDirectorDeskMessages() {
    const frame = $('directorDeskFrame');
    if (!frame?.contentWindow || !directorDeskReady || !directorDeskPendingMessages.length) return;
    const pending = directorDeskPendingMessages;
    directorDeskPendingMessages = [];
    pending.forEach(item => postDirectorDeskMessage(item.type, item.payload));
  }

  function imageNodeDirectorUrl(node) {
    return window.FutureAIDirectorDesk.imageNodeDirectorUrl(node);
  }

  function sendImageNodeToDirectorDesk(node) {
    const imageUrl = imageNodeDirectorUrl(node);
    if (!imageUrl) return toast('这个图片节点还没有可发送的图片。', 'warn');
    openDirectorDesk();
    queueDirectorDeskMessage('storyai:director-desk-panorama', {
      imageUrl,
      fileName: (nodeDisplayTitle(node) || '画布图片') + '.png',
      sourceNodeId: node.id,
      edgeId: 'canvas-director-' + node.id
    });
    toast('已发送到导演台，可作为背景参考使用。', 'success');
  }

  function interactionRescueOnPointerDown(e) {
    if (document.body.classList.contains('director-desk-open')) return;
    const modal = $('directorDeskModal');
    if (modal && !modal.classList.contains('hidden')) {
      closeDirectorDesk();
    }
  }

  function onDirectorDeskMessage(e) {
    const frameWindow = $('directorDeskFrame')?.contentWindow;
    if (frameWindow && e.source !== frameWindow) return;
    const type = e.data?.type;
    if (type === 'storyai:director-desk-ready') {
      directorDeskReady = true;
      flushDirectorDeskMessages();
    }
    if (type === 'storyai:director-desk-close') closeDirectorDesk();
    if (type === 'storyai:director-desk-panorama-removed') toast('导演台已移除画布参考图', 'success');
    if (type === 'storyai:director-desk-captures-sent') {
      handleDirectorDeskCapturesSent(e.data?.payload).catch(err => {
        console.error('director desk capture send failed', err);
        toast('导演台截图发送失败：' + (err?.message || err), 'error');
      });
    }
  }

  function normalizeDirectorDeskDestination(value) {
    return window.FutureAIDirectorDesk.normalizeDirectorDeskDestination(value);
  }

  function normalizeDirectorShotPack(value) {
    return window.FutureAIDirectorDesk.normalizeDirectorShotPack(value);
  }

  function directorShotPackPrompt(pack, fallback) {
    return window.FutureAIDirectorDesk.directorShotPackPrompt(pack, fallback);
  }

  function directorShotPackTitle(pack, fallback, index) {
    return window.FutureAIDirectorDesk.directorShotPackTitle(pack, fallback, index);
  }

  function directorShotPackVideoPrompt(pack, imagePrompt) {
    return window.FutureAIDirectorDesk.directorShotPackVideoPrompt(pack, imagePrompt);
  }

  function normalizeDirectorDeskCaptures(payload) {
    return window.FutureAIDirectorDesk.normalizeDirectorDeskCaptures(payload);
  }

  function directorDeskCaptureBaseName(fileName, index) {
    return window.FutureAIDirectorDesk.directorDeskCaptureBaseName(fileName, index);
  }

  async function persistDirectorDeskCaptures(captures) {
    const stamp = Date.now();
    const persisted = [];
    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const title = directorDeskCaptureBaseName(capture.fileName, i);
      const url = await persistMediaUrl(capture.dataUrl, `director_desk_${stamp}_${i + 1}`, 'png');
      persisted.push({...capture, title, url});
    }
    return persisted;
  }

  async function handleDirectorDeskCapturesSent(payload = {}) {
    const destination = normalizeDirectorDeskDestination(payload?.destination);
    const captures = normalizeDirectorDeskCaptures(payload);
    if (!captures.length) return toast('导演台没有可发送的截图', 'warn');
    const persisted = await persistDirectorDeskCaptures(captures);
    if (destination === 'assistant') {
      sendDirectorDeskCapturesToAssistant(persisted);
      return;
    }
    if (destination === 'short') {
      sendDirectorDeskCapturesToShortWorkbench(persisted);
      return;
    }
    if (destination === 'shot-pack') {
      sendDirectorDeskCapturesToCanvas(persisted, {close: false, toast: false});
      sendDirectorDeskCapturesToShortWorkbench(persisted, {close: false, toast: false, jump: 'storyboard'});
      closeDirectorDesk();
      toast(`已发送 ${persisted.length} 个导演台${persisted.length > 1 ? '镜头清单' : '镜头包'}到无限画布和漫剧分镜`, 'success');
      return;
    }
    sendDirectorDeskCapturesToCanvas(persisted);
  }

  function sendDirectorDeskCapturesToCanvas(captures, options = {}) {
    const close = options.close !== false;
    const showToast = options.toast !== false;
    setActiveWorkspace('canvas');
    const c = viewCenter();
    const sequential = captures.length > 1 && captures.every(capture => Number(capture.shotPack?.shotIndex) > 0);
    captures.forEach((capture, index) => {
      const col = sequential ? index : index % 3;
      const row = sequential ? 0 : Math.floor(index / 3);
      const pack = capture.shotPack;
      const prompt = directorShotPackPrompt(pack, '3D 导演台相机截图参考，可用于关键帧、分镜或图生图。');
      const title = directorShotPackTitle(pack, capture.title, index);
      const x = c.x - 300 + col * 420;
      const y = c.y - 210 + row * 360;
      const promptNode = addNode('prompt', x - 280, y + 40, {
        title: title + ' · 提示词',
        prompt,
        tags: ['导演台', '镜头包']
      }, null, false);
      const imageNode = addNode('image', x, y, {
        title,
        prompt,
        model: FutureAIApiDefaults.get('imageModel') || '',
        size: '1280x720',
        resolution: '1K',
        url: capture.url,
        urls: [capture.url],
        refUrl: capture.url,
        tags: ['导演台', '镜头包', '截图参考']
      }, null, false);
      if (promptNode?.id && imageNode?.id) connect(promptNode.id, 'text', imageNode.id, 'prompt');
    });
    saveProject();
    drawEdges();
    requestAnimationFrame(drawEdges);
    if (close) closeDirectorDesk();
    if (showToast) toast(`已发送 ${captures.length} 个导演台镜头包到无限画布`, 'success');
  }

  function sendDirectorDeskCapturesToAssistant(captures) {
    dialogEditAttachments = [
      ...captures.map(capture => ({name: capture.title, url: capture.url, mime: 'image/png', kind: 'image'})),
      ...dialogEditAttachments
    ].filter(item => item?.url).slice(0, 6);
    const packPrompt = captures.map(capture => directorShotPackPrompt(capture.shotPack, '')).find(Boolean);
    if (packPrompt && Array.isArray(chatMessages)) {
      chatMessages.push({role: 'user', content: packPrompt});
    }
    dialogEditActive = true;
    assistantActiveTab = 'dialog';
    setActiveWorkspace('assistant');
    saveProject();
    renderAssistantWorkspace();
    closeDirectorDesk();
    toast(`已发送 ${captures.length} 张导演台镜头包到∞ 灵枢万象`, 'success');
  }

  function sendDirectorDeskCapturesToShortWorkbench(captures, options = {}) {
    const close = options.close !== false;
    const showToast = options.toast !== false;
    const jump = options.jump || 'storyboard';
    const stamp = Date.now();
    shortAssetItems = [
      ...captures.map((capture, index) => ({
        type: '导演台镜头包',
        name: directorShotPackTitle(capture.shotPack, capture.title, index),
        prompt: directorShotPackPrompt(capture.shotPack, '3D 导演台相机截图，可作为角色、场景、镜头、关键帧或图生图参考。'),
        url: capture.url,
        status: '来自 3D 导演台镜头包',
        version: 1,
        locked: false
      })),
      ...shortAssetItems
    ];
    const shots = captures.map((capture, index) => {
      const pack = capture.shotPack;
      const title = directorShotPackTitle(pack, capture.title, index);
      const imagePrompt = directorShotPackPrompt(pack, `${title}，电影感构图，角色一致`);
      const action = pack?.legend
        ? `${pack.camera?.shotSize || '中景'}，${pack.camera?.angle || '平视'}。${pack.legend}。${pack.characters?.map(item => item.pose ? `${item.name}${item.pose}` : item.name).filter(Boolean).join('，') || ''}`.trim()
        : imagePrompt.split('\n')[0];
      return {
        id: 'shot_desk_' + stamp + '_' + index,
        episode: 1,
        title,
        scene: pack?.camera?.motionLabel ? `运镜：${pack.camera.motionLabel}` : '导演台预演镜头',
        action,
        imagePrompt,
        videoPrompt: directorShotPackVideoPrompt(pack, imagePrompt),
        duration: '5',
        firstFrameUrl: capture.url,
        videoUrl: '',
        status: '来自 3D 导演台镜头包',
        reviewStatus: 'draft',
        qcStatus: '',
        referenceAssetIds: []
      };
    });
    shortStoryboardItems = [...shortStoryboardItems, ...shots];
    setActiveWorkspace('short');
    renderShortWorkbench();
    jumpShortSection(jump, false);
    saveProject();
    if (close) closeDirectorDesk();
    if (showToast) toast(`已发送 ${captures.length} 个导演台镜头包到漫剧分镜`, 'success');
  }

  function filteredCommandPaletteActions() {
    return window.FutureAICommandPalette.filterActions(commandPaletteActions(), $('commandPaletteInput')?.value || '');
  }

  function renderCommandPalette() {
    const list = $('commandPaletteList');
    if (!list) return;
    const actions = filteredCommandPaletteActions();
    commandPaletteActiveIndex = actions.length ? Math.max(0, Math.min(commandPaletteActiveIndex, actions.length - 1)) : 0;
    list.innerHTML = actions.length ? actions.map((item, index) => `
      <button class="${index === commandPaletteActiveIndex ? 'active' : ''}" data-command="${esc(item.id)}" type="button" role="option" aria-selected="${index === commandPaletteActiveIndex}">
        <i class="fa-solid ${esc(item.icon)}"></i>
        <span><strong>${esc(item.title)}</strong><small>${esc(item.hint)}</small></span>
      </button>`).join('') : '<div class="command-empty">没有匹配的命令</div>';
    list.setAttribute('role', 'listbox');
    const active = list.querySelector('[data-command].active');
    const input = $('commandPaletteInput');
    if (active && input) input.setAttribute('aria-activedescendant', active.id);
    else input?.removeAttribute('aria-activedescendant');
  }

  function runCommandPaletteAction(id) {
    const action = commandPaletteActions().find(item => item.id === id);
    if (!action) return;
    closeCommandPalette();
    action.run();
  }

  function onCommandPaletteClick(e) {
    if (e.target === $('commandPalette')) return closeCommandPalette();
    const btn = e.target.closest('[data-command]');
    if (btn) runCommandPaletteAction(btn.dataset.command);
  }

  function onCommandPaletteKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeCommandPalette();
      return;
    }
    const actions = filteredCommandPaletteActions();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      if (!actions.length) return;
      if (e.key === 'Home') commandPaletteActiveIndex = 0;
      else if (e.key === 'End') commandPaletteActiveIndex = actions.length - 1;
      else commandPaletteActiveIndex = (commandPaletteActiveIndex + (e.key === 'ArrowDown' ? 1 : -1) + actions.length) % actions.length;
      renderCommandPalette();
      $('commandPaletteList')?.querySelector('[data-command].active')?.scrollIntoView({block: 'nearest'});
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const selected = actions[commandPaletteActiveIndex];
      if (selected) runCommandPaletteAction(selected.id);
    }
  }

  function renderAssistantWorkspace(...args) { return assistantChrome()?.renderAssistantWorkspace?.(...args); }
  function renderAssistantChrome(...args) { return assistantChrome()?.renderAssistantChrome?.(...args); }
  function renderCodexDesktopContext(...args) { return assistantChrome()?.renderCodexDesktopContext?.(...args); }
  function agentProjectSummary(...args) { return assistantChrome()?.agentProjectSummary?.(...args); }
  function renderAgentConsole(...args) { return assistantChrome()?.renderAgentConsole?.(...args); }
  function appendAgentMessage(...args) { return assistantChrome()?.appendAgentMessage?.(...args); }
  function appendCodexOutput(...args) { return assistantChrome()?.appendCodexOutput?.(...args); }
  function codexFailureMessage(...args) { return assistantChrome()?.codexFailureMessage?.(...args); }
  function installCodexOutputHandler(...args) { return assistantChrome()?.installCodexOutputHandler?.(...args); }
  async function runCodexConsoleAction(...args) { return assistantChrome()?.runCodexConsoleAction?.(...args); }
  async function refreshCodexCli(...args) { return assistantChrome()?.refreshCodexCli?.(...args); }
  async function chooseCodexCommand(...args) { return assistantChrome()?.chooseCodexCommand?.(...args); }
  async function codexApiConfig(...args) { return assistantChrome()?.codexApiConfig?.(...args); }
  function agentProjectDiagnosisText(...args) { return assistantChrome()?.agentProjectDiagnosisText?.(...args); }
  function agentNextPlanText(...args) { return assistantChrome()?.agentNextPlanText?.(...args); }
  async function runAgentConsoleAction(...args) { return assistantChrome()?.runAgentConsoleAction?.(...args); }
  async function onAssistantWorkbenchClick(...args) { return assistantChrome()?.onAssistantWorkbenchClick?.(...args); }
  async function onAssistantWorkbenchDoubleClick(...args) { return assistantChrome()?.onAssistantWorkbenchDoubleClick?.(...args); }
  function createAssistantTopic(...args) { return assistantChrome()?.createAssistantTopic?.(...args); }
  function ensureDialogComposerEditable(...args) { return assistantChrome()?.ensureDialogComposerEditable?.(...args); }
  function focusDialogComposer(...args) { return assistantChrome()?.focusDialogComposer?.(...args); }
  async function renameAssistantTopic(...args) { return assistantChrome()?.renameAssistantTopic?.(...args); }
  function deleteAssistantProfile(...args) { return assistantChrome()?.deleteAssistantProfile?.(...args); }
  function deleteAssistantTopic(...args) { return assistantChrome()?.deleteAssistantTopic?.(...args); }
  function clearCurrentDialogConversation(...args) { return assistantChrome()?.clearCurrentDialogConversation?.(...args); }
  function renderAssistantProfileSettings(...args) { return assistantChrome()?.renderAssistantProfileSettings?.(...args); }
  function profileFromSettingsModal(...args) { return assistantChrome()?.profileFromSettingsModal?.(...args); }
  function installedSkillCatalog(...args) { return assistantChrome()?.installedSkillCatalog?.(...args); }
  function syncInstalledSkillCatalog(...args) { return assistantChrome()?.syncInstalledSkillCatalog?.(...args); }
  async function loadSharedCodexExtensions(...args) { return assistantChrome()?.loadSharedCodexExtensions?.(...args); }
  function saveInstalledSkillCatalog(...args) { return assistantChrome()?.saveInstalledSkillCatalog?.(...args); }
  function normalizeDownloadedSkill(...args) { return assistantChrome()?.normalizeDownloadedSkill?.(...args); }
  function installMarketSkill(...args) { return assistantChrome()?.installMarketSkill?.(...args); }
  function uninstallMarketSkill(...args) { return assistantChrome()?.uninstallMarketSkill?.(...args); }
  async function searchSkillMarket(...args) { return assistantChrome()?.searchSkillMarket?.(...args); }
  function assistantSkillLibraryHtml(...args) { return assistantChrome()?.assistantSkillLibraryHtml?.(...args); }
  function toggleAssistantSkill(...args) { return assistantChrome()?.toggleAssistantSkill?.(...args); }
  function openAssistantSkillLibrary(...args) { return assistantChrome()?.openAssistantSkillLibrary?.(...args); }
  function closeAssistantSkillLibrary(...args) { return assistantChrome()?.closeAssistantSkillLibrary?.(...args); }
  function renderAssistantSkillLibraryModal(...args) { return assistantChrome()?.renderAssistantSkillLibraryModal?.(...args); }
  function assistantProfileListHtml(...args) { return assistantChrome()?.assistantProfileListHtml?.(...args); }
  function assistantTopicRailHtml(...args) { return assistantChrome()?.assistantTopicRailHtml?.(...args); }
  function assistantUnfiledTaskHtml(...args) { return assistantChrome()?.assistantUnfiledTaskHtml?.(...args); }
  function normalizeCodexSchedules(...args) { return assistantChrome()?.normalizeCodexSchedules?.(...args); }
  function formatCodexScheduleTime(...args) { return assistantChrome()?.formatCodexScheduleTime?.(...args); }
  function datetimeLocalValue(...args) { return assistantChrome()?.datetimeLocalValue?.(...args); }
  function renderCodexScheduleWorkspace(...args) { return assistantChrome()?.renderCodexScheduleWorkspace?.(...args); }
  function renderCodexPluginWorkspace(...args) { return assistantChrome()?.renderCodexPluginWorkspace?.(...args); }
  function renderCodexSkillWorkspace(...args) { return assistantChrome()?.renderCodexSkillWorkspace?.(...args); }
  function switchCodexProject(...args) { return assistantChrome()?.switchCodexProject?.(...args); }
  async function handleCodexScheduleAction(...args) { return assistantChrome()?.handleCodexScheduleAction?.(...args); }
  function startCodexScheduleTimer(...args) { return assistantChrome()?.startCodexScheduleTimer?.(...args); }
  async function checkDueCodexSchedules(...args) { return assistantChrome()?.checkDueCodexSchedules?.(...args); }
  async function runCodexSchedule(...args) { return assistantChrome()?.runCodexSchedule?.(...args); }
  function openCodexSettings(...args) { return assistantChrome()?.openCodexSettings?.(...args); }
  function blankDialogTopicState(...args) { return assistantChrome()?.blankDialogTopicState?.(...args); }
  function dialogTopicState(...args) { return assistantChrome()?.dialogTopicState?.(...args); }
  function activePromptTopic(...args) { return assistantChrome()?.activePromptTopic?.(...args); }
  function saveActiveTopicDialogState(...args) { return assistantChrome()?.saveActiveTopicDialogState?.(...args); }
  function loadActiveTopicDialogState(...args) { return assistantChrome()?.loadActiveTopicDialogState?.(...args); }


  function movePanelsIntoSettings() {
    const card = document.querySelector('#settingsDrawer .settings-card');
    const apiPane = document.querySelector('#settingsDrawer [data-settings-pane="api"]');
    const storagePane = document.querySelector('#settingsDrawer [data-settings-pane="storage"]');
    if (!card || card.dataset.movedPanels === '1') return;
    document.querySelectorAll('.sidebar .side-section').forEach(section => {
      if (section.querySelector('#openSettings')) return;
      if (section.querySelector('#sideProjects') && storagePane) storagePane.appendChild(section);
      else if (section.querySelector('#imageModelSelect') && apiPane) apiPane.appendChild(section);
      else (apiPane || card).appendChild(section);
    });
    card.dataset.movedPanels = '1';
  }

  function applyFastCanvasMode() {
    document.body.classList.toggle('fast-canvas-mode', fastCanvasMode);
    const btn = $('fastCanvasBtn');
    if (!btn) return;
    btn.classList.toggle('active', fastCanvasMode);
    btn.setAttribute('aria-pressed', fastCanvasMode ? 'true' : 'false');
    btn.title = fastCanvasMode ? '极速画布已开启：拖动和缩放更流畅' : '极速画布已关闭：始终显示完整画面';
  }
  function isCanvasSearchOpen() {
    return !$('canvasSearchPopover')?.classList.contains('hidden');
  }
  function openCanvasSearch() {
    const popover = $('canvasSearchPopover');
    if (!popover) return;
    toggleShortcutHelp(false);
    popover.classList.remove('hidden');
    $('canvasSearchBtn')?.setAttribute('aria-expanded', 'true');
    requestAnimationFrame(() => {
      const input = $('canvasSearchInput');
      input?.focus();
      input?.select();
    });
  }
  function closeCanvasSearch(restoreFocus = true) {
    const popover = $('canvasSearchPopover');
    if (!popover || popover.classList.contains('hidden')) return;
    const hadFocus = popover.contains(document.activeElement);
    popover.classList.add('hidden');
    $('canvasSearchBtn')?.setAttribute('aria-expanded', 'false');
    if (restoreFocus && hadFocus) $('canvasSearchBtn')?.focus();
  }
  function installCanvasMinimap() {
    canvasMinimap = window.FutureAICanvasMinimap?.create({
      panel: $('canvasMinimap'),
      canvas: $('canvasMinimapCanvas'),
      observeTarget: $('viewport'),
      nodeSize,
      isSelected: id => selectedNodes.has(id),
      getView: () => ({nodes, scale, offsetX, offsetY, canvasRect: $('canvas').getBoundingClientRect()}),
      setViewCenter: (worldX, worldY) => {
        const rect = $('canvas').getBoundingClientRect();
        offsetX = rect.width / 2 - worldX * scale;
        offsetY = rect.height / 2 - worldY * scale;
        setCanvasProxyActive(true);
        scheduleTransform(false, false);
        scheduleViewportInteractionEnd();
      }
    }) || null;
    applyCanvasMinimap();
  }
  function applyCanvasMinimap() {
    canvasMinimap?.setEnabled(canvasMinimapEnabled);
    const btn = $('toggleMinimapBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', canvasMinimapEnabled ? 'true' : 'false');
    btn.title = canvasMinimapEnabled ? '隐藏缩略地图' : '显示缩略地图';
  }
  function toggleCanvasMinimap() {
    canvasMinimapEnabled = !canvasMinimapEnabled;
    localStorage.setItem('futureai.canvasMinimap', canvasMinimapEnabled ? 'on' : 'off');
    applyCanvasMinimap();
  }
  function toggleFastCanvasMode() {
    fastCanvasMode = !fastCanvasMode;
    localStorage.setItem('futureai.fastCanvasMode', fastCanvasMode ? 'on' : 'off');
    applyFastCanvasMode();
    if (!fastCanvasMode) setCanvasProxyActive(false);
    toast(fastCanvasMode ? '极速画布已开启' : '极速画布已关闭', fastCanvasMode ? 'success' : 'warn');
  }


  function releaseDrags(commit) {
    const wasDragging = !!dragging;
    if (dragging && dragPoint) flushNodeDrag();
    if (dragFrame) {
      cancelAnimationFrame(dragFrame);
      dragFrame = null;
    }
    if (edgeThrottleTimer) {
      clearTimeout(edgeThrottleTimer);
      edgeThrottleTimer = null;
    }
    dragPoint = null;
    renderSnapGuides([]);
    if (commit && (panning || dragging)) saveProject();
    panning = null;
    dragging = null;
    mascotDrag = null;
    $('canvas')?.classList.remove('is-panning', 'is-zooming', 'is-dragging-node');
    setCanvasProxyActive(false);
    if (wasDragging) drawEdges();
    document.body.style.cursor = '';
    updateSelectionToolbar();
    revealSelectedNode();
    scheduleVisibilityUpdate();
  }

  function updateNodeDrag(clientX, clientY, altKey = false) {
    if (!dragging) return;
    $('canvas')?.classList.add('is-dragging-node');
    dragPoint = {clientX, clientY, altKey};
    if (dragFrame) return;
    dragFrame = requestAnimationFrame(flushNodeDrag);
  }

  function flushNodeDrag() {
    dragFrame = null;
    if (!dragging || !dragPoint) return;
    const {clientX, clientY, altKey} = dragPoint;
    dragPoint = null;
    let dx = (clientX - dragging.x) / scale;
    let dy = (clientY - dragging.y) / scale;
    const snap = altKey ? null : nodeDragSnap(dx, dy);
    if (snap) {
      dx += snap.dx;
      dy += snap.dy;
    }
    renderSnapGuides(snap?.guides || []);
    dragging.items.forEach(item => moveNode(item.node, item.startX + dx, item.startY + dy));
    scheduleDrawEdges();
    scheduleGroupRender();
  }

  function nodeWorldRect(node, x = node.x, y = node.y) {
    const size = nodeSize(node);
    return {id: node.id, x, y, w: size.width, h: size.height};
  }
  // Edge/centre snapping of the dragged selection to visible nodes; targets are measured once per drag.
  function nodeDragSnap(dx, dy) {
    if (!CanvasArrange || !dragging.items.length) return null;
    if (!dragging.snap) {
      const moving = new Set(dragging.items.map(item => item.node.id));
      dragging.snap = {
        start: CanvasArrange.bounds(dragging.items.map(item => nodeWorldRect(item.node, item.startX, item.startY))),
        targets: [...nodes.values()].filter(node => !moving.has(node.id) && node.el.offsetParent).map(node => nodeWorldRect(node))
      };
    }
    const {start, targets} = dragging.snap;
    if (!targets.length) return null;
    return CanvasArrange.snapMove({x: start.x + dx, y: start.y + dy, w: start.w, h: start.h}, targets, 6 / scale);
  }
  function renderSnapGuides(guides) {
    let layer = $('snapGuides');
    if (!guides.length) {
      if (layer) layer.innerHTML = '';
      return;
    }
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'snapGuides';
      layer.className = 'snap-guides';
      $('viewport').appendChild(layer);
    }
    layer.innerHTML = guides.map(guide => guide.axis === 'x'
      ? `<i class="snap-guide x" style="left:${guide.pos}px;top:${guide.from}px;height:${guide.to - guide.from}px"></i>`
      : `<i class="snap-guide y" style="top:${guide.pos}px;left:${guide.from}px;width:${guide.to - guide.from}px"></i>`).join('');
  }
  // Align / distribute the selected nodes; locked nodes keep their place.
  function arrangeSelection(kind, mode) {
    const rects = [...selectedNodes].map(id => nodes.get(id)).filter(node => node && !node.data.locked).map(node => nodeWorldRect(node));
    if (kind === 'distribute' && rects.length < 3) return toast('等距分布需要至少 3 个未锁定的节点', 'warn');
    if (rects.length < 2) return toast('请先选中至少 2 个未锁定的节点', 'warn');
    const placed = kind === 'distribute' ? CanvasArrange.distributeRects(rects, mode) : CanvasArrange.alignRects(rects, mode);
    placed.forEach(item => {
      const node = nodes.get(item.id);
      if (node) moveNode(node, item.x, item.y);
    });
    drawEdges();
    scheduleGroupRender();
    updateSelectionToolbar();
    saveProject();
  }

  function safeReleasePointerCapture(el, pointerId) {
    try {
      if (pointerId != null && el?.releasePointerCapture && (!el.hasPointerCapture || el.hasPointerCapture(pointerId))) {
        el.releasePointerCapture(pointerId);
      }
    } catch (err) {}
  }

  function restoreCanvasInteractivity() {
    panning = null;
    dragging = null;
    selecting = null;
    linkDrag = null;
    selectedPort = null;
    mascotDrag = null;
    document.body.style.cursor = '';
    $('selectionBox')?.classList.add('hidden');
    document.querySelectorAll('.port.selected').forEach(port => port.classList.remove('selected'));
    closeFloatingCanvasUi();
    $('canvas')?.classList.remove('drag-over');
    $('directorDeskModal')?.classList.add('hidden');
    $('directorDeskFrame') && ($('directorDeskFrame').style.pointerEvents = 'none');
    drawEdges();
    requestAnimationFrame(() => {
      drawEdges();
      scheduleVisibilityUpdate();
    });
  }

  function closeFloatingCanvasUi() {
    closeNodeContextMenu();
    closeNodeTypeMenu();
    toggleShortcutHelp(false);
    closeFabricEditor();
    closeCropperEditor();
  }
  function isCanvasOverlayTarget(target) {
    return !!target.closest('.balance-popover,.history-drawer,.queue-drawer,.canvas-rail,.bottom-canvas-tools,.zoom-control,.canvas-tidy-btn,.selection-toolbar,.topbar,.workflow-bar,.mascot-button,.mascot-switch,.chat-preview,.chat-panel,.settings-drawer,.command-palette,.modal,.image-modal,.fabric-editor-modal,.cropper-modal,.local-edit-modal,.batch-variants-modal,.camera-modal');
  }
  function trapVisibleDialogFocus(e) {
    if (e.key !== 'Tab') return false;
    const dialogs = [...document.querySelectorAll('[role="dialog"]:not(.hidden),.command-palette:not(.hidden)')];
    const dialog = dialogs.at(-1);
    if (!dialog) return false;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])')]
      .filter(element => element.offsetParent !== null && !element.closest('.hidden'));
    if (!focusable.length) return false;
    const current = focusable.indexOf(document.activeElement);
    const next = e.shiftKey
      ? (current <= 0 ? focusable.at(-1) : focusable[current - 1])
      : (current < 0 || current === focusable.length - 1 ? focusable[0] : focusable[current + 1]);
    e.preventDefault();
    next.focus();
    return true;
  }
  function handleGlobalKeydown(e) {
    if (trapVisibleDialogFocus(e)) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && String(e.key || '').toLowerCase() === 'f'
      && activeWorkspace === 'canvas' && !$('appShell')?.classList.contains('hidden')
      && !e.target.closest?.('[role="dialog"],.command-palette')) {
      e.preventDefault();
      openCanvasSearch();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !isEditableTarget(e.target) && !e.target.closest?.('[role="dialog"],.command-palette')) {
      const key = String(e.key || '').toLowerCase();
      if (key === 'd' && selectedNodes.size && canvasShortcutTarget(e)) {
        e.preventDefault();
        duplicateNodes([...selectedNodes]);
        return;
      }
      if (key === 'g' && canvasShortcutTarget(e)) {
        e.preventDefault();
        return e.shiftKey ? ungroupSelectedNodes() : groupSelectedNodes();
      }
      if (key === 'z') {
        e.preventDefault();
        return e.shiftKey ? redoProject() : undoProject();
      }
      if (key === 'y') {
        e.preventDefault();
        return redoProject();
      }
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey && canvasShortcutTarget(e)) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodes.size) {
        e.preventDefault();
        return deleteSelectedNodes();
      }
      if (e.shiftKey && e.code === 'Digit1') {
        e.preventDefault();
        return fitView(true);
      }
      if (e.key === '?') {
        e.preventDefault();
        return toggleShortcutHelp();
      }
    }
    if (e.key === 'Escape') {
      if (!$('shortcutHelp')?.classList.contains('hidden')) {
        toggleShortcutHelp(false);
        return;
      }
      if (isCanvasSearchOpen()) {
        closeCanvasSearch();
        return;
      }
      if (!$('imageModal')?.classList.contains('hidden')) {
        closeImageModal();
        return;
      }
      closeDirectorDesk();
      if (!$('modal')?.classList.contains('hidden')) closeModal(null);
      closeCommandPalette();
      closeImageModal();
      closeFabricEditor();
      closeCropperEditor();
      closeCameraModal();
      closeNodeContextMenu();
      closeNodeTypeMenu();
      closeTextEditor();
      closeSettings();
      closeHistory();
      closeAssetLibrary();
      closeQueueDrawer();
      closeWorkflowLibrary();
      $('chatPanel')?.classList.add('hidden');
      return;
    }
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'a' && !isEditableTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      window.getSelection?.().removeAllRanges();
      if (!$('appShell')?.classList.contains('hidden')) {
        selectAllCanvasNodes();
      }
    }
  }
  function isEditableTarget(target) {
    return !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
  }
  // Single-key canvas shortcuts: only on the visible canvas, never while typing or inside a dialog.
  function canvasShortcutTarget(e) {
    return activeWorkspace === 'canvas' && !$('appShell')?.classList.contains('hidden')
      && !isEditableTarget(e.target) && !e.target.closest?.('[role="dialog"]:not(.shortcut-help),.command-palette')
      && $('modal')?.classList.contains('hidden') !== false;
  }
  function toggleShortcutHelp(show) {
    const help = $('shortcutHelp');
    if (!help) return;
    const open = show ?? help.classList.contains('hidden');
    if (open === !help.classList.contains('hidden')) return;
    if (open) closeCanvasSearch(false);
    help.classList.toggle('hidden', !open);
    $('shortcutHelpBtn')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function selectionIsDialogContent(selection) {
    const elementForNode = node => node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return [selection?.anchorNode, selection?.focusNode].some(node =>
      elementForNode(node)?.closest?.('.dialog-msg-text,.codex-message-content,.codex-code-block,.dialog-thread')
    );
  }
  function clearAccidentalPageSelection() {
    if (isEditableTarget(document.activeElement)) return;
    const sel = window.getSelection?.();
    if (selectionIsDialogContent(sel)) return;
    if (sel && !sel.isCollapsed) sel.removeAllRanges();
  }

  function updateSelectionBox() {
    const box = $('selectionBox');
    if (!selecting) return box.classList.add('hidden');
    const canvasRect = $('canvas').getBoundingClientRect();
    const left = Math.min(selecting.startX, selecting.x) - canvasRect.left;
    const top = Math.min(selecting.startY, selecting.y) - canvasRect.top;
    const width = Math.abs(selecting.x - selecting.startX);
    const height = Math.abs(selecting.y - selecting.startY);
    box.style.left = left + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
    box.style.height = height + 'px';
    box.classList.toggle('hidden', !selecting.moved);
  }
  function finishSelection(additive) {
    const box = $('selectionBox');
    if (!selecting.moved) {
      if (!additive) clearSelection();
      selecting = null;
      box.classList.add('hidden');
      return;
    }
    const selRect = {
      left: Math.min(selecting.startX, selecting.x),
      right: Math.max(selecting.startX, selecting.x),
      top: Math.min(selecting.startY, selecting.y),
      bottom: Math.max(selecting.startY, selecting.y)
    };
    if (!additive) selectedNodes.clear();
    nodes.forEach(node => {
      const r = node.el.getBoundingClientRect();
      const hit = r.left < selRect.right && r.right > selRect.left && r.top < selRect.bottom && r.bottom > selRect.top;
      if (hit) selectedNodes.add(node.id);
    });
    selecting = null;
    box.classList.add('hidden');
    renderSelection();
    toast('已选中 ' + selectedNodes.size + ' 个节点', selectedNodes.size ? 'success' : 'warn');
  }

  function isCanvasMenuBlockedTarget(target) {
    return !!target?.closest?.('.balance-popover,.canvas-rail,.bottom-canvas-tools,.canvas-tidy-btn,.history-drawer,.asset-library,.queue-drawer,.music-workbench,.assistant-workbench,.short-workbench,.topbar,.workflow-bar,.zoom-control,.selection-toolbar,.settings-drawer,.command-palette,.modal,.image-modal,.fabric-editor-modal,.cropper-modal,.local-edit-modal,.batch-variants-modal,.camera-modal,.chat-panel,.chat-preview,.mascot-button,.mascot-switch');
  }

  // Small floating menu of buttons at a screen point; onPick receives the clicked button's data-* values.
  function openCanvasMenu(clientX, clientY, html, onPick, extraClass = '') {
    closeNodeTypeMenu();
    closeNodeContextMenu();
    const menu = document.createElement('div');
    menu.className = ('node-type-menu ' + extraClass).trim();
    menu.setAttribute('role', 'menu');
    menu.innerHTML = html;
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(12, Math.min(clientX, window.innerWidth - r.width - 12)) + 'px';
    menu.style.top = Math.max(12, Math.min(clientY, window.innerHeight - r.height - 12)) + 'px';
    menu.onclick = e => {
      const btn = e.target.closest('button');
      if (!btn) return;
      closeNodeTypeMenu();
      onPick({...btn.dataset});
    };
    nodeTypeMenuCloser = e => {
      if (!menu.contains(e.target)) closeNodeTypeMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', nodeTypeMenuCloser), 0);
    return menu;
  }
  function showNodeTypeMenu(clientX, clientY) {
    const html = `
      <button data-type="prompt"><i class="fa-solid fa-note-sticky"></i>提示词</button>
      <button data-type="upload"><i class="fa-solid fa-upload"></i>上传节点</button>
      <button data-type="character"><i class="fa-solid fa-user-astronaut"></i>角色卡</button>
      <button data-type="image"><i class="fa-solid fa-image"></i>图片节点</button>
      <button data-type="video"><i class="fa-solid fa-video"></i>视频节点</button>
      <button data-type="comfyui"><i class="fa-solid fa-diagram-project"></i>ComfyUI</button>
      <button data-action="storyboard"><i class="fa-solid fa-table-cells-large"></i>分镜组</button>
      <button data-action="script"><i class="fa-solid fa-scroll"></i>脚本节点</button>
      <button data-action="grid"><i class="fa-solid fa-clapperboard"></i>分镜格子</button>
      <button data-action="template"><i class="fa-solid fa-boxes-stacked"></i>插入模板</button>`;
    openCanvasMenu(clientX, clientY, html, picked => {
      const pos = screenToWorld(clientX, clientY);
      if (picked.action === 'storyboard') {
        addStoryboardAt(pos.x, pos.y);
      } else if (picked.action === 'script') {
        addNode('prompt', pos.x - 160, pos.y - 80, {title: '脚本节点', prompt: '脚本：镜头目标、角色动作、旁白/对白、画面调度、情绪节奏。'});
      } else if (picked.action === 'grid') {
        addNode('prompt', pos.x - 160, pos.y - 80, {title: '分镜格子', prompt: '分镜格子：画面编号 / 景别 / 主体动作 / 场景 / 镜头运动 / 画面连续性。'});
      } else if (picked.action === 'template') {
        openTemplateGallery({mode: 'insert', at: pos});
      } else if (picked.type) {
        const wide = ['image', 'video', 'comfyui'].includes(picked.type);
        addNode(picked.type, pos.x - (wide ? 260 : 160), pos.y - 80);
      }
    });
  }
  function goProjectCenter() {
    closeFloatingCanvasUi();
    closeTextEditor();
    closeImageModal();
    closeFabricEditor();
    closeCropperEditor();
    closeSettings();
    saveProject();
    showHome();
    toast('已返回项目中心', 'success');
  }
  function closeNodeTypeMenu() {
    if (nodeTypeMenuCloser) document.removeEventListener('mousedown', nodeTypeMenuCloser);
    nodeTypeMenuCloser = null;
    document.querySelector('.node-type-menu')?.remove();
  }
  // Right-click menu for every node type. With several nodes selected, the common actions apply to all of them.
  function showNodeContextMenu(node, clientX, clientY) {
    if (!node) return;
    closeNodeContextMenu();
    closeNodeTypeMenu();
    if (!selectedNodes.has(node.id)) selectSingleNode(node.id);
    const ids = selectedNodes.has(node.id) ? [...selectedNodes] : [node.id];
    const menu = document.createElement('div');
    menu.className = 'node-context-menu';
    menu.dataset.node = node.id;
    menu.setAttribute('role', 'menu');
    const single = ids.length === 1;
    menu.innerHTML = (single && node.type === 'image' ? imageContextMenuHtml() : '')
      + (single && node.type === 'video' ? videoContextMenuHtml() : '')
      + commonContextMenuHtml(ids);
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(12, Math.min(clientX, window.innerWidth - r.width - 12)) + 'px';
    menu.style.top = Math.max(12, Math.min(clientY, window.innerHeight - r.height - 12)) + 'px';
    menu.onclick = e => {
      const item = e.target.closest('[data-node-action]');
      if (!item || item.classList.contains('disabled')) return;
      closeNodeContextMenu();
      runNodeContextAction(node, item.dataset.nodeAction, ids);
    };
    nodeContextMenuCloser = e => {
      if (!menu.contains(e.target)) closeNodeContextMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', nodeContextMenuCloser), 0);
  }
  function closeNodeContextMenu() {
    if (nodeContextMenuCloser) document.removeEventListener('mousedown', nodeContextMenuCloser);
    nodeContextMenuCloser = null;
    document.querySelector('.node-context-menu')?.remove();
  }
  function nodeHasDownload(node) {
    return !!node?.data?.url && ['image', 'video', 'upload', 'media-tool'].includes(node.type);
  }
  function commonContextMenuHtml(ids) {
    const list = ids.map(id => nodes.get(id)).filter(Boolean);
    const count = list.length > 1 ? `<em>${list.length} 个</em>` : '';
    const locked = list.length && list.every(item => item.data.locked);
    const grouped = list.some(item => [...groups.values()].some(group => group.nodeIds.includes(item.id)));
    const key = text => `<kbd>${text}</kbd>`;
    return `
      <section><span>${list.length > 1 ? '选中的节点' : '节点'}</span>
        <button data-node-action="copy"><i class="fa-regular fa-copy"></i> 复制 ${count || key('Ctrl+D')}</button>
        <button data-node-action="delete"><i class="fa-regular fa-trash-can"></i> 删除 ${count || key('Delete')}</button>
        <button data-node-action="lock"><i class="fa-solid ${locked ? 'fa-lock-open' : 'fa-lock'}"></i> ${locked ? '解锁' : '锁定'}</button>
        <button data-node-action="front"><i class="fa-solid fa-arrow-up-wide-short"></i> 置顶</button>
        <button data-node-action="back"><i class="fa-solid fa-arrow-down-short-wide"></i> 置底</button>
        ${list.some(nodeHasDownload) ? '<button data-node-action="download"><i class="fa-solid fa-download"></i> 下载</button>' : ''}
        ${list.some(nodeHasDownload) ? '<button data-node-action="export-share"><i class="fa-solid fa-share-nodes"></i> 导出分享包</button>' : ''}
        ${list.length > 1 ? `<button data-node-action="group"><i class="fa-regular fa-object-group"></i> 编组 ${key('Ctrl+G')}</button>` : ''}
        ${grouped ? `<button data-node-action="ungroup"><i class="fa-regular fa-object-ungroup"></i> 取消组 ${key('Ctrl+Shift+G')}</button>` : ''}
        <button data-node-action="save-template"><i class="fa-solid fa-floppy-disk"></i> 保存为模板</button>
      </section>`;
  }
  function imageContextMenuHtml() {
    return `
      <section><span>图片操作</span>
        <button data-node-action="region-edit"><i class="fa-solid fa-wand-magic-sparkles"></i> 局部编辑 <em>重绘/扩图/抠图</em></button>
        <button data-node-action="batch-variants"><i class="fa-solid fa-layer-group"></i> 批量与变体 <em>一次出多张</em></button>
        <button data-node-action="pick-continue"><i class="fa-solid fa-check-double"></i> 选用这张继续</button>
        <button data-node-action="crop-image"><i class="fa-solid fa-crop-simple"></i> 快速裁剪 <em>比例</em></button>
        <button data-node-action="fabric-edit"><i class="fa-solid fa-pen-ruler"></i> 编辑图片 <em>高级</em></button>
        <button data-node-action="send-to-director"><i class="fa-solid fa-video"></i> 发送到导演台 <em>背景</em></button>
        <button data-node-action="asset"><i class="fa-solid fa-plus"></i> 加入我的资产 <em>永久</em></button>
        <button data-node-action="assistant"><i class="fa-solid fa-wand-magic-sparkles"></i> 发送到灵感助手</button>
      </section>
      <section><span>引用该节点生成</span>
        <button data-node-action="image-to-image"><i class="fa-solid fa-rotate"></i> 图生图</button>
        <button data-node-action="image-to-video"><i class="fa-solid fa-wand-magic-sparkles"></i> 图生视频</button>
      </section>
      <section><span>智能分析</span>
        <button data-node-action="describe"><i class="fa-regular fa-image"></i> 图片描述</button>
      </section>
      <section><span>生成请求</span>
        <button data-node-action="preview-request"><i class="fa-solid fa-magnifying-glass"></i> 请求预览 <em>将要发送</em></button>
        <button data-node-action="last-request"><i class="fa-solid fa-clock-rotate-left"></i> 上次请求</button>
      </section>
      <section><span>输入节点</span>
        <button data-node-action="grid"><i class="fa-solid fa-chart-simple"></i> 分镜格子</button>
        <button data-node-action="script"><i class="fa-solid fa-chart-simple"></i> 脚本</button>
      </section>`;
  }
  function videoContextMenuHtml() {
    return `
      <section><span>引用该节点生成</span>
        <button data-node-action="cover"><i class="fa-regular fa-image"></i> 截取尾帧</button>
      </section>
      <section><span>输入节点</span>
        <button data-node-action="script"><i class="fa-solid fa-chart-simple"></i> 脚本</button>
      </section>`;
  }
  function renderSelection() {
    let layer = 80;
    nodes.forEach(node => {
      const selected = selectedNodes.has(node.id);
      node.el.classList.toggle('selected-node', selected);
      node.el.style.zIndex = selected ? String(layer++) : CanvasNodes.layerZIndex(node.data);
    });
    // With 2+ nodes selected the shared selection toolbar replaces the per-node toolbars, which would stack and cover group labels.
    $('canvas')?.classList.toggle('multi-selected', selectedNodes.size > 1);
    updateSelectionToolbar();
    revealSelectedNode();
    requestAnimationFrame(drawEdges);
  }
  function clearSelection() {
    selectedNodes.clear();
    renderSelection();
  }
  function updateSelectionToolbar() {
    const toolbar = $('selectionToolbar');
    if (!toolbar) return;
    if (selectedNodes.size < 2) {
      toolbar.classList.add('hidden');
      return;
    }
    const rects = [...selectedNodes].map(id => nodes.get(id)?.el.getBoundingClientRect()).filter(Boolean);
    if (!rects.length) return toolbar.classList.add('hidden');
    const canvasRect = $('canvas').getBoundingClientRect();
    toolbar.classList.remove('hidden');
    const width = toolbar.offsetWidth;
    const height = toolbar.offsetHeight;
    // Group labels count as part of the selection, so the toolbar never covers the label you drag a group by.
    const labels = [...groups.values()]
      .filter(group => group.nodeIds.some(id => selectedNodes.has(id)))
      .map(group => group.el.querySelector('.canvas-group-label')?.getBoundingClientRect())
      .filter(rect => rect?.width);
    const left = Math.min(...rects.map(r => r.left)) - canvasRect.left;
    const top = Math.min(...rects.concat(labels).map(r => r.top)) - canvasRect.top;
    const bottom = Math.max(...rects.map(r => r.bottom)) - canvasRect.top;
    toolbar.style.left = Math.max(12, Math.min(left, canvasRect.width - width - 12)) + 'px';
    // Above the selection when there is room, otherwise just below it; always inside the canvas.
    const above = top - height - 10;
    toolbar.style.top = Math.max(12, Math.min(above >= 12 ? above : bottom + 10, canvasRect.height - height - 12)) + 'px';
  }
  function deleteSelectedNodes() {
    if (!selectedNodes.size) return toast('请先框选节点', 'warn');
    deleteNodes([...selectedNodes]);
  }
  // Deletes in one save (one undo step); locked nodes are kept.
  function deleteNodes(ids) {
    const list = unique(ids).map(id => nodes.get(id)).filter(Boolean);
    const removable = list.filter(node => !node.data.locked);
    if (!removable.length) return toast(list.length ? '节点已锁定，解锁后才能删除' : '没有可删除的节点', 'warn');
    removable.forEach(node => deleteNode(node.id, false));
    drawEdges();
    renderSelection();
    saveProject();
    const kept = list.length - removable.length;
    toast(`已删除 ${removable.length} 个节点${kept ? `，${kept} 个锁定节点未删除` : ''}（Ctrl+Z 可撤销）`, 'success');
  }
  function setNodesLocked(ids, locked) {
    ids.forEach(id => {
      const node = nodes.get(id);
      if (!node) return;
      if (locked) node.data.locked = true;
      else delete node.data.locked;
      hydrateNode(node);
    });
    saveProject();
    toast(locked ? '已锁定：不能拖动或删除' : '已解锁', 'success');
  }
  // 置顶 / 置底: the nodes get a stacking rank just above / below every other node.
  function setNodesLayer(ids, toFront) {
    const ranks = [...nodes.values()].filter(node => !ids.includes(node.id)).map(node => Math.round(Number(node.data.z) || 0));
    const z = toFront ? Math.min(60, Math.max(0, ...ranks) + 1) : Math.max(-7, Math.min(0, ...ranks) - 1);
    ids.forEach(id => {
      const node = nodes.get(id);
      if (node) node.data.z = z;
    });
    renderSelection();
    saveProject();
  }
  // Every image / video / material output of the nodes; several files are staggered so none is dropped.
  function downloadNodes(ids) {
    const jobs = [];
    unique(ids).map(id => nodes.get(id)).filter(nodeHasDownload).forEach(node => {
      const url = node.data.url;
      if (node.type === 'image') (canvasRuntime()?.imagePreviewUrls?.(node) || [url]).filter(Boolean).forEach(src => jobs.push(() => downloadImage(src)));
      else if (node.type === 'video' || isVideoMedia(node.data.mime, url)) jobs.push(() => downloadMedia(url, 'future_video_' + Date.now() + '_' + jobs.length + '.mp4'));
      else jobs.push(() => downloadMedia(url, node.data.name || ''));
    });
    if (!jobs.length) return toast('选中的节点还没有可下载的图片或视频', 'warn');
    jobs.forEach((job, index) => setTimeout(job, index * 250));
  }

  function blankProject(...args) { return projectStore()?.blankProject?.(...args); }
  function loadProjects(...args) { return projectStore()?.loadProjects?.(...args); }
  function migrateLegacyProjects(...args) { return projectStore()?.migrateLegacyProjects?.(...args); }
  function hasMojibake(...args) { return projectStore()?.hasMojibake?.(...args); }
  function defaultPromptFor(...args) { return projectStore()?.defaultPromptFor?.(...args); }
  function ensureAssistantProfiles(...args) { return projectStore()?.ensureAssistantProfiles?.(...args); }
  function activeAssistantProfile(...args) { return projectStore()?.activeAssistantProfile?.(...args); }
  function assistantSystemPrompt(...args) { return projectStore()?.assistantSystemPrompt?.(...args); }
  function validAssistantContextMode(...args) { return projectStore()?.validAssistantContextMode?.(...args); }
  function syncAssistantContextModeControls(...args) { return projectStore()?.syncAssistantContextModeControls?.(...args); }
  function ensurePromptWorkbenchState(...args) { return projectStore()?.ensurePromptWorkbenchState?.(...args); }
  function getActivePromptTopic(...args) { return projectStore()?.getActivePromptTopic?.(...args); }
  function saveProjects(...args) { return projectStore()?.saveProjects?.(...args); }
  function selectedProjectTemplateId(...args) { return projectStore()?.selectedProjectTemplateId?.(...args); }
  function resetAssistantStateForNewProject(...args) { return projectStore()?.resetAssistantStateForNewProject?.(...args); }
  async function createProject(...args) { return projectStore()?.createProject?.(...args); }
  async function createAssistantProject(...args) { return projectStore()?.createAssistantProject?.(...args); }
  function enterProject(...args) {
    const result = projectStore()?.enterProject?.(...args);
    syncCurrentProjectBudgetControl();
    return result;
  }
  function showHome(...args) { return projectStore()?.showHome?.(...args); }
  function showApp(...args) { return projectStore()?.showApp?.(...args); }
  function showStartupScreen(...args) { return projectStore()?.showStartupScreen?.(...args); }
  function openLastProject(...args) { return projectStore()?.openLastProject?.(...args); }
  function onProjectGridClick(...args) { return projectStore()?.onProjectGridClick?.(...args); }
  function onSideProjectClick(...args) { return projectStore()?.onSideProjectClick?.(...args); }
  async function renameProject(...args) { return projectStore()?.renameProject?.(...args); }
  async function deleteProject(...args) { return projectStore()?.deleteProject?.(...args); }
  function serialize(...args) { return projectStore()?.serialize?.(...args); }
  function saveProject(...args) { return projectStore()?.saveProject?.(...args); }
  function queueSave(...args) { return projectStore()?.queueSave?.(...args); }

  function variantWorkbench() {
    if (!variantWorkbenchInstance && VariantWorkbench) {
      variantWorkbenchInstance = VariantWorkbench.create({
        $,
        esc,
        toast,
        safeMediaUrl,
        VariantManager,
        Provenance,
        nodes: () => nodes,
        edges: () => edges,
        selectedNodes: () => selectedNodes,
        nodeTitle: nodeDisplayTitle,
        runImage,
        runVideo,
        saveProject,
        hydrateNode,
        refreshDownstream: refreshDownstreamLinkedInputs,
        openModal,
        openMedia: url => openImageModal(url)
      });
    }
    return variantWorkbenchInstance;
  }

  function openVariantWorkbench(nodeId = '') {
    return variantWorkbench()?.open(nodeId);
  }

  function canvasExecutor() {
    if (!canvasExecutorInstance && CanvasExecutor) {
      canvasExecutorInstance = CanvasExecutor.create({
        $,
        esc,
        toast,
        nodes: () => nodes,
        selectedNodes: () => selectedNodes,
        providers: () => apiProviders,
        imageModel: () => FutureAIApiDefaults.get('imageModel') || globalProviderForKind('image')?.imageModel || '',
        videoModel: () => FutureAIApiDefaults.get('videoModel') || globalProviderForKind('video')?.videoModel || '',
        viewCenter,
        addNode,
        connectSilently,
        addGroup,
        hydrateNode,
        saveProject,
        runImage,
        runVideo,
        openModal,
        planWithChatModel: planCanvasAssistantIntent,
        layoutItems: canvasAssistantLayoutItems,
        moveNodes: moveCanvasAssistantNodes,
        mediaOutputs: canvasAssistantMediaOutputs,
        exportMedia: exportCanvasAssistantMedia,
        generateImageKeepingOriginal,
      exportCanvasSnapshot
      });
    }
    return canvasExecutorInstance;
  }

  // The canvas assistant asks the global chat model only for the intent JSON; without an API it uses keywords.
  async function planCanvasAssistantIntent({system, user}) {
    const provider = globalProviderForKind('chat');
    const apiUrl = provider?.apiUrl || FutureAIApiDefaults.get('apiUrl').trim();
    const model = provider?.chatModel || FutureAIApiDefaults.get('chatModel').trim();
    const apiKey = provider ? await providerApiKey(provider) : '';
    if (!apiUrl || !apiKey || !model) return null;
    const res = await fetchJsonWithRetry(joinApiPath(apiUrl, provider?.chatEndpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
      body: JSON.stringify({model, messages: [{role: 'system', content: applyModelAgnosticTextRules(system, 'json')}, {role: 'user', content: user}], temperature: 0, max_tokens: 200})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || `HTTP ${res.status}`);
    return parseFirstJsonObject(data.choices?.[0]?.message?.content || data.output_text || data.content || '');
  }

  function canvasAssistantLayoutItems(list) {
    const groupOf = new Map();
    groups.forEach(group => group.nodeIds.forEach(id => groupOf.set(id, group.id)));
    return list.map(node => ({
      id: node.id,
      type: node.type,
      title: nodeDisplayTitle(node),
      x: node.x,
      y: node.y,
      ...nodeSize(node),
      seq: Number(String(node.id).replace(/\D+/g, '')) || 0,
      groupId: groupOf.get(node.id) || ''
    }));
  }

  // All moves land in one saveProject(), so the whole arrangement is a single undo step.
  function moveCanvasAssistantNodes(moves) {
    moves.forEach(move => {
      const node = nodes.get(move.id);
      if (node) moveNode(node, move.x, move.y);
    });
    renderGroups();
    drawEdges();
    saveProject();
  }

  function canvasAssistantMediaOutputs(list) {
    const deliveryNodes = list.map(node => BatchExportPayload.prepareNodeForDelivery({id: node.id, type: node.type, data: node.data}));
    return ReviewPackage.buildReviewPayload({nodes: deliveryNodes}).outputs;
  }

  async function exportCanvasAssistantMedia({format, items}) {
    if (!window.exportBridge?.exportMedia) throw new Error('当前环境不支持导出媒体');
    if (!await ensureStorageReady()) return null;
    return await window.exportBridge.exportMedia({storageDir, format, items: items.map(item => ({title: item.title, mediaType: item.mediaType, sourceUrl: item.sourceUrl}))});
  }

  async function exportCanvasSnapshot({scope} = {}) {
    const api = window.FutureAICanvasSnapshot;
    if (!api?.createCanvasSnapshot) throw new Error('画布快照模块不可用');
    if (!await ensureStorageReady()) return null;
    const resolvedScope = scope || (selectedNodes.size ? 'selection' : 'all');
    const snap = api.createCanvasSnapshot({ document });
    const captured = await snap.capture({ nodes, selectedIds: selectedNodes, scope: resolvedScope });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `canvas_snapshot_${resolvedScope}_${stamp}.png`;
    const saved = await persistMediaUrl(captured.dataUrl, fileName.replace(/\.png$/i, ''), 'png');
    return { ok: true, url: saved, fileName, width: captured.width, height: captured.height, nodeCount: captured.nodeCount, scope: captured.scope };
  }

  function openCanvasExecutor() {
    setActiveWorkspace('canvas');
    return canvasExecutor()?.open();
  }

  function agentUi() {
    if (!agentUiInstance && AgentUI) {
      agentUiInstance = AgentUI.create({
        host: {
          get storageDir() { return storageDir; },
          get STORE() { return STORE; },
          get codexCli() { return codexState?.cli || null; },
          get codexState() { return codexState; },
          get agentSessionId() { return agentSessionId; },
          set agentSessionId(v) { agentSessionId = v; },
          get agentRunning() { return agentRunning; },
          set agentRunning(v) { agentRunning = v; },
          get agentStatus() { return agentStatus; },
          set agentStatus(v) { agentStatus = v; },
          get agentOutput() { return agentOutput; },
          set agentOutput(v) { agentOutput = v; }
        },
        $,
        esc,
        toast,
        getStore,
        setStore,
        saveSettings,
        agentApiConfig,
        refreshCodex: () => refreshCodexCli({ force: true }),
        chooseCodex: () => chooseCodexCommand(),
        runCodex: async prompt => runDialogCodexAssistant({ userText: prompt, alreadyRecorded: true }),
        handleCanvasRequest: handleAgentCanvasRequest,
        onAgentProgress: payload => {
          if (!dialogAgentRun) return;
          const label = payload.type === 'tool' ? `智能体 · ${payload.name || '工具'}${payload.status === 'running' || payload.status === 'output' ? ' 执行中' : ''}`
            : payload.type === 'approval' ? `等待你批准：${payload.name || ''}`
            : payload.type === 'plan' ? '智能体已制定计划'
            : payload.status === 'streaming' ? `智能体：${String(payload.text || '').slice(-120)}`
            : payload.status === 'direct' ? '已识别为简单任务，直接执行'
            : payload.status === 'verify' ? '正在自动验证（运行项目测试/检查）'
            : `智能体思考中（第 ${payload.step || 1} 步${payload.model ? ` · ${payload.model}` : ''}）`;
          const detail = payload.diff || payload.output;
          updateDialogRun(dialogAgentRun, label, { transient: payload.status === 'streaming' || payload.status === 'output', ...(detail ? { detail } : {}) });
        },
        onAgentFinished: payload => {
          const fromChat = !!dialogAgentRun;
          if (dialogAgentRun) finishDialogRun(dialogAgentRun);
          dialogAgentRun = null;
          const text = payload?.content
            || (payload?.type === 'error' ? `智能体执行失败：${payload.error || '未知错误'}` : '')
            || (fromChat && payload?.cancelled ? '智能体任务已停止。' : '');
          if (text) pushDialogMessage('assistant', text);
          if (text || fromChat) {
            saveProject();
            renderDialogEditWorkbench();
          }
        }
      });
    }
    return agentUiInstance;
  }

  async function agentApiConfig() {
    ensureApiProviders();
    const provider = globalProviderForKind('chat');
    const baseUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '') || '';
    const model = provider.chatModel || FutureAIApiDefaults.get('chatModel').trim() || '';
    const apiKey = await providerApiKey(provider);
    return { apiKey, baseUrl, model, format: provider.type || provider.protocolMessage || '', providerType: provider.type || '' };
  }

  async function handleAgentCanvasRequest(payload) {
    const text = String(payload.request || '').trim();
    const batch = payload.batch || null;
    if (!text && !batch?.op) throw new Error('画布请求为空');
    const selected = new Set(Array.isArray(payload.selection) ? payload.selection : [...selectedNodes]);
    const executor = canvasExecutor();
    if (!executor) throw new Error('画布助手不可用');
    if (payload.selection?.length) {
      selectedNodes.clear();
      payload.selection.forEach(id => { if (nodes.has(id)) selectedNodes.add(id); });
      renderSelection();
    }
    if (typeof executor.runDirect === 'function') {
      return await executor.runDirect({
        request: text || (batch?.op || ''),
        selection: [...selected],
        batch,
        autoConfirm: true
      });
    }
    const previous = $('canvasAssistantInput')?.value;
    if ($('canvasAssistantInput')) $('canvasAssistantInput').value = text;
    await executor.plan();
    const proposal = executor.getProposal?.();
    if (!proposal) throw new Error('未能生成画布提案');
    await executor.apply();
    if ($('canvasAssistantInput') && previous != null) $('canvasAssistantInput').value = previous;
    return { ok: true, kind: proposal.kind, request: text, selected: [...selected] };
  }
  function loadProject(...args) {
    const result = projectStore()?.loadProject?.(...args);
    syncCurrentProjectBudgetControl();
    scheduleUnsavedMediaSweep(0);
    return result;
  }
  function renderProjectVersionControls(...args) { return projectStore()?.renderProjectVersionControls?.(...args); }
  function undoProject(...args) { return projectStore()?.undoProject?.(...args); }
  function redoProject(...args) { return projectStore()?.redoProject?.(...args); }
  function restoreProjectVersion(...args) { return projectStore()?.restoreProjectVersion?.(...args); }
  function clearCanvas(...args) { return projectStore()?.clearCanvas?.(...args); }
  function createDefaultScene(...args) { return projectStore()?.createDefaultScene?.(...args); }
  function createProjectFromTemplate(...args) { return projectStore()?.createProjectFromTemplate?.(...args); }
  function applyProjectTemplate(...args) { return projectStore()?.applyProjectTemplate?.(...args); }
  function createShortVideoTemplate(...args) { return projectStore()?.createShortVideoTemplate?.(...args); }
  function createCharacterTemplate(...args) { return projectStore()?.createCharacterTemplate?.(...args); }
  function createImageToImageTemplate(...args) { return projectStore()?.createImageToImageTemplate?.(...args); }
  function createComfyUITemplate(...args) { return projectStore()?.createComfyUITemplate?.(...args); }
  function createStoryboardTemplate(...args) { return projectStore()?.createStoryboardTemplate?.(...args); }


  function getSelectedImageNode() {
    const ids = [...selectedNodes];
    for (const id of ids) {
      const node = nodes.get(id);
      if (node?.type === 'image') return node;
    }
    for (const node of nodes.values()) {
      if (node.type === 'image' && node.data?.url) return node;
    }
    return null;
  }

  function dialogEditTargetNode(...args) { return dialogRuntime()?.dialogEditTargetNode?.(...args); }
  function dialogExplicitTargetNode(...args) { return dialogRuntime()?.dialogExplicitTargetNode?.(...args); }
  function ensureDialogEditState(...args) { return dialogRuntime()?.ensureDialogEditState?.(...args); }
  function dialogEditReferenceItems(...args) { return dialogRuntime()?.dialogEditReferenceItems?.(...args); }
  function dialogExplicitReferenceItems(...args) { return dialogRuntime()?.dialogExplicitReferenceItems?.(...args); }
  function dialogLatestGeneratedImageRef(...args) { return dialogRuntime()?.dialogLatestGeneratedImageRef?.(...args); }
  function dialogShouldUseLatestContextImage(...args) { return dialogRuntime()?.dialogShouldUseLatestContextImage?.(...args); }
  function dialogGenerationReferenceUrls(...args) { return dialogRuntime()?.dialogGenerationReferenceUrls?.(...args); }
  function dialogEditModeLabel(...args) { return dialogRuntime()?.dialogEditModeLabel?.(...args); }
  function dialogMessageRunKind(...args) { return dialogRuntime()?.dialogMessageRunKind?.(...args); }
  function fallbackDialogRunPlan(...args) { return dialogRuntime()?.fallbackDialogRunPlan?.(...args); }
  function isPromptWritingRequest(...args) { return dialogRuntime()?.isPromptWritingRequest?.(...args); }
  async function planDialogRunWithTextModel(...args) { return dialogRuntime()?.planDialogRunWithTextModel?.(...args); }
  function parseFirstJsonObject(...args) { return dialogRuntime()?.parseFirstJsonObject?.(...args); }
  function dialogReferenceIntent(...args) { return dialogRuntime()?.dialogReferenceIntent?.(...args); }
  function dialogReferenceInstructions(...args) { return dialogRuntime()?.dialogReferenceInstructions?.(...args); }
  function dialogReferenceDisplayItems(...args) { return dialogRuntime()?.dialogReferenceDisplayItems?.(...args); }
  function pushDialogMessage(...args) { return dialogRuntime()?.pushDialogMessage?.(...args); }
  function dialogAttachmentStripHtml(...args) { return dialogRuntime()?.dialogAttachmentStripHtml?.(...args); }
  function dialogMessageAttachmentHtml(...args) { return dialogRuntime()?.dialogMessageAttachmentHtml?.(...args); }
  function startDialogRun(...args) { return dialogRuntime()?.startDialogRun?.(...args); }
  function dialogRunIsActive(...args) { return dialogRuntime()?.dialogRunIsActive?.(...args); }
  function assertDialogRunActive(...args) { return dialogRuntime()?.assertDialogRunActive?.(...args); }
  function updateDialogRun(...args) { return dialogRuntime()?.updateDialogRun?.(...args); }
  function finishDialogRun(...args) { return dialogRuntime()?.finishDialogRun?.(...args); }
  function resetDialogRun(...args) { return dialogRuntime()?.resetDialogRun?.(...args); }
  async function stopDialogRun(...args) { return dialogRuntime()?.stopDialogRun?.(...args); }
  function dialogRunningCardHtml(...args) { return dialogRuntime()?.dialogRunningCardHtml?.(...args); }
  function codexStepRowHtml(...args) { return dialogRuntime()?.codexStepRowHtml?.(...args); }
  function renderCodexInlineMarkdown(...args) { return dialogRuntime()?.renderCodexInlineMarkdown?.(...args); }
  function renderCodexMessage(...args) { return dialogRuntime()?.renderCodexMessage?.(...args); }
  function codexExecutionHtml(...args) { return dialogRuntime()?.codexExecutionHtml?.(...args); }
  function dialogMessageImportButton(...args) { return dialogRuntime()?.dialogMessageImportButton?.(...args); }
  function dialogMessageDownloadButton(...args) { return dialogRuntime()?.dialogMessageDownloadButton?.(...args); }
  function dialogMessageText(...args) { return dialogRuntime()?.dialogMessageText?.(...args); }
  function dialogMessageWorkingPrompt(...args) { return dialogRuntime()?.dialogMessageWorkingPrompt?.(...args); }
  function dialogMessageAttachments(...args) { return dialogRuntime()?.dialogMessageAttachments?.(...args); }
  function isSeedancePromptText(...args) { return dialogRuntime()?.isSeedancePromptText?.(...args); }
  function dialogMessageActionButtons(...args) { return dialogRuntime()?.dialogMessageActionButtons?.(...args); }
  function beginDialogMessageEdit(...args) { return dialogRuntime()?.beginDialogMessageEdit?.(...args); }
  function applyDialogMessageEdit(...args) { return dialogRuntime()?.applyDialogMessageEdit?.(...args); }
  async function dialogTextChatReply(...args) { return dialogRuntime()?.dialogTextChatReply?.(...args); }
  function dialogSubjectFramingConstraints(...args) { return dialogRuntime()?.dialogSubjectFramingConstraints?.(...args); }
  function buildDialogImageBrief(...args) { return dialogRuntime()?.buildDialogImageBrief?.(...args); }
  function buildDialogImageTaskContext(...args) { return dialogRuntime()?.buildDialogImageTaskContext?.(...args); }
  function buildDialogEditPrompt(...args) { return dialogRuntime()?.buildDialogEditPrompt?.(...args); }


  function addPromptAtCenter() {
    const c = viewCenter();
    addNode('prompt', c.x - 180, c.y - 90);
  }
  function addImageAtCenter() {
    const c = viewCenter();
    addNode('image', c.x - 260, c.y - 220);
  }
  function addUploadAtCenter() {
    const c = viewCenter();
    const node = addNode('upload', c.x - 180, c.y - 120);
    node.el.querySelector('[data-upload]')?.click();
  }
  function addVideoAtCenter() {
    const c = viewCenter();
    addNode('video', c.x - 260, c.y - 220);
  }
  function addMediaToolAtCenter() {
    const c = viewCenter();
    addNode('media-tool', c.x - 180, c.y - 220);
  }
  function addComfyUIAtCenter() {
    const c = viewCenter();
    addNode('comfyui', c.x - 260, c.y - 220);
  }
  function addCharacterAtCenter() {
    const c = viewCenter();
    addNode('character', c.x - 190, c.y - 120, {
      prompt: '角色卡：姓名 / 年龄段 / 身份 / 服装 / 发型 / 性格 / 固定特征 / 禁用变化。'
    });
  }
  function addCharacterBundle() {
    const c = viewCenter();
    const x = c.x - 520;
    const y = c.y - 180;
    const character = addNode('character', x, y, {
      prompt: '角色卡：姓名 / 年龄段 / 身份 / 服装 / 发型 / 性格 / 固定特征 / 禁用变化。'
    }, null, false);
    const portrait = addNode('image', x + 390, y - 46, {
      prompt: '角色定妆图：保持角色卡中的身份、服装、发型和气质一致。',
      model: FutureAIApiDefaults.get('imageModel'),
      size: '1024x1536',
      resolution: '1K'
    }, null, false);
    connect(character.id, 'text', portrait.id, 'prompt');
    selectSingleNode(portrait.id);
    saveProject();
    drawEdges();
    toast('已创建角色卡流程', 'success');
  }
  function addStoryboard() {
    const c = viewCenter();
    addStoryboardAt(c.x, c.y);
  }
  function addStoryboardAt(centerX, centerY) {
    const x = centerX - 520;
    const y = centerY - 260;
    const prompts = [
      '镜头 01：角色建立，明确人物身份、服装、场景、光线和情绪。',
      '镜头 02：动作推进，保持角色一致，加入关键动作和环境变化。',
      '镜头 03：情绪特写，强调表情、构图、戏剧张力和画面连续性。'
    ];
    prompts.forEach((text, i) => {
      const p = addNode('prompt', x, y + i * 250, {prompt: text}, null, false);
      const img = addNode('image', x + 430, y + i * 250 - 55, {model: FutureAIApiDefaults.get('imageModel'), size: i === 0 ? '1024x1536' : '1280x720'}, null, false);
      connect(p.id, 'text', img.id, 'prompt');
    });
    saveProject();
    toast('已创建三镜头分镜组', 'success');
  }

  let userTemplateCache = null;
  let templateGalleryState = {mode: 'insert', category: 'all', at: null, focusSave: false};

  function customWorkflowDefinitions() {
    if (Array.isArray(userTemplateCache)) return userTemplateCache.slice();
    return WorkflowLibrary?.loadLibrary() || [];
  }
  function allWorkflowDefinitions() {
    return [...(WorkflowLibrary?.BUILT_INS || []), ...customWorkflowDefinitions()];
  }
  async function refreshUserTemplates({migrateLocal = true} = {}) {
    const bridge = window.templateBridge;
    let portable = [];
    if (bridge?.list) {
      try { portable = await bridge.list() || []; }
      catch (error) { console.warn('[templates] list failed', error); }
    }
    portable = (Array.isArray(portable) ? portable : []).map(item => {
      try { return WorkflowLibrary.normalizeDefinition(Object.assign({}, item, {builtIn: false})); }
      catch { return null; }
    }).filter(Boolean);
    const local = WorkflowLibrary?.loadLibrary() || [];
    if (migrateLocal && local.length && bridge?.save) {
      for (const item of local) {
        if (portable.some(existing => existing.id === item.id)) continue;
        try {
          const saved = await bridge.save(WorkflowLibrary.normalizeDefinition(item));
          if (saved) portable.unshift(WorkflowLibrary.normalizeDefinition(Object.assign({}, saved, {builtIn: false})));
        } catch (error) { console.warn('[templates] migrate failed', error); }
      }
      try { WorkflowLibrary.saveLibrary([]); } catch {}
    }
    // Prefer portable; fall back to localStorage when bridge is unavailable (tests/dev).
    userTemplateCache = portable.length || bridge?.list ? portable : local;
    return userTemplateCache;
  }
  function openWorkflowLibraryForSelection() {
    const selected = [...selectedNodes].map(id => nodes.get(id)).filter(Boolean);
    if (selected.length) {
      const title = selected.length === 1 ? nodeDisplayTitle(selected[0]) : `组合工作流 ${selected.length} 节点`;
      if ($('workflowLibraryName')) $('workflowLibraryName').value = title;
      if ($('templateGallerySaveName')) $('templateGallerySaveName').value = title;
    }
    openWorkflowLibrary();
  }
  function workflowExposureFields(node) {
    const data = node?.data || {};
    const fields = [];
    if (node.type === 'prompt' || node.type === 'character') fields.push('prompt');
    if (['image', 'video'].includes(node.type)) fields.push('model');
    if (node.type === 'image') fields.push('aspect', 'resolution', 'size');
    if (node.type === 'video') fields.push('operation', 'size', 'duration', 'speed');
    return fields.filter(field => Object.prototype.hasOwnProperty.call(data, field) || ['prompt', 'model', 'size', 'aspect', 'resolution', 'duration', 'speed', 'operation'].includes(field));
  }
  function renderWorkflowExposureControls() {
    const host = $('workflowExposureControls');
    if (!host) return;
    const selected = [...selectedNodes].map(id => nodes.get(id)).filter(Boolean);
    if (!selected.length) {
      host.innerHTML = '<small>先选择画布节点，再打开这里保存工作流。</small>';
      return;
    }
    const inputItems = selected.flatMap(node => workflowExposureFields(node).map(field => ({node, field})));
    const outputItems = selected.filter(node => ['image', 'video', 'upload', 'media-tool'].includes(node.type));
    host.innerHTML = `<div class="workflow-exposure-group"><strong>可修改输入/参数</strong><div class="workflow-exposure-grid">${inputItems.map(item => `<label><input type="checkbox" data-exposure-kind="parameter" data-node-id="${esc(item.node.id)}" data-field="${esc(item.field)}">${esc(nodeDisplayTitle(item.node))} · ${esc(item.field)}</label>`).join('') || '<small>当前节点没有可暴露参数</small>'}</div></div><div class="workflow-exposure-group"><strong>可读取输出</strong><div class="workflow-exposure-grid">${outputItems.map(node => `<label><input type="checkbox" data-exposure-kind="output" data-node-id="${esc(node.id)}">${esc(nodeDisplayTitle(node))}</label>`).join('') || '<small>当前节点没有媒体输出</small>'}</div>`;
  }
  function openWorkflowLibrary() {
    closeHistory();
    closeAssetLibrary();
    closeQueueDrawer();
    renderWorkflowLibrary();
    renderWorkflowExposureControls();
    const drawer = $('workflowLibraryDrawer');
    drawer?.classList.remove('hidden');
    drawer?.setAttribute('aria-hidden', 'false');
    setTimeout(() => (selectedNodes.size ? $('workflowLibraryName') : drawer?.querySelector('button'))?.focus?.(), 0);
  }
  function closeWorkflowLibrary() {
    const drawer = $('workflowLibraryDrawer');
    drawer?.classList.add('hidden');
    drawer?.setAttribute('aria-hidden', 'true');
  }
  async function openTemplateGallery(options = {}) {
    if (!WorkflowLibrary) return toast('模板模块不可用', 'error');
    closeHistory();
    closeAssetLibrary();
    closeQueueDrawer();
    closeWorkflowLibrary();
    templateGalleryState = {
      mode: options.mode === 'new-project' ? 'new-project' : 'insert',
      category: options.category || templateGalleryState.category || 'all',
      at: options.at || null,
      focusSave: Boolean(options.focusSave)
    };
    await refreshUserTemplates();
    const selected = [...selectedNodes].map(id => nodes.get(id)).filter(Boolean);
    if (selected.length && $('templateGallerySaveName') && !$('templateGallerySaveName').value) {
      $('templateGallerySaveName').value = selected.length === 1 ? nodeDisplayTitle(selected[0]) : `我的模板 ${selected.length} 节点`;
    }
    renderTemplateGallery();
    const modal = $('templateGalleryModal');
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'false');
    if (templateGalleryState.focusSave) setTimeout(() => $('templateGallerySaveName')?.focus?.(), 0);
  }
  function closeTemplateGallery() {
    const modal = $('templateGalleryModal');
    modal?.classList.add('hidden');
    modal?.setAttribute('aria-hidden', 'true');
    templateGalleryState.at = null;
    templateGalleryState.focusSave = false;
  }
  function renderTemplateGallery() {
    const tabs = $('templateGalleryTabs');
    const grid = $('templateGalleryGrid');
    const saveBox = $('templateGallerySaveBox');
    const title = $('templateGalleryTitle');
    const subtitle = $('templateGallerySubtitle');
    if (!tabs || !grid || !WorkflowLibrary) return;
    const cats = WorkflowLibrary.CATEGORIES || [];
    tabs.innerHTML = cats.map(cat => `<button type="button" role="tab" data-tpl-cat="${esc(cat.id)}" class="${templateGalleryState.category === cat.id ? 'active' : ''}" aria-selected="${templateGalleryState.category === cat.id ? 'true' : 'false'}">${esc(cat.name)}</button>`).join('');
    const list = WorkflowLibrary.listByCategory(allWorkflowDefinitions(), templateGalleryState.category);
    grid.innerHTML = list.map(templateGalleryCardHtml).join('') || `<div class="template-gallery-empty">${templateGalleryState.category === 'mine' ? '还没有「我的模板」。选中节点后可在下方保存。' : '这一类暂时没有模板'}</div>`;
    const canSave = templateGalleryState.mode === 'insert' && selectedNodes.size > 0;
    if (saveBox) saveBox.hidden = !canSave;
    if (title) title.textContent = templateGalleryState.mode === 'new-project' ? '从模板新建项目' : '插入工作流模板';
    if (subtitle) subtitle.textContent = templateGalleryState.mode === 'new-project'
      ? '选一个模板，会新建项目并把链路放到画布中央'
      : '点卡片或「放到画布」，整条链路一次放入（可撤销）';
  }
  function templateGalleryCardHtml(definition) {
    const builtIn = Boolean(definition.builtIn || String(definition.id || '').startsWith('builtin-'));
    const preview = WorkflowLibrary.schematicSvg(definition);
    const cat = (WorkflowLibrary.CATEGORIES || []).find(item => item.id === definition.category)?.name || '模板';
    return `<article class="template-gallery-card" data-template-id="${esc(definition.id)}" tabindex="0">
      <div class="tpl-preview">${preview}</div>
      <strong>${esc(definition.name)}</strong>
      <p>${esc(definition.notes || '')}</p>
      <div class="tpl-meta"><span>${esc(cat)} · ${definition.nodes.length} 节点</span><span>${builtIn ? '内置' : '我的'}</span></div>
      <div class="tpl-actions">
        <button type="button" class="primary-btn" data-template-use="${esc(definition.id)}"><i class="fa-solid fa-plus"></i> ${templateGalleryState.mode === 'new-project' ? '用它新建' : '放到画布'}</button>
        ${builtIn ? '' : `<button type="button" class="icon-btn" data-template-delete="${esc(definition.id)}" title="删除我的模板"><i class="fa-regular fa-trash-can"></i></button>`}
      </div>
    </article>`;
  }
  function handleTemplateGalleryTabClick(event) {
    const btn = event.target.closest('[data-tpl-cat]');
    if (!btn) return;
    templateGalleryState.category = btn.dataset.tplCat || 'all';
    renderTemplateGallery();
  }
  async function handleTemplateGalleryGridClick(event) {
    const remove = event.target.closest('[data-template-delete]');
    const use = event.target.closest('[data-template-use]') || event.target.closest('[data-template-id]');
    if (remove) {
      event.stopPropagation();
      const definition = workflowDefinitionById(remove.dataset.templateDelete);
      if (!definition || definition.builtIn) return;
      try {
        if (window.templateBridge?.remove) await window.templateBridge.remove(definition.id);
        userTemplateCache = (userTemplateCache || []).filter(item => item.id !== definition.id);
        WorkflowLibrary.saveLibrary(WorkflowLibrary.deleteLibraryItem(WorkflowLibrary.loadLibrary(), definition.id));
        renderTemplateGallery();
        renderWorkflowLibrary();
        toast(`已删除模板：${definition.name}`, 'success');
      } catch (error) {
        toast(error?.message || '删除模板失败', 'error');
      }
      return;
    }
    if (!use) return;
    const id = use.dataset.templateUse || use.dataset.templateId;
    const definition = workflowDefinitionById(id);
    if (!definition) return;
    await applyTemplateDefinition(definition);
  }
  async function applyTemplateDefinition(definition) {
    if (!definition) return;
    if (templateGalleryState.mode === 'new-project') {
      closeTemplateGallery();
      const project = await createProject(true, definition.name, 'blank');
      if (!project) return;
      instantiateWorkflowDefinition(definition, {center: viewCenter()});
      return;
    }
    instantiateWorkflowDefinition(definition, {center: templateGalleryState.at || viewCenter()});
    closeTemplateGallery();
  }
  function workflowCardHtml(definition) {
    const builtIn = Boolean(definition.builtIn || String(definition.id || '').startsWith('builtin-'));
    return `<article class="workflow-library-card" data-workflow-id="${esc(definition.id)}">
      <div><strong>${esc(definition.name)}</strong><span>v${esc(definition.version)} · ${definition.nodes.length} 节点 · ${definition.edges.length} 连线</span><p>${esc(definition.notes || (builtIn ? '内置组合工作流' : '没有修改说明'))}</p></div>
      <div class="workflow-library-card-actions">
        <button type="button" class="primary-btn" data-workflow-use="${esc(definition.id)}"><i class="fa-solid fa-plus"></i> 放到画布</button>
        <button type="button" class="icon-btn" data-workflow-export="${esc(definition.id)}" title="导出工作流"><i class="fa-solid fa-file-export"></i></button>
        ${builtIn ? '' : `<button type="button" class="icon-btn" data-workflow-delete="${esc(definition.id)}" title="删除本地模板"><i class="fa-regular fa-trash-can"></i></button>`}
      </div>
    </article>`;
  }
  function renderWorkflowLibrary() {
    const list = $('workflowLibraryList');
    if (!list || !WorkflowLibrary) return;
    list.innerHTML = allWorkflowDefinitions().map(workflowCardHtml).join('') || '<div class="workflow-library-empty">还没有工作流模板</div>';
  }
  function selectedWorkflowSnapshot() {
    const selectedIds = new Set(selectedNodes);
    const selected = [...selectedIds].map(id => nodes.get(id)).filter(Boolean);
    if (!selected.length) throw new Error('请先框选要保存的节点');
    const selectedEdges = edges.filter(edge => selectedIds.has(edge.from) && selectedIds.has(edge.to));
    const selectedGroups = [...groups.values()].map(group => ({
      id: group.id,
      name: group.name,
      nodeIds: group.nodeIds.filter(id => selectedIds.has(id))
    })).filter(group => group.nodeIds.length > 1);
    return {nodes: selected.map(node => ({id: node.id, type: node.type, x: node.x, y: node.y, data: node.data})), edges: selectedEdges, groups: selectedGroups};
  }
  async function persistUserTemplate(definition) {
    const normalized = WorkflowLibrary.normalizeDefinition(Object.assign({}, definition, {builtIn: false}));
    if (window.templateBridge?.save) {
      const saved = await window.templateBridge.save(normalized);
      const item = WorkflowLibrary.normalizeDefinition(Object.assign({}, saved || normalized, {builtIn: false}));
      userTemplateCache = WorkflowLibrary.upsertLibraryItem(userTemplateCache || [], item);
      try { WorkflowLibrary.saveLibrary([]); } catch {}
      return item;
    }
    const saved = WorkflowLibrary.saveLibrary(WorkflowLibrary.upsertLibraryItem(customWorkflowDefinitions(), normalized));
    userTemplateCache = saved;
    return normalized;
  }
  async function saveSelectedAsUserTemplate() {
    if (!WorkflowLibrary) return toast('模板模块不可用', 'error');
    try {
      const snapshot = selectedWorkflowSnapshot();
      const name = String($('templateGallerySaveName')?.value || $('workflowLibraryName')?.value || '').trim();
      if (!name) return toast('请填写模板名称', 'warn');
      const definition = WorkflowLibrary.createDefinition({
        name,
        category: 'image',
        notes: '我保存的模板',
        ...snapshot
      });
      const saved = await persistUserTemplate(definition);
      templateGalleryState.category = 'mine';
      renderTemplateGallery();
      renderWorkflowLibrary();
      toast(`已保存到「我的模板」：${saved.name}`, 'success');
    } catch (error) {
      toast(error?.message || '保存模板失败', 'warn');
    }
  }
  function saveSelectedWorkflow() {
    if (!WorkflowLibrary) return toast('工作流模块不可用', 'error');
    (async () => {
      try {
        const snapshot = selectedWorkflowSnapshot();
        const name = String($('workflowLibraryName')?.value || '').trim();
        if (!name) return toast('请填写工作流名称', 'warn');
        const exposed = {inputs: [], outputs: [], parameters: []};
        document.querySelectorAll('#workflowExposureControls [data-exposure-kind]:checked').forEach(input => {
          const item = {nodeId: String(input.dataset.nodeId || '')};
          if (input.dataset.field) item.field = String(input.dataset.field);
          const kind = input.dataset.exposureKind;
          if (kind === 'output') exposed.outputs.push(item);
          else { exposed.parameters.push(item); exposed.inputs.push(item); }
        });
        const definition = WorkflowLibrary.createDefinition({
          name,
          version: String($('workflowLibraryVersion')?.value || '1.0.0').trim(),
          notes: String($('workflowLibraryNotes')?.value || '').trim(),
          ...snapshot,
          exposed
        });
        const savedDef = await persistUserTemplate(definition);
        const group = addGroup([...selectedNodes], null, definition.name, false, {
          workflowId: savedDef.id,
          workflowVersion: savedDef.version,
          workflowDefinition: savedDef,
          collapsed: false
        });
        if (group) renderGroup(group);
        saveProject();
        renderWorkflowLibrary();
        renderTemplateGallery();
        toast(`已保存工作流：${savedDef.name} v${savedDef.version}`, 'success');
      } catch (error) {
        toast(error?.message || '保存工作流失败', 'warn');
      }
    })();
  }
  function workflowDefinitionById(id) {
    return allWorkflowDefinitions().find(item => item.id === id) || null;
  }
  function instantiateWorkflowDefinition(definition, options = {}) {
    if (!definition || !WorkflowLibrary) return;
    const center = options.center || viewCenter();
    const existing = [...nodes.values()].map(node => ({type: node.type, x: node.x, y: node.y, data: {aspect: node.data?.aspect, size: node.data?.size}}));
    const place = WorkflowLibrary.placementOrigin(definition, existing, center);
    const instance = WorkflowLibrary.instantiate(definition, {
      originX: place.originX,
      originY: place.originY,
      imageModel: FutureAIApiDefaults.get('imageModel') || '',
      videoModel: FutureAIApiDefaults.get('videoModel') || ''
    });
    instance.nodes.forEach(item => addNode(item.type, item.x, item.y, item.data, item.id, false));
    alignInsertedTemplateNodes(instance.nodes.map(item => item.id));
    instance.edges.forEach(edge => connectSilently(edge.from, edge.fromPort || 'image', edge.to, edge.toPort || 'ref'));
    instance.groups.forEach(group => addGroup(group.nodeIds, group.id, group.name || definition.name, false, group));
    // Leave nothing selected so no node composer pops open over the fresh template; the group label selects it all.
    selectedNodes.clear();
    renderSelection();
    // Show the whole inserted template (with its group frame) at normal size or smaller; view-only, no extra undo step.
    if (options.fit !== false) fitView(false, instance.nodes.map(item => item.id), {save: false, pad: 64, extraTop: 72});
    drawEdges();
    syncCanvasEmptyState();
    saveProject();
    toast(`已添加模板：${definition.name}`, 'success');
    return instance;
  }
  // Re-flow inserted template nodes with their real rendered sizes: keep the template's columns (by x) and order
  // (by y), stack each column with a fixed gap and centre columns vertically, so ports line up and nothing overlaps.
  function alignInsertedTemplateNodes(ids) {
    const list = ids.map(id => nodes.get(id)).filter(Boolean);
    if (list.length < 2) return;
    list.forEach(node => mountNode(node));
    const originX = Math.min(...list.map(node => node.x));
    const originY = Math.min(...list.map(node => node.y));
    const columns = [];
    [...list].sort((a, b) => a.x - b.x).forEach(node => {
      const column = columns.find(col => Math.abs(col.x - node.x) < 200);
      if (column) column.items.push(node);
      else columns.push({x: node.x, items: [node]});
    });
    const COL_GAP = 110;
    const ROW_GAP = 64;
    columns.forEach(col => {
      col.items.sort((a, b) => a.y - b.y);
      col.sizes = col.items.map(node => nodeSize(node));
      col.width = Math.max(...col.sizes.map(size => size.width));
      col.height = col.sizes.reduce((sum, size) => sum + size.height, 0) + ROW_GAP * (col.items.length - 1);
    });
    const tallest = Math.max(...columns.map(col => col.height));
    let x = originX;
    columns.forEach(col => {
      let y = originY + (tallest - col.height) / 2;
      col.items.forEach((node, index) => {
        moveNode(node, Math.round(x + (col.width - col.sizes[index].width) / 2), Math.round(y));
        y += col.sizes[index].height + ROW_GAP;
      });
      x += col.width + COL_GAP;
    });
    // Real sizes can exceed the library's estimate; slide the whole block right until it clears existing nodes.
    const idSet = new Set(ids);
    const others = [...nodes.values()].filter(node => !idSet.has(node.id)).map(node => {
      const size = nodeSize(node);
      return {left: node.x, top: node.y, right: node.x + size.width, bottom: node.y + size.height};
    });
    if (!others.length) return;
    const boxes = () => list.map(node => { const size = nodeSize(node); return {left: node.x, top: node.y, right: node.x + size.width, bottom: node.y + size.height}; });
    const hits = () => boxes().some(a => others.some(b => !(a.right + 40 <= b.left || b.right + 40 <= a.left || a.bottom + 40 <= b.top || b.bottom + 40 <= a.top)));
    for (let tries = 0; tries < 40 && hits(); tries += 1) list.forEach(node => moveNode(node, node.x + 160, node.y));
  }
  function workflowGroupRunOrder(group) {
    const ids = new Set((group?.nodeIds || []).filter(id => nodes.has(id)));
    const incoming = new Map([...ids].map(id => [id, 0]));
    const outgoing = new Map([...ids].map(id => [id, []]));
    edges.forEach(edge => {
      if (!ids.has(edge.from) || !ids.has(edge.to)) return;
      incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
      outgoing.get(edge.from).push(edge.to);
    });
    const ready = [...ids].filter(id => incoming.get(id) === 0).sort((a, b) => (nodes.get(a)?.x || 0) - (nodes.get(b)?.x || 0));
    const ordered = [];
    while (ready.length) {
      const id = ready.shift();
      ordered.push(id);
      outgoing.get(id).forEach(next => {
        incoming.set(next, incoming.get(next) - 1);
        if (incoming.get(next) === 0) ready.push(next);
      });
    }
    return ordered.length === ids.size ? ordered : [...ids].sort((a, b) => (nodes.get(a)?.x || 0) - (nodes.get(b)?.x || 0) || (nodes.get(a)?.y || 0) - (nodes.get(b)?.y || 0));
  }
  async function runWorkflowGroup(groupId) {
    const group = groups.get(groupId);
    if (!group) return toast('组合工作流不存在', 'warn');
    const order = workflowGroupRunOrder(group);
    // Nodes that already show a result are left alone; only empty ones are filled.
    const skipped = new Set(order.filter(id => ['image', 'video', 'comfyui', 'media-tool'].includes(nodes.get(id)?.type) && nodeHasResult(nodes.get(id))));
    const paid = order.filter(id => !skipped.has(id)).map(id => nodes.get(id)).filter(node => ['image', 'video', 'comfyui'].includes(node?.type));
    const skippedNote = skippedResultText(skipped.size);
    if (paid.length) {
      const approved = await openModal({
        title: '确认运行组合工作流',
        text: `将按依赖顺序运行 ${order.length - skipped.size} 个节点，其中 ${paid.length} 个可能调用生成接口。${skippedNote ? `\n${skippedNote}。` : ''}\n\n未确认前不会发送请求；每个生成节点仍会继续执行模型能力和预算检查。`,
        okText: '确认运行',
        cancelText: '取消',
        cancelValue: false,
        confirm: true
      });
      if (!approved) return;
    }
    if (group.collapsed) {
      group.collapsed = false;
      renderGroup(group);
    }
    for (const id of order) {
      const node = nodes.get(id);
      if (!node || skipped.has(id)) continue;
      let ok = true;
      if (node.type === 'prompt' || node.type === 'character') runPrompt(node.id);
      else if (node.type === 'image') ok = (await runImage(node.id)) !== false;
      else if (node.type === 'video') ok = (await runVideo(node.id)) !== false;
      else if (node.type === 'media-tool') ok = (await runMediaTool(node.id)) !== false;
      else if (node.type === 'comfyui') ok = Boolean(await runComfyUI(node.id));
      if (!ok) {
        saveProject();
        return toast(`组合已停在“${nodeDisplayTitle(node)}”，已完成的结果均已保留`, 'warn');
      }
    }
    saveProject();
    toast(`组合工作流“${group.name}”运行完成${skippedNote ? `；${skippedNote}` : ''}`, 'success');
  }
  function exportWorkflowDefinition(definition) {
    if (!definition) return;
    const blob = new Blob([JSON.stringify(definition, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${String(definition.name || 'workflow').replace(/[\\/:*?"<>|]+/g, '_')}-${definition.version}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importWorkflowDefinitions(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !WorkflowLibrary) return;
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of incoming) {
        await persistUserTemplate(WorkflowLibrary.normalizeDefinition(value));
      }
      renderWorkflowLibrary();
      renderTemplateGallery();
      toast(`已导入 ${incoming.length} 个工作流，私有信息已清理`, 'success');
    } catch (error) {
      toast(`工作流导入失败：${error?.message || error}`, 'error');
    }
  }
  function handleWorkflowLibraryClick(event) {
    const use = event.target.closest('[data-workflow-use]');
    const exportButton = event.target.closest('[data-workflow-export]');
    const remove = event.target.closest('[data-workflow-delete]');
    if (use) return instantiateWorkflowDefinition(workflowDefinitionById(use.dataset.workflowUse));
    if (exportButton) return exportWorkflowDefinition(workflowDefinitionById(exportButton.dataset.workflowExport));
    if (remove) {
      const definition = workflowDefinitionById(remove.dataset.workflowDelete);
      if (!definition || definition.builtIn) return;
      (async () => {
        try {
          if (window.templateBridge?.remove) await window.templateBridge.remove(definition.id);
          userTemplateCache = (userTemplateCache || []).filter(item => item.id !== definition.id);
          WorkflowLibrary.saveLibrary(WorkflowLibrary.deleteLibraryItem(WorkflowLibrary.loadLibrary(), definition.id));
          renderWorkflowLibrary();
          renderTemplateGallery();
          toast(`已删除本地工作流：${definition.name}`, 'success');
        } catch (error) {
          toast(error?.message || '删除失败', 'error');
        }
      })();
    }
  }

  function openShortWorkbench() {
    closeHistory();
    closeFloatingCanvasUi();
    $('chatPanel')?.classList.add('hidden');
    $('chatPreview')?.classList.add('hidden');
    document.querySelector('.workflow-bar')?.classList.remove('open');
    setActiveWorkspace('short');
    renderShortWorkbench();
    jumpShortSection('idea', false);
  }

  function openDialogEditWorkbench(...args) { return dialogRuntime()?.openDialogEditWorkbench?.(...args); }
  function closeDialogEditWorkbench(...args) { return dialogRuntime()?.closeDialogEditWorkbench?.(...args); }
  function renderDialogEditWorkbench(...args) { return dialogRuntime()?.renderDialogEditWorkbench?.(...args); }
  function scrollDialogThreadToBottom(...args) { return dialogRuntime()?.scrollDialogThreadToBottom?.(...args); }
  async function onDialogEditWorkbenchClick(...args) { return dialogRuntime()?.onDialogEditWorkbenchClick?.(...args); }
  function downloadDialogMessageAttachment(...args) { return dialogRuntime()?.downloadDialogMessageAttachment?.(...args); }
  function importDialogMessageToCanvas(...args) { return dialogRuntime()?.importDialogMessageToCanvas?.(...args); }
  async function onDialogEditWorkbenchInput(...args) { return dialogRuntime()?.onDialogEditWorkbenchInput?.(...args); }
  async function handleDialogEditUploads(...args) { return dialogRuntime()?.handleDialogEditUploads?.(...args); }
  function buildCodexAssistantPrompt(...args) { return dialogRuntime()?.buildCodexAssistantPrompt?.(...args); }
  function isVideoUnderstandingRequest(...args) { return dialogRuntime()?.isVideoUnderstandingRequest?.(...args); }
  function isExplicitImageExecutionRequest(...args) { return dialogRuntime()?.isExplicitImageExecutionRequest?.(...args); }
  async function hydrateDialogTextAttachments(...args) { return dialogRuntime()?.hydrateDialogTextAttachments?.(...args); }
  async function runDialogCodexAssistant(...args) {
    const options = args[0] || {};
    const agent = agentUi()?.settings?.() || {};
    if (agent.backend !== 'codex') {
      const text = String(options.userText ?? dialogEditInput ?? '').trim() || '请处理这些附件。';
      if (!options.alreadyRecorded) {
        if (dialogEditEditingIndex >= 0) applyDialogMessageEdit(text, options.attachments || dialogEditAttachments);
        else pushDialogMessage('user', text, options.attachments || dialogEditAttachments);
      }
      // The message is in the thread either way; clear the composer so the task is not re-sent.
      dialogEditInput = '';
      dialogEditAttachments = [];
      dialogEditEditingIndex = -1;
      // Show the hand-off in the chat itself: the agent console is usually closed, so without this
      // the chat looked dead while the agent worked (users closed the app mid-run).
      dialogAgentRun = startDialogRun('agent', '内置智能体正在执行本地任务');
      saveProject();
      renderDialogEditWorkbench();
      const started = await agentUi()?.start(text);
      if (!started?.ok) {
        finishDialogRun(dialogAgentRun);
        dialogAgentRun = null;
        pushDialogMessage('assistant', `智能体未能启动：${started?.error || '内置智能体不可用'}`);
        saveProject();
        renderDialogEditWorkbench();
      }
      return started;
    }
    return dialogRuntime()?.runDialogCodexAssistant?.(...args);
  }
  async function stopDialogCodexRun(...args) {
    if (agentRunning) await agentUi()?.stop?.();
    return dialogRuntime()?.stopDialogCodexRun?.(...args);
  }
  async function runDialogEditGeneration(...args) { return dialogRuntime()?.runDialogEditGeneration?.(...args); }
  function setDialogEditStatus(...args) { return dialogRuntime()?.setDialogEditStatus?.(...args); }


  async function multimodalImageUnderstand(o) {
    const images = Array.isArray(o.images) ? o.images.filter(Boolean) : [];
    if (!images.length) throw new Error('没有可分析的图片');
    const messages = [
      {
        role: 'system',
        content: '你是一个图像理解助手。输出中文，结构化、简洁、可用于后续生成或改图。'
      },
      {
        role: 'user',
        content: [
          {type: 'text', text: o.prompt},
          ...images.map(url => ({type: 'image_url', image_url: {url}}))
        ]
      }
    ];
    const {res} = await fetchApiWithBaseFallback(o.apiUrl, o.endpoint || '/chat/completions', {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey},
      body: JSON.stringify({model: o.model, messages, temperature: 0.3, max_tokens: 1200}),
      signal: AbortSignal.timeout(API_TIMEOUTS.text)
    });
    const data = await safeJson(res);
    if (!res.ok) throw createProviderApiError(data, res);
    const text = data.choices?.[0]?.message?.content || data.output_text || data.content || '';
    if (!String(text).trim()) throw new Error('图像理解没有返回内容');
    return cleanAiText(text);
  }

  async function multimodalVideoUnderstand(o) {
    const videos = Array.isArray(o.videos) ? o.videos : [];
    const content = [{
      type: 'text',
      text: [
        '请根据按时间均匀抽取的关键帧理解视频，不要把单帧猜测当成确定事实。',
        `用户要求：${String(o.userText || '请理解视频')}`,
        '输出中文结构化结果，包含：视频内容摘要、人物与主体、动作与事件、场景变化、镜头语言、时间顺序、可用于漫剧制作的建议。',
        '看不清或关键帧无法证实的内容必须标注为不确定；不得虚构对白、音效或帧外事件。'
      ].join('\n')
    }];
    videos.forEach((video, videoIndex) => {
      content.push({type: 'text', text: `视频 ${videoIndex + 1}：${video.name || '未命名'}，时长 ${Number(video.durationSeconds || 0).toFixed(1)} 秒。`});
      (video.frames || []).forEach(frame => {
        content.push({type: 'text', text: `时间点 ${Number(frame.timeSeconds || 0).toFixed(1)} 秒`});
        content.push({type: 'image_url', image_url: {url: frame.dataUrl}});
      });
    });
    const {res} = await fetchApiWithBaseFallback(o.apiUrl, o.endpoint || '/chat/completions', {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey},
      body: JSON.stringify({model: o.model, messages: [{role: 'system', content: '你是专业的视频理解与镜头分析助手。'}, {role: 'user', content}], temperature: 0.2, max_tokens: 1800})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    const text = data.choices?.[0]?.message?.content || data.output_text || data.content || '';
    if (!String(text).trim()) throw new Error('视频理解没有返回内容');
    return cleanAiText(text);
  }
  function closeShortWorkbench(...args) { return shortWorkbench()?.closeShortWorkbench?.(...args); }
  function renderShortTaskSidebar(...args) { return shortWorkbench()?.renderShortTaskSidebar?.(...args); }
  function renderShortSkillVersion(...args) { return shortWorkbench()?.renderShortSkillVersion?.(...args); }
  async function installShortSkill(...args) { return shortWorkbench()?.installShortSkill?.(...args); }
  function openShortSkillManager(...args) { return shortWorkbench()?.openShortSkillManager?.(...args); }
  function jumpShortSection(...args) { return shortWorkbench()?.jumpShortSection?.(...args); }
  function renderShortWorkbench(...args) { return shortWorkbench()?.renderShortWorkbench?.(...args); }
  function ensureShortWorkbenchProductionSections(...args) { return shortWorkbench()?.ensureShortWorkbenchProductionSections?.(...args); }
  function renderShortApprovalState(...args) { return shortWorkbench()?.renderShortApprovalState?.(...args); }
  function shortVideoSize(...args) { return shortWorkbench()?.shortVideoSize?.(...args); }
  function shortImageSize(...args) { return shortWorkbench()?.shortImageSize?.(...args); }
  function shortStoryRevision(...args) { return shortWorkbench()?.shortStoryRevision?.(...args); }
  async function importShortScript(...args) { return shortWorkbench()?.importShortScript?.(...args); }
  function analyzeShortScript(...args) { return shortWorkbench()?.analyzeShortScript?.(...args); }
  function invalidateShortStoryApproval(...args) { return shortWorkbench()?.invalidateShortStoryApproval?.(...args); }
  function normalizeShortVideoTask(...args) { return shortWorkbench()?.normalizeShortVideoTask?.(...args); }
  function recoverInterruptedShortTasks(...args) { return shortWorkbench()?.recoverInterruptedShortTasks?.(...args); }
  function normalizeShortProductionState(...args) { return shortWorkbench()?.normalizeShortProductionState?.(...args); }
  function shortReferenceAssetsForShot(...args) { return shortWorkbench()?.shortReferenceAssetsForShot?.(...args); }
  async function runShortBatch(...args) { return shortWorkbench()?.runShortBatch?.(...args); }
  function localShortQcItems(...args) { return shortWorkbench()?.localShortQcItems?.(...args); }
  function runShortLocalQc(...args) { return shortWorkbench()?.runShortLocalQc?.(...args); }
  async function runShortAiQc(...args) { return shortWorkbench()?.runShortAiQc?.(...args); }
  function renderShortQc(...args) { return shortWorkbench()?.renderShortQc?.(...args); }
  function onShortQcListClick(...args) { return shortWorkbench()?.onShortQcListClick?.(...args); }
  async function buildShortAudioPlan(...args) { return shortWorkbench()?.buildShortAudioPlan?.(...args); }
  function renderShortAudioPlan(...args) { return shortWorkbench()?.renderShortAudioPlan?.(...args); }
  function onShortAudioPlanInput(...args) { return shortWorkbench()?.onShortAudioPlanInput?.(...args); }
  function renderShortTtsConfigState(...args) { return shortWorkbench()?.renderShortTtsConfigState?.(...args); }
  async function onShortVoiceReferenceChange(...args) { return shortWorkbench()?.onShortVoiceReferenceChange?.(...args); }
  async function shortTtsSettings(...args) { return shortWorkbench()?.shortTtsSettings?.(...args); }
  function shortVoiceText(...args) { return shortWorkbench()?.shortVoiceText?.(...args); }
  async function shortSpeechRequest(...args) { return shortWorkbench()?.shortSpeechRequest?.(...args); }
  async function generateShortVoice(...args) { return shortWorkbench()?.generateShortVoice?.(...args); }
  async function onShortAudioPlanClick(...args) { return shortWorkbench()?.onShortAudioPlanClick?.(...args); }
  async function generateAllShortVoices(...args) { return shortWorkbench()?.generateAllShortVoices?.(...args); }
  function normalizeShortTimeline(...args) { return shortWorkbench()?.normalizeShortTimeline?.(...args); }
  function renderShortTimeline(...args) { return shortWorkbench()?.renderShortTimeline?.(...args); }
  function onShortTimelineInput(...args) { return shortWorkbench()?.onShortTimelineInput?.(...args); }
  function onShortTimelineClick(...args) { return shortWorkbench()?.onShortTimelineClick?.(...args); }
  function shortTimelineSrtText(...args) { return shortWorkbench()?.shortTimelineSrtText?.(...args); }
  function installManjuExportProgressHandler(...args) { return shortWorkbench()?.installManjuExportProgressHandler?.(...args); }
  async function exportShortMp4(...args) { return shortWorkbench()?.exportShortMp4?.(...args); }
  function shortSrtText(...args) { return shortWorkbench()?.shortSrtText?.(...args); }
  function formatSrtTime(...args) { return shortWorkbench()?.formatSrtTime?.(...args); }
  function downloadShortSrt(...args) { return shortWorkbench()?.downloadShortSrt?.(...args); }
  function shortProductionPackage(...args) { return shortWorkbench()?.shortProductionPackage?.(...args); }
  function downloadShortProductionJson(...args) { return shortWorkbench()?.downloadShortProductionJson?.(...args); }
  function downloadShortQcReport(...args) { return shortWorkbench()?.downloadShortQcReport?.(...args); }
  function downloadTextFile(...args) { return shortWorkbench()?.downloadTextFile?.(...args); }
  function renderShortDelivery(...args) { return shortWorkbench()?.renderShortDelivery?.(...args); }
  function setShortBusy(...args) { return shortWorkbench()?.setShortBusy?.(...args); }
  function bindShortProductionBriefInputs(...args) { return shortWorkbench()?.bindShortProductionBriefInputs?.(...args); }
  function intFromInput(...args) { return shortWorkbench()?.intFromInput?.(...args); }
  function shortProductionBrief(...args) { return shortWorkbench()?.shortProductionBrief?.(...args); }
  function restoreShortProductionBrief(...args) { return shortWorkbench()?.restoreShortProductionBrief?.(...args); }
  function restoreShortWorkbenchState(...args) { return shortWorkbench()?.restoreShortWorkbenchState?.(...args); }
  function shortProductionBriefText(...args) { return shortWorkbench()?.shortProductionBriefText?.(...args); }
  function shortStoryboardTargetText(...args) { return shortWorkbench()?.shortStoryboardTargetText?.(...args); }
  async function shortApiSettings(...args) { return shortWorkbench()?.shortApiSettings?.(...args); }
  async function requireShortApi(...args) { return shortWorkbench()?.requireShortApi?.(...args); }
  async function shortChatText(...args) { return shortWorkbench()?.shortChatText?.(...args); }
  function cleanAiText(...args) { return shortWorkbench()?.cleanAiText?.(...args); }
  function localizeAssistantText(...args) { return shortWorkbench()?.localizeAssistantText?.(...args); }
  function shortStorySystemPrompt(...args) { return shortWorkbench()?.shortStorySystemPrompt?.(...args); }
  function shortStoryUserPrompt(...args) { return shortWorkbench()?.shortStoryUserPrompt?.(...args); }
  async function generateShortStory(...args) { return shortWorkbench()?.generateShortStory?.(...args); }
  function fallbackShortStory(...args) { return shortWorkbench()?.fallbackShortStory?.(...args); }
  function approveShortStory(...args) { return shortWorkbench()?.approveShortStory?.(...args); }
  async function storyToShortStoryboard(...args) { return shortWorkbench()?.storyToShortStoryboard?.(...args); }
  async function buildShortStoryboard(...args) { return shortWorkbench()?.buildShortStoryboard?.(...args); }
  function normalizeShortStoryboard(...args) { return shortWorkbench()?.normalizeShortStoryboard?.(...args); }
  function fallbackShortStoryboard(...args) { return shortWorkbench()?.fallbackShortStoryboard?.(...args); }
  async function generateShortAssets(...args) { return shortWorkbench()?.generateShortAssets?.(...args); }
  async function buildShortAssets(...args) { return shortWorkbench()?.buildShortAssets?.(...args); }
  function normalizeShortAssets(...args) { return shortWorkbench()?.normalizeShortAssets?.(...args); }
  function parseJsonArray(...args) { return shortWorkbench()?.parseJsonArray?.(...args); }
  function renderShortStoryboard(...args) { return shortWorkbench()?.renderShortStoryboard?.(...args); }
  function renderShortAssets(...args) { return shortWorkbench()?.renderShortAssets?.(...args); }
  function renderShortFrames(...args) { return shortWorkbench()?.renderShortFrames?.(...args); }
  function renderShortVideos(...args) { return shortWorkbench()?.renderShortVideos?.(...args); }
  async function generateAllShortAssetImages(...args) { return shortWorkbench()?.generateAllShortAssetImages?.(...args); }
  async function generateShortAssetImage(...args) { return shortWorkbench()?.generateShortAssetImage?.(...args); }
  async function generateAllShortFirstFrames(...args) { return shortWorkbench()?.generateAllShortFirstFrames?.(...args); }
  async function generateShortFirstFrame(...args) { return shortWorkbench()?.generateShortFirstFrame?.(...args); }
  async function generateAllShortVideos(...args) { return shortWorkbench()?.generateAllShortVideos?.(...args); }
  async function generateShortVideo(...args) { return shortWorkbench()?.generateShortVideo?.(...args); }
  function onShortStoryboardListClick(...args) { return shortWorkbench()?.onShortStoryboardListClick?.(...args); }
  function onShortStoryboardListInput(...args) { return shortWorkbench()?.onShortStoryboardListInput?.(...args); }
  function onShortStoryboardListDragStart(...args) { return shortWorkbench()?.onShortStoryboardListDragStart?.(...args); }
  function onShortStoryboardListDrop(...args) { return shortWorkbench()?.onShortStoryboardListDrop?.(...args); }
  async function onShortAssetsListClick(...args) { return shortWorkbench()?.onShortAssetsListClick?.(...args); }
  function onShortAssetsListInput(...args) { return shortWorkbench()?.onShortAssetsListInput?.(...args); }
  async function onShortFramesListClick(...args) { return shortWorkbench()?.onShortFramesListClick?.(...args); }
  function onShortFramesListInput(...args) { return shortWorkbench()?.onShortFramesListInput?.(...args); }
  async function onShortVideoListClick(...args) { return shortWorkbench()?.onShortVideoListClick?.(...args); }
  function createShortShotNodes(...args) { return shortWorkbench()?.createShortShotNodes?.(...args); }
  function createShortAssetNode(...args) { return shortWorkbench()?.createShortAssetNode?.(...args); }
  function createShortFrameNode(...args) { return shortWorkbench()?.createShortFrameNode?.(...args); }
  function createShortVideoNode(...args) { return shortWorkbench()?.createShortVideoNode?.(...args); }

  function addNode(...args) { const node = canvasRuntime()?.addNode?.(...args); syncCanvasEmptyState(); return node; }
  function normalizeTags(...args) { return canvasRuntime()?.normalizeTags?.(...args); }
  function normalizeNodeMetadata(...args) { return canvasRuntime()?.normalizeNodeMetadata?.(...args); }
  function normalizeData(...args) { return canvasRuntime()?.normalizeData?.(...args); }
  function nodePort(...args) { return canvasRuntime()?.nodePort?.(...args); }
  function renderNode(...args) { return canvasRuntime()?.renderNode?.(...args); }
  function renderImageNode(...args) { return canvasRuntime()?.renderImageNode?.(...args); }
  function renderVideoNode(...args) { return canvasRuntime()?.renderVideoNode?.(...args); }
  function renderUploadNode(...args) { return canvasRuntime()?.renderUploadNode?.(...args); }
  function renderComfyUINode(...args) { return canvasRuntime()?.renderComfyUINode?.(...args); }
  function nodeButtons(...args) { return canvasRuntime()?.nodeButtons?.(...args); }
  function renderNodeMetadata(...args) { return canvasRuntime()?.renderNodeMetadata?.(...args); }
  function nodeDefaultTitle(...args) { return canvasRuntime()?.nodeDefaultTitle?.(...args); }
  function nodeDisplayTitle(...args) { return canvasRuntime()?.nodeDisplayTitle?.(...args); }
  function refreshNodeModelSelects(...args) { return canvasRuntime()?.refreshNodeModelSelects?.(...args); }
  function refreshNodeCapabilityControls(...args) { return canvasRuntime()?.refreshNodeCapabilityControls?.(...args); }
  function bindNode(...args) { return canvasRuntime()?.bindNode?.(...args); }
  function beginNodeDrag(...args) { return canvasRuntime()?.beginNodeDrag?.(...args); }
  function isNodeInteractiveTarget(...args) { return canvasRuntime()?.isNodeInteractiveTarget?.(...args); }
  function isNodeDragSurface(...args) { return canvasRuntime()?.isNodeDragSurface?.(...args); }
  function selectSingleNode(...args) { return canvasRuntime()?.selectSingleNode?.(...args); }
  function selectAllCanvasNodes(...args) { return canvasRuntime()?.selectAllCanvasNodes?.(...args); }
  function clearCanvasSearch(...args) { return canvasRuntime()?.clearCanvasSearch?.(...args); }
  function canvasSearchText(...args) { return canvasRuntime()?.canvasSearchText?.(...args); }
  function nodeMatchesCanvasFilters(...args) { return canvasRuntime()?.nodeMatchesCanvasFilters?.(...args); }
  function applyCanvasFilters(...args) { return canvasRuntime()?.applyCanvasFilters?.(...args); }
  function focusCanvasSearchResult(...args) { return canvasRuntime()?.focusCanvasSearchResult?.(...args); }
  function hydrateNode(...args) { return canvasRuntime()?.hydrateNode?.(...args); }
  function deleteNode(...args) { const result = canvasRuntime()?.deleteNode?.(...args); syncCanvasEmptyState(); return result; }
  function duplicateNodes(...args) { return canvasRuntime()?.duplicateNodes?.(...args) || []; }
  function createConnectedNode(...args) { return canvasRuntime()?.createConnectedNode?.(...args); }
  async function renameNode(...args) { return canvasRuntime()?.renameNode?.(...args); }
  function toggleNodeFavorite(...args) { return canvasRuntime()?.toggleNodeFavorite?.(...args); }
  async function editNodeTags(...args) { return canvasRuntime()?.editNodeTags?.(...args); }
  function readUpload(...args) { return canvasRuntime()?.readUpload?.(...args); }
  function isSupportedUploadFile(...args) { return canvasRuntime()?.isSupportedUploadFile?.(...args); }
  function isVideoMedia(...args) { return canvasRuntime()?.isVideoMedia?.(...args); }
  function safeDownloadName(...args) { return canvasRuntime()?.safeDownloadName?.(...args); }
  function imageStatusHtml(...args) { return canvasRuntime()?.imageStatusHtml?.(...args); }
  function imageStatusMessage(...args) { return canvasRuntime()?.imageStatusMessage?.(...args); }
  function setImageStatus(...args) { return canvasRuntime()?.setImageStatus?.(...args); }
  function imageErrorTitle(...args) { return canvasRuntime()?.imageErrorTitle?.(...args); }
  function referencePreviewHtml(...args) { return canvasRuntime()?.referencePreviewHtml?.(...args); }
  function renderReferenceBox(...args) { return canvasRuntime()?.renderReferenceBox?.(...args); }
  function primaryMediaUrl(...args) { return canvasRuntime()?.primaryMediaUrl?.(...args); }
  function uniqueRefItems(...args) { return canvasRuntime()?.uniqueRefItems?.(...args); }
  function orderRefItems(...args) { return canvasRuntime()?.orderRefItems?.(...args); }
  function getResolvedImageRefItems(...args) { return canvasRuntime()?.getResolvedImageRefItems?.(...args); }
  function getResolvedImageRefs(...args) { return canvasRuntime()?.getResolvedImageRefs?.(...args); }
  function startReferenceSort(...args) { return canvasRuntime()?.startReferenceSort?.(...args); }
  function updateReferenceSort(...args) { return canvasRuntime()?.updateReferenceSort?.(...args); }
  function finishReferenceSort(...args) { return canvasRuntime()?.finishReferenceSort?.(...args); }
  function portClick(...args) { return canvasRuntime()?.portClick?.(...args); }
  function startPortDrag(...args) { return canvasRuntime()?.startPortDrag?.(...args); }
  function updateLinkDrag(...args) { return canvasRuntime()?.updateLinkDrag?.(...args); }
  function nearbyPortAt(...args) { return canvasRuntime()?.nearbyPortAt?.(...args); }
  function finishPortDrag(...args) { return canvasRuntime()?.finishPortDrag?.(...args); }
  function cancelPortDrag(...args) { return canvasRuntime()?.cancelPortDrag?.(...args); }
  function drawLinkPreview(...args) { return canvasRuntime()?.drawLinkPreview?.(...args); }
  function removeLinkPreview(...args) { return canvasRuntime()?.removeLinkPreview?.(...args); }
  function connect(...args) { return canvasRuntime()?.connect?.(...args); }
  function connectSilently(...args) { return canvasRuntime()?.connectSilently?.(...args); }
  function normalizeConnection(...args) { return canvasRuntime()?.normalizeConnection?.(...args); }
  function hydrateLinkedInputs(...args) { return canvasRuntime()?.hydrateLinkedInputs?.(...args); }
  function refreshLinkedInputTargets(...args) { return canvasRuntime()?.refreshLinkedInputTargets?.(...args); }
  function refreshDownstreamLinkedInputs(...args) { return canvasRuntime()?.refreshDownstreamLinkedInputs?.(...args); }
  function refreshAllLinkedInputs(...args) { return canvasRuntime()?.refreshAllLinkedInputs?.(...args); }
  function toggleLinkMode(...args) { return canvasRuntime()?.toggleLinkMode?.(...args); }
  function updateLinkMode(...args) { return canvasRuntime()?.updateLinkMode?.(...args); }
  function inputPortElement(...args) { return canvasRuntime()?.inputPortElement?.(...args); }
  function portElement(...args) { return canvasRuntime()?.portElement?.(...args); }
  function portCenter(...args) { return canvasRuntime()?.portCenter?.(...args); }
  function nodeSize(...args) { return canvasRuntime()?.nodeSize?.(...args); }
  function updatePortConnectionStates(...args) { return canvasRuntime()?.updatePortConnectionStates?.(...args); }
  function drawEdges(...args) { return canvasRuntime()?.drawEdges?.(...args); }
  function scheduleDrawEdges(...args) { return canvasRuntime()?.scheduleDrawEdges?.(...args); }

  window.__futureCanvasDebug = {
    get nodes() { return [...nodes.values()].map(n => ({id: n.id, type: n.type, data: n.data})); },
    get edges() { return edges.slice(); },
    connect,
    normalizeConnection: (fromId, toId, fromPort = 'text', toPort = 'prompt') => normalizeConnection(nodes.get(fromId), nodes.get(toId), fromPort, toPort),
    setNodeData(id, patch = {}) {
      const node = nodes.get(id);
      if (!node) return false;
      Object.assign(node.data || (node.data = {}), patch);
      hydrateNode(node);
      return true;
    },
    addImageAt(x, y, seed = {}) {
      return addNode('image', x, y, seed);
    }
  };

  function getInputPrompt(id) {
    return edges.filter(e => e.to === id && e.toPort === 'prompt')
      .map(e => nodes.get(e.from))
      .filter(n => n && (n.type === 'prompt' || n.type === 'character'))
      .map(n => n.data.prompt || '')
      .filter(Boolean)
      .join('\n\n');
  }
  function canvasContextSnapshot() {
    const project = projects.find(item => item.id === currentProjectId) || {};
    return {
      projectName: project.name || $('projectTitle')?.textContent || '未命名项目',
      currentProjectId,
      selectedNodeIds: [...selectedNodes],
      nodes: [...nodes.values()].map(node => ({id: node.id, type: node.type, x: node.x, y: node.y, data: node.data || {}})),
      edges: edges.slice()
    };
  }
  function promptWithCanvasContext(prompt, mode, targetNodeId = '') {
    if (targetNodeId && !selectedNodes.has(targetNodeId)) return prompt;
    const contextText = buildPromptContext(canvasContextSnapshot(), {mode, targetNodeId});
    return contextText ? [prompt, contextText].filter(Boolean).join('\n\n') : prompt;
  }
  function modelAgnosticGenerationPrefix(...args) { return providerApi()?.modelAgnosticGenerationPrefix?.(...args); }
  function applyModelAgnosticGenerationRules(...args) { return providerApi()?.applyModelAgnosticGenerationRules?.(...args); }
  function modelAgnosticTextPrefix(...args) { return providerApi()?.modelAgnosticTextPrefix?.(...args); }
  function applyModelAgnosticTextRules(...args) { return providerApi()?.applyModelAgnosticTextRules?.(...args); }
  function extractChatText(...args) { return providerApi()?.extractChatText?.(...args); }
  function apiErrorMessage(...args) { return providerApi()?.apiErrorMessage?.(...args); }
  async function chatCompletionTextRequest(...args) { return providerApi()?.chatCompletionTextRequest?.(...args); }

  function getInputImageRefs(id) {
    return getResolvedImageRefs(id);
  }
  async function ensureInputImageRefs(id, visiting = new Set()) {
    for (const edge of edges.filter(e => e.to === id && e.toPort === 'ref')) {
      const src = nodes.get(edge.from);
      if (!src || (src.type !== 'image' && src.type !== 'upload')) continue;
      if (src.type === 'image' && !src.data.url) await runImage(src.id, visiting);
    }
    return getResolvedImageRefs(id);
  }
  function runPrompt(id) {
    const node = nodes.get(id);
    if (!node) return;
    node.data.prompt = (node.data.prompt || '').trim();
    hydrateNode(node);
    saveProject();
  }
  async function optimizePrompt(id) {
    const node = nodes.get(id);
    if (!node) return;
    const linkedPrompt = node.type === 'image' || node.type === 'video' ? getInputPrompt(id) : '';
    const prompt = (node.data.prompt || linkedPrompt || '').trim();
    if (!prompt) return toast('请先输入或连接一段提示词', 'warn');
    const provider = globalProviderForKind('chat');
    const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
    const model = provider.chatModel || FutureAIApiDefaults.get('chatModel').trim();
    const apiKey = await providerApiKey(provider);
    if (!apiUrl || !apiKey) {
      return toast('请先在设置里完善全局聊天供应商和密钥', 'warn');
    }
    if (!model) {
      return toast('请先选择或填写全局聊天模型', 'warn');
    }
    const btn = node.el.querySelector('[data-optimize-prompt]');
    const oldText = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>' + (btn.hasAttribute('data-icon-only') ? '' : ' 优化中');
    }
    try {
      const optimized = await optimizePromptRequest({
        apiUrl,
        apiKey,
        model,
        provider,
        nodeType: node.type,
        prompt
      });
      node.data.prompt = optimized;
      hydrateNode(node);
      saveProject();
      toast('提示词已优化', 'success');
    } catch (err) {
      toast('优化失败：\n' + (err.message || String(err)), 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = oldText;
      }
    }
  }
  async function optimizePromptRequest(o) {
    const target = o.nodeType === 'video' ? 'AI 视频生成' : o.nodeType === 'image' ? 'AI 图片生成' : '分镜/角色提示词';
    const messages = [
      {role: 'system', content: applyModelAgnosticTextRules('你是 AI 视觉生成提示词优化器。只输出优化后的中文提示词，不解释，不加标题，不使用 Markdown。', 'prompt')},
      {role: 'user', content: `请把下面内容优化为适合${target}的高质量提示词。要求：保留用户原意，补充主体、场景、镜头、光线、风格、构图、细节和一致性约束；避免敏感和违规表达；不要超过 220 个中文字。\n\n原提示词：\n${o.prompt}`}
    ];
    const res = await fetchJsonWithRetry(joinApiPath(o.apiUrl, o.provider?.chatEndpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + o.apiKey},
      body: JSON.stringify({model: o.model, messages, temperature: 0.4})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    const text = data.choices?.[0]?.message?.content || data.output_text || data.content || '';
    if (!text.trim()) throw new Error('聊天模型没有返回可用内容');
    return text.trim().replace(/^["“]|["”]$/g, '');
  }
  function cleanDialogOptimizedPrompt(value, fallbackPrompt = '') {
    const cleaned = String(value || '')
      .trim()
      .replace(/^\s*(?:优化提示词|提示词|最终提示词)\s*[：:]\s*/i, '')
      .replace(/^['"“]|['"”]$/g, '')
      .trim()
      .slice(0, 1400);
    if (!cleaned || /模型无关规则|对话上下文规则|内部任务上下文|用户原始指令/i.test(cleaned)) return String(fallbackPrompt || '').trim();
    return cleaned;
  }
  async function optimizeDialogImagePrompt({apiUrl, apiKey, model, provider, rawPrompt, fallbackPrompt = ''}) {
    const messages = [
      {role: 'system', content: applyModelAgnosticTextRules('你是 AI 图片生成提示词优化器。只输出一段可直接用于图片模型的中文提示词，不解释、不加标题、不使用 Markdown。必须保留用户指定的主体、服装、画幅、构图和参考图约束。', 'prompt')},
      {role: 'user', content: `请把以下内部任务上下文整理为高质量图片提示词。只输出最终图片提示词本身，不得复述系统规则、内部任务上下文、历史对话、模型无关规则或“用户原始指令”等标题。保留用户原意和硬约束，补足主体、动作、场景、景别、构图、光线、材质、风格与细节；不要凭空添加文字、水印或未要求的人物；不超过 700 个中文字符。\n\n内部任务上下文：\n${String(rawPrompt || '').slice(0, 12000)}`}
    ];
    const res = await fetchJsonWithRetry(joinApiPath(apiUrl, provider?.chatEndpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
      retries: 2,
      retryUnsafe: true,
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
      body: JSON.stringify({model, messages, temperature: 0.35, max_tokens: 1200})
    });
    const data = await safeJson(res);
    if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
    const text = data.choices?.[0]?.message?.content || data.output_text || data.content || '';
    if (!String(text).trim()) throw new Error('聊天模型没有返回优化后的提示词');
    return cleanDialogOptimizedPrompt(text, fallbackPrompt);
  }
  function providerConcurrencyLimit(...args) { return generationQueueApi()?.providerConcurrencyLimit?.(...args); }
  function enqueueImageGeneration(...args) { return generationQueueApi()?.enqueueImageGeneration?.(...args); }

  async function runMediaTool(id, options = {}) {
    // quiet: a rerun on a new node; its single result toast comes from the caller.
    const say = (message, ...rest) => (options.quiet ? ((options.lastMessage = String(message || '')), false) : toast(message, ...rest));
    const node = nodes.get(id);
    if (!node || node.type !== 'media-tool') return false;
    if (!window.mediaBridge?.process) return say('当前安装缺少本地媒体处理桥接', 'warn');
    if (!await ensureStorageReady()) return false;
    const linked = edges.filter(edge => edge.to === id && edge.toPort === 'media').map(edge => nodes.get(edge.from)?.data?.url || '').filter(Boolean);
    const sourceUrls = [...new Set([...(node.data.sourceUrls || []), ...linked])].filter(Boolean).slice(0, 2);
    if (!sourceUrls.length) return say('请先连接源素材', 'warn');
    const operation = window.FutureAIMediaProcessContract?.operation(node.data.operation);
    if (window.FutureAIMediaProcessContract?.requiresSecondSource(node.data.operation) && sourceUrls.length < 2) return say('该操作需要连接两个源素材', 'warn');
    const previousUrl = node.data.url || '';
    const button = node.el.querySelector('[data-run="media-tool"]');
    if (button) {
      UIRenderHelpers.setRunButtonBusy(button, true);
    }
    node.data.status = `正在本地执行：${operation?.label || node.data.operation}`;
    node.data.statusType = 'running';
    hydrateNode(node);
    try {
      const result = await window.mediaBridge.process({
        ...node.data,
        storageDir,
        sourceUrl: sourceUrls[0],
        secondSourceUrl: sourceUrls[1] || ''
      });
      node.data.url = result.url;
      node.data.urls = [result.url];
      node.data.sourceUrls = sourceUrls;
      node.data.lastOperation = result.operation;
      node.data.status = `本地处理完成：${operation?.label || result.operation}`;
      node.data.statusType = '';
      node.data.transformations = [...(Array.isArray(node.data.transformations) ? node.data.transformations : []), {kind: result.operation, sourceUrls, outputUrl: result.url, parameters: result.requested, at: Date.now()}].slice(-50);
      const mediaType = /\.(mp4|webm|mov)(?:[?#]|$)/i.test(result.url) ? 'video' : /\.(m4a|mp3|wav|aac|ogg)(?:[?#]|$)/i.test(result.url) ? 'audio' : 'image';
      Provenance?.recordNodeOutputs(node.data, [{
        url: result.url,
        mediaType,
        providerId: 'local-ffmpeg',
        providerName: '本地 FFmpeg',
        modelId: 'local-media-tool',
        requestProtocol: 'local-process',
        parameters: result.requested,
        transformations: [{kind: result.operation, sourceUrls, at: Date.now()}],
        generatedAt: Date.now()
      }]);
      hydrateNode(node);
      refreshDownstreamLinkedInputs(node.id);
      saveProject();
      say('本地媒体处理完成（原素材未改动）', 'success');
      return true;
    } catch (error) {
      node.data.url = previousUrl;
      node.data.status = error?.message || '本地媒体处理失败';
      node.data.statusType = 'error';
      hydrateNode(node);
      saveProject();
      say(`本地媒体处理失败：\n${error?.message || error}`, 'error');
      return false;
    } finally {
      if (button) {
        UIRenderHelpers.setRunButtonBusy(button, false, 'fa-play');
      }
    }
  }
  function pumpGenerationQueue(...args) { return generationQueueApi()?.pumpGenerationQueue?.(...args); }
  async function startQueueItem(...args) { return generationQueueApi()?.startQueueItem?.(...args); }
  function queueStatusLabel(...args) { return generationQueueApi()?.queueStatusLabel?.(...args); }
  function renderQueue(...args) { return generationQueueApi()?.renderQueue?.(...args); }
  function openQueueDrawer(...args) {
    rememberDrawerFocus('queueDrawer', args[0]?.currentTarget);
    const result = generationQueueApi()?.openQueueDrawer?.(...args);
    focusDrawer('queueDrawer', '#closeQueue');
    return result;
  }
  function closeQueueDrawer(...args) {
    const wasOpen = !$('queueDrawer')?.classList.contains('hidden');
    const result = generationQueueApi()?.closeQueueDrawer?.(...args);
    if (wasOpen) restoreDrawerFocus('queueDrawer');
    return result;
  }
  function toggleQueueDrawer(...args) {
    const drawer = $('queueDrawer');
    const opening = drawer?.classList.contains('hidden');
    if (opening) rememberDrawerFocus('queueDrawer', args[0]?.currentTarget);
    const result = generationQueueApi()?.toggleQueueDrawer?.(...args);
    const isOpen = !drawer?.classList.contains('hidden');
    if (isOpen) {
      focusDrawer('queueDrawer', '#closeQueue');
      // Queue rendering can replace its list in the same frame; keep focus deterministic.
      requestAnimationFrame(() => $('closeQueue')?.focus());
    } else if (!isOpen) restoreDrawerFocus('queueDrawer');
    setTimeout(() => {
      if (!$('queueDrawer')?.classList.contains('hidden')) $('closeQueue')?.focus();
    }, 120);
    return result;
  }
  function pauseQueue(...args) { return generationQueueApi()?.pauseQueue?.(...args); }
  function resumeQueue(...args) { return generationQueueApi()?.resumeQueue?.(...args); }
  function clearQueue(...args) { return generationQueueApi()?.clearQueue?.(...args); }
  function retryFailedQueue(...args) { return generationQueueApi()?.retryFailedQueue?.(...args); }
  function onQueueListClick(...args) { return generationQueueApi()?.onQueueListClick?.(...args); }
  async function runImage(...args) { return generationQueueApi()?.runImage?.(...args); }
  async function runImageNow(...args) { return generationQueueApi()?.runImageNow?.(...args); }

  function providerHasCapabilityKey(provider, capability, model = '') {
    if (!provider) return false;
    if (provider.useGlobalKey) return Boolean(FutureAIApiDefaults.get('apiKey')?.trim());
    return Boolean(provider.apiKeySaved || provider.apiKey);
  }

  function generationSafetySettings() {
    return {
      maxTasks: Math.max(1, Math.min(100, Number($('generationMaxTasks')?.value || 12))),
      failureStop: Math.max(1, Math.min(20, Number($('generationFailureStop')?.value || 3))),
      dailyReminder: Math.max(1, Math.min(1000, Number($('generationDailyReminder')?.value || 30))),
      requireStorage: $('generationRequireStorage')?.checked !== false,
      budgetCurrency: String($('generationBudgetCurrency')?.value || 'USD').toUpperCase(),
      singleBudget: Math.max(0, Number($('generationSingleBudget')?.value || 0)),
      dailyBudget: Math.max(0, Number($('generationDailyBudget')?.value || 0)),
      projectBudget: currentProjectBudgetLimit()
    };
  }
  function generationUsageToday() {
    const now = new Date();
    const day = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const saved = getStore('futureai.generationUsage', {});
    return {day, count: saved.day === day ? Math.max(0, Number(saved.count || 0)) : 0};
  }
  function addGenerationUsage(count) {
    const usage = generationUsageToday();
    setStore('futureai.generationUsage', {day: usage.day, count: usage.count + Math.max(0, Number(count || 0))});
  }
  function currentProjectBudgetLimit() {
    const project = projects.find(item => item.id === currentProjectId);
    return Math.max(0, Number(project?.budget?.limit || 0));
  }
  function syncCurrentProjectBudgetControl() {
    if ($('generationProjectBudget')) $('generationProjectBudget').value = String(currentProjectBudgetLimit());
  }
  function persistCurrentProjectBudget() {
    const project = projects.find(item => item.id === currentProjectId);
    if (!project || !$('generationProjectBudget')) return;
    const limit = Math.max(0, Number($('generationProjectBudget').value || 0));
    const currency = String($('generationBudgetCurrency')?.value || 'USD').toUpperCase();
    if (Number(project.budget?.limit || 0) === limit && String(project.budget?.currency || currency) === currency) return;
    project.budget = {limit, currency, updatedAt: Date.now()};
    saveProjects();
  }
  function generationBudgetLedger() {
    const value = getStore('futureai.generationBudgetLedger', []);
    return Array.isArray(value) ? value : [];
  }
  function setGenerationBudgetLedger(value) {
    setStore('futureai.generationBudgetLedger', Array.isArray(value) ? value.slice(-5000) : []);
  }
  function renderBudgetLedgerReport() {
    const host = $('budgetLedgerReport');
    if (!host || !BudgetGuard) return;
    const ledger = generationBudgetLedger().slice(-12).reverse();
    const currency = String($('generationBudgetCurrency')?.value || 'USD').toUpperCase();
    const usage = BudgetGuard.usageFor(generationBudgetLedger(), {projectId: currentProjectId || '', currency});
    const rows = ledger.length ? ledger.map(item => {
      const estimateMin = Number(item.estimatedMinAmount ?? item.estimatedAmount ?? 0);
      const estimateMax = Number(item.estimatedMaxAmount ?? item.estimatedAmount ?? 0);
      const estimate = Math.abs(estimateMax - estimateMin) > 0.0000005
        ? `${item.currency} ${estimateMin.toFixed(4)} - ${estimateMax.toFixed(4)}`
        : `${item.currency} ${Number(item.estimatedAmount || 0).toFixed(4)}`;
      const actual = item.actualAmount == null ? '未回填实际金额' : `${item.currency} ${Number(item.actualAmount).toFixed(4)} (${Number(item.differenceAmount || 0) >= 0 ? '+' : ''}${Number(item.differenceAmount || 0).toFixed(4)})`;
      const source = item.priceSource || 'unknown';
      const updated = item.sourceUpdatedAt ? ` · 价格更新 ${esc(item.sourceUpdatedAt)}` : '';
      return `<div class="budget-ledger-row"><span>${esc(item.model || item.kind || '任务')} · ${esc(item.status || '')}</span><small>预计 ${estimate} · 实际 ${actual} · 来源 ${esc(source)}${updated}${item.differenceReason ? ` · ${esc(item.differenceReason)}` : ''}</small></div>`;
    }).join('') : '<small>还没有生成费用记录。</small>';
    host.innerHTML = `<div class="budget-ledger-summary">今日 ${currency} ${usage.daily.toFixed(4)} · 当前项目 ${currency} ${usage.project.toFixed(4)}</div>${rows}`;
  }
  function previewBudgetRoutes() {
    const host = $('budgetLedgerReport');
    if (!host || !BudgetGuard) return;
    const preference = String($('budgetRoutePreference')?.value || 'balanced');
    const candidates = [];
    const providers = Array.isArray(apiProviders) ? apiProviders : [];
    providers.forEach(provider => {
      ['image', 'video', 'chat'].forEach(kind => {
        const model = String(provider[`${kind}Model`] || provider.model || '').trim();
        if (!model) return;
        const profile = ModelCapabilities?.resolveProfile?.({provider, modelId: model, kind});
        const estimate = ModelCapabilities?.estimateCost?.(profile, kind === 'video' ? {duration: 5} : kind === 'chat' ? {tokens: 1000} : {count: 1});
        candidates.push({providerId: provider.id || provider.name, modelId: model, price: estimate?.amount ?? null, quality: profile?.qualityScore ?? null, latencyMs: profile?.latencyMs ?? null});
      });
    });
    const suggestions = BudgetGuard.routeSuggestions(candidates, preference).slice(0, 8);
    renderBudgetLedgerReport();
    host.insertAdjacentHTML('afterbegin', suggestions.length ? `<div class="budget-route-suggestions"><strong>候选路由（${esc(preference)}）</strong>${suggestions.map((item, index) => `<div class="budget-route-row"><span>${index + 1}. ${esc(item.modelId)}</span><small>${esc(item.providerId)} · ${item.price == null ? '价格待接口确认' : `${currencyOrDefault(item.price)}`} · score ${item.score}</small></div>`).join('')}</div>` : '<div class="budget-route-suggestions"><small>暂无足够模型价格数据。</small></div>');
  }
  function currencyOrDefault(amount) {
    const currency = String($('generationBudgetCurrency')?.value || 'USD').toUpperCase();
    return `${currency} ${Number(amount).toFixed(4)}`;
  }
  function generationBudgetDecision(estimates, safety = generationSafetySettings()) {
    return BudgetGuard?.evaluateBudget({
      estimates,
      currency: safety.budgetCurrency,
      singleLimit: safety.singleBudget,
      dailyLimit: safety.dailyBudget,
      projectLimit: safety.projectBudget,
      projectId: currentProjectId || '',
      day: BudgetGuard.dayKey(),
      ledger: generationBudgetLedger()
    }) || {allowed: true, estimates: []};
  }
  function consumeBatchBudgetOverride() {
    if (!budgetBatchOverride || budgetBatchOverride.projectId !== currentProjectId || budgetBatchOverride.expiresAt < Date.now() || budgetBatchOverride.remaining <= 0) return false;
    budgetBatchOverride.remaining -= 1;
    return true;
  }
  // Every image/video generation goes authorize → (request) → complete with the returned id.
  // Besides the budget ledger, the id carries the balance-chip spend ticket (balance snapshot
  // taken here, just before the request), so it is always non-empty even without a ledger entry.
  const generationSpendTickets = new Map();
  async function authorizeGenerationBudget(args = {}) {
    const ledgerId = await authorizeGenerationBudgetLedger(args);
    const id = ledgerId || `spend-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    generationSpendTickets.set(id, {ledger: Boolean(ledgerId), spend: balanceChip?.noteGenerationStarted(args.provider) || null});
    return id;
  }
  async function authorizeGenerationBudgetLedger({node, provider, model, kind, request, profile = null} = {}) {
    if (!BudgetGuard || !ModelCapabilities) return '';
    const capability = profile || ModelCapabilities.resolveProfile({provider, modelId: model, kind});
    const estimate = ModelCapabilities.estimateCost(capability, request || {});
    if (!estimate?.amount) return '';
    const decision = generationBudgetDecision([estimate]);
    let override = false;
    if (!decision.allowed) {
      override = consumeBatchBudgetOverride();
      if (!override) {
        const confirmed = await openModal({
          title: '预算保护已阻止提交',
          text: `${BudgetGuard.decisionText(decision)}\n\n本次预计 ${ModelCapabilities.formatEstimate?.(estimate) || `${estimate.currency} ${estimate.amount}`}。预算按上界保护，默认不会发送 API 请求；只有明确确认后才会继续。`,
          okText: '确认超预算继续',
          cancelText: '停止提交',
          confirm: true
        });
        if (!confirmed) {
          const error = new Error('已由预算保护停止，未发送 API 请求');
          error.code = 'BUDGET_EXCEEDED';
          throw error;
        }
        override = true;
      }
    }
    const id = `budget-${Date.now()}-${Math.random().toString(16).slice(2, 7)}`;
    setGenerationBudgetLedger(BudgetGuard.recordEstimate(generationBudgetLedger(), {
      id,
      projectId: currentProjectId || '',
      nodeId: node?.id || '',
      day: BudgetGuard.dayKey(),
      currency: estimate.currency,
      estimatedAmount: estimate.amount,
      estimatedMinAmount: estimate.minAmount ?? estimate.amount,
      estimatedMaxAmount: estimate.maxAmount ?? estimate.amount,
      kind,
      model,
      override,
      priceSource: capability?.source?.kind || 'unknown',
      sourceUpdatedAt: capability?.source?.updatedAt || ''
    }));
    return id;
  }
  function completeGenerationBudget(id, result = {}) {
    // Every image/video generation (done or failed) ends here; a failed one may still have billed.
    const ticket = generationSpendTickets.get(id);
    generationSpendTickets.delete(id);
    balanceChip?.noteGenerationFinished(ticket?.spend || null, result);
    if (!id || !BudgetGuard || (ticket && !ticket.ledger)) return;
    setGenerationBudgetLedger(BudgetGuard.completeEntry(generationBudgetLedger(), id, result));
  }
  function generationReferenceProblems(node, add) {
    const explicit = [node.data.manualRefUrl, node.data.refUrl].filter(Boolean);
    explicit.forEach(url => {
      if (!safeMediaUrl(url)) add(node, '参考素材地址无效或已被安全策略阻止', '重新上传参考素材', {nodeId: node.id});
    });
    edges.filter(edge => edge.to === node.id && edge.toPort === 'ref').forEach(edge => {
      const source = nodes.get(edge.from);
      if (!source || (source.type !== 'upload' && source.type !== 'image')) {
        add(node, '参考素材连接已失效', '重新连接图片或上传节点', {nodeId: node.id});
        return;
      }
      if (source.type === 'upload' && !safeMediaUrl(source.data.url || '')) add(node, '连接的上传素材不可读取', '重新上传该素材', {nodeId: source.id});
      if (source.type === 'image' && !source.data.url && !String(source.data.prompt || getInputPrompt(source.id) || '').trim()) add(node, '连接的图片参考既没有结果也没有提示词', '先完善参考图片节点', {nodeId: source.id});
    });
  }
  function generationReferenceDescriptors(node) {
    // Image nodes also remember roles of refs that are no longer (or not yet) wired; count only the live ones.
    const live = item => node.type !== 'image' || (item?.sourceNodeId
      ? edges.some(edge => edge.from === item.sourceNodeId && edge.to === node.id && edge.toPort === 'ref')
      : Boolean(item?.url));
    const saved = Array.isArray(node.data.references) ? node.data.references.filter(live) : [];
    if (saved.length) {
      return saved.map(item => ({
        role: String(item?.role || 'reference'),
        sourceNodeId: String(item?.sourceNodeId || ''),
        assetId: String(item?.assetId || ''),
        mediaType: String(item?.mediaType || ''),
        mime: String(item?.mime || ''),
        sizeBytes: Math.max(0, Number(item?.sizeBytes || 0))
      }));
    }
    const direct = [...new Set([node.data.manualRefUrl, node.data.refUrl].filter(Boolean))];
    const linked = edges.filter(edge => edge.to === node.id && edge.toPort === 'ref');
    const descriptors = direct.map((url, index) => ({
      role: node.type === 'video' && index === 0 ? 'first-frame' : 'reference',
      url,
      mime: index === 0 ? String(node.data.manualRefMime || '') : '',
      sizeBytes: index === 0 ? Math.max(0, Number(node.data.manualRefSizeBytes || 0)) : 0
    }));
    linked.forEach((edge, index) => {
      const source = nodes.get(edge.from);
      descriptors.push({
        role: node.type === 'video' && descriptors.length + index === 0 ? 'first-frame' : source?.type === 'video' ? 'source' : 'reference',
        sourceNodeId: String(source?.id || edge.from || ''),
        mediaType: source?.type === 'video' ? 'video' : String(source?.data?.kind || ''),
        mime: String(source?.data?.mime || ''),
        sizeBytes: Math.max(0, Number(source?.data?.sizeBytes || 0))
      });
    });
    return descriptors;
  }
  async function generationPreflight() {
    const issues = [];
    const warnings = [];
    const blockedNodeIds = new Set();
    // Whole-canvas runs only fill empty nodes; nodes that already show a result are skipped.
    const allGenerationNodes = [...nodes.values()].filter(node => node.type === 'image' || node.type === 'video' || node.type === 'comfyui');
    const skippedNodeIds = new Set(allGenerationNodes.filter(nodeHasResult).map(node => node.id));
    const generationNodes = allGenerationNodes.filter(node => !skippedNodeIds.has(node.id));
    let requests = 0;
    const estimatedCosts = new Map();
    let globalBlocked = false;
    const add = (node, problem, action, target = {}) => {
      if (node?.id) blockedNodeIds.add(node.id);
      issues.push({text: `${node ? nodeDisplayTitle(node) + '：' : ''}${problem}（${action}）`, nodeId: target.nodeId || node?.id || '', focusId: target.focusId || ''});
    };
    for (const node of generationNodes) {
      const prompt = String(node.data.prompt || getInputPrompt(node.id) || '').trim();
      if (!prompt) add(node, '缺少提示词', '填写提示词或连接文本节点', {nodeId: node.id});
      generationReferenceProblems(node, add);
      if (node.type === 'comfyui') {
        requests += 1;
        if (!String(node.data.workflowJson || $('comfyWorkflowJson')?.value || '').trim()) add(node, '没有 ComfyUI workflow', '在设置中导入 workflow JSON', {focusId: 'comfyWorkflowJson'});
        continue;
      }
      const capability = node.type === 'video' ? 'video' : 'image';
      const provider = currentProviderForNode(node, capability);
      const apiUrl = String(provider?.apiUrl || FutureAIApiDefaults.get('apiUrl') || '').trim();
      const model = String(node.data.model || (node.type === 'video' ? provider?.videoModel || FutureAIApiDefaults.get('videoModel') : provider?.imageModel || FutureAIApiDefaults.get('imageModel')) || '').trim();
      if (!apiUrl) add(node, '缺少 API 地址', '打开设置并选择可用供应商', {focusId: 'apiProviderList'});
      const keyOptional = node.type === 'image' && provider?.type === 'custom-sync';
      if (!keyOptional && !providerHasCapabilityKey(provider, capability, model)) add(node, `没有可用于${node.type === 'video' ? '视频' : '图片'}的 Key`, '在设置中为该 API 保存 Key', {focusId: 'apiProviderList'});
      if (!model) add(node, `没有选择${node.type === 'video' ? '视频' : '图片'}模型`, '选择该 API 支持的模型', {focusId: 'apiProviderList'});
      if (node.type === 'image') {
        requests += Math.max(1, Math.min(4, Number(node.data.count) || 1));
        if (!imageTargetSize(node.data)) add(node, '自定义宽高无效', '宽和高填写 64-16384 之间的整数', {nodeId: node.id});
      } else requests += 1;
      if (model && ModelCapabilities) {
        const references = generationReferenceDescriptors(node);
        const profile = ModelCapabilities.resolveProfile({provider, modelId: model, kind: capability});
        const request = node.type === 'image'
          ? {
              operation: references.length ? 'edit' : 'generate',
              aspect: node.data.aspect || '',
              resolution: node.data.resolution || '1K',
              count: Math.max(1, Math.min(4, Number(node.data.count) || 1)),
              references
            }
          : {
              operation: node.data.operation || 'generate',
              size: window.FutureAIMediaDimensions?.videoTargetSize(node.data) || node.data.size,
              duration: node.data.duration || '5',
              count: 1,
              references
            };
        const validation = ModelCapabilities.validateRequest(profile, request);
        validation.errors.forEach(item => add(node, item.message, '更换模型或调整节点参数', {nodeId: node.id}));
        validation.warnings.forEach(item => warnings.push(`${nodeDisplayTitle(node)}：${item.message}`));
        const estimate = ModelCapabilities.estimateCost(profile, request);
        if (estimate) {
          const previous = estimatedCosts.get(estimate.currency) || {amount: 0, minAmount: 0, maxAmount: 0};
          estimatedCosts.set(estimate.currency, {
            amount: previous.amount + Number(estimate.amount || 0),
            minAmount: previous.minAmount + Number(estimate.minAmount ?? estimate.amount ?? 0),
            maxAmount: previous.maxAmount + Number(estimate.maxAmount ?? estimate.amount ?? 0)
          });
        }
      }
    }
    const safety = generationSafetySettings();
    if (requests > safety.maxTasks) {
      issues.push({text: `本次预计 ${requests} 次请求，超过单次上限 ${safety.maxTasks}（在设置的“生成保护”中调整，或减少节点）`, focusId: 'generationMaxTasks'});
      globalBlocked = true;
    }
    if (safety.requireStorage) {
      if (!storageDir) {
        issues.push({text: '尚未选择本地存储目录（先选择目录，确保生成结果可恢复）', focusId: 'localStoragePath'});
        globalBlocked = true;
      } else if (!window.localStorageBridge?.checkWritable) {
        issues.push({text: '本地存储写入检查不可用（重启软件后再试）', focusId: 'localStoragePath'});
        globalBlocked = true;
      } else {
        try {
          await window.localStorageBridge.checkWritable(storageDir);
          if (usingDefaultStorageDir()) warnings.push(`当前使用默认存储目录 ${storageDir}，建议在设置 › 本地存储中选择你自己的存储目录。`);
        } catch (err) {
          issues.push({text: `本地存储目录不可写：${err.message || String(err)}（重新选择可写目录）`, focusId: 'localStoragePath'});
          globalBlocked = true;
        }
      }
    }
    if (generationNodes.some(node => node.type === 'image' && (node.data.refUrl || edges.some(edge => edge.to === node.id && edge.toPort === 'ref')))) warnings.push('参考图兼容回退可能增加调用次数。');
    warnings.push('失败后手动重试或改用备用模型/Key 会产生新的 API 调用。');
    const runnableRequests = globalBlocked ? 0 : generationNodes.reduce((sum, node) => blockedNodeIds.has(node.id) ? sum : sum + (node.type === 'image' ? Math.max(1, Math.min(4, Number(node.data.count) || 1)) : 1), 0);
    const estimatedCostText = [...estimatedCosts.entries()]
      .map(([currency, estimate]) => ModelCapabilities.formatEstimate({currency, ...estimate}))
      .join(' + ');
    const budgetDecision = generationBudgetDecision(
      [...estimatedCosts.entries()].map(([currency, estimate]) => ({currency, ...estimate})),
      Object.assign({}, safety, {singleBudget: 0})
    );
    return {issues, warnings: [...new Set(warnings)], requests, runnableRequests, estimatedCostText, budgetDecision, totalNodes: generationNodes.length, runnableNodes: globalBlocked ? 0 : Math.max(0, generationNodes.length - blockedNodeIds.size), blockedNodes: globalBlocked ? generationNodes.length : blockedNodeIds.size, blockedNodeIds, skippedNodeIds, globalBlocked, safety};
  }
  function focusGenerationIssue(issue) {
    if (!issue) return;
    if (issue.focusId) {
      openSettings();
      revealSettingsTarget(issue.focusId);
      return;
    }
    if (issue.nodeId && nodes.has(issue.nodeId)) {
      closeSettings();
      selectSingleNode(issue.nodeId);
      nodes.get(issue.nodeId)?.el?.scrollIntoView?.({block: 'center', inline: 'center'});
    }
  }

  async function runAll() {
    if (queuePaused) return toast('生成队列已暂停，请先恢复队列再运行全部节点', 'warn');
    const button = $('runAll');
    if (button?.disabled) return;
    const preflight = await generationPreflight();
    if (preflight.issues.length) {
      const fix = await openModal({
        title: `运行前发现 ${preflight.issues.length} 个问题`,
        text: `可运行节点 ${preflight.runnableNodes} 个，不可运行 ${preflight.blockedNodes} 个。\n\n` + preflight.issues.slice(0, 16).map((item, index) => `${index + 1}. ${item.text}`).join('\n') + (preflight.issues.length > 16 ? `\n还有 ${preflight.issues.length - 16} 个问题未显示。` : ''),
        okText: '定位第一个问题',
        cancelText: preflight.globalBlocked ? '取消' : '运行可用项',
        cancelValue: preflight.globalBlocked ? null : 'run-available',
        confirm: true
      });
      if (fix === true) focusGenerationIssue(preflight.issues[0]);
      if (fix !== 'run-available') return;
    }
    const skippedNote = skippedResultText(preflight.skippedNodeIds.size);
    if (!preflight.requests) return toast(skippedNote ? `没有需要生成的空节点：${skippedNote}` : '当前画布没有可生成的图片、视频或 ComfyUI 节点', 'warn');
    const plannedRequests = preflight.runnableRequests || preflight.requests;
    if (preflight.budgetDecision && !preflight.budgetDecision.allowed) {
      const budgetConfirmed = await openModal({
        title: '批量任务超过费用预算',
        text: `${BudgetGuard.decisionText(preflight.budgetDecision)}\n\n批量预计费用：${preflight.estimatedCostText || '价格数据不足'}。默认不会提交任何 API 请求。`,
        okText: '确认超预算运行',
        cancelText: '停止运行',
        confirm: true
      });
      if (!budgetConfirmed) return;
      budgetBatchOverride = {projectId: currentProjectId, remaining: plannedRequests, expiresAt: Date.now() + 30 * 60 * 1000};
    }
    const usage = generationUsageToday();
    const dailyWarning = usage.count + plannedRequests >= preflight.safety.dailyReminder
      ? `\n\n今日已记录 ${usage.count} 次请求，本次后约 ${usage.count + plannedRequests} 次，已达到每日提醒值 ${preflight.safety.dailyReminder}。`
      : '';
    const confirmed = await openModal({
      title: '确认运行全部节点',
      text: `可运行节点 ${preflight.runnableNodes} 个，不可运行 ${preflight.blockedNodes} 个。${skippedNote ? `\n${skippedNote}。` : ''}\n预计发起 ${preflight.runnableRequests || preflight.requests} 次生成请求。${preflight.estimatedCostText ? `\n已配置价格的模型预计费用：${preflight.estimatedCostText}。` : '\n当前模型尚未配置价格，无法准确估算费用。'}\n连续失败 ${preflight.safety.failureStop} 次后会停止后续任务。\n\n${preflight.warnings.join('\n')}${dailyWarning}`,
      okText: '开始运行',
      confirm: true
    });
    if (!confirmed) return;
    addGenerationUsage(preflight.runnableRequests || preflight.requests);
    if (button) button.disabled = true;
    const oldButtonHtml = button?.innerHTML || '';
    if (button) button.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 运行中';
    let completed = 0;
    let failed = 0;
    let consecutiveFailures = 0;
    let stopped = false;
    try {
      for (const node of nodes.values()) {
        if (node.type !== 'prompt' && node.type !== 'character') continue;
        runPrompt(node.id);
        completed++;
      }
      const tasks = [...nodes.values()].filter(node => (node.type === 'image' || node.type === 'comfyui' || node.type === 'video') && !preflight.blockedNodeIds.has(node.id) && !preflight.skippedNodeIds.has(node.id));
      for (const node of tasks) {
        let ok = false;
        try {
          ok = node.type === 'image' ? (await runImage(node.id)) !== false : node.type === 'comfyui' ? Boolean(await runComfyUI(node.id)) : Boolean(await runVideo(node.id));
        } catch {
          ok = false;
        }
        if (ok) {
          completed++;
          consecutiveFailures = 0;
        } else {
          failed++;
          consecutiveFailures++;
        }
        if (consecutiveFailures >= preflight.safety.failureStop) {
          stopped = true;
          break;
        }
      }
      toast(`全部节点运行结束：完成 ${completed}，失败 ${failed}${stopped ? `，因连续失败 ${consecutiveFailures} 次已停止后续任务` : ''}${skippedNote ? `；${skippedNote}` : ''}`, failed ? 'warn' : 'success');
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = oldButtonHtml;
      }
    }
  }

  async function runComfyUI(id) {
    const node = nodes.get(id);
    if (!node) return;
    const previousUrl = node.data.url || '';
    const previousUrls = Array.isArray(node.data.urls) ? [...node.data.urls] : (previousUrl ? [previousUrl] : []);
    const baseUrl = normalizeComfyUrl($('comfyUrl')?.value || 'http://127.0.0.1:8188');
    const ownPrompt = (node.data.prompt || '').trim();
    let prompt = ownPrompt || getInputPrompt(id);
    prompt = promptWithCanvasContext(prompt, 'comfy', node.id);
    prompt = applyModelAgnosticGenerationRules(prompt, 'comfy');
    const workflowText = node.data.workflowJson || $('comfyWorkflowJson')?.value || '';
    if (!workflowText.trim()) { toast('请先在设置里导入 ComfyUI workflow JSON', 'warn'); return false; }
    if (!prompt) { toast('ComfyUI 节点缺少提示词', 'warn'); return false; }
    const btn = node.el.querySelector('[data-run="comfyui"]');
    UIRenderHelpers.setRunButtonBusy(btn, true);
    setImageStatus(node, 'running', '正在提交 ComfyUI workflow', 'ComfyUI 运行中');
    try {
      const workflow = prepareComfyWorkflow(workflowText, {
        prompt,
        negative: node.data.negative || '',
        width: Number(node.data.width) || 1024,
        height: Number(node.data.height) || 1024,
        seed: node.data.seed
      });
      const submit = await submitComfyWorkflow(baseUrl, workflow);
      node.data.promptId = submit.prompt_id || '';
      setImageStatus(node, 'running', '任务已提交：' + node.data.promptId + '\n正在等待输出图片', 'ComfyUI 队列中');
      const images = await pollComfyHistory(baseUrl, node.data.promptId);
      if (!images.length) throw new Error('ComfyUI history 中没有找到输出图片');
      const urls = [];
      for (let i = 0; i < images.length; i++) {
        const viewUrl = comfyViewUrl(baseUrl, images[i]);
        urls.push(await persistMediaUrl(viewUrl, `comfyui_${Date.now()}_${i + 1}`, 'png'));
      }
      node.data.url = urls[0] || '';
      node.data.urls = urls;
      node.data.workflowName = node.data.workflowName || $('comfyWorkflowName')?.value || 'ComfyUI 工作流';
      setImageStatus(node, '', '', '');
      refreshDownstreamLinkedInputs(node.id);
      addHistory({type: 'image', url: node.data.url, urls, prompt, model: 'ComfyUI', size: `${node.data.width || 1024}x${node.data.height || 1024}`, time: Date.now()});
      const outputData = {prompt, model: 'ComfyUI', size: `${node.data.width || 1024}x${node.data.height || 1024}`, resolution: '1K', url: node.data.url, urls};
      const linkedOutput = edges
        .filter(edge => edge.from === node.id && edge.fromPort === 'image')
        .map(edge => nodes.get(edge.to))
        .find(target => target?.type === 'image');
      // Only an empty linked output node is filled; one that already shows a picture keeps it and the new output gets its own node.
      const fillLinked = linkedOutput && !nodeHasResult(linkedOutput);
      const imageNode = fillLinked ? linkedOutput : batchVariants().spawnRight(linkedOutput || node, 'image', outputData);
      if (fillLinked) {
        Object.assign(imageNode.data, outputData);
      } else {
        connectSilently(node.id, 'image', imageNode.id, 'ref');
      }
      hydrateNode(imageNode);
      drawEdges();
      saveProject();
      toast(linkedOutput && !fillLinked ? 'ComfyUI 输出已放到右侧新节点，原图保留' : 'ComfyUI 输出已回流到画布', 'success');
      return true;
    } catch (err) {
      node.data.url = previousUrl;
      node.data.urls = previousUrls;
      setImageStatus(node, 'error', err.message || String(err), 'ComfyUI 失败');
      refreshDownstreamLinkedInputs(node.id);
      saveProject();
      toast('ComfyUI 失败：\n' + (err.message || String(err)), 'error');
      return false;
    } finally {
      UIRenderHelpers.setRunButtonBusy(btn, false);
    }
  }

  function blobToDataUrl(blob) {
    return MediaUtils.blobToDataUrl(blob);
  }
  async function testComfyUI() {
    const baseUrl = normalizeComfyUrl($('comfyUrl')?.value || 'http://127.0.0.1:8188');
    try {
      const res = await fetchJsonWithRetry(baseUrl + '/system_stats', {timeoutMs: API_TIMEOUTS.comfy, cache: 'no-store'});
      if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
      await safeJson(res);
      toast('ComfyUI 连接成功：' + baseUrl, 'success');
      saveSettings();
    } catch (err) {
      toast('ComfyUI 连接失败：\n' + (err.message || String(err)), 'error');
    }
  }
  function importComfyWorkflowFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result || '');
        const workflow = parseComfyWorkflow(raw);
        const pretty = JSON.stringify(workflow, null, 2);
        $('comfyWorkflowJson').value = pretty;
        $('comfyWorkflowName').value = file.name.replace(/\.json$/i, '') || 'ComfyUI 工作流';
        comfyWorkflowCache = workflow;
        saveSettings();
        nodes.forEach(node => {
          if (node.type !== 'comfyui') return;
          node.data.workflowJson = node.data.workflowJson || pretty;
          node.data.workflowName = node.data.workflowName || $('comfyWorkflowName').value;
          hydrateNode(node);
        });
        toast('ComfyUI workflow 已导入', 'success');
      } catch (err) {
        toast('导入失败：\n' + (err.message || String(err)), 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }
  function exportComfyWorkflow() {
    exportComfyWorkflowText($('comfyWorkflowJson')?.value || '', $('comfyWorkflowName')?.value || 'comfyui-workflow');
  }
  function exportComfyWorkflowText(text, name = 'comfyui-workflow') {
    if (!text.trim()) return toast('当前没有可导出的 ComfyUI workflow', 'warn');
    try {
      const pretty = JSON.stringify(parseComfyWorkflow(text), null, 2);
      const blob = new Blob([pretty], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (String(name || 'comfyui-workflow').replace(/[\\/:*?"<>|]+/g, '_')) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('导出失败：\n' + (err.message || String(err)), 'error');
    }
  }
  function importComfyWorkflowIntoNode(node, file, input) {
    if (input) input.value = '';
    if (!node || !file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workflow = parseComfyWorkflow(String(reader.result || ''));
        node.data.workflowJson = JSON.stringify(workflow, null, 2);
        node.data.workflowName = file.name.replace(/\.json$/i, '') || node.data.workflowName || 'ComfyUI 工作流';
        comfyWorkflowCache = workflow;
        hydrateNode(node);
        saveProject();
        toast('节点 workflow 已导入', 'success');
      } catch (err) {
        toast('节点 workflow 导入失败：\n' + (err.message || String(err)), 'error');
      }
    };
    reader.readAsText(file, 'utf-8');
  }
  function saveComfyNodeWorkflowGlobal(node) {
    if (!node) return;
    const text = node.data.workflowJson || '';
    if (!text.trim()) return toast('当前 ComfyUI 节点没有 workflow JSON', 'warn');
    try {
      const pretty = JSON.stringify(parseComfyWorkflow(text), null, 2);
      if ($('comfyWorkflowJson')) $('comfyWorkflowJson').value = pretty;
      if ($('comfyWorkflowName')) $('comfyWorkflowName').value = node.data.workflowName || 'ComfyUI 工作流';
      comfyWorkflowCache = parseComfyWorkflow(pretty);
      saveSettings();
      toast('已保存为全局 ComfyUI workflow', 'success');
    } catch (err) {
      toast('保存失败：\n' + (err.message || String(err)), 'error');
    }
  }
  function clearComfyWorkflow() {
    if ($('comfyWorkflowJson')) $('comfyWorkflowJson').value = '';
    comfyWorkflowCache = null;
    saveSettings();
    toast('ComfyUI workflow 已清空', 'success');
  }

  function modelFieldForKind(kind) {
    return kind === 'video' ? 'videoModel' : kind === 'image' ? 'imageModel' : 'chatModel';
  }
  function capabilityForModelKind(kind) {
    return kind === 'video' ? 'video' : kind === 'image' ? 'image' : 'text';
  }
  function classifyModelKind(model = '') {
    const value = String(model || '').trim();
    if (!value) return '';
    if (/video|sora|kling|wan\d|wan-|wan_|hailuo|runway|veo|luma|pika|seedance|t2v|i2v|vidu|pixverse|可灵|即梦/i.test(value)) return 'video';
    if (/image|img|dall|gpt-image|flux|sdxl|stable|kolors|seedream|wanx|black-forest|midjourney|mj-|ideogram|recraft|文生图|生图/i.test(value)) return 'image';
    if (/gpt|chat|claude|gemini|qwen|deepseek|kimi|doubao|glm|llama|mistral|yi-|ernie|baichuan|moonshot|instruct|turbo|plus|pro/i.test(value)) return 'chat';
    return '';
  }
  function modelKindLabel(kind) {
    return kind === 'video' ? '视频' : kind === 'image' ? '图片' : '文本';
  }
  function isZexImageGateway(provider = {}) {
    const apiUrl = String(provider?.apiUrl || '').toLowerCase();
    const name = String(provider?.name || '').toLowerCase();
    return /(?:^|\/\/)zexapi\.com(?:\/|$)/i.test(apiUrl) || /章鱼哥/.test(name);
  }
  function compactModelId(value = '') {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function knownModelIdForAlias(model = '', provider = {}) {
    const value = String(model || '').trim();
    if (!value) return '';
    const models = Array.isArray(provider?.models) ? provider.models : [];
    const exact = models.find(candidate => String(candidate || '').trim().toLowerCase() === value.toLowerCase());
    if (exact) return String(exact).trim();
    const compact = compactModelId(value);
    if (!compact) return '';
    const equivalent = models.find(candidate => compactModelId(candidate) === compact);
    return equivalent ? String(equivalent).trim() : '';
  }
  function normalizeKnownImageModelAlias(model = '', provider = {}) {
    const value = String(model || '').trim();
    if (!value || !isZexImageGateway(provider)) return value;
    // Keep the supplier's exact ID. Compact matching only bridges punctuation aliases
    // when that exact ID was actually returned by /models; never invent an ID.
    return knownModelIdForAlias(value, provider) || value;
  }
  function effectiveImageModel(provider = {}, model = '', resolution = '1K') {
    const normalized = normalizeKnownImageModelAlias(model, provider);
    if (isZexImageGateway(provider) && /^(?:image2|gpt[-_]?image[-_]?2)$/i.test(normalized) && String(resolution || '1K').toUpperCase() !== '1K') {
      const target = String(resolution || '1K').toUpperCase();
      const preferred = (target === '4K'
        ? ['gpt-image-2-4K', 'gpt-image-2', 'gpt-image2', 'gpt-image-2-2K']
        : ['gpt-image-2-2K', 'gpt-image-2', 'gpt-image2', 'gpt-image-2-4K'])
        .map(candidate => knownModelIdForAlias(candidate, provider))
        .find(Boolean);
      return preferred || normalized;
    }
    return normalized;
  }
  function modelsForKind(models = [], kind = 'chat') {
    return unique((models || []).filter(model => classifyModelKind(model) === kind));
  }
  function firstImportedModelForKind(models = [], kind = 'chat') {
    return modelsForKind(models, kind)[0] || '';
  }
  function normalizeModelRecords(records = []) {
    const merged = new Map();
    (records || []).forEach(record => {
      const normalized = typeof record === 'string'
        ? {id: String(record || '').trim(), label: '', kind: ''}
        : {
          id: String(record?.id || '').trim(),
          label: String(record?.label || '').trim(),
          kind: String(record?.kind || '').trim()
        };
      if (!isLikelyModelId(normalized.id)) return;
      const previous = merged.get(normalized.id);
      merged.set(normalized.id, {
        id: normalized.id,
        label: normalized.label || previous?.label || '',
        kind: normalized.kind || previous?.kind || ''
      });
    });
    return [...merged.values()];
  }
  function applyImportedModelRecordsToProvider(provider, records = []) {
    if (!provider) return {chat: 0, image: 0, video: 0, unknown: 0};
    const existingRecords = normalizeModelRecords(provider.modelCatalog || []);
    const cleanRecords = normalizeModelRecords([...existingRecords, ...(records || [])]);
    provider.modelCatalog = cleanRecords.map(record => ({
      id: record.id,
      label: record.label,
      kind: record.kind || classifyModelKind(`${record.id} ${record.label}`)
    }));
    const cleanModels = expandKnownModelAliases(unique([...(provider.models || []), ...cleanRecords.map(record => record.id)]));
    provider.models = cleanModels;
    const counts = {chat: 0, image: 0, video: 0, unknown: 0};
    cleanModels.forEach(model => {
      const catalogRecord = provider.modelCatalog.find(record => record.id === model);
      const kind = catalogRecord?.kind || classifyModelKind(model);
      if (kind && counts[kind] !== undefined) counts[kind] += 1;
      else counts.unknown += 1;
    });
    const catalogForKind = kind => provider.modelCatalog
      .filter(record => (record.kind || classifyModelKind(`${record.id} ${record.label}`)) === kind)
      .map(record => record.id);
    const chatCandidate = firstImportedModelForKind(catalogForKind('chat').concat(modelsForKind(cleanModels, 'chat')), 'chat');
    const imageCandidate = firstImportedModelForKind(catalogForKind('image').concat(modelsForKind(cleanModels, 'image')), 'image');
    const videoCandidate = firstImportedModelForKind(catalogForKind('video').concat(modelsForKind(cleanModels, 'video')), 'video');
    if (!provider.chatModel && chatCandidate) provider.chatModel = chatCandidate;
    if (!provider.imageModel && imageCandidate) provider.imageModel = imageCandidate;
    if (!provider.videoModel && videoCandidate) provider.videoModel = videoCandidate;
    return counts;
  }
  function applyImportedModelsToProvider(provider, models = []) {
    return applyImportedModelRecordsToProvider(provider, (models || []).map(model => ({id: String(model || '').trim()})));
  }
  function modelImportSummary(counts = {}) {
    const parts = [
      counts.chat ? `${counts.chat} 个文本` : '',
      counts.image ? `${counts.image} 个图片` : '',
      counts.video ? `${counts.video} 个视频` : '',
      counts.unknown ? `${counts.unknown} 个未识别` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' / ') : '未识别到可分类模型';
  }
  function isLikelyModelId(value = '') {
    const text = String(value || '').trim();
    return text.length > 0 && text.length < 160 && !/^https?:\/\//i.test(text) && !/[\r\n{}[\]]/.test(text);
  }
  function modelCapabilityHint(value = '') {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(item => modelCapabilityHint(item)).filter(Boolean).join(' ');
    if (typeof value === 'object') return Object.entries(value).map(([key, item]) => `${key} ${modelCapabilityHint(item)}`).join(' ');
    return '';
  }
  function classifyModelRecordKind(record = {}) {
    const capabilityFields = [
      'type', 'kind', 'task', 'task_type', 'taskType', 'capability', 'capabilities',
      'modalities', 'modality', 'supported_tasks', 'supportedTasks', 'category',
      'architecture', 'operations', 'operation'
    ];
    const hint = capabilityFields.map(key => modelCapabilityHint(record?.[key])).filter(Boolean).join(' ');
    const explicitKind = classifyModelKind(hint);
    if (explicitKind) return explicitKind;
    return classifyModelKind(`${record?.id || ''} ${record?.label || ''}`);
  }
  function extractModelRecords(payload) {
    const found = [];
    const visit = (value, depth = 0) => {
      if (value == null || depth > 6) return;
      if (typeof value === 'string') {
        if (isLikelyModelId(value)) found.push({id: value.trim(), label: ''});
        return;
      }
      if (Array.isArray(value)) {
        value.forEach(item => visit(item, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;
      const id = ['id', 'model_id', 'modelId', 'model'].map(key => value[key]).find(isLikelyModelId);
      const label = ['name', 'display_name', 'displayName', 'label'].map(key => value[key]).find(isLikelyModelId);
      if (isLikelyModelId(id)) {
        const record = {id: String(id).trim(), label: isLikelyModelId(label) ? String(label).trim() : ''};
        record.kind = classifyModelRecordKind({...value, ...record});
        found.push(record);
      }
      ['data', 'models', 'model_list', 'modelList', 'items', 'list', 'result', 'results', 'output'].forEach(key => {
        if (key in value) visit(value[key], depth + 1);
      });
    };
    visit(payload);
    return normalizeModelRecords(found).map(record => ({
      ...record,
      kind: record.kind || classifyModelKind(`${record.id} ${record.label}`)
    }));
  }
  function extractModelIds(payload) {
    return expandKnownModelAliases(unique(extractModelRecords(payload).map(record => record.id)));
  }
  function apiBaseAddressProblem(apiUrl = '') {
    const value = String(apiUrl || '').trim();
    if (!value) return null;
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return {reason: 'API 地址格式不正确', suggestedUrl: ''};
    }
    if (!/^https?:$/.test(parsed.protocol)) {
      return {reason: 'API 地址必须以 http:// 或 https:// 开头', suggestedUrl: ''};
    }
    const segments = parsed.pathname.split('/').filter(Boolean);
    const pageIndex = segments.findIndex(segment => /^(console|dashboard|admin|panel)$/i.test(segment));
    if (pageIndex < 0) return null;
    const apiSegments = segments.filter((_, index) => index !== pageIndex);
    if (!apiSegments.length) apiSegments.push('v1');
    const suggestedUrl = `${parsed.origin}/${apiSegments.join('/')}`;
    return {reason: 'API 地址里包含了供应商后台页面路径', suggestedUrl};
  }
  function assertUsableApiBaseAddress(apiUrl = '') {
    const problem = apiBaseAddressProblem(apiUrl);
    if (!problem) return;
    const current = String(apiUrl || '').trim();
    const suggestion = problem.suggestedUrl ? `\n可先尝试：${problem.suggestedUrl}` : '';
    throw new Error(`${problem.reason}。\n当前地址：${current}${suggestion}\n软件没有自动修改你的地址。`);
  }
  function assertModelListResponse({response, payload, models = [], requestUrl = ''} = {}) {
    const contentType = String(response?.headers?.get?.('content-type') || '');
    const responseMessage = String(payload?.message || '');
    if (/text\/html/i.test(contentType) || /<(?:!doctype|html)\b/i.test(responseMessage)) {
      throw new Error(`供应商返回的是网页，不是模型列表。\n请求地址：${requestUrl}\n请填写供应商的 API 根地址，不要填控制台或后台页面地址。`);
    }
    if (!models.length) {
      throw new Error(`供应商没有返回可用模型。\n请求地址：${requestUrl}\n请确认该地址是 OpenAI 兼容 API，且当前密钥有查看模型的权限。`);
    }
  }
  function expandKnownModelAliases(models = []) {
    const expanded = [...models];
    models.forEach(model => {
      const text = String(model || '');
      if (/gpt[-_\s]?5[._-]?6|5\.6/i.test(text)) {
        expanded.push('gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna');
      }
    });
    return unique(expanded);
  }
  function providerModelsForKind(provider, kind) {
    const field = modelFieldForKind(kind);
    const active = FutureAIApiDefaults.get(modelFieldForKind(kind)).trim();
    const catalogModels = (Array.isArray(provider?.modelCatalog) ? provider.modelCatalog : [])
      .filter(record => (record?.kind || classifyModelKind(`${record?.id || ''} ${record?.label || ''}`)) === kind)
      .map(record => record.id);
    const models = [provider?.[field], ...catalogModels, ...(provider?.models || []).filter(model => classifyModelKind(model) === kind)];
    if (provider?.id === globalModelProviders[kind] && active) models.unshift(active);
    return unique(models.filter(Boolean));
  }
  function globalProviderForKind(kind) {
    ensureApiProviders();
    const capability = capabilityForModelKind(kind);
    return window.FutureAIModelAvailability.preferredGlobalProvider(apiProviders, {
      selectedId: globalModelProviders[kind],
      supports: provider => providerSupports(provider, capability),
      hasUsableKey: provider => window.FutureAIModelAvailability.providerHasUsableKey(provider, FutureAIApiDefaults.get('apiKey'))
    }) || defaultApiProvider();
  }
  function providerOptionsForKind(kind, selected = '') {
    const capability = capabilityForModelKind(kind);
    const capable = apiProviders.filter(provider => providerSupports(provider, capability));
    const source = capable.length ? capable : apiProviders;
    return source.map(provider => `<option value="${esc(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${esc(provider.name || providerTypeLabel(provider.type))}</option>`).join('');
  }
  function syncGlobalModelInputs() {
    ['chat', 'image', 'video'].forEach(kind => {
      const previousProviderId = globalModelProviders[kind];
      const provider = globalProviderForKind(kind);
      globalModelProviders[kind] = provider.id;
      // The saved default could not send requests and another service took over (e.g. the user added
      // their own relay on a fresh install): use that service's model, as a manual switch would.
      if (previousProviderId && previousProviderId !== provider.id) {
        const ownModel = provider[modelFieldForKind(kind)] || firstImportedModelForKind(provider.models || [], kind);
        if (ownModel) FutureAIApiDefaults.set(modelFieldForKind(kind), ownModel);
      }
      const providerSelect = $(`global${kind[0].toUpperCase() + kind.slice(1)}Provider`);
      const modelInput = $(`global${kind[0].toUpperCase() + kind.slice(1)}Model`);
      const modelList = $(`global${kind[0].toUpperCase() + kind.slice(1)}ModelList`);
      const models = providerModelsForKind(provider, kind);
      if (providerSelect) providerSelect.innerHTML = providerOptionsForKind(kind, provider.id);
      if (modelInput) modelInput.value = FutureAIApiDefaults.get(modelFieldForKind(kind)) || provider?.[modelFieldForKind(kind)] || '';
      if (modelList) modelList.innerHTML = models.map(model => `<option value="${esc(model)}"></option>`).join('');
    });
  }
  function setGlobalProviderValue(kind, providerId) {
    if (!kind) return;
    globalModelProviders[kind] = providerId || '';
    const provider = globalProviderForKind(kind);
    const current = provider?.[modelFieldForKind(kind)] || firstImportedModelForKind(provider?.models || [], kind) || '';
    setGlobalModelValue(kind, current, {save: false, rerender: false});
    saveSettings();
    renderModels();
    refreshNodeModelSelects();
  }
  function setGlobalModelValue(kind, value, options = {}) {
    const model = String(value || '').trim();
    FutureAIApiDefaults.set(modelFieldForKind(kind), model);
    const provider = globalProviderForKind(kind);
    if (provider && model) {
      const changed = kind === 'image' && provider.imageModel !== model;
      provider[modelFieldForKind(kind)] = model;
      provider.models = unique([model, ...(provider.models || [])]);
      if (changed) {
        provider.imageCapabilityStatus = 'unknown';
        provider.imageCapabilityMessage = '';

      }
    }
    const input = $(`global${kind[0].toUpperCase() + kind.slice(1)}Model`);
    if (input && input.value !== model) input.value = model;
    if (options.save !== false) saveSettings();
    if (options.rerender !== false) renderModels();
  }
  function providerTypeLabel(...args) { return providerUI()?.providerTypeLabel?.(...args); }
  function providerTypeMeta(...args) { return providerUI()?.providerTypeMeta?.(...args); }
  function providerSupports(...args) { return providerUI()?.providerSupports?.(...args); }
  function defaultEndpointForProvider(...args) { return providerUI()?.defaultEndpointForProvider?.(...args); }
  function defaultApiProvider(...args) { return providerUI()?.defaultApiProvider?.(...args); }
  function normalizeApiProvider(...args) { return providerUI()?.normalizeApiProvider?.(...args); }
  function ensureApiProviders(...args) { return providerUI()?.ensureApiProviders?.(...args); }
  function migrateLegacyProviderKeys(...args) { return providerUI()?.migrateLegacyProviderKeys?.(...args); }
  function uniqueById(...args) { return providerUI()?.uniqueById?.(...args); }
  function syncLegacyApiProvider(...args) { return providerUI()?.syncLegacyApiProvider?.(...args); }
  function modelPickerGroups(...args) { return providerUI()?.modelPickerGroups?.(...args); }
  function currentProviderForNode(...args) { return providerUI()?.currentProviderForNode?.(...args); }
  function renderApiProviders(...args) { return providerUI()?.renderApiProviders?.(...args); }
  async function hydrateProviderKeyInputs(...args) { return providerUI()?.hydrateProviderKeyInputs?.(...args); }
  function providerInitial(...args) { return providerUI()?.providerInitial?.(...args); }
  function providerModelDatalistHtml(...args) { return providerUI()?.providerModelDatalistHtml?.(...args); }
  function providerModelSelectOptionsHtml(...args) { return providerUI()?.providerModelSelectOptionsHtml?.(...args); }
  function providerModelGroupHtml(...args) { return providerUI()?.providerModelGroupHtml?.(...args); }
  function providerModelLibraryHtml(...args) { return providerUI()?.providerModelLibraryHtml?.(...args); }
  function apiProviderCardHtml(...args) { return providerUI()?.apiProviderCardHtml?.(...args); }
  function addApiProvider(...args) { return providerUI()?.addApiProvider?.(...args); }
  function syncApiProviderCardFields(...args) { return providerUI()?.syncApiProviderCardFields?.(...args); }
  function handleApiProviderInput(...args) { return providerUI()?.handleApiProviderInput?.(...args); }
  function handleApiProviderClick(...args) { return providerUI()?.handleApiProviderClick?.(...args); }
  function refreshProviderBalances(...args) { return providerUI()?.refreshProviderBalances?.(...args); }
  function useProviderModelFromCard(...args) { return providerUI()?.useProviderModelFromCard?.(...args); }
  function addProviderModelFromCard(...args) { return providerUI()?.addProviderModelFromCard?.(...args); }
  function toggleApiProviderCollapsed(...args) { return providerUI()?.toggleApiProviderCollapsed?.(...args); }
  async function providerApiKey(...args) { return providerUI()?.providerApiKey?.(...args); }
  async function saveProviderKeyFromCard(...args) { return providerUI()?.saveProviderKeyFromCard?.(...args); }
  async function saveTypedProviderKeyIfNeeded(...args) { return providerUI()?.saveTypedProviderKeyIfNeeded?.(...args); }
  function setProviderTestStatus(...args) { return providerUI()?.setProviderTestStatus?.(...args); }
  function imageCapabilityError(...args) { return providerUI()?.imageCapabilityError?.(...args); }
  function isImageProviderCapabilityError(...args) { return providerUI()?.isImageProviderCapabilityError?.(...args); }
  function markImageProviderCapability(...args) { return providerUI()?.markImageProviderCapability?.(...args); }
  function assertImageProviderCapability(...args) { return providerUI()?.assertImageProviderCapability?.(...args); }
  async function testImageProviderFromCard(...args) { return providerUI()?.testImageProviderFromCard?.(...args); }
  async function autoConfigureProviderFromCard(...args) { return providerUI()?.autoConfigureProviderFromCard?.(...args); }
  async function importModelsForProviderCard(...args) { return providerUI()?.importModelsForProviderCard?.(...args); }


  function isOpenAiImageGenerationModel(...args) { return providerApi()?.isOpenAiImageGenerationModel?.(...args); }
  function applyKnownImageProtocol(...args) { return providerApi()?.applyKnownImageProtocol?.(...args); }
  function saveKnownImageProtocolCorrection(...args) { return providerApi()?.saveKnownImageProtocolCorrection?.(...args); }
  function isUnsupportedImageModelError(...args) { return providerApi()?.isUnsupportedImageModelError?.(...args); }
  function isImageGenerationDisabledError(...args) { return providerApi()?.isImageGenerationDisabledError?.(...args); }
  function providerImageModelIds(...args) { return providerApi()?.providerImageModelIds?.(...args); }
  function equivalentProviderModelId(...args) { return providerApi()?.equivalentProviderModelId?.(...args); }
  function imageModelResolutionTier(...args) { return providerApi()?.imageModelResolutionTier?.(...args); }
  function sortImageModelCandidates(...args) { return providerApi()?.sortImageModelCandidates?.(...args); }
  function imageModelCandidates(...args) { return providerApi()?.imageModelCandidates?.(...args); }
  async function refreshProviderImageModels(...args) { return providerApi()?.refreshProviderImageModels?.(...args); }
  function rememberWorkingImageModel(...args) { return providerApi()?.rememberWorkingImageModel?.(...args); }
  function classifyImageProviderError(...args) { return providerApi()?.classifyImageProviderError?.(...args); }
  function createProviderApiError(...args) { return providerApi()?.createProviderApiError?.(...args); }
  function imageTaskAdapterConfig(...args) { return providerApi()?.imageTaskAdapterConfig?.(...args); }
  function usableGeneratedImageUrl(...args) { return providerApi()?.usableGeneratedImageUrl?.(...args); }
  function asyncImageUrlFromResponse(...args) { return providerApi()?.asyncImageUrlFromResponse?.(...args); }
  async function requestAsyncImageTask(...args) { return providerApi()?.requestAsyncImageTask?.(...args); }
  async function rawImageGenerationWithModel(...args) { return providerApi()?.rawImageGenerationWithModel?.(...args); }
  async function rawImageEditRequest(...args) { return providerApi()?.rawImageEditRequest?.(...args); }
  function imageOutpaintPrompt(...args) { return providerApi()?.imageOutpaintPrompt?.(...args); }
  async function requestImageGenerationWithModel(...args) { return providerApi()?.requestImageGenerationWithModel?.(...args); }
  async function imageGenerateRequest(...args) { return providerApi()?.imageGenerateRequest?.(...args); }
  async function imageEditRequest(...args) { return providerApi()?.imageEditRequest?.(...args); }
  async function referenceGuidedImageFallback(...args) { return providerApi()?.referenceGuidedImageFallback?.(...args); }
  async function imageEditWithFallback(...args) { return providerApi()?.imageEditWithFallback?.(...args); }
  function referenceBoardPrompt(...args) { return providerApi()?.referenceBoardPrompt?.(...args); }
  function shortError(...args) { return providerApi()?.shortError?.(...args); }
  async function composeReferenceBoard(...args) { return providerApi()?.composeReferenceBoard?.(...args); }
  async function loadImageForCanvas(...args) { return providerApi()?.loadImageForCanvas?.(...args); }
  function drawImageContain(...args) { return providerApi()?.drawImageContain?.(...args); }
  function imageSizeForResolution(...args) { return providerApi()?.imageSizeForResolution?.(...args); }
  function customImageTargetSize(...args) { return providerApi()?.customImageTargetSize?.(...args); }
  function imageTargetSize(...args) { return providerApi()?.imageTargetSize?.(...args); }
  function imageSizeFromDialogPrompt(...args) { return providerApi()?.imageSizeFromDialogPrompt?.(...args); }
  function apiCompatibleImageSize(...args) { return providerApi()?.apiCompatibleImageSize?.(...args); }
  function imageSizeCapabilityProfile(...args) { return providerApi()?.imageSizeCapabilityProfile?.(...args); }
  function recordImageSizeCapability(...args) { return providerApi()?.recordImageSizeCapability?.(...args); }
  function providerImageRequestSizes(...args) { return providerApi()?.providerImageRequestSizes?.(...args); }
  function parseSize(...args) { return providerApi()?.parseSize?.(...args); }
  function validateGeneratedImageTargetSize(...args) { return providerApi()?.validateGeneratedImageTargetSize?.(...args); }
  function isUnsupportedImageSizeError(...args) { return providerApi()?.isUnsupportedImageSizeError?.(...args); }
  function isApiGatewayTimeoutError(...args) { return providerApi()?.isApiGatewayTimeoutError?.(...args); }
  function joinApiPath(...args) { return providerApi()?.joinApiPath?.(...args); }
  function apiRequestCandidates(...args) { return providerApi()?.apiRequestCandidates?.(...args); }
  function imageRequestDimensionFields(...args) { return providerApi()?.imageRequestDimensionFields?.(...args); }
  async function fetchApiWithBaseFallback(...args) { return providerApi()?.fetchApiWithBaseFallback?.(...args); }
  async function chatImageGenerateRequest(...args) { return providerApi()?.chatImageGenerateRequest?.(...args); }
  async function customSyncImageRequest(...args) { return providerApi()?.customSyncImageRequest?.(...args); }
  function valueAtPath(...args) { return providerApi()?.valueAtPath?.(...args); }
  function imageUrlFromUnknown(...args) { return providerApi()?.imageUrlFromUnknown?.(...args); }
  function extractImageUrl(...args) { return providerApi()?.extractImageUrl?.(...args); }
  async function runVideo(...args) { return providerApi()?.runVideo?.(...args); }
  function updateVideoStatus(...args) { return providerApi()?.updateVideoStatus?.(...args); }
  function buildVideoCreateBody(...args) { return providerApi()?.buildVideoCreateBody?.(...args); }
  function sizeToAspect(...args) { return providerApi()?.sizeToAspect?.(...args); }
  async function pollVideoTask(...args) { return providerApi()?.pollVideoTask?.(...args); }
  function sleep(...args) { return providerApi()?.sleep?.(...args); }
  function isTerminalShortVideoTaskError(...args) { return providerApi()?.isTerminalShortVideoTaskError?.(...args); }
  async function resumeShortVideoTask(...args) { return providerApi()?.resumeShortVideoTask?.(...args); }
  async function videoGenerateRequest(...args) { return providerApi()?.videoGenerateRequest?.(...args); }
  function shouldUseOpenAiVideoEndpoint(...args) { return providerApi()?.shouldUseOpenAiVideoEndpoint?.(...args); }
  function videoApiError(...args) { return providerApi()?.videoApiError?.(...args); }
  function shouldFallbackToVideosEndpoint(...args) { return providerApi()?.shouldFallbackToVideosEndpoint?.(...args); }
  async function openAiVideoRequest(...args) { return providerApi()?.openAiVideoRequest?.(...args); }
  function sizeToOpenAiVideoSize(...args) { return providerApi()?.sizeToOpenAiVideoSize?.(...args); }
  async function pollOpenAiVideoTask(...args) { return providerApi()?.pollOpenAiVideoTask?.(...args); }
  async function fetchOpenAiVideoContent(...args) { return providerApi()?.fetchOpenAiVideoContent?.(...args); }
  function tryExtractVideoUrl(...args) { return providerApi()?.tryExtractVideoUrl?.(...args); }
  function formatVideoError(...args) { return providerApi()?.formatVideoError?.(...args); }
  function apiResponseErrorText(...args) { return providerApi()?.apiResponseErrorText?.(...args); }
  async function safeJson(...args) { return providerApi()?.safeJson?.(...args); }
  async function persistGeneratedImageResult(...args) { return providerApi()?.persistGeneratedImageResult?.(...args); }

  const REMOTE_MEDIA_RETRY_DELAYS_MS = [0, 2000, 6000];
  const UNSAVED_MEDIA_SWEEP_DELAY_MS = 60 * 1000;
  const UNSAVED_MEDIA_SWEEP_LIMIT = 12;
  let unsavedMediaSweepAttempt = 0;
  const unsavedMediaFailures = new Map();
  let unsavedMediaSweepTimer = null;
  function isRemoteMediaUrl(value) {
    return /^https?:\/\//i.test(String(value || ''));
  }
  function remoteMediaKind(url, ext) {
    return /^(mp4|webm|mov)$/i.test(String(ext || '')) || /\.(mp4|webm|mov)(?:[?#]|$)/i.test(String(url || '')) ? 'video' : 'image';
  }
  async function saveRemoteMedia(url, ext) {
    let lastError;
    for (const delay of REMOTE_MEDIA_RETRY_DELAYS_MS) {
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      try {
        return await window.localStorageBridge.saveRemoteMedia(storageDir, {url, kind: remoteMediaKind(url, ext)});
      } catch (err) {
        lastError = err;
      }
    }
    throw lastError;
  }
  // Every generated/remote result is copied into <storageDir>/media before it is
  // used; remote URLs expire. If that fails the remote URL is kept but the node
  // shows "未保存" and a background sweep keeps retrying.
  async function persistMediaUrl(url, name = 'media', ext = '') {
    const value = String(url || '');
    const remote = isRemoteMediaUrl(value);
    if (!storageDir || !window.localStorageBridge?.saveMedia || (!remote && !value.startsWith('data:') && !value.startsWith('blob:'))) return value;
    try {
      if (remote) return await saveRemoteMedia(value, ext);
      const dataUrl = value.startsWith('blob:') ? await blobUrlToDataUrl(value) : value;
      return await window.localStorageBridge.saveMedia(storageDir, {
        dataUrl,
        name,
        ext: ext || mediaExtFromDataUrl(dataUrl)
      }) || value;
    } catch (err) {
      console.warn('media persist failed', err);
      toast(`媒体未保存到本地：${err?.message || err}。节点已标记“未保存”，稍后会自动重试。`, 'warn');
      scheduleUnsavedMediaSweep();
      // A blob: URL dies with the page; keep the bytes in the project instead
      // (written to media/ by the sweep or on next open).
      if (value.startsWith('blob:')) {
        try { return await blobUrlToDataUrl(value); } catch {}
      }
      return value;
    }
  }
  function scheduleUnsavedMediaSweep(delay = UNSAVED_MEDIA_SWEEP_DELAY_MS) {
    clearTimeout(unsavedMediaSweepTimer);
    unsavedMediaSweepTimer = setTimeout(() => { retryUnsavedMedia().catch(err => console.warn('unsaved media retry failed', err)); }, delay);
  }
  // Every media field of every node (url, urls, refUrl, references, variants…)
  // that is still remote or inline is copied into <storageDir>/media. Keeps
  // retrying with backoff (1/5/15/30 min) for the whole session.
  async function retryUnsavedMedia() {
    if (!storageDir || !window.localStorageBridge?.saveRemoteMedia) return;
    const MediaRefs = window.FutureAIMediaRefs;
    if (!MediaRefs) return;
    let changed = false;
    let pending = false;
    for (const node of [...nodes.values()]) {
      if (!node?.data) continue;
      const nodeChanged = await MediaRefs.mapNodeMediaRefs(node.data, async value => {
        if ((unsavedMediaFailures.get(value) || 0) >= UNSAVED_MEDIA_SWEEP_LIMIT) return value;
        try {
          if (isRemoteMediaUrl(value)) {
            const local = await saveRemoteMedia(value, node.type === 'video' ? 'mp4' : '');
            if (local && local !== value) {
              if (!node.data.sourceUrl) node.data.sourceUrl = value;
              return local;
            }
            return value;
          }
          if (/^data:(image|video|audio)\//i.test(value)) {
            return await window.localStorageBridge.saveMedia(storageDir, {dataUrl: value, name: `node_${node.id}`, ext: mediaExtFromDataUrl(value)}) || value;
          }
          return value;
        } catch {
          unsavedMediaFailures.set(value, (unsavedMediaFailures.get(value) || 0) + 1);
          pending = true;
          return value;
        }
      });
      if (nodeChanged && node.el) hydrateNode(node);
      changed ||= nodeChanged;
    }
    if (changed) saveProject();
    if (pending) scheduleUnsavedMediaSweep(MediaRefs.sweepDelayMs(unsavedMediaSweepAttempt++));
    else unsavedMediaSweepAttempt = 0;
  }
  // 「图片文件找不到」→ 重新定位: the picked file is copied into media/ and every
  // field of the node that pointed at the missing file is switched to it.
  async function onMediaRelocateRequest(event) {
    const missingUrl = String(event?.detail?.url || '');
    const nodeId = String(event?.detail?.nodeId || '');
    if (!missingUrl) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = event?.detail?.kind === 'video' ? 'video/*' : 'image/*';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        const saved = await persistMediaUrl(String(dataUrl), file.name || 'relocated', mediaExtFromMime(file.type, file.name));
        let count = 0;
        for (const node of nodes.values()) {
          if (nodeId && node.id !== nodeId) continue;
          const replaced = window.FutureAIMediaRefs?.replaceNodeMediaRef(node.data, missingUrl, saved) || 0;
          if (replaced) { count += replaced; if (node.el) hydrateNode(node); }
        }
        if (count) { saveProject(); toast('已重新定位图片，并复制到存储文件夹', 'success'); }
      } catch (err) {
        toast('重新定位失败：' + (err?.message || err), 'error');
      }
    }, {once: true});
    input.click();
  }
  // Non-blocking reminder while results go to the default folder: always visible in
  // Settings, plus a dismissible banner that comes back next launch until a folder is chosen.
  async function syncStoragePathField() {
    if ($('localStoragePath')) $('localStoragePath').value = storageDir;
    const usingDefault = usingDefaultStorageDir();
    $('storageDirDefaultNotice')?.classList.toggle('hidden', !usingDefault);
    $('storageDefaultBanner')?.classList.toggle('hidden', !usingDefault || storageDefaultNoticeDismissed);
    document.querySelectorAll('[data-default-storage-dir]').forEach(el => { el.textContent = defaultStorageDir; });
    const warning = $('storageDirInstallWarning');
    if (!warning) return;
    const inspected = storageDir ? await window.localStorageBridge?.inspectDir?.(storageDir).catch(() => null) : null;
    warning.classList.toggle('hidden', !inspected?.insideInstallDir);
  }
  async function blobUrlToDataUrl(url) {
    return await MediaUtils.blobUrlToDataUrl(url);
  }
  function mediaExtFromMime(mime = '', name = '') {
    return MediaUtils.mediaExtFromMime(mime, name);
  }
  function mediaExtFromDataUrl(dataUrl = '') {
    return MediaUtils.mediaExtFromDataUrl(dataUrl);
  }
  async function mediaUrlToBlob(url) {
    if (String(url || '').startsWith('data:')) return dataURLToBlob(url);
    if (String(url || '').startsWith('file:') && window.localStorageBridge?.readMedia) {
      const dataUrl = await window.localStorageBridge.readMedia(url);
      if (dataUrl) return dataURLToBlob(dataUrl);
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error('无法读取参考素材：' + res.status);
    return await res.blob();
  }
  function dataURLToBlob(dataURL) {
    return MediaUtils.dataURLToBlob(dataURL);
  }
  function isSafetyError(err) {
    return /safety|unsafe|policy|moderation|rejected|violation|PUBLIC_ERROR_UNSAFE_GENERATION/i.test(err?.message || String(err));
  }
  function softenPrompt(text) {
    let s = String(text || '');
    const sexual = /\b(sexy|sexual|sensual|seductive|nsfw|nude|naked|lingerie|erotic)\b|性感|色情|裸露|诱惑|挑逗/i.test(s);
    if (sexual) s = s.replace(/\b(?:[0-9]|1[0-7])\s*(?:-?year-?old|years old|yo)\b/gi, 'adult');
    s = s.replace(/\b(nude|naked|sexy|sexual|nsfw)\b/gi, 'fully clothed, non-sexual');
    s = s.replace(/性感|色情|裸露|诱惑|挑逗/g, '端庄、得体、非性感');
    const guard = sexual ? 'adult character, fully clothed, non-sexual, no minors, no nudity' : 'family-friendly, fully clothed, non-sexual, no nudity, no erotic framing';
    if (!/non-sexual|非性感/.test(s)) s += '\n\nSafety constraints: ' + guard + '.';
    return s.trim();
  }
  function formatError(err, refCount = 0) {
    const msg = err?.message || String(err);
    const prefix = imageErrorTitle(refCount);
    return isSafetyError(err)
      ? 'API 内容审核拒绝：\n' + msg + '\n可点击「安全改写」改写提示词后重试。'
      : prefix + '：\n' + msg;
  }

  function diagnoseGenerationError(err, context = {}) {
    const raw = err?.message || String(err || '');
    const msg = raw.replace(/\s+/g, ' ').trim();
    const lower = msg.toLowerCase();
    const base = {
      category: 'unknown',
      summary: '生成失败',
      suggestion: '请查看接口返回信息后重试',
      detail: msg
    };
    if (isSafetyError(err)) {
      return {...base, category: 'safety', summary: '内容审核拒绝', suggestion: '点击「安全改写」改写提示词后重试，或减少敏感动作、裸露、未成年人或危险描述'};
    }
    if (isImageProviderCapabilityError(err) || /image generation is not enabled for this group/i.test(msg)) {
      return {...base, category: 'image-capability-disabled', summary: '当前 API 未开通图片生成', suggestion: '请在该中转站为当前密钥所属账户组开通图片生成；开通后在 API 设置中点击“检测图片能力”'};
    }
    if (/not supported by any configured account|no available (?:model )?channels?|no available distributor|model.+(?:no access|not available)|模型.*(?:无权限|不可用|无可用渠道)/i.test(msg)) {
      return {...base, category: 'model-access', summary: '当前账户未开通该图片模型', suggestion: '切换到此 API 已开通的图片模型；4K 专用模型需要中转站为当前账户组单独开通'};
    }
    if (/401|403|unauthorized|forbidden|invalid api key|incorrect api key|api[_ -]?key|鉴权|认证|未授权|密钥|令牌|token/i.test(msg)) {
      return {...base, category: 'auth', summary: 'API Key 或权限错误', suggestion: '检查该 API 配置的密钥、权限和 Base URL'};
    }
    if (/quota|insufficient|balance|billing|credit|payment|余额|额度|欠费|付费|账户余额/i.test(msg)) {
      return {...base, category: 'quota', summary: '额度或余额不足', suggestion: '充值、切换备用 API，或降低批量生成数量'};
    }
    if (isApiGatewayTimeoutError(err)) {
      const zexTimeout = /daisy\.life|\b524\b/i.test(msg);
      return {...base, category: 'gateway-timeout', summary: '供应商上游超时', suggestion: zexTimeout
        ? '章鱼哥的 daisy.life 同步中转在上游完成前返回了 HTTP 524。先改用 image2 + 1K/1024x1024，或切换支持异步任务的图像供应商；重复点击可能产生重复计费。'
        : '当前模型或图生图接口等待超时。请稍后重试，或切换更稳定的图像模型/供应商'};
    }
    if (/model.*not.*found|invalid model|model_not_found|does not exist|unknown model|模型不存在|模型.*无效|找不到模型/i.test(msg)) {
      return {...base, category: 'model-not-found', summary: '模型不存在', suggestion: '重新导入该 API 的模型列表，或切换到该 API 的默认模型'};
    }
    if (/\b404\b|not found/i.test(msg) && /\/chat\/completions/i.test(context.endpoint || '') && isOpenAiImageGenerationModel(context.model)) {
      return {...base, category: 'endpoint-mismatch', summary: '图片模型和接口不匹配', suggestion: '该模型应使用 /images/generations，不应使用 /chat/completions'};
    }
    if (/image|images\/generations|not support.*image|does not support.*image|unsupported.*model|模型不支持|不支持生图/i.test(msg) && /model|模型|support|支持/i.test(msg)) {
      return {...base, category: 'capability', summary: '当前模型不支持生图', suggestion: '切换到图像模型，或选择支持生图的 API 配置'};
    }
    if (/edit|image edit|images\/edits|multipart|reference|refs|图生图|参考图|多参考|unsupported.*image/i.test(msg) && /support|unsupported|不支持|invalid/i.test(msg)) {
      return {...base, category: 'image-edit', summary: '当前接口不支持图生图/参考图', suggestion: '改用 OpenAI Images、ComfyUI，或配置支持 refs 的自定义同步接口'};
    }
    if (isUnsupportedImageSizeError(err)) {
      return {...base, category: 'size', summary: '尺寸或分辨率不支持', suggestion: '切回 1K 或 1024x1024 后重试'};
    }
    if (/timeout|aborted|network|failed to fetch|econn|enotfound|etimedout|socket|网络|超时|连接失败/i.test(msg)) {
      return {...base, category: 'network', summary: '网络或接口超时', suggestion: '检查网络、Base URL，或稍后重试'};
    }
    if (/接口未返回图片|b64_json|responsePath|返回字段|output|data\.0\.url/i.test(msg)) {
      return {...base, category: 'response-path', summary: '返回字段无法识别', suggestion: '在 API 配置里填写正确返回字段，如 data.0.url 或 output.images.0.url'};
    }
    if (/异步任务|轮询协议|async|task|dashscope|volcengine|通义|火山/i.test(msg)) {
      return {...base, category: 'async-protocol', summary: '厂商异步协议未接入', suggestion: '先使用自定义同步网关，或等下一版接入该厂商异步轮询'};
    }
    if (/400|bad request|invalid request|参数|parameter|字段|field/i.test(msg)) {
      return {...base, category: 'bad-request', summary: '请求参数不兼容', suggestion: '检查尺寸、模型名、自定义路径和返回字段配置'};
    }
    return base;
  }

  function formatImageGenerationError(err, context = {}) {
    const diagnosis = diagnoseGenerationError(err, context);
    const lines = [
      `${imageErrorTitle(context.refCount || 0)}：${diagnosis.summary}`,
      `建议：${diagnosis.suggestion}`
    ];
    if (context.providerName || context.model) lines.push(`配置：${[context.providerName, context.model].filter(Boolean).join(' / ')}`);
    if (diagnosis.detail) lines.push(`接口返回：${diagnosis.detail}`);
    return lines.join('\n');
  }

  function addHistory(item) {
    const entry = compactHistoryItem({id: 'h_' + Date.now(), projectId: currentProjectId || '', ...item});
    history.unshift(entry);
    history = history.slice(0, 60);
    if (!trySaveHistory()) {
      history = history.slice(0, 20).map(compactHistoryItem);
      if (!trySaveHistory()) {
        history = history.slice(0, 8).map(item => compactHistoryItem(item, true));
        trySaveHistory();
      }
      toast('生成已完成，但历史记录空间已满，已自动压缩历史。', 'warn');
    }
    renderHistory();
  }
  async function searchFreeVideos() {
    if (!window.mediaBridge?.searchVideo) return toast('当前环境不支持视频资源搜索', 'warn');
    mediaVideoSearchQuery = $('mediaVideoSearchInput')?.value.trim() || mediaVideoSearchQuery || '自然';
    mediaVideoStatus = '正在搜索免费公开视频...';
    renderVideoResults();
    try {
      const result = await window.mediaBridge.searchVideo({ query: mediaVideoSearchQuery });
      mediaVideoResults = Array.isArray(result?.tracks) ? result.tracks : [];
      const failedSources = Array.isArray(result?.diagnostics) ? result.diagnostics.filter(item => item.status === 'rejected').length : 0;
      mediaVideoStatus = mediaVideoResults.length ? `找到 ${mediaVideoResults.length} 个 · ${result.source || '免费资源库'}${failedSources ? ` · ${failedSources} 个源暂不可用` : ''}` : '没有找到可播放视频，换个关键词试试';
    } catch (err) {
      mediaVideoStatus = '搜索失败';
      toast('视频搜索失败：\n' + (err.message || err), 'warn');
    }
    renderVideoResults();
  }

  function renderVideoResults() {
    if ($('mediaVideoSearchInput') && $('mediaVideoSearchInput').value !== mediaVideoSearchQuery) $('mediaVideoSearchInput').value = mediaVideoSearchQuery;
    if ($('mediaVideoSearchStatus')) $('mediaVideoSearchStatus').textContent = mediaVideoStatus;
    if (!$('mediaVideoList')) return;
    $('mediaVideoList').innerHTML = mediaVideoResults.map(video => `<article class="music-track" data-video-id="${esc(video.id)}"><button class="music-track-play" type="button"><i class="fa-solid fa-play"></i></button><div><strong>${esc(video.title || '免费视频')}</strong><span>${esc(video.artist || '公开作者')} · ${esc(video.source || '免费资源库')}</span><small>${esc(video.license || '请打开来源确认授权')}</small></div><button class="icon-btn" type="button" title="播放"><i class="fa-solid fa-play"></i></button><button class="icon-btn" data-video-source type="button" title="来源"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></article>`).join('') || '<div class="music-empty">输入关键词搜索免费公开视频</div>'; 
  }

  function setMediaMode(...args) { return mediaWorkbench()?.setMediaMode?.(...args); }
  function stopOtherMedia(...args) { return mediaWorkbench()?.stopOtherMedia?.(...args); }
  function playLocalVideoFile(...args) { return mediaWorkbench()?.playLocalVideoFile?.(...args); }
  async function playMediaUrl(...args) { return mediaWorkbench()?.playMediaUrl?.(...args); }
  function renderTvChannels(...args) { return mediaWorkbench()?.renderTvChannels?.(...args); }
  function musicTrackById(...args) { return mediaWorkbench()?.musicTrackById?.(...args); }
  function isMusicFavorite(...args) { return mediaWorkbench()?.isMusicFavorite?.(...args); }
  function saveMusicFavorites(...args) { return mediaWorkbench()?.saveMusicFavorites?.(...args); }
  function importLocalMusicFiles(...args) { return mediaWorkbench()?.importLocalMusicFiles?.(...args); }
  function musicPlayableQueue(...args) { return mediaWorkbench()?.musicPlayableQueue?.(...args); }
  function musicQueueIndex(...args) { return mediaWorkbench()?.musicQueueIndex?.(...args); }
  function formatMusicTime(...args) { return mediaWorkbench()?.formatMusicTime?.(...args); }
  function initLXMusicCore(...args) { return mediaWorkbench()?.initLXMusicCore?.(...args); }
  function syncLXMusicQueue(...args) { return mediaWorkbench()?.syncLXMusicQueue?.(...args); }
  function applyMusicVolume(...args) { return mediaWorkbench()?.applyMusicVolume?.(...args); }
  async function loadMusicPluginRegistry(...args) { return mediaWorkbench()?.loadMusicPluginRegistry?.(...args); }
  function saveMusicPluginState(...args) { return mediaWorkbench()?.saveMusicPluginState?.(...args); }
  function onMusicPluginToggle(...args) { return mediaWorkbench()?.onMusicPluginToggle?.(...args); }
  function renderMusicPlugins(...args) { return mediaWorkbench()?.renderMusicPlugins?.(...args); }
  async function searchOpenRadio(...args) { return mediaWorkbench()?.searchOpenRadio?.(...args); }
  function scheduleAutoMusicSearch(...args) { return mediaWorkbench()?.scheduleAutoMusicSearch?.(...args); }
  async function searchFreeMusic(...args) { return mediaWorkbench()?.searchFreeMusic?.(...args); }
  async function playMusicTrack(...args) { return mediaWorkbench()?.playMusicTrack?.(...args); }
  function toggleMusicPlayback(...args) { return mediaWorkbench()?.toggleMusicPlayback?.(...args); }
  function playAdjacentMusic(...args) { return mediaWorkbench()?.playAdjacentMusic?.(...args); }
  function handleMusicEnded(...args) { return mediaWorkbench()?.handleMusicEnded?.(...args); }
  function handleMusicPlaybackError(...args) { return mediaWorkbench()?.handleMusicPlaybackError?.(...args); }
  function updateMusicProgress(...args) { return mediaWorkbench()?.updateMusicProgress?.(...args); }
  function seekMusicPlayback(...args) { return mediaWorkbench()?.seekMusicPlayback?.(...args); }
  function changeMusicVolume(...args) { return mediaWorkbench()?.changeMusicVolume?.(...args); }
  function toggleMusicShuffle(...args) { return mediaWorkbench()?.toggleMusicShuffle?.(...args); }
  function toggleMusicRepeat(...args) { return mediaWorkbench()?.toggleMusicRepeat?.(...args); }
  function toggleMusicFavorite(...args) { return mediaWorkbench()?.toggleMusicFavorite?.(...args); }
  async function openMusicSource(...args) { return mediaWorkbench()?.openMusicSource?.(...args); }
  function onMusicListClick(...args) { return mediaWorkbench()?.onMusicListClick?.(...args); }
  function musicTrackCard(...args) { return mediaWorkbench()?.musicTrackCard?.(...args); }
  function renderMusicTransport(...args) { return mediaWorkbench()?.renderMusicTransport?.(...args); }
  function musicPresetCard(...args) { return mediaWorkbench()?.musicPresetCard?.(...args); }
  function renderMusicRecommendations(...args) { return mediaWorkbench()?.renderMusicRecommendations?.(...args); }
  function renderMusicQueueList(...args) { return mediaWorkbench()?.renderMusicQueueList?.(...args); }
  function renderMusicResultsShell(...args) { return mediaWorkbench()?.renderMusicResultsShell?.(...args); }
  function renderMusicPlayer(...args) { return mediaWorkbench()?.renderMusicPlayer?.(...args); }
  function addAssetLibraryItem(...args) { return mediaWorkbench()?.addAssetLibraryItem?.(...args); }
  function trySaveHistory(...args) { return mediaWorkbench()?.trySaveHistory?.(...args); }
  function trySaveAssetLibrary(...args) { return mediaWorkbench()?.trySaveAssetLibrary?.(...args); }
  function onHistoryClick(...args) { return mediaWorkbench()?.onHistoryClick?.(...args); }
  function renderHistory(...args) { return mediaWorkbench()?.renderHistory?.(...args); }
  function renderAssetLibrary(...args) { return mediaWorkbench()?.renderAssetLibrary?.(...args); }
  function rebuildAssetVisualIndex(...args) { return mediaWorkbench()?.rebuildAssetVisualIndex?.(...args); }
  function onAssetLibraryReportClick(...args) { return mediaWorkbench()?.onAssetLibraryReportClick?.(...args); }
  function toggleAssetLibraryTrash(...args) { return mediaWorkbench()?.toggleAssetLibraryTrash?.(...args); }
  async function dedupeAssetLibrary(...args) { return mediaWorkbench()?.dedupeAssetLibrary?.(...args); }
  function normalizeAssetFolders(...args) { return mediaWorkbench()?.normalizeAssetFolders?.(...args); }
  function scopedAssetFolders(...args) { return mediaWorkbench()?.scopedAssetFolders?.(...args); }
  function assetFolderId(...args) { return mediaWorkbench()?.assetFolderId?.(...args); }
  function ensureAssetLibraryFolderSelection(...args) { return mediaWorkbench()?.ensureAssetLibraryFolderSelection?.(...args); }
  function assetFolderCounts(...args) { return mediaWorkbench()?.assetFolderCounts?.(...args); }
  function renderAssetLibraryFolders(...args) { return mediaWorkbench()?.renderAssetLibraryFolders?.(...args); }
  function saveAssetLibraryFolders(...args) { return mediaWorkbench()?.saveAssetLibraryFolders?.(...args); }
  async function createAssetLibraryFolder(...args) { return mediaWorkbench()?.createAssetLibraryFolder?.(...args); }
  function assetLibraryFolderOptionsHtml(...args) { return mediaWorkbench()?.assetLibraryFolderOptionsHtml?.(...args); }
  function folderNameById(...args) { return mediaWorkbench()?.folderNameById?.(...args); }
  async function moveAssetLibraryItem(...args) { return mediaWorkbench()?.moveAssetLibraryItem?.(...args); }
  function assetLibraryMatchesFilters(...args) { return mediaWorkbench()?.assetLibraryMatchesFilters?.(...args); }
  function assetKind(...args) { return mediaWorkbench()?.assetKind?.(...args); }
  function assetPrimaryUrl(...args) { return mediaWorkbench()?.assetPrimaryUrl?.(...args); }
  function assetDisplayName(...args) { return mediaWorkbench()?.assetDisplayName?.(...args); }
  function normalizeAssetItem(...args) { return mediaWorkbench()?.normalizeAssetItem?.(...args); }
  function assetLibraryCardsHtml(...args) { return mediaWorkbench()?.assetLibraryCardsHtml?.(...args); }
  function assetById(...args) { return mediaWorkbench()?.assetById?.(...args); }
  function assetRecordById(...args) { return mediaWorkbench()?.assetRecordById?.(...args); }
  function onAssetLibraryDragStart(...args) { return mediaWorkbench()?.onAssetLibraryDragStart?.(...args); }
  function onAssetLibraryDragEnd(...args) { return mediaWorkbench()?.onAssetLibraryDragEnd?.(...args); }
  function assetFromDataTransfer(...args) { return mediaWorkbench()?.assetFromDataTransfer?.(...args); }
  function hasAssetTransfer(...args) { return mediaWorkbench()?.hasAssetTransfer?.(...args); }
  function onAssetLibraryActionClick(...args) { return mediaWorkbench()?.onAssetLibraryActionClick?.(...args); }
  async function renameAssetLibraryItem(...args) { return mediaWorkbench()?.renameAssetLibraryItem?.(...args); }
  async function editAssetLibraryTags(...args) { return mediaWorkbench()?.editAssetLibraryTags?.(...args); }
  async function deleteAssetLibraryItem(...args) { return mediaWorkbench()?.deleteAssetLibraryItem?.(...args); }
  async function importAssetLibraryFiles(...args) { return mediaWorkbench()?.importAssetLibraryFiles?.(...args); }

  function dropAssetOnCanvas(asset, clientX = null, clientY = null) {
    if (!asset?.url) return toast('资产不可用', 'warn');
    setActiveWorkspace('canvas');
    const pos = Number.isFinite(clientX) && Number.isFinite(clientY) ? screenToWorld(clientX, clientY) : viewCenter();
    const node = asset.kind === 'video'
      ? addNode('video', pos.x - 260, pos.y - 180, {title: asset.name, prompt: asset.prompt, model: asset.model, url: asset.url, refUrl: asset.refUrl || '', size: asset.size || '1280x720', duration: asset.duration || '5', tags: ['资产库']})
      : addNode('image', pos.x - 260, pos.y - 180, {title: asset.name, prompt: asset.prompt, model: asset.model, url: asset.url, urls: asset.urls?.length ? asset.urls : [asset.url], refUrl: asset.refUrl || '', size: asset.size || '1024x1024', tags: ['资产库']});
    if (node) {
      selectSingleNode(node.id);
      fitNodeIntoView(node, true);
      saveProject();
      toast('资产已放入画布', 'success');
    }
  }
  function sendAssetToAssistant(asset) {
    if (!asset?.url) return toast('资产不可用', 'warn');
    const item = {name: asset.name, url: asset.url, mime: asset.mime, kind: asset.kind};
    dialogEditAttachments = [item, ...dialogEditAttachments].filter(entry => entry?.url).slice(0, 6);
    chatAttachments = [item, ...chatAttachments].filter(entry => entry?.url).slice(0, 6);
    dialogEditActive = true;
    assistantActiveTab = 'dialog';
    setActiveWorkspace('assistant');
    renderAssistantWorkspace();
    toast('资产已发送到∞ 灵枢万象', 'success');
  }
  function sendAssetToShortWorkbench(asset) {
    if (!asset?.url) return toast('资产不可用', 'warn');
    shortAssetItems = [{
      id: 'library_asset_' + Date.now(),
      type: asset.kind === 'video' ? '视频资产' : '图片资产',
      name: asset.name,
      prompt: asset.prompt || '来自资产库，可作为角色、场景、道具、风格或镜头参考。',
      url: asset.kind === 'image' ? asset.url : '',
      videoUrl: asset.kind === 'video' ? asset.url : '',
      status: '来自资产库'
    }, ...shortAssetItems];
    setActiveWorkspace('short');
    renderShortWorkbench();
    jumpShortSection('assets', false);
    saveProject();
    toast('资产已加入 AI 漫剧工作台', 'success');
  }
  function installAssetDropTargets() {
    const targets = [
      {el: $('shortWorkbench'), onDrop: sendAssetToShortWorkbench},
      {el: $('assistantWorkbench'), onDrop: sendAssetToAssistant},
      {el: $('chatPanel'), onDrop: sendAssetToAssistant}
    ];
    targets.forEach(({el, onDrop}) => {
      if (!el) return;
      el.addEventListener('dragover', e => {
        if (!hasAssetTransfer(e.dataTransfer)) return;
        e.preventDefault();
        el.classList.add('asset-drop-over');
      });
      el.addEventListener('dragleave', e => {
        if (!el.contains(e.relatedTarget)) el.classList.remove('asset-drop-over');
      });
      el.addEventListener('drop', e => {
        const asset = assetFromDataTransfer(e.dataTransfer);
        if (!asset) return;
        e.preventDefault();
        el.classList.remove('asset-drop-over');
        onDrop(asset);
      });
    });
  }
  function renderAll() {
    renderProjects();
    renderSettings();
    renderModels();
    renderHistory();
    renderAssetLibrary();
    renderReviewCommentsReport();
    $('projectTitle').textContent = projects.find(p => p.id === currentProjectId)?.name || '未命名项目';
    syncCanvasEmptyState();
  }
  function syncCanvasEmptyState() {
    const empty = $('canvasEmptyState');
    if (!empty) return;
    const visible = activeWorkspace === 'canvas' && nodes.size === 0;
    empty.classList.toggle('hidden', !visible);
    empty.setAttribute('aria-hidden', String(!visible));
  }
  function renderProjects(...args) { return projectStore()?.renderProjects?.(...args); }
  function projectThumb(...args) { return projectStore()?.projectThumb?.(...args); }

  function renderSettings() {
    const s = getStore(STORE.settings, {});
    if (s.loaded) return;
  }
  function loadSettings() {
    const s = getStore(STORE.settings, {});
    uiSoundEnabled = s.uiSoundEnabled !== false;
    autoOpenLastProject = s.autoOpenLastProject === true;
    if ($('autoOpenLastProject')) $('autoOpenLastProject').checked = autoOpenLastProject;
    uiSoundVolume = Math.max(0, Math.min(1, Number(s.uiSoundVolume ?? .35)));
    if (typeof s.reduceMotionMode === 'boolean') {
      reduceMotionMode = s.reduceMotionMode;
      localStorage.setItem('futureai.reduceMotion', reduceMotionMode ? 'on' : 'off');
    } else if (localStorage.getItem('futureai.reduceMotion') === 'on') {
      reduceMotionMode = true;
    }
    applyReduceMotionMode();
    colorTheme = normalizeColorTheme(s.colorTheme || 'ocean');
    customThemeColor = normalizeCustomThemeColor(s.customThemeColor || '#4fd6e8');
    customThemePalette = window.FutureAIColorThemes?.normalizePalette(
      s.customThemePalette || {accent:customThemeColor},
      window.FutureAIColorThemes?.paletteFromAccent(customThemeColor)
    ) || customThemePalette;
    customThemeColor = customThemePalette.accent;
    savedColorThemes = window.FutureAIColorThemes?.normalizeSavedThemes(s.savedColorThemes) || [];
    activeSavedColorThemeId = colorTheme === 'custom' && savedColorThemes.some(item => item.id === String(s.activeSavedColorThemeId || ''))
      ? String(s.activeSavedColorThemeId)
      : '';
    if (activeSavedColorThemeId && $('customThemeName')) {
      $('customThemeName').value = savedColorThemes.find(item => item.id === activeSavedColorThemeId)?.name || nextSavedColorThemeName();
    }
    storageDir = s.storageDir || '';
    syncStoragePathField();
    codexPermission = ['readonly','project','full'].includes(s.codexPermission) ? s.codexPermission : 'project';
    if (s.apiUrl) FutureAIApiDefaults.set('apiUrl', s.apiUrl);
    if (s.imageModel) FutureAIApiDefaults.set('imageModel', s.imageModel);
    if (s.videoModel) FutureAIApiDefaults.set('videoModel', s.videoModel);
    if (s.chatModel) FutureAIApiDefaults.set('chatModel', s.chatModel);
    globalModelProviders = {
      chat: s.globalModelProviders?.chat || s.chatProviderId || '',
      image: s.globalModelProviders?.image || s.imageProviderId || '',
      video: s.globalModelProviders?.video || s.videoProviderId || ''
    };
    // v2: only the user's picks (or none = automatic short chain); older full `order` lists are dropped.
    imageFallback = window.FutureAIModelAvailability.normalizeFallbackSettings(s.imageFallback || {});
    if (s.imageFallback && s.imageFallback.version !== 2) setStore(STORE.settings, {...s, imageFallback});
    const nextAssistantContextMode = validAssistantContextMode(s.assistantContextMode);
    if ($('assistantContextModeInline')) $('assistantContextModeInline').value = nextAssistantContextMode;
    if (s.comfyUrl && $('comfyUrl')) $('comfyUrl').value = s.comfyUrl;
    if (s.comfyWorkflowName && $('comfyWorkflowName')) $('comfyWorkflowName').value = s.comfyWorkflowName;
    if (s.comfyWorkflowJson && $('comfyWorkflowJson')) $('comfyWorkflowJson').value = s.comfyWorkflowJson;
    if ($('generationMaxTasks')) $('generationMaxTasks').value = String(Math.max(1, Math.min(100, Number(s.generationMaxTasks || 12))));
    if ($('generationFailureStop')) $('generationFailureStop').value = String(Math.max(1, Math.min(20, Number(s.generationFailureStop || 3))));
    if ($('generationAutoRetry')) $('generationAutoRetry').value = String(window.FutureAIAutoRetry?.normalizeLimit(s.generationAutoRetry, 1) ?? 1);
    if ($('generationDailyReminder')) $('generationDailyReminder').value = String(Math.max(1, Math.min(1000, Number(s.generationDailyReminder || 30))));
    if ($('generationRequireStorage')) $('generationRequireStorage').checked = s.generationRequireStorage !== false;
    if ($('generationBudgetCurrency')) $('generationBudgetCurrency').value = ['USD', 'CNY'].includes(String(s.generationBudgetCurrency || '').toUpperCase()) ? String(s.generationBudgetCurrency).toUpperCase() : 'USD';
    if ($('generationSingleBudget')) $('generationSingleBudget').value = String(Math.max(0, Number(s.generationSingleBudget || 0)));
    if ($('generationDailyBudget')) $('generationDailyBudget').value = String(Math.max(0, Number(s.generationDailyBudget || 0)));
    syncCurrentProjectBudgetControl();
    comfyWorkflowCache = s.comfyWorkflowJson ? parseComfyWorkflowSafe(s.comfyWorkflowJson) : null;
    ensureApiProviders(s);
    syncGlobalModelInputs();
    applyAppearanceMode(s.appearanceMode || 'standard');
    applyColorTheme(colorTheme, customThemeColor);
    canvasWallpaper?.load(s.canvasWallpaper);
    balanceChip?.load(s.balanceChipProviderId);
    applyMascot(s.mascot || 'boy');
    migrateLegacyApiKeySecret(s);
    syncUISoundControls();
  }
  async function followMovedStorageDir() {
    if (!storageDir || !window.localStorageBridge?.resolveMovedRoot) return storageDir;
    try {
      const result = await window.localStorageBridge.resolveMovedRoot(storageDir);
      if (result?.moved && result.dir) {
        storageDir = result.dir;
        syncStoragePathField();
        saveSettings();
        toast('存储文件夹位置已变化，已自动切换到：' + result.dir, 'success');
      } else if (result?.missing) {
        toast('找不到存储文件夹：' + storageDir + '。如果移动过，请在 设置 → 存储 中重新选择。');
      }
    } catch (err) {
      console.warn('storage directory relocation failed', err);
    }
    return storageDir;
  }
  async function recoverStorageDir() {
    if (storageDir || !window.localStorageBridge?.findProjectRoot) return storageDir;
    try {
      const recovered = await window.localStorageBridge.findProjectRoot();
      if (!recovered) return '';
      storageDir = recovered;
      syncStoragePathField();
      saveSettings();
      return storageDir;
    } catch (err) {
      console.warn('storage directory recovery failed', err);
      return '';
    }
  }
  function usingDefaultStorageDir() {
    return Boolean(storageDir) && storageDir === defaultStorageDir;
  }
  async function useDefaultStorageDirIfUnset() {
    if (!window.localStorageBridge?.defaultDir) return;
    try {
      defaultStorageDir = await window.localStorageBridge.defaultDir();
      if (!storageDir) storageDir = await window.localStorageBridge.defaultDir({create: true});
      syncStoragePathField();
    } catch (err) {
      console.warn('default storage directory unavailable', err);
    }
  }
  function saveSettings() {
    const previous = getStore(STORE.settings, {});
    const persistedStorageDir = storageDir || previous.storageDir || '';
    const persistedApiProviders = apiProviders.map(provider => Object.fromEntries(
      Object.entries(provider).filter(([key]) => !key.startsWith('_'))
    ));
    storageDir = persistedStorageDir;
    persistCurrentProjectBudget();
    setStore(STORE.settings, {
      apiUrl: FutureAIApiDefaults.get('apiUrl'),
      imageModel: FutureAIApiDefaults.get('imageModel'),
      videoModel: FutureAIApiDefaults.get('videoModel'),
      chatModel: FutureAIApiDefaults.get('chatModel'),
      globalModelProviders,
      imageFallback,
      assistantContextMode: validAssistantContextMode($('assistantContextModeInline')?.value),
      apiProviders: persistedApiProviders,
      comfyUrl: $('comfyUrl')?.value || 'http://127.0.0.1:8188',
      comfyWorkflowName: $('comfyWorkflowName')?.value || '默认工作流',
      comfyWorkflowJson: $('comfyWorkflowJson')?.value || '',
      storageDir: persistedStorageDir,
      generationMaxTasks: Math.max(1, Math.min(100, Number($('generationMaxTasks')?.value || 12))),
      generationFailureStop: Math.max(1, Math.min(20, Number($('generationFailureStop')?.value || 3))),
      generationAutoRetry: window.FutureAIAutoRetry?.normalizeLimit($('generationAutoRetry')?.value, 1) ?? 1,
      generationDailyReminder: Math.max(1, Math.min(1000, Number($('generationDailyReminder')?.value || 30))),
      generationRequireStorage: $('generationRequireStorage')?.checked !== false,
      generationBudgetCurrency: String($('generationBudgetCurrency')?.value || 'USD').toUpperCase(),
      generationSingleBudget: Math.max(0, Number($('generationSingleBudget')?.value || 0)),
      generationDailyBudget: Math.max(0, Number($('generationDailyBudget')?.value || 0)),
      codexPermission,
      codexSharedExtensions: previous.codexSharedExtensions !== false,
      codexSharedSkillIds: Array.isArray(previous.codexSharedSkillIds) ? previous.codexSharedSkillIds : undefined,
      codexSharedPluginIds: Array.isArray(previous.codexSharedPluginIds) ? previous.codexSharedPluginIds : undefined,
      installedAssistantSkills: previous.installedAssistantSkills || [],
      // Agent settings are owned by agent-ui.js (saved via setStore before calling us); keep them.
      agent: previous.agent,
      codexScheduleAutoRun: previous.codexScheduleAutoRun,
      uiSoundEnabled,
      autoOpenLastProject,
      uiSoundVolume,
      reduceMotionMode,
      colorTheme,
      customThemeColor,
      customThemePalette,
      savedColorThemes,
      activeSavedColorThemeId,
      canvasWallpaper: canvasWallpaper?.value() || previous.canvasWallpaper,
      balanceChipProviderId: balanceChip ? balanceChip.value() : previous.balanceChipProviderId,
      theme: 'dark',
      appearanceMode: normalizeAppearanceMode($('appearanceMode')?.value || document.body.dataset.appearance || 'standard'),
      mascot: $('mascotImage')?.dataset.mascot || 'boy'
    });
    // Provider edits (add, rename, delete, key) all end in saveSettings; keep the chip in step.
    balanceChip?.render();
  }
  function initUISoundFeedback() {
    if (!window.FutureAIUISound?.createUISoundController) return;
    uiSoundController = window.FutureAIUISound.createUISoundController({window, enabled: uiSoundEnabled, volume: uiSoundVolume});
    uiSoundController.attach(document);
    syncUISoundControls();
  }
  function syncUISoundControls() {
    if ($('uiSoundEnabled')) $('uiSoundEnabled').checked = uiSoundEnabled;
    if ($('uiSoundVolume')) {
      $('uiSoundVolume').value = String(Math.round(uiSoundVolume * 100));
      $('uiSoundVolume').disabled = !uiSoundEnabled;
    }
    if ($('uiSoundVolumeValue')) $('uiSoundVolumeValue').value = `${Math.round(uiSoundVolume * 100)}%`;
    if ($('uiSoundPreview')) $('uiSoundPreview').disabled = !uiSoundEnabled || uiSoundVolume <= 0;
  }
  async function loadApiKeySecret() {
    if (!window.secretBridge?.getApiKey) return;
    try {
      const apiKey = await window.secretBridge.getApiKey();
      if (apiKey) FutureAIApiDefaults.set('apiKey', apiKey);
    } catch (error) {
      console.warn('[security] API key could not be loaded', error);
      toast('系统安全存储暂不可用，API 密钥未加载；稍后可在设置中重试。', 'warn');
    }
  }
  function migrateLegacyApiKeySecret(settings) {
    if (!settings?.apiKey || !window.secretBridge?.setApiKey) return;
    FutureAIApiDefaults.set('apiKey', settings.apiKey);
    window.secretBridge.setApiKey(settings.apiKey).catch(err => console.warn('api key migration failed', err));
    const next = {...settings};
    delete next.apiKey;
    setStore(STORE.settings, next);
  }
  async function persistProjectMedia(...args) { return projectStore()?.persistProjectMedia?.(...args); }
  function hasStorageDir(...args) { return projectStore()?.hasStorageDir?.(...args); }
  function promptStorageDirRequired(...args) { return projectStore()?.promptStorageDirRequired?.(...args); }
  async function ensureStorageReady(...args) { return projectStore()?.ensureStorageReady?.(...args); }
  async function loadLocalStores(...args) { return projectStore()?.loadLocalStores?.(...args); }
  async function chooseStorageDir(...args) { return projectStore()?.chooseStorageDir?.(...args); }
  async function openStorageDir(...args) { return projectStore()?.openStorageDir?.(...args); }
  async function flushWorkspaceStores(...args) { return projectStore()?.flushWorkspaceStores?.(...args); }
  function workspaceBackupPayload(...args) { return projectStore()?.workspaceBackupPayload?.(...args); }
  async function exportWorkspaceBackup(...args) { return projectStore()?.exportWorkspaceBackup?.(...args); }
  async function restoreWorkspaceBackup(...args) { return projectStore()?.restoreWorkspaceBackup?.(...args); }
  async function restoreProjectBackup(...args) { return projectStore()?.restoreProjectBackup?.(...args); }

  function normalizeAppearanceMode(mode) {
    return ['standard', 'focus', 'contrast'].includes(mode) ? mode : 'standard';
  }
  function normalizeColorTheme(value) {
    return window.FutureAIColorThemes?.normalizeTheme(value) || 'ocean';
  }
  function normalizeCustomThemeColor(value) {
    return window.FutureAIColorThemes?.normalizeHex(value) || '#4fd6e8';
  }
  function applyColorTheme(id = colorTheme, customColor = customThemeColor, palette = customThemePalette) {
    const theme = window.FutureAIColorThemes?.applyColorTheme(document, id, customColor, palette);
    if (theme) colorTheme = theme.id;
    syncColorThemeControls();
    return theme;
  }
  function setCustomThemeColor(value, syncPicker = false) {
    const zone = window.FutureAIColorThemes?.PALETTE_KEYS.includes(activeThemeZone) ? activeThemeZone : 'accent';
    const nextColor = normalizeCustomThemeColor(value);
    customThemePalette = window.FutureAIColorThemes?.normalizePalette({...customThemePalette, [zone]:nextColor}, customThemePalette) || {...customThemePalette, [zone]:nextColor};
    customThemeColor = customThemePalette.accent;
    colorTheme = 'custom';
    applyColorTheme(colorTheme, customThemeColor, customThemePalette);
    if (syncPicker && customColorPicker && customColorPicker.color.hexString.toLowerCase() !== nextColor) {
      syncingColorPicker = true;
      customColorPicker.color.hexString = nextColor;
      syncingColorPicker = false;
    }
    return nextColor;
  }
  function setCustomThemePalette(value, syncPicker = true) {
    customThemePalette = window.FutureAIColorThemes?.normalizePalette(value, customThemePalette) || customThemePalette;
    customThemeColor = customThemePalette.accent;
    colorTheme = 'custom';
    applyColorTheme(colorTheme, customThemeColor, customThemePalette);
    if (syncPicker) setActiveThemeZone(activeThemeZone, true);
    return customThemePalette;
  }
  function setActiveThemeZone(value, syncPicker = true) {
    activeThemeZone = window.FutureAIColorThemes?.PALETTE_KEYS.includes(value) ? value : 'accent';
    const color = customThemePalette[activeThemeZone] || customThemeColor;
    if (syncPicker && customColorPicker && customColorPicker.color.hexString.toLowerCase() !== color) {
      syncingColorPicker = true;
      customColorPicker.color.hexString = color;
      syncingColorPicker = false;
    }
    syncColorThemeControls();
    return activeThemeZone;
  }
  function nextSavedColorThemeName() {
    const openSlot = Array.from({length: 5}, (_, index) => index).find(index => !savedColorThemes.some(item => item.slot === index));
    return `我的主题 ${Number.isInteger(openSlot) ? openSlot + 1 : 5}`;
  }
  function renderSavedColorThemes() {
    const list = $('savedColorThemeList');
    if (!list) return;
    list.innerHTML = Array.from({length: 5}, (_, slot) => {
      const item = savedColorThemes.find(theme => theme.slot === slot);
      if (!item) return `<button class="saved-theme-empty" type="button" data-saved-theme-slot="${slot}" title="保存当前主题到槽位 ${slot + 1}"><i class="fa-solid fa-plus"></i><span>槽位 ${slot + 1}</span></button>`;
      const active = item.id === activeSavedColorThemeId;
      const palette = window.FutureAIColorThemes?.normalizePalette(item.palette || {accent:item.color}) || {accent:item.color,deep:item.color,workspace:item.color,panel:item.color,control:item.color};
      return `<div class="saved-theme-slot ${active ? 'active' : ''}">
        <button class="saved-theme-apply" type="button" data-saved-theme-apply="${esc(item.id)}" title="应用 ${esc(item.name)}"><span class="saved-theme-palette" style="--saved-accent:${esc(palette.accent)};--saved-deep:${esc(palette.deep)};--saved-workspace:${esc(palette.workspace)};--saved-panel:${esc(palette.panel)};--saved-control:${esc(palette.control)}"><i></i><i></i><i></i><i></i><i></i></span><span>${esc(item.name)}</span></button>
        <button class="saved-theme-overwrite" type="button" data-saved-theme-overwrite="${esc(item.id)}" title="用当前配色覆盖 ${esc(item.name)}" aria-label="用当前配色覆盖 ${esc(item.name)}"><i class="fa-solid fa-arrow-rotate-left"></i></button>
        <button class="saved-theme-delete" type="button" data-saved-theme-delete="${esc(item.id)}" title="删除 ${esc(item.name)}" aria-label="删除 ${esc(item.name)}"><i class="fa-regular fa-trash-can"></i></button>
      </div>`;
    }).join('');
    if ($('savedColorThemeCount')) $('savedColorThemeCount').textContent = `${savedColorThemes.length} / 5`;
    if ($('saveCustomTheme')) {
      const full = savedColorThemes.length >= 5 && !activeSavedColorThemeId;
      const overwriteMode = Boolean(document.querySelector('.saved-theme-library')?.classList.contains('overwrite-mode'));
      $('saveCustomTheme').disabled = false;
      $('saveCustomTheme').classList.toggle('overwrite-prompt', full && !overwriteMode);
      $('saveCustomTheme').innerHTML = activeSavedColorThemeId
        ? '<i class="fa-solid fa-bookmark"></i> 更新主题'
        : full
          ? overwriteMode
            ? '<i class="fa-solid fa-xmark"></i> 取消覆盖'
            : '<i class="fa-solid fa-arrow-rotate-left"></i> 选择槽位覆盖'
          : '<i class="fa-solid fa-bookmark"></i> 保存当前';
    }
  }
  function saveCurrentColorTheme(slot = null) {
    if (colorTheme !== 'custom') {
      const resolved = window.FutureAIColorThemes?.resolveTheme(colorTheme, customThemeColor, customThemePalette);
      setCustomThemePalette(resolved?.palette || customThemePalette, true);
    }
    const saveAsNew = Number.isInteger(slot);
    const active = saveAsNew ? null : savedColorThemes.find(item => item.id === activeSavedColorThemeId);
    if (!saveAsNew && !active && savedColorThemes.length >= 5) {
      const library = document.querySelector('.saved-theme-library');
      const next = !library?.classList.contains('overwrite-mode');
      library?.classList.toggle('overwrite-mode', next);
      renderSavedColorThemes();
      if (next) {
        library?.scrollIntoView({block:'nearest',behavior:'smooth'});
        toast('请选择要覆盖的主题槽位', 'info');
      }
      return;
    }
    const targetSlot = saveAsNew ? slot : active?.slot ?? Array.from({length: 5}, (_, index) => index).find(index => !savedColorThemes.some(item => item.slot === index));
    if (!Number.isInteger(targetSlot)) return toast('最多保存 5 套个人主题，请先更新或删除一套。', 'warn');
    const id = active?.id || `personal-theme-${Date.now()}-${targetSlot + 1}`;
    const name = String($('customThemeName')?.value || '').trim() || `我的主题 ${targetSlot + 1}`;
    savedColorThemes = window.FutureAIColorThemes.upsertSavedTheme(savedColorThemes, {id, slot: targetSlot, name, color: customThemeColor, palette:customThemePalette});
    activeSavedColorThemeId = id;
    if ($('customThemeName')) $('customThemeName').value = savedColorThemes.find(item => item.id === id)?.name || name;
    renderSavedColorThemes();
    saveSettings();
    toast(active ? '个人主题已更新' : '个人主题已保存', 'success');
  }
  function overwriteSavedColorTheme(id) {
    const current = savedColorThemes.find(item => item.id === String(id || ''));
    if (!current) return;
    const name = String($('customThemeName')?.value || '').trim() || current.name;
    savedColorThemes = window.FutureAIColorThemes.upsertSavedTheme(savedColorThemes, {
      id:current.id,
      slot:current.slot,
      name,
      color:customThemeColor,
      palette:customThemePalette
    });
    activeSavedColorThemeId = current.id;
    document.querySelector('.saved-theme-library')?.classList.remove('overwrite-mode');
    if ($('customThemeName')) $('customThemeName').value = name;
    renderSavedColorThemes();
    saveSettings();
    toast(`已覆盖主题槽位 ${current.slot + 1}`, 'success');
  }
  function handleSavedColorThemeClick(event) {
    const overwriteButton = event.target.closest('[data-saved-theme-overwrite]');
    if (overwriteButton) return overwriteSavedColorTheme(overwriteButton.dataset.savedThemeOverwrite);
    const deleteButton = event.target.closest('[data-saved-theme-delete]');
    if (deleteButton) {
      const id = deleteButton.dataset.savedThemeDelete;
      savedColorThemes = window.FutureAIColorThemes.removeSavedTheme(savedColorThemes, id);
      if (activeSavedColorThemeId === id) activeSavedColorThemeId = '';
      document.querySelector('.saved-theme-library')?.classList.remove('overwrite-mode');
      renderSavedColorThemes();
      saveSettings();
      return toast('个人主题已删除', 'success');
    }
    const applyButton = event.target.closest('[data-saved-theme-apply]');
    if (applyButton) {
      const item = savedColorThemes.find(theme => theme.id === applyButton.dataset.savedThemeApply);
      if (!item) return;
      activeSavedColorThemeId = item.id;
      document.querySelector('.saved-theme-library')?.classList.remove('overwrite-mode');
      if ($('customThemeName')) $('customThemeName').value = item.name;
      setCustomThemePalette(item.palette || {accent:item.color}, true);
      renderSavedColorThemes();
      saveSettings();
      return toast(`已应用个人主题：${item.name}`, 'success');
    }
    const emptyButton = event.target.closest('[data-saved-theme-slot]');
    if (emptyButton) saveCurrentColorTheme(Number(emptyButton.dataset.savedThemeSlot));
  }
  async function ensureColorThemePicker() {
    const host = $('customColorWheel');
    if (!host || customColorPicker) return customColorPicker;
    const ok = await ensureVendor('iro', '专业取色器');
    if (!ok || !window.iro?.ColorPicker) return null;
    customColorPicker = new window.iro.ColorPicker(host, {
      width: 210,
      color: customThemePalette[activeThemeZone] || customThemeColor,
      borderWidth: 1,
      borderColor: '#91a5b2',
      layout: [
        {component: window.iro.ui.Wheel},
        {component: window.iro.ui.Slider, options: {sliderType: 'value'}}
      ]
    });
    customColorPicker.on('color:change', color => {
      if (syncingColorPicker) return;
      setCustomThemeColor(color.hexString, false);
      clearTimeout(colorThemeSaveTimer);
      colorThemeSaveTimer = setTimeout(saveSettings, 120);
    });
    syncColorThemeControls();
  }
  function syncColorThemeControls() {
    const zoneLabels = {accent:'按钮强调',deep:'应用背景',workspace:'画布底色',panel:'大面板',control:'卡片输入'};
    const zoneColor = customThemePalette[activeThemeZone] || customThemeColor;
    document.querySelectorAll('input[name="colorTheme"]').forEach(input => { input.checked = input.value === colorTheme; });
    if ($('customThemeColor')) $('customThemeColor').value = zoneColor;
    if ($('customThemeHex') && document.activeElement !== $('customThemeHex')) $('customThemeHex').value = zoneColor.toUpperCase();
    if ($('customThemePreview')) $('customThemePreview').style.backgroundColor = zoneColor;
    if ($('customThemeZoneLabel')) $('customThemeZoneLabel').textContent = `${zoneLabels[activeThemeZone] || '按钮强调'} HEX`;
    document.querySelectorAll('[data-theme-zone]').forEach(button => {
      const zone = button.dataset.themeZone;
      const active = zone === activeThemeZone;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
      button.querySelector('.theme-zone-swatch')?.style.setProperty('--zone-color', customThemePalette[zone] || customThemeColor);
    });
    if ($('customThemeRow')) {
      $('customThemeRow').classList.add('active');
      $('customThemeRow').setAttribute('aria-hidden', 'false');
    }
    renderSavedColorThemes();
  }
  function toggleFocusMode() {
    const next = document.body.classList.contains('appearance-focus') ? 'standard' : 'focus';
    applyAppearanceMode(next);
    saveSettings();
  }
  function applyAppearanceMode(mode) {
    const safe = normalizeAppearanceMode(mode);
    document.body.classList.add('dark-mode');
    document.body.dataset.appearance = safe;
    document.body.classList.toggle('appearance-focus', safe === 'focus');
    document.body.classList.toggle('appearance-contrast', safe === 'contrast');
    if ($('appearanceMode')) $('appearanceMode').value = safe;
    const btn = $('themeToggle');
    if (btn) {
      const focus = safe === 'focus';
      btn.innerHTML = focus ? '<i class="fa-solid fa-eye"></i>' : '<i class="fa-solid fa-crosshairs"></i>';
      btn.title = focus ? '退出专注模式' : '进入专注模式';
      btn.classList.toggle('active', focus);
    }
  }
  function toggleTheme() {
    toggleFocusMode();
  }
  function applyTheme() {
    applyAppearanceMode('standard');
  }
  function switchMascot() {
    const current = $('mascotImage')?.dataset.mascot || 'boy';
    applyMascot(current === 'boy' ? 'girl' : 'boy');
    saveSettings();
  }
  function applyMascot(kind) {
    const img = $('mascotImage');
    if (!img) return;
    const safe = kind === 'girl' ? 'girl' : 'boy';
    img.dataset.mascot = safe;
    img.src = safe === 'girl' ? './assets/mascot-girl.png' : './assets/mascot-boy.png';
    img.alt = safe === 'girl' ? '∞小妹' : '∞小子';
    const btn = $('mascotSwitch');
    if (btn) btn.title = safe === 'girl' ? '切换为男伴' : '切换为女伴';
  }
  function renderModels() {
    syncGlobalModelInputs();
    const active = {image: FutureAIApiDefaults.get('imageModel'), video: FutureAIApiDefaults.get('videoModel'), chat: FutureAIApiDefaults.get('chatModel')};
    const providerModels = apiProviders.flatMap(provider => [provider.chatModel, provider.imageModel, provider.videoModel, ...(provider.models || [])]).filter(Boolean);
    const buckets = ModelRendering.modelBuckets({
      imageModel: active.image,
      videoModel: active.video,
      chatModel: active.chat,
      importedModels: unique([...providerModels, ...importedModels])
    });
    fillSelect($('imageModelSelect'), buckets.image, active.image, globalProviderForKind('image')?.availableModels?.image);
    fillSelect($('videoModelSelect'), buckets.video, active.video);
    fillSelect($('chatModelSelect'), buckets.chat, active.chat, globalProviderForKind('chat')?.availableModels?.chat);
    refreshNodeModelSelects();
    const modelStore = $('modelStore');
    if (!modelStore) return;
    modelStore.innerHTML = ModelRendering.modelStoreHtml({buckets, active, esc});
    modelStore.onclick = e => {
      const imageBtn = e.target.closest('[data-use-image-model]');
      const videoBtn = e.target.closest('[data-use-video-model]');
      const chatBtn = e.target.closest('[data-use-chat-model]');
      const btn = imageBtn || videoBtn || chatBtn;
      if (!btn) return;
      if (imageBtn) setGlobalModelValue('image', btn.dataset.useImageModel);
      if (videoBtn) setGlobalModelValue('video', btn.dataset.useVideoModel);
      if (chatBtn) setGlobalModelValue('chat', btn.dataset.useChatModel);
    };
  }
  function fillSelect(sel, items, value, available = []) {
    if (!sel) return;
    sel.innerHTML = ModelRendering.selectOptionsHtml({models: items, available, esc});
    sel.value = value;
  }
  async function testApi() {
    ensureApiProviders();
    const provider = globalProviderForKind('chat');
    const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
    const model = provider.chatModel || FutureAIApiDefaults.get('chatModel').trim();
    const apiKey = await providerApiKey(provider);
    if (!apiUrl || !apiKey) {
      return toast('请先完善全局聊天供应商的 API 地址和密钥', 'warn');
    }
    if (!model) {
      return toast('请先选择或填写全局聊天模型', 'warn');
    }
    try {
      assertUsableApiBaseAddress(apiUrl);
      let modelsNote = '';
      try {
        const {res} = await fetchApiWithBaseFallback(apiUrl, '/models', {timeoutMs: 30000, retries: 0, headers: {Authorization: 'Bearer ' + apiKey}});
        const data = await safeJson(res);
        if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
        const modelIds = extractModelIds(data);
        if (modelIds.length && !modelIds.includes(model)) modelsNote = `\n注意：${model} 不在 /models 列表中，但已继续测试真实聊天请求。`;
      } catch (modelsErr) {
        modelsNote = '\n注意：/models 列表不可用，但已继续测试真实聊天请求。';
      }
      const reply = await chatCompletionTextRequest({
        apiUrl,
        apiKey,
        model,
        temperature: 0,
        maxTokens: 24,
        timeoutMs: 30000,
        retries: 0,
        messages: [
          {role: 'system', content: '只回复 OK。'},
          {role: 'user', content: 'ping'}
        ],
        endpoint: provider.chatEndpoint
      });
      if (provider) setProviderTestStatus(provider, modelsNote ? 'warn' : 'ok', `文本可用：${model}`);
      toast(`API 测试通过：${provider.name || '全局聊天供应商'} / ${model} 可返回内容。${reply ? '' : ''}${modelsNote}`, modelsNote ? 'warn' : 'success');
    } catch (err) {
      toast(apiErrorMessage(err, 'API 测试失败'), 'error');
    }
  }
  async function importModels() {
    ensureApiProviders();
    const providers = uniqueById(['chat', 'image', 'video'].map(kind => globalProviderForKind(kind)).filter(Boolean));
    if (!providers.length) return toast('请先添加 API 供应商', 'warn');
    try {
      const summaries = [];
      let total = 0;
      for (const provider of providers) {
        try {
          const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
          let selectedCapability = 'chat';
          let apiKey = await providerApiKey(provider);
          if (!apiKey) {
            selectedCapability = 'image';
            apiKey = await providerApiKey(provider);
          }
          if (!apiKey) {
            selectedCapability = 'video';
            apiKey = await providerApiKey(provider);
          }
          if (!apiUrl || !apiKey) {
            summaries.push(`${provider.name || providerTypeLabel(provider.type)}：缺少地址或密钥，已跳过`);
            continue;
          }
          assertUsableApiBaseAddress(apiUrl);
          const {res, requestUrl} = await fetchApiWithBaseFallback(apiUrl, '/models', {timeoutMs: API_TIMEOUTS.text, headers: {Authorization: 'Bearer ' + apiKey}});
          const data = await safeJson(res);
          if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
          const models = extractModelIds(data);
          assertModelListResponse({response: res, payload: data, models, requestUrl});
          const counts = applyImportedModelsToProvider(provider, models);
          importedModels = unique([...importedModels, ...models]);
          total += models.length;
          summaries.push(`${provider.name || providerTypeLabel(provider.type)}：${models.length} 个（${modelImportSummary(counts)}）`);
        } catch (err) {
          summaries.push(`${provider.name || providerTypeLabel(provider.type)}：导入失败，${err.message || String(err)}`);
        }
      }
      setStore(STORE.models, importedModels);
      saveSettings();
      renderApiProviders();
      renderModels();
      refreshNodeModelSelects();
      toast(`模型导入完成：${total} 个\n${summaries.join('\n')}`, 'success');
    } catch (err) {
      toast(apiErrorMessage(err, '模型导入失败'), 'error');
    }
  }

  let globalApiAutoImportTimer = 0;
  function scheduleGlobalApiAutoImport() {
    clearTimeout(globalApiAutoImportTimer);
    globalApiAutoImportTimer = setTimeout(() => {
      globalApiAutoImportTimer = 0;
      autoImportGlobalApiModels();
    }, 500);
  }

  async function autoImportGlobalApiModels() {
    const apiUrl = String(FutureAIApiDefaults.get('apiUrl') || '').trim().replace(/\/$/, '');
    const apiKey = String(FutureAIApiDefaults.get('apiKey') || '').trim();
    if (!apiUrl || !apiKey) return;
    try {
      ensureApiProviders();
      syncLegacyApiProvider();
      saveSettings();
      const provider = apiProviders.find(item => item.id === 'default-openai') || globalProviderForKind('chat');
      if (!provider) return;
      const response = await fetchApiWithBaseFallback(apiUrl, '/models', {
        timeoutMs: 30000,
        retries: 0,
        headers: {Authorization: 'Bearer ' + apiKey}
      });
      const data = await safeJson(response.res);
      if (!response.res.ok) throw new Error(data?.error?.message || data?.message || `HTTP ${response.res.status}`);
      const records = extractModelRecords(data);
      const models = unique(records.map(record => String(record.id || '').trim()).filter(Boolean));
      assertModelListResponse({response: response.res, payload: data, models, requestUrl: response.requestUrl});
      if (applyImportedModelRecordsToProvider) applyImportedModelRecordsToProvider(provider, records);
      else applyImportedModelsToProvider(provider, models);
      importedModels = unique([...importedModels, ...models]);
      setStore(STORE.models, importedModels);
      provider.setupStatus = 'ready';
      provider.setupModelsCount = models.length;
      provider.lastTest = {status: 'ok', message: `已自动导入 ${models.length} 个模型`, checkedAt: Date.now()};
      saveSettings();
      renderApiProviders();
      renderModels();
      refreshNodeModelSelects();
      toast(`API 已保存，自动导入 ${models.length} 个模型`, 'success');
    } catch (error) {
      console.warn('[api] automatic model import failed', error);
      saveSettings();
      renderApiProviders();
      toast('API 地址和 Key 已保存，但模型自动导入失败：' + (error?.message || error), 'warn');
    }
  }

  async function autoLayout(...args) { return canvasLayout()?.autoLayout?.(...args); }
  function layoutNodeTypeRank(...args) { return canvasLayout()?.layoutNodeTypeRank?.(...args); }
  function layoutNodeSort(...args) { return canvasLayout()?.layoutNodeSort?.(...args); }
  function canvasLayoutComponents(...args) { return canvasLayout()?.canvasLayoutComponents?.(...args); }
  function layoutComponent(...args) { return canvasLayout()?.layoutComponent?.(...args); }
  function applyStructuredLayout(...args) { return canvasLayout()?.applyStructuredLayout?.(...args); }
  async function autoLayoutWithElk(...args) { return canvasLayout()?.autoLayoutWithElk?.(...args); }
  function snapLayoutValue(...args) { return canvasLayout()?.snapLayoutValue?.(...args); }
  function layoutCommit(...args) { return canvasLayout()?.layoutCommit?.(...args); }
  function tidySelectedNodesByRows(...args) { return canvasLayout()?.tidySelectedNodesByRows?.(...args); }
  function tidyCanvasDepth(...args) { return canvasLayout()?.tidyCanvasDepth?.(...args); }
  function tidyCanvasGrid(...args) { return canvasLayout()?.tidyCanvasGrid?.(...args); }
  function fallbackAutoLayout(...args) { return canvasLayout()?.fallbackAutoLayout?.(...args); }
  function fitView(...args) { return canvasLayout()?.fitView?.(...args); }
  function fitNodeIntoView(...args) { return canvasLayout()?.fitNodeIntoView?.(...args); }
  function resetView(...args) { return canvasLayout()?.resetView?.(...args); }
  function moveNode(...args) { return canvasLayout()?.moveNode?.(...args); }
  function scheduleTransform(...args) { return canvasLayout()?.scheduleTransform?.(...args); }
  function applyTransform(...args) { return canvasLayout()?.applyTransform?.(...args); }
  function revealSelectedNode(...args) { return canvasLayout()?.revealSelectedNode?.(...args); }
  function proxyNodeSize(...args) { return canvasLayout()?.proxyNodeSize?.(...args); }
  function setCanvasProxyActive(...args) { return canvasLayout()?.setCanvasProxyActive?.(...args); }
  function scheduleCanvasProxyDraw(...args) { return canvasLayout()?.scheduleCanvasProxyDraw?.(...args); }
  function drawCanvasProxy(...args) { return canvasLayout()?.drawCanvasProxy?.(...args); }
  function scheduleViewportInteractionEnd(...args) { return canvasLayout()?.scheduleViewportInteractionEnd?.(...args); }
  function currentWorldBounds(...args) { return canvasLayout()?.currentWorldBounds?.(...args); }
  function nodeIntersectsView(...args) { return canvasLayout()?.nodeIntersectsView?.(...args); }
  function mountNode(...args) { return canvasLayout()?.mountNode?.(...args); }
  function unmountNode(...args) { return canvasLayout()?.unmountNode?.(...args); }
  function shouldVirtualizeNode(...args) { return canvasLayout()?.shouldVirtualizeNode?.(...args); }
  function scheduleVisibilityUpdate(...args) { return canvasLayout()?.scheduleVisibilityUpdate?.(...args); }
  function groupBounds(...args) { return canvasLayout()?.groupBounds?.(...args); }
  function addGroup(...args) { return canvasLayout()?.addGroup?.(...args); }
  function renderGroup(...args) { return canvasLayout()?.renderGroup?.(...args); }
  function renderGroups(...args) { return canvasLayout()?.renderGroups?.(...args); }
  function scheduleGroupRender(...args) { return canvasLayout()?.scheduleGroupRender?.(...args); }
  function groupSelectedNodes(...args) { return canvasLayout()?.groupSelectedNodes?.(...args); }
  function ungroupSelectedNodes(...args) { return canvasLayout()?.ungroupSelectedNodes?.(...args); }
  function selectGroupNodes(...args) { return canvasLayout()?.selectGroupNodes?.(...args); }
  function ungroupGroup(...args) { return canvasLayout()?.ungroupGroup?.(...args); }
  function expandNodeIdsForGroups(...args) { return canvasLayout()?.expandNodeIdsForGroups?.(...args); }
  function removeNodeFromGroups(...args) { return canvasLayout()?.removeNodeFromGroups?.(...args); }
  function screenToWorld(...args) { return canvasLayout()?.screenToWorld?.(...args); }
  function viewCenter(...args) { return canvasLayout()?.viewCenter?.(...args); }


  function openModal({title, value = '', text = '', okText = '确定', cancelText = '取消', cancelValue = null, confirm = false}) {
    modalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    $('modalTitle').textContent = title;
    $('modalInput').value = value;
    $('modalInput').classList.toggle('hidden', !!text);
    $('modalText').classList.toggle('hidden', !text);
    $('modalText').textContent = text;
    $('modalOk').textContent = okText;
    $('modalCancel').textContent = cancelText;
    $('modal').classList.remove('hidden');
    $('modal').setAttribute('aria-hidden', 'false');
    setTimeout(() => { if (!text) $('modalInput').focus(); }, 30);
    return new Promise(resolve => { modalResolve = {resolve, confirm, cancelValue}; });
  }
  function submitModal() {
    if (!modalResolve) return;
    const result = modalResolve.confirm ? true : $('modalInput').value;
    closeModal(result);
  }
  function closeModal(value) {
    $('modal').classList.add('hidden');
    $('modal').setAttribute('aria-hidden', 'true');
    if (modalResolve) modalResolve.resolve(value);
    modalResolve = null;
    const restore = modalPreviousFocus;
    modalPreviousFocus = null;
    if (restore && document.contains(restore)) requestAnimationFrame(() => restore.focus());
  }
  function openImageModal(src, trigger = null) {
    const safe = safeMediaUrl(src);
    if (!safe) return toast('素材地址不安全，已阻止打开', 'warn');
    const modal = $('imageModal');
    const wasOpen = !!modal && !modal.classList.contains('hidden');
    if (!wasOpen) imageModalPreviousFocus = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const video = $('videoModalPlayer');
    if (video) {
      video.pause();
      video.src = '';
      video.classList.add('hidden');
    }
    $('imageModalImg')?.classList.remove('hidden');
    imageModalSrc = safe;
    $('imageModalImg').src = safe;
    modalZoom = 1;
    modalPan = {x: 0, y: 0};
    modalDrag = null;
    modalSuppressClick = false;
    $('imageModal').classList.remove('dragging');
    $('imageModalImg').classList.remove('dragging');
    applyImageModalZoom();
    modal?.classList.remove('hidden');
    modal?.setAttribute('aria-hidden', 'false');
    const focusClose = () => {
      if (!$('imageModal')?.classList.contains('hidden')) $('imageModalClose')?.focus();
    };
    focusClose();
    requestAnimationFrame(focusClose);
    setTimeout(() => {
      const active = document.activeElement;
      if (!$('imageModal')?.classList.contains('hidden') && (active === document.body || active === imageModalPreviousFocus)) focusClose();
    }, 50);
  }
  function openMediaUrl(src) {
    if (!src) return toast('当前没有可查看的素材', 'warn');
    const safe = safeMediaUrl(src);
    if (!safe) return toast('素材地址不安全，已阻止打开', 'warn');
    if (isVideoMedia('', safe)) {
      const modal = $('imageModal');
      const wasOpen = !!modal && !modal.classList.contains('hidden');
      if (!wasOpen) imageModalPreviousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      $('imageModalImg').classList.add('hidden');
      imageModalSrc = safe;
      const video = $('videoModalPlayer');
      video.src = safe;
      video.classList.remove('hidden');
      modal?.classList.remove('hidden');
      modal?.setAttribute('aria-hidden', 'false');
      const focusClose = () => {
        if (!$('imageModal')?.classList.contains('hidden')) $('imageModalClose')?.focus();
      };
      focusClose();
      requestAnimationFrame(focusClose);
      setTimeout(() => {
        const active = document.activeElement;
        if (!$('imageModal')?.classList.contains('hidden') && (active === document.body || active === imageModalPreviousFocus)) focusClose();
      }, 50);
      return;
    }
    openImageModal(safe);
  }
  async function openFabricEditor(node) { return imageEditors()?.openFabricEditor?.(node); }
  function closeFabricEditor() { return imageEditors()?.closeFabricEditor?.(); }
  function onFabricEditorClick(e) { return imageEditors()?.onFabricEditorClick?.(e); }
  async function saveFabricEditor() { return imageEditors()?.saveFabricEditor?.(); }
  function syncFabricBrush() { return imageEditors()?.syncFabricBrush?.(); }

  async function openCropperEditor(node) { return imageEditors()?.openCropperEditor?.(node); }
  function closeCropperEditor() { return imageEditors()?.closeCropperEditor?.(); }
  function onCropperEditorClick(e) { return imageEditors()?.onCropperEditorClick?.(e); }
  async function saveCropperEditor() { return imageEditors()?.saveCropperEditor?.(); }
  async function openLocalEdit(node) { return localEdit()?.openLocalEdit?.(node); }
  function closeLocalEdit() { return localEdit()?.closeLocalEdit?.(); }
  function openBatchVariants(node) { return batchVariants()?.openBatchVariants?.(node); }
  function closeBatchVariants() { return batchVariants()?.closeBatchVariants?.(); }
  function regenerateImageAsNew(node, overrides) { return batchVariants()?.regenerateAsNew?.(node, overrides); }
  // A node that already shows a finished result (video still being fetched does not count).
  function nodeHasResult(node) {
    if (!node || node.data?.videoTask) return false;
    return Boolean(node.data?.url || (Array.isArray(node.data?.urls) && node.data.urls.some(Boolean)));
  }
  // One rule for every way of starting a run: a node that already shows a result keeps it, the run goes to a new node on its right.
  function generateImageKeepingOriginal(node, overrides = {}) {
    if (!node || node.type !== 'image') return Promise.resolve(false);
    if (nodeHasResult(node) && node.data.statusType !== 'running') return regenerateImageAsNew(node, overrides);
    Object.assign(node.data, overrides);
    hydrateNode(node);
    return enqueueImageGeneration(node.id);
  }
  function runVideoKeepingOriginal(node) {
    if (!nodeHasResult(node)) return runVideo(node.id);
    return batchVariants()?.rerunAsNew?.(node, {label: '重新生成', noun: '视频', run: next => quietRun(options => runVideo(next.id, new Set(), options))});
  }
  function runMediaToolKeepingOriginal(node) {
    if (!nodeHasResult(node)) return runMediaTool(node.id);
    return batchVariants()?.rerunAsNew?.(node, {label: '再次处理', noun: '结果', port: 'media', run: next => quietRun(options => runMediaTool(next.id, options))});
  }
  // Quiet runs keep their warning text so the single failure toast can say why.
  async function quietRun(run) {
    const options = {quiet: true, lastMessage: ''};
    const ok = await run(options);
    if (ok === false && options.lastMessage) throw new Error(options.lastMessage.replace(/^[^：\n]{0,12}失败：\s*/, '').replace(/\s*\n\s*/g, ' '));
    return ok;
  }
  // Group / canvas runs only fill empty nodes; finished ones are left alone (redo one with its own 重新生成 button).
  function skippedResultText(count) {
    return count ? `${count} 个节点已有结果，已跳过（要重做请点节点上的重新生成）` : '';
  }
  function openPromptAssist(node) { return promptAssist()?.openForNode?.(node); }
  function closePromptAssist() { return promptAssist()?.close?.(); }
  function pickBatchContinue(node) {
    const urls = Array.isArray(node?.data?.urls) ? node.data.urls.filter(Boolean) : [];
    if (urls.length > 1) {
      const active = node.data?.url && urls.includes(node.data.url) ? node.data.url : urls[0];
      return batchVariants()?.pickVariantSpawn?.(node, active);
    }
    return batchVariants()?.pickContinue?.(node);
  }

  function closeImageModal() {
    const wasOpen = !$('imageModal').classList.contains('hidden');
    $('imageModal').classList.add('hidden');
    $('imageModal').setAttribute('aria-hidden', 'true');
    $('imageModalImg').src = '';
    imageModalSrc = '';
    modalZoom = 1;
    modalPan = {x: 0, y: 0};
    modalDrag = null;
    modalSuppressClick = false;
    modalWheelDelta = 0;
    if (modalWheelRaf) {
      cancelAnimationFrame(modalWheelRaf);
      modalWheelRaf = 0;
    }
    applyImageModalZoom();
    const video = $('videoModalPlayer');
    if (video) {
      video.pause();
      video.src = '';
      video.classList.add('hidden');
    }
    $('imageModalImg').classList.remove('hidden');
    if (wasOpen) {
      const restore = imageModalPreviousFocus;
      imageModalPreviousFocus = null;
      if (restore && document.contains(restore)) {
        restore.focus();
        requestAnimationFrame(() => {
          const active = document.activeElement;
          if ($('imageModal')?.classList.contains('hidden') && document.contains(restore)
            && (active === document.body || active === $('imageModalClose'))) restore.focus();
        });
      }
    }
  }
  function handleImageModalWheel(e) {
    if ($('imageModal').classList.contains('hidden')) return;
    if (e.target.closest('button,input,textarea,select,video')) return;
    e.preventDefault();
    e.stopPropagation();
    const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * window.innerHeight : e.deltaY;
    modalWheelDelta += pixels;
    modalWheelPoint = {x: e.clientX, y: e.clientY};
    if (modalWheelRaf) return;
    modalWheelRaf = requestAnimationFrame(flushImageModalWheel);
  }
  function flushImageModalWheel() {
    modalWheelRaf = 0;
    const pixels = modalWheelDelta;
    modalWheelDelta = 0;
    if (!pixels || $('imageModal')?.classList.contains('hidden')) return;
    const img = $('imageModalImg');
    if (!img || img.classList.contains('hidden')) return;
    const next = Math.max(0.2, Math.min(8, modalZoom * Math.exp(-pixels * 0.0012)));
    if (Math.abs(next - modalZoom) < 0.0001) return;
    const rect = img.getBoundingClientRect();
    const offsetX = modalWheelPoint.x - (rect.left + rect.width / 2);
    const offsetY = modalWheelPoint.y - (rect.top + rect.height / 2);
    const ratio = next / modalZoom;
    modalPan = {
      x: modalPan.x + offsetX * (1 - ratio),
      y: modalPan.y + offsetY * (1 - ratio)
    };
    modalZoom = next;
    applyImageModalZoom();
  }
  function applyImageModalZoom() {
    const img = $('imageModalImg');
    if (!img) return;
    img.style.transform = `translate3d(${modalPan.x}px, ${modalPan.y}px, 0) scale(${modalZoom})`;
    img.style.transformOrigin = 'center center';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    const label = $('imageModalZoomLabel');
    if (label) label.textContent = Math.round(modalZoom * 100) + '%';
  }
  function zoomImageModal(factor) {
    modalZoom = Math.max(0.2, Math.min(8, modalZoom * factor));
    applyImageModalZoom();
  }
  function startImageModalDrag(e) {
    const modal = $('imageModal');
    const img = $('imageModalImg');
    if (modal.classList.contains('hidden') || e.button !== 0 || img.classList.contains('hidden')) return;
    if (e.target.closest('button,input,textarea,select,video')) return;
    modalDrag = {x: e.clientX, y: e.clientY, startX: modalPan.x, startY: modalPan.y, moved: false};
    try {
      if (typeof e.pointerId === 'number' && modal.setPointerCapture) modal.setPointerCapture(e.pointerId);
    } catch {}
    modal.classList.add('dragging');
    img.classList.add('dragging');
    e.preventDefault();
  }
  function updateImageModalDrag(e) {
    if (!modalDrag) return;
    const dx = e.clientX - modalDrag.x;
    const dy = e.clientY - modalDrag.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) modalDrag.moved = true;
    modalPan = {x: modalDrag.startX + dx, y: modalDrag.startY + dy};
    applyImageModalZoom();
  }
  function endImageModalDrag(e) {
    if (!modalDrag) return;
    const modal = $('imageModal');
    try {
      if (typeof e.pointerId === 'number' && modal.releasePointerCapture && modal.hasPointerCapture?.(e.pointerId)) {
        modal.releasePointerCapture(e.pointerId);
      }
    } catch {}
    modal.classList.remove('dragging');
    $('imageModalImg').classList.remove('dragging');
    const moved = modalDrag.moved;
    modalDrag = null;
    modalSuppressClick = moved;
    if (moved) setTimeout(() => { modalSuppressClick = false; }, 80);
  }
  function openMediaViewer(node) {
    openMediaUrl(node?.data?.url);
  }
  function defaultCameraState() {
    return CanvasCamera.defaultCameraState();
  }
  function normalizeCameraState(value = {}) {
    return CanvasCamera.normalizeCameraState(value);
  }
  function clampNumber(value, min, max, fallback) {
    return CanvasCamera.clampNumber(value, min, max, fallback);
  }
  function openCameraModal(node) {
    if (!node || node.type !== 'image') return toast('请先选择图片节点', 'warn');
    cameraTargetNodeId = node.id;
    cameraDraft = normalizeCameraState(node.data.camera3d);
    const url = safeMediaUrl(node.data.url || node.data.refUrl || '');
    $('cameraPlane').style.backgroundImage = url ? `url("${cssUrl(url)}")` : '';
    $('cameraPlane').classList.toggle('empty', !url);
    syncCameraControls();
    $('cameraModal')?.classList.remove('hidden');
  }
  function closeCameraModal() {
    $('cameraModal')?.classList.add('hidden');
    cameraDrag = null;
  }
  async function applyCameraModal() {
    const node = nodes.get(cameraTargetNodeId);
    if (!node) return closeCameraModal();
    const camera3d = normalizeCameraState(cameraDraft);
    closeCameraModal();
    // A node with a picture keeps it (and its angle); the new angle renders on a new node to the right.
    if (nodeHasResult(node)) toast('多角度：' + cameraSummary(camera3d) + '，将在右侧新节点生成', 'info');
    else toast('已应用 3D 相机角度：' + cameraSummary(camera3d), 'success');
    await generateImageKeepingOriginal(node, {camera3d});
  }
  function updateCameraFromControls() {
    cameraDraft = normalizeCameraState({
      yaw: $('cameraYaw')?.value,
      pitch: $('cameraPitch')?.value,
      distance: $('cameraDistance')?.value
    });
    syncCameraControls();
  }
  function onCameraPresetClick(e) {
    const yaw = e.target.closest('[data-camera-yaw]');
    const pitch = e.target.closest('[data-camera-pitch]');
    const distance = e.target.closest('[data-camera-distance]');
    const btn = yaw || pitch || distance;
    if (!btn) return;
    if (yaw) cameraDraft.yaw = Number(yaw.dataset.cameraYaw);
    if (pitch) cameraDraft.pitch = Number(pitch.dataset.cameraPitch);
    if (distance) cameraDraft.distance = Number(distance.dataset.cameraDistance);
    cameraDraft = normalizeCameraState(cameraDraft);
    syncCameraControls();
  }
  function cameraSceneMetrics(camera) {
    return CanvasCamera.cameraSceneMetrics(camera);
  }
  function syncCameraControls() {
    const camera = normalizeCameraState(cameraDraft);
    cameraDraft = camera;
    if ($('cameraYaw')) $('cameraYaw').value = camera.yaw;
    if ($('cameraPitch')) $('cameraPitch').value = camera.pitch;
    if ($('cameraDistance')) $('cameraDistance').value = camera.distance;
    if ($('cameraYawValue')) $('cameraYawValue').textContent = Math.round(camera.yaw) + '°';
    if ($('cameraPitchValue')) $('cameraPitchValue').textContent = Math.round(camera.pitch) + '°';
    if ($('cameraDistanceValue')) $('cameraDistanceValue').textContent = camera.distance.toFixed(1);
    if ($('cameraSummary')) $('cameraSummary').textContent = cameraSummary(camera);
    const plane = $('cameraPlane');
    if (plane) plane.style.transform = `translate(-50%,-50%) rotateY(${camera.yaw}deg) rotateX(${-camera.pitch}deg)`;
    const scene = cameraSceneMetrics(camera);
    const scale = Math.max(.72, 1.18 - camera.distance / 12);
    const eye = $('cameraEye');
    if (eye) eye.style.transform = `translate(${scene.eyeX}px, ${scene.eyeY}px) translate(-50%,-50%) scale(${scale})`;
    const sight = $('cameraSight');
    if (sight) {
      sight.style.width = scene.length + 'px';
      sight.style.transform = `translate(${scene.eyeX}px, ${scene.eyeY}px) rotate(${scene.angle}deg)`;
    }
  }
  function startCameraDrag(e) {
    if ($('cameraModal')?.classList.contains('hidden')) return;
    if (!e.target.closest('.camera-stage') || e.target.closest('button,input')) return;
    cameraDrag = {x: e.clientX, y: e.clientY, yaw: cameraDraft.yaw, pitch: cameraDraft.pitch};
    e.preventDefault();
  }
  function updateCameraDrag(e) {
    if (!cameraDrag) return;
    cameraDraft = normalizeCameraState({
      yaw: cameraDrag.yaw + (e.clientX - cameraDrag.x) * .22,
      pitch: cameraDrag.pitch - (e.clientY - cameraDrag.y) * .18,
      distance: cameraDraft.distance
    });
    syncCameraControls();
  }
  function endCameraDrag() {
    cameraDrag = null;
  }
  function onCameraWheel(e) {
    if ($('cameraModal')?.classList.contains('hidden')) return;
    if (!e.target.closest('.camera-stage')) return;
    e.preventDefault();
    cameraDraft.distance = clampNumber(cameraDraft.distance + (e.deltaY > 0 ? .35 : -.35), 1, 10, 5);
    syncCameraControls();
  }
  function cssUrl(url) {
    return String(url || '').replace(/["\\\n\r]/g, '');
  }
  function cameraSummary(camera) {
    return CanvasCamera.cameraSummary(camera);
  }
  function cameraPrompt(camera) {
    return CanvasCamera.cameraPrompt(camera);
  }
  function composerPromptExtras(node) {
    const bits = [];
    if (node?.data?.markTag) bits.push('构图要求：' + node.data.markTag);
    if (node?.data?.styleTag) bits.push('视觉风格：' + node.data.styleTag);
    if (node?.data?.moodTag) bits.push('情绪氛围：' + node.data.moodTag);
    return bits.join('。');
  }
  function withCameraPrompt(prompt, node) {
    const extra = [cameraPrompt(node?.data?.camera3d), composerPromptExtras(node)].filter(Boolean).join('\n');
    return extra ? [prompt, extra].filter(Boolean).join('\n\n') : prompt;
  }
  // Next-step node to the right of the source, wired to it (same options as dropping a wire on empty canvas).
  function createNextStepNode(node, optionId) {
    const kind = node.type === 'video' ? 'video' : 'image';
    const option = CanvasNodes.wireDropOptions(node, 'out', kind).find(item => item.id === optionId);
    if (!option) return null;
    return createConnectedNode(node.id, 'out', option, node.x + nodeSize(node).width + 80, node.y);
  }
  function runNodeContextAction(node, action, ids = [node?.id]) {
    if (!node) return;
    if (action === 'copy') return duplicateNodes(ids);
    if (action === 'delete') return deleteNodes(ids);
    if (action === 'lock') return setNodesLocked(ids, !ids.every(id => nodes.get(id)?.data.locked));
    if (action === 'front' || action === 'back') return setNodesLayer(ids, action === 'front');
    if (action === 'download') return downloadNodes(ids);
    if (action === 'export-share') {
      selectedNodes.clear();
      ids.forEach(id => selectedNodes.add(id));
      renderSelection();
      return openExportShare({scope: 'selection', format: 'share-zip'});
    }
    if (action === 'group' || action === 'ungroup') {
      selectedNodes.clear();
      ids.forEach(id => selectedNodes.add(id));
      return action === 'group' ? groupSelectedNodes() : ungroupSelectedNodes();
    }
    if (action === 'save-template') {
      selectedNodes.clear();
      ids.forEach(id => selectedNodes.add(id));
      renderSelection();
      return openTemplateGallery({mode: 'insert', focusSave: true, category: 'mine'});
    }
    if (action === 'fullscreen') return openMediaViewer(node);
    if (action === 'region-edit') return openLocalEdit(node);
    if (action === 'batch-variants') return openBatchVariants(node);
    if (action === 'prompt-assist') return openPromptAssist(node);
    if (action === 'pick-continue') return pickBatchContinue(node);
    if (action === 'fabric-edit') return openFabricEditor(node);
    if (action === 'crop-image') return openCropperEditor(node);
    if (action === 'send-to-director') return sendImageNodeToDirectorDesk(node);
    if (action === 'preview-request' || action === 'last-request') {
      try { return generationQueueApi()?.previewImageRequest(node.id, getResolvedImageRefItems(node.id, node.data.manualRefUrl || ''), action === 'last-request'); }
      catch (error) { return toast(error.message, 'warn'); }
    }
    if (action === 'favorite' || action === 'asset') {
      const asset = addAssetLibraryItem({
        type: node.type === 'video' || isVideoMedia(node.data.mime, node.data.url) ? 'video' : 'image',
        url: node.data.url || '',
        urls: node.data.urls || [],
        prompt: node.data.prompt || '',
        model: node.data.model || node.type,
        size: node.data.size || '',
        time: Date.now()
      });
      if (asset) return toast('已加入资产库；便携素材会写入软件旁的 library 文件夹', 'success');
      return;
    }
    if (action === 'assistant') {
      chatMessages.push({role: 'assistant', content: '已接收当前图片节点，可继续让我帮你分析画面、改写提示词或扩展分镜。'});
      $('chatPanel').classList.remove('hidden');
      renderChat();
      return;
    }
    if (action === 'image-to-image' || action === 'image-to-video') return createNextStepNode(node, action);
    if (action === 'describe') {
      // Placed beside the image and not wired into its prompt port, so it can never become the image's own prompt.
      selectSingleNode(batchVariants().spawnRight(node, 'prompt', {prompt: '请分析这张图片的主体、风格、构图、光线、场景和可复用提示词。'}).id);
      saveProject();
      return toast('已在右侧创建图片描述提示节点', 'success');
    }
    if (action === 'edit') {
      dialogEditActiveNodeId = node.id;
      openDialogEditWorkbench(node.id);
      return toast('已打开对话改图工作区', 'success');
    }
    if (action === 'grid') {
      selectSingleNode(batchVariants().spawnRight(node, 'prompt', {prompt: '分镜格子：画面编号 / 景别 / 主体动作 / 场景 / 镜头运动 / 画面连续性。'}).id);
      saveProject();
      return toast('已在右侧创建分镜格子节点', 'success');
    }
    if (action === 'script') {
      selectSingleNode(batchVariants().spawnRight(node, 'prompt', {prompt: '脚本：镜头目标、角色动作、旁白/对白、画面调度、情绪节奏。'}).id);
      saveProject();
      return toast('已在右侧创建脚本节点', 'success');
    }
    if (action === 'cover') return createNextStepNode(node, 'last-frame');
    if (action === 'camera') return openCameraModal(node);
  }
  function enhanceTextareas(root) {
    root.querySelectorAll('textarea').forEach(textarea => {
      if (textarea.id === 'textEditorInput' || textarea.closest('.text-editor-modal')) return;
      if (textarea.dataset.expandReady === '1') return;
      textarea.dataset.expandReady = '1';
      const wrap = document.createElement('div');
      wrap.className = 'textarea-wrap';
      textarea.parentNode.insertBefore(wrap, textarea);
      wrap.appendChild(textarea);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-expand-btn';
      btn.title = '放大文本框';
      btn.innerHTML = '<i class="fa-solid fa-expand"></i>';
      wrap.appendChild(btn);
      btn.addEventListener('click', () => openTextEditor(textarea));
      // Media node prompts get the 优化提示词 icon beside the expand button; the node click handler runs it.
      if (textarea.hasAttribute('data-inline-optimize')) wrap.insertAdjacentHTML('beforeend', '<button type="button" class="text-optimize-btn" data-optimize-prompt data-icon-only title="优化提示词" aria-label="优化提示词"><i class="fa-solid fa-wand-magic-sparkles"></i></button>');
    });
  }
  function openTextEditor(textarea) {
    activeTextArea = textarea;
    const input = $('textEditorInput');
    input.value = textarea.value || '';
    $('textEditorModal').classList.remove('hidden');
    setTimeout(() => input.focus(), 30);
  }
  function syncExpandedText() {
    if (!activeTextArea) return;
    activeTextArea.value = $('textEditorInput').value;
    activeTextArea.dispatchEvent(new Event('input', {bubbles: true}));
  }
  function closeTextEditor() {
    syncExpandedText();
    $('textEditorModal')?.classList.add('hidden');
    activeTextArea = null;
  }
  function rememberDrawerFocus(id, fallback = null) {
    const active = fallback instanceof HTMLElement
      ? fallback
      : document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) drawerPreviousFocus.set(id, active);
  }
  function focusDrawer(id, preferredSelector) {
    const drawer = $(id);
    const previous = drawerPreviousFocus.get(id);
    const focusTarget = () => {
      if (!drawer || drawer.classList.contains('hidden')) return;
      drawer.querySelector(preferredSelector || 'button,input,textarea,select,[tabindex]:not([tabindex="-1"])')?.focus();
    };
    focusTarget();
    requestAnimationFrame(focusTarget);
    setTimeout(() => {
      const active = document.activeElement;
      if (!drawer?.classList.contains('hidden') && (active === document.body || active === previous)) focusTarget();
    }, 50);
  }
  function restoreDrawerFocus(id) {
    const restore = drawerPreviousFocus.get(id);
    drawerPreviousFocus.delete(id);
    if (restore && document.contains(restore)) {
      const drawer = $(id);
      restore.focus();
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (drawer?.classList.contains('hidden') && document.contains(restore)
          && (active === document.body || drawer.contains(active))) restore.focus();
      });
    }
  }
  const SETTINGS_TABS = ['appearance', 'api', 'generation', 'storage', 'about'];
  function switchSettingsTab(tab, {persist = true} = {}) {
    const id = SETTINGS_TABS.includes(tab) ? tab : 'api';
    document.querySelectorAll('#settingsDrawer [data-settings-tab]').forEach(btn => {
      const on = btn.dataset.settingsTab === id;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#settingsDrawer [data-settings-pane]').forEach(pane => {
      pane.classList.toggle('hidden', pane.dataset.settingsPane !== id);
    });
    if (persist) {
      try { localStorage.setItem('futureai.settingsTab', id); } catch {}
    }
    if (id === 'api') refreshProviderBalances();
    if (id === 'appearance') void ensureColorThemePicker();
  }
  function revealSettingsTarget(id) {
    const target = $(id);
    if (!target) return;
    const pane = target.closest('[data-settings-pane]')?.dataset.settingsPane;
    if (pane) switchSettingsTab(pane);
    target.closest('details')?.setAttribute('open', '');
    requestAnimationFrame(() => {
      target.scrollIntoView?.({block: 'center'});
      target.focus?.();
    });
  }
  function openSettings(event = null) {
    rememberDrawerFocus('settingsDrawer', event?.currentTarget);
    syncCurrentProjectBudgetControl();
    renderReviewCommentsReport();
    renderBudgetLedgerReport();
    let last = 'api';
    try { last = localStorage.getItem('futureai.settingsTab') || 'api'; } catch {}
    switchSettingsTab(last, {persist: false});
    $('settingsDrawer').classList.remove('hidden');
    $('settingsDrawer').setAttribute('aria-hidden', 'false');
    focusDrawer('settingsDrawer', '#closeSettings');
    requestAnimationFrame(() => $('closeSettings')?.focus());
    setTimeout(() => {
      if (!$('settingsDrawer')?.classList.contains('hidden')) $('closeSettings')?.focus();
    }, 50);
    void ensureColorThemePicker();
  }
  function closeSettings() {
    const wasOpen = !$('settingsDrawer').classList.contains('hidden');
    $('settingsDrawer').classList.add('hidden');
    $('settingsDrawer').setAttribute('aria-hidden', 'true');
    if (wasOpen) restoreDrawerFocus('settingsDrawer');
  }
  function toggleHistory(event = null) {
    closeAssetLibrary();
    const opening = $('historyDrawer').classList.contains('hidden');
    if (opening) rememberDrawerFocus('historyDrawer', event?.currentTarget);
    $('historyDrawer').classList.toggle('hidden');
    $('historyDrawer').setAttribute('aria-hidden', String($('historyDrawer').classList.contains('hidden')));
    renderHistory();
    if (opening) focusDrawer('historyDrawer', '#closeHistory');
    else restoreDrawerFocus('historyDrawer');
  }
  function closeHistory() {
    const wasOpen = !$('historyDrawer').classList.contains('hidden');
    $('historyDrawer').classList.add('hidden');
    $('historyDrawer').setAttribute('aria-hidden', 'true');
    if (wasOpen) restoreDrawerFocus('historyDrawer');
  }
  function toggleAssetLibrary(event = null) {
    closeHistory();
    const opening = $('assetLibraryDrawer')?.classList.contains('hidden');
    if (opening) rememberDrawerFocus('assetLibraryDrawer', event?.currentTarget);
    $('assetLibraryDrawer')?.classList.toggle('hidden');
    $('assetLibraryDrawer')?.setAttribute('aria-hidden', String($('assetLibraryDrawer').classList.contains('hidden')));
    renderAssetLibrary();
    if (opening) {
      mediaWorkbench()?.syncPortableLibraryIntoAssets?.().catch(err => console.warn('portable sync failed', err));
      focusDrawer('assetLibraryDrawer', '#assetLibrarySearch');
      setTimeout(() => {
        if (!$('assetLibraryDrawer')?.classList.contains('hidden')) $('assetLibrarySearch')?.focus();
      }, 50);
    }
    else restoreDrawerFocus('assetLibraryDrawer');
  }
  function closeAssetLibrary() {
    const wasOpen = !$('assetLibraryDrawer')?.classList.contains('hidden');
    $('assetLibraryDrawer')?.classList.add('hidden');
    $('assetLibraryDrawer')?.setAttribute('aria-hidden', 'true');
    if (wasOpen) restoreDrawerFocus('assetLibraryDrawer');
  }
  function zoomCanvas(factor) {
    const r = $('canvas').getBoundingClientRect();
    const mx = r.width / 2;
    const my = r.height / 2;
    const next = zoomAroundPoint({scale, offsetX, offsetY}, {x: mx, y: my}, scale * factor);
    scale = next.scale;
    offsetX = next.offsetX;
    offsetY = next.offsetY;
    $('canvas')?.classList.add('is-zooming');
    setCanvasProxyActive(true);
    scheduleTransform(false, false);
    scheduleViewportInteractionEnd();
  }
  function setCanvasZoom(next) {
    const r = $('canvas').getBoundingClientRect();
    const mx = r.width / 2;
    const my = r.height / 2;
    const nextView = zoomAroundPoint({scale, offsetX, offsetY}, {x: mx, y: my}, clampScale(next || 1, .25, 1.6), {min: .25, max: 1.6});
    scale = nextView.scale;
    offsetX = nextView.offsetX;
    offsetY = nextView.offsetY;
    $('canvas')?.classList.add('is-zooming');
    setCanvasProxyActive(true);
    scheduleTransform(false, false);
    scheduleViewportInteractionEnd();
  }
  function updateZoomLabel() {
    const label = $('canvasZoomLabel');
    const percent = String(Math.round(scale * 100));
    if (percent === lastZoomPercent) return;
    lastZoomPercent = percent;
    if (label) label.textContent = percent + '%';
    const slider = $('zoomSlider');
    if (slider) slider.value = percent;
  }
  function closeWorkflowBar() {
    document.querySelector('.workflow-bar')?.classList.remove('open');
    $('railPan')?.classList.remove('active');
  }
  function toggleWorkflowBar() {
    const bar = document.querySelector('.workflow-bar');
    if (!bar) return;
    const open = bar.classList.toggle('open');
    $('railPan')?.classList.toggle('active', open);
  }
  function startMascotDrag(e) {
    mascotDrag = null;
    mascotWasDragged = false;
  }
  function toggleChat() {
    if (mascotWasDragged) return;
    $('chatPanel').classList.toggle('hidden');
    if (!$('chatPanel').classList.contains('hidden')) $('chatPreview')?.classList.add('hidden');
    renderChat();
  }
  function renderChat() {
    if (!chatMessages.length) {
      chatMessages = [{role: 'assistant', content: '我是∞小子。可以帮你整理提示词、分镜、角色一致性，也可以解释当前画布流程。'}];
    }
    const container = $('chatMessages');
    container.replaceChildren();
    chatMessages.forEach(m => {
      const message = document.createElement('div');
      message.className = `chat-msg ${m.role === 'user' ? 'user' : 'assistant'}`;
      const assets = document.createElement('div');
      assets.className = 'chat-assets';
      (m.attachments || []).forEach(a => {
        const url = safeMediaUrl(a.url);
        if (!url) return;
        const media = document.createElement(isVideoMedia(a.mime, url) ? 'video' : 'img');
        media.src = url;
        if (media.tagName === 'VIDEO') media.controls = true;
        else media.alt = String(a.name || '素材');
        assets.appendChild(media);
      });
      if (assets.childElementCount) message.appendChild(assets);
      const content = m.role === 'assistant' ? localizeAssistantText(m.content) : m.content;
      message.appendChild(document.createTextNode(String(content || '')));
      container.appendChild(message);
    });
    container.scrollTop = container.scrollHeight;
  }
  function showChatPreview(text) {
    const preview = $('chatPreview');
    const previewText = $('chatPreviewText');
    if (!preview || !previewText || !text) return;
    previewText.textContent = String(text).replace(/\s+/g, ' ').slice(0, 88);
    positionChatPreviewNearMascot();
    preview.classList.toggle('hidden', !$('chatPanel').classList.contains('hidden'));
    preview.classList.add('pulse');
    setTimeout(() => preview.classList.remove('pulse'), 1200);
  }
  function positionChatPreviewNearMascot() {
    const preview = $('chatPreview');
    const mascot = $('mascotButton');
    if (!preview || !mascot) return;
    const r = mascot.getBoundingClientRect();
    const width = preview.offsetWidth || 280;
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, r.left - width + 28));
    const top = Math.max(12, Math.min(window.innerHeight - 82, r.top - 12));
    preview.style.left = left + 'px';
    preview.style.top = top + 'px';
    preview.style.right = 'auto';
    preview.style.bottom = 'auto';
  }
  async function addChatUploads(e) {
    const files = [...(e.target.files || [])].filter(isSupportedUploadFile).slice(0, 6);
    e.target.value = '';
    if (!files.length) return toast('只支持上传图片或视频给助手', 'warn');
    const added = [];
    for (const file of files) {
      const url = await fileToDataUrl(file);
      const item = {url, name: file.name || '上传素材', mime: file.type || '', kind: isVideoMedia(file.type, url) ? 'video' : 'image'};
      chatAttachments.push(item);
      added.push(item);
    }
    chatMessages.push({
      role: 'user',
      content: '已上传素材给助手：' + added.map(a => a.name).join('、'),
      attachments: added
    });
    chatMessages.push({
      role: 'assistant',
      content: '我已接收素材。你可以让我分析画面、提炼提示词、拆分镜头，或者把它作为角色/风格/场景参考继续生成。'
    });
    $('chatPanel').classList.remove('hidden');
    renderChat();
    showChatPreview('我已接收素材。你可以让我分析画面、提炼提示词、拆分镜头。');
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function chatAttachmentSummary(attachments = []) {
    const items = attachments.map((item, index) => {
      const kind = isVideoMedia(item.mime, item.url) ? 'video' : 'image';
      const role = kind === 'video'
        ? '视频素材，只作为动作、节奏或镜头参考'
        : '图片素材，可作为画面理解、角色、风格、构图或改图参考';
      return {
        index: index + 1,
        name: item.name || `附件 ${index + 1}`,
        kind,
        mime: item.mime || '',
        role
      };
    });
    return {
      count: items.length,
      items
    };
  }

  function buildAssistantOutputDiscipline(userText = '') {
    const text = String(userText || '');
    const wantsPrompt = /提示词|prompt|咒语|反推|优化.*词|生成.*词/i.test(text);
    const wantsStoryboard = /分镜|镜头|剧本|短剧|漫剧|storyboard|shot/i.test(text);
    const wantsImageEdit = /改图|修图|局部|替换|去掉|保留|重绘|图生图/i.test(text);
    const wantsAnalysis = /分析|理解|看看|评价|为什么|问题|优化建议/i.test(text);
    const rules = [
      '先判断用户当前任务类型，再回答；不要泛泛聊天。',
      '必须优先使用当前选中节点、上游节点和画布摘要；如果没有相关上下文，再按用户文本回答。',
      '不知道或上下文不足时，直接指出缺口，并给一个可执行的默认方案；不要编造用户没有提供的画面信息。',
      '回答要短而有用，优先给可复制、可执行的结果；避免空泛夸奖、长篇理论和“可以尝试”式废话。',
      '涉及图片生成或改图时，明确区分：要保留什么、要改变什么、参考图的用途、负向避免什么。',
      '涉及角色/漫剧/视频时，必须关注角色一致性、镜头连续性、画幅、动作节奏和上下游节点约束。'
    ];
    if (wantsPrompt) rules.push('如果用户要提示词，输出“正向提示词”和“负向提示词”；不要解释太多。');
    if (wantsStoryboard) rules.push('如果用户要分镜，按“镜头编号 / 画面 / 角色动作 / 镜头运动 / 生成提示”组织。');
    if (wantsImageEdit) rules.push('如果用户要改图，按“保留 / 修改 / 避免 / 可直接用的改图指令”组织。');
    if (wantsAnalysis) rules.push('如果用户要分析，先列主要问题，再给优先级最高的 3-5 条改进建议。');
    return rules.join('\n');
  }

  function assistantContextMode() {
    const value = $('assistantContextModeInline')?.value || 'auto';
    return ['auto', 'selected', 'full', 'off'].includes(value) ? value : 'auto';
  }

  function trimCanvasSummaryForMode(summary, mode) {
    if (mode === 'full') return summary;
    return {
      projectName: summary.projectName,
      nodeCount: summary.nodeCount,
      edgeCount: summary.edgeCount,
      selectedCount: summary.selectedCount,
      typeCounts: summary.typeCounts,
      selected: summary.selected
    };
  }

  function buildAssistantIntelligenceContext({userText = '', attachments = []} = {}) {
    const snapshot = canvasContextSnapshot();
    const mode = assistantContextMode();
    const canvasSummary = getFullCanvasSummary(snapshot, 16);
    const selectedContextText = buildPromptContext(snapshot, {mode: 'chat'});
    const profile = activeAssistantProfile() || {};
    const profilePrompt = assistantSystemPrompt() || '你是∞未来 AI 里的高级创作助手，擅长 AI 漫剧、分镜、提示词、角色一致性、图像理解和工作流诊断。';
    const attachmentSummary = chatAttachmentSummary(attachments);
    const contextSections = [];
    if (mode === 'off') {
      contextSections.push('【画布上下文模式】关闭。不要主动引用当前画布项目或节点，除非用户消息里明确提供。');
    } else if (mode === 'selected') {
      contextSections.push('【画布上下文模式】仅选中节点。只允许使用当前选中节点及其上下游关系。');
      contextSections.push(selectedContextText || '【画布上下文】当前没有选中节点；本轮不要引用画布内容。');
    } else {
      contextSections.push(`【画布上下文模式】${mode === 'full' ? '完整画布' : '自动'}`);
      contextSections.push('【画布摘要】');
      contextSections.push(JSON.stringify(trimCanvasSummaryForMode(canvasSummary, mode), null, 2));
      contextSections.push(selectedContextText || '【画布上下文】当前没有选中节点。');
    }
    return [
      profilePrompt,
      '【当前助手画像】',
      JSON.stringify({
        name: profile.name || '智能创作助手',
        model: profile.model || globalProviderForKind('chat')?.chatModel || FutureAIApiDefaults.get('chatModel') || '',
        negativePrompt: profile.negativePrompt || ''
      }, null, 2),
      ...contextSections,
      '【本轮附件摘要】',
      JSON.stringify(attachmentSummary, null, 2),
      '【输出纪律】',
      buildAssistantOutputDiscipline(userText)
    ].filter(Boolean).join('\n\n');
  }

  async function sendChat() {
    const text = $('chatInput').value.trim();
    const attachments = chatAttachments.splice(0, 6);
    if (!text && !attachments.length) return;
    chatMessages.push({role: 'user', content: text || '请分析这些上传素材。', attachments});
    $('chatInput').value = '';
    renderChat();
    const provider = globalProviderForKind('chat');
    const apiUrl = provider.apiUrl || FutureAIApiDefaults.get('apiUrl').trim().replace(/\/$/, '');
    const model = provider.chatModel || FutureAIApiDefaults.get('chatModel').trim();
    const apiKey = await providerApiKey(provider);
    if (!apiUrl || !apiKey) {
      const reply = '先在设置里完善全局聊天供应商和密钥，我就能接入你的聊天模型。';
      chatMessages.push({role: 'assistant', content: reply});
      renderChat();
      showChatPreview(reply);
      return;
    }
    if (!model) {
      const reply = '请先选择或填写全局聊天模型。';
      chatMessages.push({role: 'assistant', content: reply});
      renderChat();
      showChatPreview(reply);
      return;
    }
    try {
      const intelligenceContext = buildAssistantIntelligenceContext({userText: text, attachments});
      const messages = [
        {role: 'system', content: applyModelAgnosticTextRules(intelligenceContext, 'chat')},
        ...chatMessages.slice(-12).map(chatToApiMessage)
      ];
      const res = await fetchJsonWithRetry(joinApiPath(apiUrl, provider.chatEndpoint || '/chat/completions'), {timeoutMs: API_TIMEOUTS.text,
        retries: 2,
        retryUnsafe: true,
        method: 'POST',
        headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey},
        body: JSON.stringify({model, messages, temperature: .45, max_tokens: 1600})
      });
      const data = await safeJson(res);
      if (!res.ok) throw new Error(data.error?.message || data.message || JSON.stringify(data));
      const reply = cleanAiText(data.choices?.[0]?.message?.content || data.output_text || data.content || '没有返回内容。');
      chatMessages.push({role: 'assistant', content: reply});
      showChatPreview(reply);
    } catch (err) {
      const reply = '请求失败：\n' + (err.message || err);
      chatMessages.push({role: 'assistant', content: reply});
      showChatPreview(reply);
    }
    renderChat();
  }
  function chatToApiMessage(m) {
    const attachments = (m.attachments || [])
      .map(a => ({...a, url: safeMediaUrl(a.url)}))
      .filter(a => a.url && !isVideoMedia(a.mime, a.url));
    if (!attachments.length) return {role: m.role, content: m.content};
    return {
      role: m.role,
      content: [
        {type: 'text', text: m.content || '请分析这些图片素材。'},
        ...attachments.map(a => ({type: 'image_url', image_url: {url: a.url}}))
      ]
    };
  }
  let downloadSeq = 0;
  function triggerBrowserDownload(href, name) {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  async function downloadSafeMedia(src, {emptyText, name, successText, kind} = {}) {
    if (!src) return toast(emptyText || '暂无可下载内容', 'warn');
    const safe = safeMediaUrl(src);
    if (!safe) return toast((kind === 'image' ? '图片' : '素材') + '地址不安全，已阻止下载', 'warn');
    const fileName = name || ((kind === 'image' ? 'future_canvas_' : 'future_media_') + Date.now() + '_' + (++downloadSeq) + (kind === 'image' ? '.png' : ''));
    try {
      const blob = await mediaUrlToBlob(safe);
      if (kind === 'image' && !String(blob?.type || '').toLowerCase().startsWith('image/')) {
        throw new Error('远程服务器返回的不是图片内容');
      }
      const href = URL.createObjectURL(blob);
      setTimeout(() => URL.revokeObjectURL(href), 12000);
      triggerBrowserDownload(href, fileName);
      toast(successText || '已开始下载', 'success');
    } catch (err) {
      const external = safeExternalUrl(safe);
      if (external) {
        if (kind === 'image') {
          if (!window.mediaDownloadBridge?.downloadRemoteImage) {
            toast('图片下载组件不可用，请重启软件后重试。', 'error');
            return;
          }
          try {
            const result = await window.mediaDownloadBridge.downloadRemoteImage({url: external, name: fileName});
            if (result?.canceled) return;
            toast(`图片已保存为 ${result?.ext?.toUpperCase() || '图片'}`, 'success');
          } catch (downloadError) {
            toast('图片下载失败：' + (downloadError?.message || downloadError), 'error');
          }
          return;
        }
        triggerBrowserDownload(external, fileName);
        const opener = document.createElement('a');
        opener.href = external;
        opener.target = '_blank';
        opener.rel = 'noopener';
        document.body.appendChild(opener);
        opener.click();
        opener.remove();
        toast('无法直接下载远程文件，已尝试打开原地址。', 'warn');
        return;
      }
      toast((kind === 'image' ? '图片' : '素材') + '下载失败：' + (err?.message || '无法读取本地文件'), 'warn');
    }
  }
  async function downloadImage(src) {
    return downloadSafeMedia(src, {
      emptyText: '暂无图片可下载',
      name: 'future_canvas_' + Date.now() + '_' + (++downloadSeq) + '.png',
      successText: '图片已开始下载',
      kind: 'image'
    });
  }
  async function downloadMedia(src, name) {
    return downloadSafeMedia(src, {
      emptyText: '暂无可下载内容',
      name: name || ('future_media_' + Date.now() + '_' + (++downloadSeq)),
      successText: '已开始下载',
      kind: 'media'
    });
  }
  function toast(message, type = 'error') {
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.textContent = message;
    $('toast').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 4200);
  }
  function installDiagnosticsHandlers() { return supportUI()?.installDiagnosticsHandlers?.(); }
  function diagnosticsSettingsSummary() { return supportUI()?.diagnosticsSettingsSummary?.() || {}; }

  async function loadSupportCenter() { return supportUI()?.loadSupportCenter?.(); }

  function renderSupportMarkdown(content) { return supportUI()?.renderSupportMarkdown?.(content); }

  async function openSupportDocument(id) { return supportUI()?.openSupportDocument?.(id); }

  function closeSupportDocument() { return supportUI()?.closeSupportDocument?.(); }
  async function exportDiagnosticsPackage() { return supportUI()?.exportDiagnosticsPackage?.(); }
  function buildBatchExportPayload() {
    return BatchExportPayload.buildBatchExportPayload({
      storageDir,
      currentProjectId,
      projects,
      canvas: serialize(),
      selectedNodes,
      nodes,
      history,
      settingsSummary: diagnosticsSettingsSummary()
    });
  }
  async function runBatchExport() {
    if (!window.exportBridge?.exportProjectPackage) return toast('当前环境不支持批量导出', 'warn');
    if (!await ensureStorageReady()) return;
    try {
      saveProject();
      saveProjects();
      const result = await window.exportBridge.exportProjectPackage(buildBatchExportPayload());
      toast(result?.zipFile ? `批量导出完成：${result.mediaCount || 0} 个媒体文件` : '批量导出完成', 'success');
      return result;
    } catch (err) {
      toast('批量导出失败：\n' + (err.message || err), 'error');
      throw err;
    }
  }
  async function runReviewPackageExport() {
    if (!window.reviewBridge?.exportPackage || !ReviewPackage) return toast('当前环境不支持离线审片包', 'warn');
    if (!await ensureStorageReady()) return;
    const project = projects.find(item => item.id === currentProjectId) || {id: currentProjectId, name: '未命名项目'};
    const canvas = serialize();
    const review = ReviewPackage.buildReviewPayload({project, nodes: canvas.nodes || []});
    if (!review.outputs.length) return toast('当前项目还没有可供审阅的图片、视频或音频产出', 'warn');
    try {
      saveProject();
      saveProjects();
      const result = await window.reviewBridge.exportPackage({...review, storageDir});
      toast(`审片包已导出：${result?.outputCount || review.outputs.length} 个产出`, 'success');
      return result;
    } catch (error) {
      toast('导出审片包失败：\n' + (error?.message || error), 'error');
      throw error;
    }
  }
  async function importReviewCommentsFile(event) {
    const file = event?.target?.files?.[0];
    if (event?.target) event.target.value = '';
    if (!file || !ReviewPackage) return;
    try {
      const payload = JSON.parse(await file.text());
      if (Number(payload?.schemaVersion) !== 1 || !Array.isArray(payload?.comments)) throw new Error('这不是有效的 ∞未来 AI 审阅意见文件');
      const project = projects.find(item => item.id === currentProjectId);
      if (!project) throw new Error('请先打开需要导入意见的项目');
      const result = ReviewPackage.mergeReviewComments({
        nodes: [...nodes.values()],
        projectComments: project.reviewComments || [],
        projectId: currentProjectId
      }, payload);
      if (result.wrongProject) throw new Error('审阅意见属于另一个项目，未导入任何内容');
      project.reviewComments = result.projectComments;
      saveProject();
      saveProjects();
      renderAll();
      const notes = [`成功 ${result.imported} 条`];
      if (result.stale) notes.push(`旧版本 ${result.stale} 条`);
      if (result.invalid) notes.push(`无法匹配 ${result.invalid} 条`);
      toast(`审阅意见导入完成：${notes.join('，')}`, result.stale || result.invalid ? 'warn' : 'success');
      return result;
    } catch (error) {
      toast('导入审阅意见失败：\n' + (error?.message || error), 'error');
      throw error;
    }
  }
  function renderReviewCommentsReport() {
    const report = $('reviewCommentsReport');
    if (!report) return;
    const project = projects.find(item => item.id === currentProjectId);
    const summaries = Array.isArray(project?.reviewComments) ? project.reviewComments : [];
    const outputComments = [...nodes.values()].flatMap(node => Array.isArray(node.data?.reviewComments) ? node.data.reviewComments : []);
    const decisions = outputComments.filter(item => item.type === 'approval' || item.type === 'revision');
    if (!summaries.length && !outputComments.length) {
      report.classList.remove('open');
      report.replaceChildren();
      return;
    }
    report.classList.add('open');
    report.innerHTML = `<strong>当前项目审阅意见：${outputComments.length} 条，决定 ${decisions.length} 条，总结 ${summaries.length} 条</strong>${summaries.slice(-3).map(item => `<p>${esc(item.text || '')}</p>`).join('')}<p>图片/视频的具体时间点意见可在“候选对比台”查看。</p>`;
  }
  async function scanMediaLibrary() {
    if (!window.mediaLibraryBridge?.scanMediaLibrary) return toast('当前环境不支持本地素材库扫描', 'warn');
    if (!await ensureStorageReady()) return;
    try {
      saveProject();
      saveProjects();
      const index = await window.mediaLibraryBridge.scanMediaLibrary({storageDir});
      renderMediaLibraryReport(index);
      toast('本地素材库扫描完成', 'success');
      return index;
    } catch (err) {
      toast('本地素材库扫描失败：\n' + (err.message || err), 'error');
      throw err;
    }
  }
  function renderMediaLibraryReport(index) {
    const el = $('mediaLibraryReport');
    if (!el) return;
    el.innerHTML = MediaLibraryRendering.mediaLibraryReportHtml({index, esc});
    el.classList.add('open');
  }
  function formatBytes(bytes = 0) {
    return MediaLibraryRendering.formatBytes(bytes);
  }
  function formatCleanupSummary(scan) {
    return CleanupRendering.formatCleanupSummary({scan, formatBytes});
  }
  async function runOneClickCleanup() {
    if (!window.cleanupBridge?.scanCleanup || !window.cleanupBridge?.executeCleanup) return toast('当前环境不支持一键清理', 'warn');
    try {
      const scan = await window.cleanupBridge.scanCleanup({storageDir});
      if (!scan?.items?.length) return toast('没有需要清理的项目', 'success');
      const confirmed = await openModal({title: '一键清理确认', text: formatCleanupSummary(scan), okText: '确认清理', confirm: true});
      if (!confirmed) return;
      const result = await window.cleanupBridge.executeCleanup({cleanupToken: scan.cleanupToken, confirmed: true});
      toast(`清理完成：${result?.deleted?.length || 0} 项，释放 ${formatBytes(result?.summary?.bytes || 0)}`, result?.failed?.length ? 'warn' : 'success');
    } catch (err) {
      toast('一键清理失败：\n' + (err.message || err), 'error');
    }
  }
  function getStore(...args) { return projectStore()?.getStore?.(...args); }
  function setStore(...args) { return projectStore()?.setStore?.(...args); }
  function cacheBrowserStore(...args) { return projectStore()?.cacheBrowserStore?.(...args); }
  function trySetLocalStorage(...args) { return projectStore()?.trySetLocalStorage?.(...args); }
  function warnStorageQuotaOnce(...args) { return projectStore()?.warnStorageQuotaOnce?.(...args); }
  function syncLocalStore(...args) { return projectStore()?.syncLocalStore?.(...args); }

  function unique(arr) {
    return [...new Set(arr.filter(Boolean))];
  }

  async function startE2ESmokeTest(...args) { return e2eSmoke()?.startE2ESmokeTest?.(...args); }


  function handleInitFailure(error) {
    console.error('[app] initialization failed', error);
    toast('应用初始化未完成，请重新打开软件；项目文件不会被修改。', 'error');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { init().catch(handleInitFailure); });
  else init().catch(handleInitFailure);
})();
