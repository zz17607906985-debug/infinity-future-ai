# ∞未来 AI 3.1.x 优化目标

> 2026 年产品级升级路线、阶段日期、验收标准和技术蓝图详见 [`PRODUCT_OPTIMIZATION_PLAN_2026.md`](./PRODUCT_OPTIMIZATION_PLAN_2026.md)。

## 总目标

在保留现有功能、内容方向和创作理念的基础上，把软件从“可以运行”提升为适合非技术用户长期、稳定、放心使用的创作工具。

## P0：数据安全与任务可靠性

- 显示“正在保存、已保存、保存失败”等明确状态。
- 增加撤销、自动恢复点和项目版本回滚。
- 保存图片、视频等异步任务 ID，软件重启后可继续查询任务结果。
- 支持恢复中断任务、仅重试失败项、更换配置后重试。
- 防止项目切换、目录切换和备份恢复造成任务数据串线。
- 消除假成功、任务永久等待和失败状态不明确的问题。

## P0：生成前统一检查

- 运行前检查提示词、模型、API 配置、对应用途 Key、参考素材、尺寸、存储目录和输出位置。
- 一次列出全部问题，并提供可直接到达对应设置的修复入口。
- 批量任务开始前显示可运行、不可运行和预计请求数量。
- 缺少必要条件时不得进入队列或显示成功。
- 运行全部会异步检查参考素材安全性、本地存储目录可写性、单次请求上限，并允许只运行没有问题的节点。

## P1：新手操作与工作流

- 新建项目后按实际工作顺序引导：添加素材、连接节点、选择模型、生成、检查和导出。
- 使用普通中文说明功能、错误原因和下一步操作，减少技术术语。
- 对首次使用、空项目、空队列和未配置状态提供明确入口。
- 保留专业功能，但逐步展示复杂选项，避免设置页面一次出现过多内容。

## P1：队列与批量生产

- 支持调整任务顺序、暂停单项、继续单项、取消单项和重新运行。
- 显示每项任务当前阶段、耗时、失败原因和使用的模型配置。
- 支持仅重试失败项、复制任务和修改参数后重试。
- 长任务运行时防止重复点击、误切项目和重复收费请求。
- 队列支持复制任务、失败项定位到节点修改参数后重试，并在重启后把未完成任务标记为“待继续”。

## P1：素材与项目管理

- 素材支持搜索、分类、筛选、引用位置查看和未使用素材清理。
- 检测重复素材，避免同一文件被反复复制和占用空间。
- 删除项目或素材前显示影响范围，并提供恢复机会。
- 大项目中减少全量重绘、重复保存和不必要的媒体读取。
- 资产删除改为可恢复回收站，删除前显示项目/历史引用影响；支持重复素材检测和非破坏性去重。

## P1：API 与多 Key

- 同一 API 地址支持多个 Key，并按文本、图片、视频用途并行使用。
- 同用途多个 Key 支持轮询、并发负载分配和手动主 Key。
- 仅对 401、403、429、额度不足和明确密钥错误自动切换 Key。
- 对限流 Key 设置短暂冷却，对失效或无权限 Key 设置较长冷却。
- 支持模型绑定指定 Key，避免不同模型或账户权限串用。
- 提供 Key/API 状态面板，显示脱敏标识、健康状态、并发任务、最近错误和冷却时间。
- 支持单独测试某个 Key；真实密钥不得进入项目、设置、日志或诊断导出。
- Key 面板显示脱敏标识、失败次数、冷却倒计时和健康状态；健康元数据通过主进程安全存储持久化。

## P2：费用与使用保护

- 批量生成前显示预计调用次数和可能产生的额外调用。
- 对扩图、自动重试、备用模型和备用 Key 切换给出明确提示。
- 支持单次最大任务数、连续失败停止和每日使用提醒。
- 防止界面重复点击或网络重试造成重复计费。
- 生成保护设置已加入单次最大请求数、连续失败自动停止和每日请求提醒，并在运行前提示参考图/扩图等可能的额外调用。

## P2：性能与可观察性

- 大量节点、时间线片段和素材下保持输入、拖动和切换流畅。
- 保存采用防抖和增量策略，避免每次输入都保存整个项目。
- 统一记录任务阶段、失败类别和恢复动作，日志必须脱敏。
- 将底层错误翻译为“哪里有问题、为什么、下一步怎么处理”。

## P1：前端操作体验与可访问性

- 为设置、命令中心、历史记录、资产库、生成队列、助手对话和素材预览补齐弹层语义、标题、关闭标签和键盘焦点管理。
- 打开弹层后自动把焦点放到第一个可操作控件，关闭后还原到触发按钮；按 `Esc` 可以关闭当前最上层界面。
- 所有图标按钮提供可理解的中文 `aria-label` 和悬停提示，不能只依赖图标或颜色表达含义。
- 主要导航、媒体、资产库、设置和供应商卡片的纯图标按钮已补齐中文 `aria-label`。
- 生成、导入、导出、测试、恢复和更新按钮显示明确的进行中、成功、失败、可重试状态，避免只替换按钮文字后用户不知道任务是否仍在运行。
- 空项目、空历史、空资产库、空队列、未配置 API 和无搜索结果提供下一步操作入口，而不是只显示“暂无内容”。
- 表单输入补齐关联标签、单位、示例和校验提示；错误应定位到对应控件，并保留用户已经填写的内容。
- 工作区切换、抽屉展开、筛选和搜索保持当前上下文，不因重绘导致滚动位置、输入焦点或选中项丢失。
- 窄窗口和小屏下，顶部导航、工具栏、设置页、队列和媒体面板应自动换行或变为可滚动布局，不遮挡主要操作。
- 键盘可完成常用流程：切换工作区、搜索节点、打开设置、暂停队列、重试失败项、发送对话和关闭弹层。
- 尊重系统“减少动态效果”设置；性能模式下减少背景视频、装饰动画和大范围重绘，但不影响生成与导出。

## P2：前端视觉一致性与反馈规范

- 统一按钮层级、危险操作颜色、状态徽章、提示消息和空状态文案，减少同一动作在不同工作区出现不同叫法。
- 对长文本、模型名、文件名、错误信息和项目标题统一截断、换行和复制入口，避免溢出遮挡。
- 重要操作提供撤销、返回、恢复或再次执行入口；危险操作在执行前说明影响范围。
- 关键界面补充最小端到端冒烟检查，至少覆盖打开设置、切换工作区、打开队列、搜索节点、打开素材预览和关闭所有弹层。

## P1：画布节点尺寸、比例与完整预览

- 用户选择图片或视频比例后，节点预览区应立即更新，不等待生成完成或重新加载项目。
- 生成前、生成中和生成后保持同一预览比例，避免因媒体加载后改用自然高度导致节点跳变。
- 图片和视频默认使用 `contain` 显示，保证完整内容可见；任何真实裁剪或扩图都必须由用户明确触发并显示状态。
- 生成结果与预览比例不一致时，显示完整状态并保持内容完整，不能被固定容器、溢出隐藏或 `cover` 样式意外裁掉。
- 比例变化后同步更新节点端口位置、边缘连线、快速画布代理框和虚拟化判断，避免连线偏移或 Fit View 范围错误。
- 最小冒烟测试覆盖 `1:1`、`16:9`、`9:16`、`3:2`、`2:3` 和自定义宽高，并分别检查生成前/后比例、端口位置、代理框和内容完整性。

## 持续交付约束

- 版本保持真实的 3.1.x，不使用虚假或跳跃版本。
- 保持 Electron 安全存储、URL DOM 安全和发布目录白名单。
- 保持可复现 ASAR 构建，不恢复多余 ASAR 或非白名单发布文件。
- 每项改动至少通过脚本解析、最小冒烟测试和对应操作契约测试。
- 高风险功能增加独立单元测试；正式发布前重新构建并验证安装包。

## Recent operational fixes

- Video retries preserve the last successful URL and expose the generated URL list consistently.
- ComfyUI reruns reuse an existing connected output image node instead of creating duplicates at the viewport center; first output nodes are placed beside the source node.
- Command palette supports ArrowUp, ArrowDown, Home, End, Enter activation, aria-activedescendant, and focus restoration.
- Settings, history, asset library, and queue drawers focus their first control on open and restore the triggering control on close.
- Queue cleanup reports that running requests cannot be interrupted and remain visible until completion.
- Narrow windows constrain settings, history, asset, and queue panels without covering the primary workspace controls.

## Verification boundary

- Static checks, renderer smoke checks, layout checks, provider key-pool checks, operational contracts, URL safety, version, update/rollback/license, release whitelist, and reproducible build checks are automated.
- Manual GUI verification is still required for real provider responses, ComfyUI output reuse with a live workflow, mobile-size screenshots, and accessibility with a screen reader.

## 当前已完成

- 建立第一阶段模型能力中心：统一图片、视频、文本和音频能力档案，并为未知模型提供不冒充真实能力的安全默认档案。
- 图片与视频节点会按所选模型动态展示支持的比例、清晰度、尺寸和时长；保留当前不支持值并明确提示，不静默替换用户选择。
- API 设置可为图片/视频模型保存本地能力覆盖，包括生成/编辑/首尾帧/延长、参考数量、价格、币种、生命周期和替代模型。
- 单节点生成和“运行全部”已接入同一套模型能力检查；已配置价格的模型会在批量提交前汇总预计费用。
- 模型能力模块与持久化、界面入口和生成预检已有独立自动化测试，并进入可复现发布构建。
- 清理多余 ASAR，并增加发布目录白名单检查。
- 修正版本为 3.1.0，验证更新、回滚和许可证显示。
- 修复 URL DOM 注入点和多个媒体 URL 入口。
- 建立可复现构建、最小冒烟测试和操作契约测试。
- 修复图片队列假成功、取消卡死、项目切换串线和首次建项目幽灵项目。
- 改善“运行全部”、漫剧时间线输入和对话编辑保存体验。
- 同一 API 地址已支持多个 Key，并可按文本、图片、视频用途分流。
- 画布图片/视频节点已按所选比例即时调整，生成前后保持同一预览尺寸，并使用 `contain` 防止预览意外裁剪。
- 节点比例变化已同步端口位置和快速画布代理尺寸，并增加画布布局专项检查。
- 图片重新生成失败时保留上一次成功结果，避免失败重试把已有内容清空。
- `Esc` 已统一关闭常用抽屉和弹层，通用对话框补充焦点恢复、焦点循环和 `aria-hidden` 状态同步。
- 修复资产库空状态和资产卡片类名错误，恢复正确的卡片布局与空状态样式。
- 项目恢复已支持撤销、重做和指定恢复点，恢复快照不会清空 redo 栈。
- 视频异步任务保存协议、供应商、模型和任务 ID，重启后显示“待继续”并可继续查询。
- 生成队列已支持单项暂停/继续、复制任务、失败项修改参数入口、状态持久化和运行中任务保护。
- 生成预检已覆盖参考素材、存储目录可写性、请求数量上限、每日提醒、连续失败停止和额外调用提示。
- API Key 健康状态已持久化，401/403/429/额度错误按冷却策略切换，普通网络/模型错误不会擅自换 Key。
- API 配置已支持按具体聊天、图片和视频模型绑定指定 Key；绑定 Key 冷却或失效时会阻止该模型误用其他账户权限。
- Key 状态面板已显示供应商当前并发、脱敏标识、用途、最近错误、失败次数和冷却状态。
- 同用途多个 Key 已按实时运行负载和最近使用时间分配请求；每个 Key 的瞬时并发仅保存在内存，完成后释放且不会写入设置。
- 多张图片批量生成已改为每个请求独立租用 Key，并根据可用同用途 Key 数自动并发；对话、漫剧和 TTS 流程只获取实际所需用途的 Key，完成或失败后按具体 Key 准确释放。
- 图片生成功能的开通/禁用状态已按 Key 隔离；单把 Key 的图片权限不足不会污染整个 API 地址，生成任务会自动尝试下一把图片 Key。
- 单供应商多 Key 已默认组成统一运行池并全部参与自动分配；同供应商多个图片节点的并发上限会随可用图片 Key 数自动提升，无需手动修改高级并发设置。
- Key 最近错误在写入健康元数据前会清除 Bearer、常见 API Key 格式和当前内存中的真实 Key 值。
- 资产库已增加引用影响提示、可恢复回收站和重复素材非破坏性去重。
- 项目中心、生成队列、历史记录和资产库空状态已提供下一步操作入口。
- 主要纯图标按钮已补齐中文 `aria-label`，并补充生成保护设置控件。
- 聊天发送按钮已补齐按钮类型、悬停提示和中文 `aria-label`，避免仅凭纸飞机图标表达操作含义。
- 画布指针、框选、拖放、缩放和指针释放事件已拆分到 `canvas/events.js`，并通过状态代理连接主壳。
- 助手、Codex 安排和未完成视频任务的危险确认已统一使用可恢复焦点的应用内确认弹层，不再依赖原生 `confirm()`。
- UI surface smoke coverage now includes settings, generation queue, history, asset library, media preview, Escape closing, aria state, and focus restoration.
- Media preview now synchronizes aria-hidden, focuses its close action, and restores focus to the triggering history or asset control.
- Media preview switches between image/video content as a single modal state, pauses and clears the previous video, and preserves the original trigger when multiple previews are opened in sequence.
- Local project-file writes now report asynchronous disk failures back to the save indicator, with write sequencing so an older failed write cannot overwrite a newer successful save state.
- The save contract now has a runtime test covering disk failure feedback and out-of-order write completion.
- Release artifact verified after the latest changes; use `dist/build-manifest.json` as the authoritative current ASAR SHA-256 record.
- 智能素材索引已完成：支持角色、场景、道具、画风、镜头集合、未使用筛选、相似素材、本地视觉特征、索引重建和素材替换影响报告；索引失败不会影响原素材。
- 离线审片包已完成：导出自包含 HTML 与 ZIP，支持图片放大、视频播放、时间点评论、通过、返工、总结、审阅 JSON 导入导出和版本不匹配拒绝导入；通过版本被新产出或本地修改后自动失效。
- 审片包默认不携带 API Key、绝对私有路径或可执行脚本；正式交付仅允许导出已通过版本。
- 内置 FFmpeg 运行时冒烟已纳入 `npm test`，实际验证生成、裁剪、变速、缩放和拼接，不再只验证命令契约。
- 可复现构建已完成：同一份源码连续两次 ASAR 打包哈希一致，`resources/app.asar` 与 `dist/app.asar` 哈希一致；最终 SHA-256 以 `dist/build-manifest.json` 为准。
- 安装构建已完成：新增模块和测试脚本均存在于安装包，发布目录 7 个顶层条目通过白名单检查，未发现多余 `app.asar.*` 文件。
