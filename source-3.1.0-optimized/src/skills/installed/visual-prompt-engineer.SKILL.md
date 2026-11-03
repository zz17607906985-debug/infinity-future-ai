---
name: visual-prompt-engineer
description: 编译可执行的 AI 图像/视频提示词：母提示词、局部差分修改、生成式修复、遮挡补全、扩图与超分辨率放大、风格别名、参考图反推、人物与场景摄影设计、世界观关键帧、模型方言（GPT Image/MJ/FLUX/SDXL/Runway/Veo/Sora）、单变量测试。同一场景换机位、正反打、多视角与穿帮诊断时，执行二维场景母版、可见性与跨镜头连续性检查。为从零生成图像执行导演式构图、景别、机位、站位、焦段行为、焦点/景深、前中后景、黑白灰明度骨架与色彩关系设计；复杂叙事和宏大场景再执行故事秒、PRIMARY/HANDOFF/QUIET、观看路径、尺度证明与世界运行证据。支持 1:1角色模板、高级电影3D、手绘奇幻、真人胶片/纪实/特写、强空间纵深与概念氛围。人像默认按 GPT Image 2 方言与视频母版哑光验收。不负责实际生成媒体。
---

# Visual Prompt Engineer

把用户的视觉意图整理成通用母提示词，再编译为目标模型支持的语法。保持可解释、可测试和可迁移，不用关键词堆砌代替视觉设计。

## 完整提示词交付（固定）

- 每次新建、调整、返修和成片诊断都交付一条完整、独立、可直接复制的提示词；禁止只交付删除／替换／插入补丁。
- 内部仍执行单变量诊断：每轮只改变一个 `changed_dimension`，逐句或语义等价保留已成功项。完整重写是交付包装，不是自由重设计。
- 02A 与 1:1 的固定合同必须重新完整编译并验证；真人任务必须完整保留当前有效的身份、构图、皮肤、眼睛、光线与负向约束。

## 抽象描述词编译门（阻断级）

- 用户使用“高级、真实、有氛围、突出主体、不要 AI 感、电影感、精致”等抽象结果词时，可保留其作为意图标签，但不得把标签本身当作可执行提示词。先判断本镜头中它具体要解决什么，再选择构图、明度、色彩、光源、空间、材质、焦点、动作或成像中的相关维度，写成 2–5 条当前景别可直接观察的结果。
- 不建立固定同义词词典：`高级` 不恒等于低饱和或大面积留白，`真实` 不恒等于自然光或瑕疵堆叠，`有氛围` 不恒等于柔和侧光，`突出产品` 不恒等于居中占画面 60%，`不要 AI 感` 不得翻译成无条件增加随机细节。具体方案必须服从当前叙事、媒介、构图家族、参考图和用户 LOCKED。
- 细节必须有可说明的来源：由结构、曲率、受力、功能、使用方式、环境、光源或叙事状态产生。需要身份复用、多视角连续或视频稳定时，使用受控且可继承的非均匀性；禁止用随机雀斑、划痕、褶皱、杂物、光斑或纹理噪声制造所谓自然感。
- 主体显著性用 `PRIMARY / minimum_readable_size / focus_owner / contrast_peak / detail_owner` 与主体—背景分离控制；主体是否居中、占比多少、背景是否虚化由任务决定。氛围用有来源的光线、黑白灰层级、色彩关系、空间衰减与静区共同建立，不预设低饱和、雾或侧光。
- 编译完成后删除抽象词做一次反检：若仍能仅凭可见条件重建画面，并且每条关键条件都能在目标景别回答“是／否”，才算通过。抽象词与具体条件冲突时，以用户事实和具体可见条件为准。

## P0 Reproduction Contract: 02A quality invariant across layouts

When `高级电影3D风格` and `1:1角色模板`/`1：1角色模板` occur together,
load [references/validated-02a-1x1-shell.md](references/validated-02a-1x1-shell.md)
first. This is a higher-priority route than the generic 1:1 template,
photoreal skin contract, model-adapter prose, or default variation behavior.

- `高级电影3D风格` owns the character rendering quality. `1:1角色模板` is
  layout-only: it may change canvas, panel arrangement, crop, background, and
  archive lighting, but it must not create a second 02A look-dev or change the
  face, skin, eyes, hair, material, or overall rendering-quality target.
- Never infer or auto-add `1:1角色模板` from `高级电影3D风格`, a prior accepted
  character sheet, or an asset-generation request. The layout route requires
  an explicit current trigger or an unambiguous current-task inheritance.
- Compile with [profiles/02a-character-1x1-v1.json](profiles/02a-character-1x1-v1.json)
  and [contracts/02a-character-1x1-v1.txt](contracts/02a-character-1x1-v1.txt).
  The 1:1 contract carries the same complete media, skin, eyes, hair, material,
  light, and negative-quality chain as the ordinary single-image 02A contract.
- When adapting an already defined character, preserve the source `identity`,
  `appearance`, and `costume` text verbatim inside the corresponding 1:1
  fields. Add only information that the new full-body panel genuinely requires,
  such as lower-body clothing, shoes, full-body proportions, and archive pose.
- Never replace the complete 02A material chain with a compact shorthand,
  keyword summary, or prior accepted shell. Never import photoreal
  pores/dewy-skin rules into this route.
- Validate the compiled 1:1 prompt with `scripts/validate_prompt.py`. When a
  source single-image prompt exists, also run `scripts/validate_02a_layout_pair.py`;
  any loss of source identity, appearance, costume, or common material markers
  is blocking.
- Preserve the accepted quality anchors and use them as look-dev references,
  not as default character identities.
- Cross-machine reproducibility means deterministic compilation of the prompt
  contract, not pixel-identical output across different image models, model
  versions, seeds, reference images, or sampling settings.

## Keyword Modes

### 二维场景多机位连续性

- 同一场景换角度、正反打、多视角资产或场景穿帮诊断时，先读取 [references/scene-multiview-continuity.md](references/scene-multiview-continuity.md)，再编译镜头；孤立人像、产品转面和无连续性要求的新场景不触发。
- 继承场景母版，逐机位判断画面左右、深度和可见性；更换摄影机不授权重排家具或改变世界光源。该模块细化本场景的固定项，不覆盖用户明确指定的改动或风格合同。
- 默认利用二维参考，不把建模或安装外部工具作为前置条件；提示词约束与实际工具控制分别记录，生成后的验收必须有图像证据。
- 生成前完成该模块的空间预检记录；生成及每次局部修改后，用原记录的同一批检查 ID 逐项复查。可执行环境运行 `scripts/check_scene_continuity.py`；缺记录、关键关系冲突或未核实不得以“已调用 skill”代替完成。脚本只校验记录，不验证像素或强制控制生图工具。

### 1：1角色模板

- 将 `1：1角色模板`、`1:1角色模板` 及二者带空格的写法视为同一触发词。
- 此模板只控制画布比例、单双栏、裁切、背景、边距和档案布光；不拥有角色媒介与质感。不得因为启用模板而更换、缩减或重新解释当前风格的面部骨相、皮肤、眼睛、发丝、材质与渲染质量。
- 未显式触发 `1：1角色模板` / `1:1角色模板` 时，不得仅因用户要求人物资产、白底图、角色设定或曾经验收过双栏成片而自动加入该模板。
- 触发后先读取 [references/one-to-one-character-template.md](references/one-to-one-character-template.md)，再生成提示词。
- 此模式优先于常规母提示词、三个单变量变体和下方 `Output Contract`，但仍执行真实性、一致性与风险检查。
- 将纯白背景和均匀棚拍视为角色档案摄影的明确例外，不套用常规真人场景的「拒绝棚拍」限制。
- 把纯白背景视为版式色值，不视为整张图的曝光指令。编译时必须明确背景与主体独立测光：背景接近纯白，人物中间调、肤色与浅色衣物保持低于背景的可读层级；“无投影”只删除外部落影，不删除脸部、身体与服装内部的宽缓结构阴影。
- 默认只输出可直接使用的中文 `正向提示词` 与 `负向提示词`；除非用户要求，不附创意说明、参数、英文版或变体。
- 媒介为真人时，额外读取 [references/photoreal-skin-and-light-contract.md](references/photoreal-skin-and-light-contract.md)；`高级电影3D风格` 同时触发时按该风格卡替换媒介，不加载真人皮肤合同中的摄影专用条款。

### 高级电影3D风格

- 将 `高级电影3D风格` 及带空格的等价写法视为同一风格检索词。
- 本模式是独立、显式触发的局部路由。只有用户明确输入该检索词时才读取并应用对应风格卡；未触发时不得把其中的半写实 3D 媒介、PBR 材质、皮肤、发丝、眼神、光影、色调或负向词继承到任何其他风格。
- **普通单幅人物（阻断级）**：没有同时触发 `1:1角色模板` 时，读取 [profiles/02a-character-v1.json](profiles/02a-character-v1.json)，只填写其变量字段；必须用 `scripts/compile_prompt.py` 生成最终提示词，再用 `scripts/validate_prompt.py` 验证。不得手写、摘要、翻译、压缩或重排 `contracts/02a-character-v1.txt` 的固定材质段；验证未通过不得交付。
- **普通 02A 编译命令**：先把变量写入临时 JSON，`scene_source` 仅允许 `default` 或 `user`；用户没有明确给出场景时必须使用默认低信息背景，不得擅自补写图书馆、校园、咖啡馆、抱书、金色阳光等生活写真语义。运行 bundled Python：`<bundled-python> scripts/compile_prompt.py --profile 02a-character-v1 --input <variables.json> --output <prompt.txt>`，随后运行 `<bundled-python> scripts/validate_prompt.py --profile 02a-character-v1 --input <prompt.txt>`。
- **质感不变量（阻断级）**：`高级电影3D风格` 决定角色的半写实电影 3D 质感；`1:1角色模板` 只改变排版。有无模板时的角色骨相、皮肤 look-dev、眼睛、发丝、PBR 材质与高级完成度必须指向同一质量标准，不得把单幅版改成真人 VFX，也不得把 1:1 版改成更卡通、更幼态或更廉价的角色风格。
- **02A × 1:1（阻断级）**：只有同时显式触发或在当前任务中明确承接 1:1 时，才先读取 [references/validated-02a-1x1-shell.md](references/validated-02a-1x1-shell.md)，再读取 [profiles/02a-character-1x1-v1.json](profiles/02a-character-1x1-v1.json)。用 `scripts/compile_prompt.py --profile 02a-character-1x1-v1` 编译，再用 `scripts/validate_prompt.py --profile 02a-character-1x1-v1` 验证；不得手写或以精简壳替代完整材质合同。若当前任务承接已有单幅角色，必须将原 `identity`、`appearance`、`costume` 原文完整放入 1:1 对应字段，只允许追加全身栏必需信息，并运行 `scripts/validate_02a_layout_pair.py`。不要加载真人皮肤合同或整本 style-cards。
- 该风格卡不固定角色姓名、黑发、伤痕、湿发、服装、场景、景别或极端面部特写。先完成当前任务的主体、服装、动作、场景和构图决策，再套用风格锁定。
- 与 `1:1角色模板` 同时触发时，只把场景、镜头和动作适配为正方形双栏、左脸右身、纯白背景、裁切、安全边距和档案光；角色身份、外形、服装以及完整皮肤、眼睛、发丝、材质、光影与负向质量链不得删减。此组合不得在负向提示词中排除 `3D`、`CGI` 或三维动画；应排除的是廉价游戏建模、低模、塑料皮肤和传统卡通三渲二。
- 用户指定 Midjourney 且要求字符限制时，按其限制压缩内容，优先保留主体辨识点、固定服装、场景动作、核心 3D 材质光影和必要参数。

### Midjourney 场景短提示词

- 用户明确要求「MJ场景提示词」「Midjourney环境提示词」「所有场景再出一版MJ」「900字符以内的场景提示词」或批量生成 `-MJ.txt` 时，读取 [references/midjourney-scene-prompts.md](references/midjourney-scene-prompts.md)。
- 该模式只处理 Midjourney 的场景、环境和空间资产；不要把它的 16:9、单行短提示词、环境负向参数或场景字段顺序套到人物角色模板、道具白底图、视频运动提示词或其他平台。
- 本模式的前置风格触发词可为 `高级电影3D风格`。用户已在同一任务、同一项目或紧邻上文明确触发该词，随后使用「前面的风格」「同一风格」「所有场景再出一版MJ」等承接表达时，继续把 `高级电影3D风格` 视为当前批次的有效风格锁定，不要求用户逐条重复。
- `高级电影3D风格`、手绘、写实摄影等媒介继续由已触发的风格卡决定。只有用户明确指定、上文仍有效的承接式触发或项目已有风格锁定时，才把对应风格语法写进MJ提示词；用户切换风格、切换项目或明确取消后立即停止继承，不得把半写实3D变成跨任务全局默认。
- 当用户指定字符上限时，把空格、标点、换行和参数全部计入；硬性验证每条不超过限制，并预留约5%的安全余量。批量文件默认一条提示词一行，不附标题、解释或第二个代码块。

### 参考图反推

- 用户要求反推提示词、逆向提示词、参考图复刻、视觉拆解或按图重建时，先读取 [references/reference-image-reconstruction.md](references/reference-image-reconstruction.md)。
- 先生成忠实复刻的通用母提示词，再提供模型版或单变量变体；不要在反推阶段擅自「增强电影感」、更换构图或美化人物。
- 严格区分画面可见事实与推断。不要从图片猜测姓名、族裔、职业、关系、健康状况或隐藏光源设备；只描述可观察外观和光影结果。
- 场景参考图若依赖高调逆光空气、连续距离漂白、低对比低饱和或远层轮廓溶入天空，同时读取 [references/scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) §2.2；忠实反推可见衰减强度，不把空气来源猜成确定事实。
- 场景、环境、建筑或世界观关键帧参考图同时读取 [references/concept-scene-directorial-design.md](references/concept-scene-directorial-design.md)；忠实记录参考图已有的故事秒/运行状态、PRIMARY、第二观看点、观看路径、尺度链、光线归属与静区，不以“优化构图”为名擅自重排。
- 未指定模型时输出模型中立版本，不伪造平台参数。

### 生成式修复、遮挡补全与放大

- 用户要求“去除杂物／修复破损／补全遮挡／扩图／糊图变清晰／放大到 4K／无缝修复”时，先把任务拆为 `cleanup / inpaint / outpaint / upscale`。只有用户同时要求多个目标时才按“先确定结构与补全内容，再统一边界与材质，最后放大”的顺序组合；不得用一段万能画质词混做全部任务。
- 每个删除指令必须同时定义删除后显露区域的正向终点：由哪一段墙面、地面、背景、衣物、皮肤或其他既有结构连续填满，以及其透视、遮挡、材质与光影怎样承接。只写“删除／不要／清理”而不写填补结果，视为不完整编辑合同。
- 建立 `target_regions / locked_regions / evidence_sources / allowed_inference / forbidden_invention`。只允许目标区域变化；区域外内容按编辑器实际能力锁定。若工具不支持遮罩或像素级锁定，不承诺“其他像素完全不变”，而应明确可实现的结构与视觉保持范围。
- 补全证据按“同一原图相邻可见延续 → 用户指定参考图 → 已确认的结构、透视、材质和光源规律 → 通用先验”排序。被遮挡或原图未记录的信息属于生成式推断，不声称恢复真实原貌；人物身份锚点、文字、标志、精确图案与重复几何缺少可靠证据时，优先索取参考或保留低置信区域，不擅自编造。
- 只删除用户点名的破损、杂物、污点或伪影。正常投影、接触阴影、反射、胶片颗粒、景深虚化、运动模糊、使用痕迹和时代性噪声不是默认缺陷；“混乱阴影”“不干净”等含糊词必须先转成可定位的异常边缘、重影、断裂或无来源亮暗块。
- 修复边界同时对齐：轮廓与透视、重复图案相位、遮挡顺序、材质纹理频率与方向、粗糙度／反射响应、光源方向／软硬度／色温／衰减、焦平面与景深、颗粒／噪声／压缩特征。禁止只做颜色融合而让结构或材质穿帮。
- 放大时区分“输出像素尺寸”和“可由原图证明的真实细节”。保持原有光学清晰度分布，不做全局等锐、轮廓描边或全画面微纹理生成；新增细节只能作为与原图尺度相容的保守重建，不以 `4K / 像素级 / 完美 / 100%统一 / 无PS痕迹` 等不可验证口号替代控制条件。
- 先做 `edit_or_rebuild` 分流：单一、边界明确且基线可信的局部变化使用 edit；新机位、整体构图重排、空间布局重建、身份／服装／媒介重设计、多个相互影响区域或底图已无法提供结构证据时使用 rebuild／regenerate。换视角即使沿用同一场景，也属于新的空间重建镜头，必须走场景母版与可见性检查，不能伪装成外科式局部编辑。
- 验收至少检查：目标缺陷已处理、关键身份／文字／结构无误、接缝在正常观看尺寸不可见、未修改区域无可观察漂移、锐度与细节密度仍服从原焦点和景深。任一关键事实无证据时标记 `unverified`，不得用画面更锐或更漂亮抵消。

### 手绘奇幻风格

- 将 `手绘奇幻风格` 视为风格编译别名，触发后**只读取** [references/style-04A-hand-painted-fantasy.md](references/style-04A-hand-painted-fantasy.md)。
- 先按常规导演流程确定故事、人物关系、观看路径、构图、调度和显著性所有权，再把结果翻译为该风格的形状、墨线、笔触、色彩与材质语法；不得让风格别名替代或重新分配导演决策。
- 该别名不固定人物、场景、焦段、机位或动作，也不等同于通用厚涂、传统赛璐璐、精致三渲二、游戏 CG 或某一作品的复刻。



## 融汇原则（相对「只把 craft 文件拷进来」）

1. **单一真相**：同一规则只在一处定义。皮肤 → photoreal；电影感 → live-action L1；近景眼/发/半脸 → character-closeup；纵深 → scene-depth。  
2. **取长**：craft → 时间切片、注意力路径、胶片/光色克制、半脸预设、satin 反射分寸；visual → 主体分流、视频母版哑光、景别毛孔、GPT 方言、工程化 examples。  
3. **补短**：craft 不过度平行入口；visual 不丢掉导演语感与半脸等专科。  
4. **冲突裁决**：用户 LOCKED > 身份连续 > photoreal 皮肤 > 光源空间 > 电影 L1 默认 > 装饰。  
5. **废弃双源**：`cinematic-language.md`、`human-realism.md` 仅为重定向桩，不参与加载。

## 工作流默认（P2）

在用户未另行指定时采用：

| 项 | 默认 |
|----|------|
| 主入口 | 仅 **visual-prompt-engineer**；craft 为兼容桩，不加载其 references |
| 人像 / 1:1 / 身份资产目标模型 | **GPT Image 2**（model-adapters §2.1） |
| 人像哑光验收 | **视频身份母版** photoreal §5.1（供 Seedance 等图生视频）；用户声明「仅静帧」才放宽 |
| 1:1 皮肤 | 左栏特写：景别相符自然毛孔 + 强哑光；右栏全身：不写密毛孔 |
| 电影感 | **L1** live-action-cinema-look（已融汇 craft 导演语法）；器材细节才读 camera-optics |
| 高频风格卡 | 01A / 02A / 04A **单文件**；禁止默认整本 style-cards |
| 交付 | 可粘贴提示词优先；1:1 默认中文正/负向；指定 GPT 时按 §2.1 骨架 |

用户明确指定其他模型、风格或「仅静帧」时，覆盖上表对应行即可。

## Execution Profiles

先选择执行深度；这是**改动范围与交付展开度**，不是质量等级。所有档位都保留用户 LOCKED、身份连续、媒介一致、模型方言和阻断级质量检查。

| 档位 | 触发 | 执行与交付 |
|------|------|------------|
| **FAST** | 用户明确要求「只改／保持其他不变／降低尺度／换服装／修正局部」等单变量编辑，且已有可复用提示词或明确视觉基线 | 锁定未点名变量，内部执行最小差分，对外输出完整整合的可复制提示词；不重做创意、不自动增加场景、不提供变体 |
| **STANDARD** | 常规人物、产品、简单场景、提示词编写或模型适配；也是无法确定复杂度时的默认 | 完成必要设计与模型编译；省略无助于执行的分析章节；只有用户要求探索、比较或测试时才给变体 |
| **DIRECTOR** | 概念场景、世界观关键帧、复杂叙事镜头、宏大环境，或用户明确要求导演设计 | 执行故事秒／运行时刻、PRIMARY→HANDOFF、观看路径、尺度证明、世界运行证据、QUIET 与专项质量门 |

- `高级电影3D风格`、`1:1角色模板` 及二者组合继续执行各自 P0 合同；执行档位不得压缩、摘要或绕过其固定编译与验证链。
- FAST 只有在改动边界明确且存在视觉基线时启用；否则升级为 STANDARD。FAST 不得以「精简」为由删除原提示词中已经生效的身份、构图、光线、材质或质量锚点。
- STANDARD 的简单场景只需明确叙事焦点、空间层次和光线方向；不要强制补写完整的世界运行证据。场景承担叙事、概念设计或复杂空间表达时升级为 DIRECTOR。
- 输出最小充分：用户要求「直接做／直接给提示词／可复制版」时，交付提示词优先，不自动附创意理解、参数、检查清单或变体。
- 用户要求局部修改、提示词限长、成片诊断或直接交付时，读取 [references/edit-budget-and-output-profiles.md](references/edit-budget-and-output-profiles.md)，建立 `edit_scope`，选择 `PATCH / COMPACT / STANDARD / FULL_CONTRACT` 预算，并使用 `PORTRAIT / SCENE / VIDEO / DIAGNOSTIC` 输出 profile。预算不得覆盖 P0 合同。

## Workflow

1. **识别任务与主体类型**
   - 判断 image/video 与 text-to-image、image-to-image、text-to-video、image-to-video。
   - 内部记录一个 `primary_mode`：`text-to-image`、`image-edit`、`multi-image-compose`、`text-to-video`、`image-to-video`、`keyframe-video`、`video-extension` 或 `video-edit`；只有用户明确要求能力诊断、结构化接入、模式检查或批量回归时，才读取 [references/capability-matrix.md](references/capability-matrix.md) 并输出该字段。
   - 提取用途、受众、主体、动作、目标模型/版本、画幅/时长、参考图角色和商业用途。
   - 依据 `Execution Profiles` 选择 FAST、STANDARD 或 DIRECTOR；无法确定时使用 STANDARD，不得默认降级为 FAST。
   - **主体类型分流**（决定后续合同加载，一等公民）：
     | 类型 | 典型用途 | 额外合同 |
     |------|----------|----------|
     | **人像/角色** | 肖像、角色档案、选角、身份资产、图生视频人物基准 | 真人媒介 → 读取 photoreal-skin-and-light-contract |
     | **产品** | 白底主图、场景化产品、包装、电商 | 轮廓/材质/标签文字证明；不加载皮肤合同 |
      | **场景/环境** | 空间、建筑、风景、正常场景、概念关键帧、MJ 场景资产 | 先读 concept-scene-directorial-design，再读 scene-depth-and-atmosphere；不加载皮肤合同 |
     | **抽象/平面** | 图形、UI、概念平面、纯设计 | 构图与信息层级；不加载皮肤合同 |
     | **其他** | 动物、载具、机械等 | 按主体辨识合同处理，按需局部读取 |
   - 混合主体（人+产品、人+场景）以叙事 PRIMARY 所属类型为主合同，次要主体只保留辨识锚点。

2. **最少提问**
   - 仅在缺失信息会显著改变结果时提问，每轮最多 3 个。
   - 优先确认主体与用途、目标模型/模式、主风格和必须保留项。
   - 用户要求「直接做」时采用合理默认值，并显式列出假设。

3. **规范化创意**
   - 内部整理：主体、动作、环境、构图、镜头、光线、色彩、材质、线条、渲染、画中文字、必须保留、必须避免、交付规格。
   - **导演视觉门（从零生成图像必经）**：STANDARD 与 DIRECTOR 的新建人物、产品、场景或叙事静帧，只要不是纯白档案/固定技术排版，进入风格卡、材质与模型方言前先读取 [references/composition-and-color-grammar.md](references/composition-and-color-grammar.md)，内部确定 `narrative_goal / attention_path / composition_family / shot_scale / viewpoint / lens_behavior / focus_owner / depth_strategy / value_pattern / color_structure / light_motivation / emotion_endpoint`。`value_pattern` 必须包含 `dominant_value_family / primary_value_shape / lightest_owner / darkest_owner / contrast_peak / gray_bridge / value_separation`。每项一个短决定即可；一个镜头只选 1 个主构图家族，必要时加 1 个辅助机制。FAST 局部编辑继承未点名轴；忠实参考图复刻记录现有设计、不擅自重排；1:1 白底角色模板由布局合同拥有构图。
   - 导演视觉门必须把术语翻译为可见几何与光色关系：主体落点、空白方向、ENTRY→PRIMARY→HANDOFF→HOLD、摄影机世界位置、空间扩张/自然观察/压缩隔离、焦点层、黑白灰大中小形、最亮/最暗与对比峰值所有者、灰阶桥、主体背景明度分离和主辅强调色面积。先让灰阶成立，再进入色相；不得只写“黄金螺旋、三分法、虫视、85mm、浅景深、互补色、电影感”等名称让模型自行猜测。
   - **新建场景基础美术门（阻断级）**：无论用户给的是模糊意图还是明确作品/类型名，先内部确定 `aesthetic_thesis / shape_language / palette_hierarchy / density_rhythm / signature_motif / material_mood`，再读取风格卡、写材质和模型方言。命名风格不得跳过此门；`detail_owner_layer` 只决定细节位置，不授予该层无限堆料权。STANDARD 每项一句即可；DIRECTOR、随机场景设计、命名风格场景或用户反馈场景“丑/俗/廉价/乱/像游戏截图”时读取 [references/scene-appeal-and-art-direction.md](references/scene-appeal-and-art-direction.md)
   - 将 4–8 个关键要求编译为当前景别可回答“是/否”的 `visual_assertions`；每条只包含一个可见事实。多参考、双栏/多输出、关键文字/道具或正式验收时读取 [references/reference-validity-and-visual-proof.md](references/reference-validity-and-visual-proof.md)，为断言增加 `priority / category / proof_region / minimum_readable_size / valid_outputs`；MUST 事实必须在声明区域达到可读尺寸。抽象气质必须先转译为脸部比例、轮廓、动作、视线、空间关系、材质或显著性证据。
   - 局部编辑先分类 `changed_dimensions / locked_dimensions / open_dimensions / conflicts`；只改 changed，锁住其余有效基线。一个修改必然牵动第二轴时标记必要依赖，不得静默漂移。
   - **条件读取**（按需，不要一次加载全部）：
     - 攻击、碰撞、施法、追逐、跌落、承重、破坏，或用户反馈「动作不成立」「材质像道具」→ [references/action-causality-and-material-structure.md](references/action-causality-and-material-structure.md)
     - 只有年代/情绪/类型/质感等模糊词，或要求系统像导演自动决定拍法 → [references/directorial-intent-compiler.md](references/directorial-intent-compiler.md) 做完整意图推导；它不替代所有新建场景必经的基础美术门
     - 询问具体相机/镜头/胶片/扫描参数（电影感 L3）→ [references/camera-optics-and-capture.md](references/camera-optics-and-capture.md)；仅要胶片观感时不要读本文件，用 live-action-cinema-look
      - **人像/角色 + 真人媒介**（或用户明确要求真实皮肤/去 AI 感）→ [references/photoreal-skin-and-light-contract.md](references/photoreal-skin-and-light-contract.md)
      - **DIRECTOR 场景**，包括世界观关键帧、环境概念设计、复杂叙事空间和宏大地点建立镜头 → 先读 [references/concept-scene-directorial-design.md](references/concept-scene-directorial-design.md)，用故事秒或运行时刻、唯一中央问题、PRIMARY→HANDOFF 观看路径、尺度证明、世界运行证据和 QUIET 静区建立导演结构；庞大场景默认建立人物→熟悉物→主体的连续尺度链，作为视频场景设定图时锁定人景相对比例与共同透视。STANDARD 简单场景不强制加载本文件，除非场景承担叙事或用户要求导演设计
      - **场景/环境**，或人+景需要纵深/大气透视/远景衰减/边缘柔化/发光空气/低对比低饱和概念氛围，或用户反馈全画面一样清、空气感太弱、远景抢戏、背景糊烂、无条件大雾 → [references/scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md)
      - **城市大全景 / 时代背景 / 世界观建立镜头 / 场景氛围板**（阻断级）→ 把“交代时代、地域、体制、气候与城市面貌”置于建筑零件展示之前；在近景／中景／远景中只指定一个 `detail_owner_layer` 重点刻画，另外两层压成体块、剪影、连续色面与空气层。单层细节所有权不等于浅景深；仍用遮挡、尺度递减、明度/饱和度/边缘衰减建立大纵深。细则与已验收写法见 [references/scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) §10.2
      - **真人电影感 / 实拍静帧 / 低饱和胶片 / 纪实观察 / 去广告·去 AI 味 / Kodak·VISION 倾向** → 先读 [references/live-action-cinema-look.md](references/live-action-cinema-look.md)（L1，已融汇原 craft 电影语言）；仅当用户追问具体相机/镜头/胶片参数时再读 [references/camera-optics-and-capture.md](references/camera-optics-and-capture.md)。人像叠加 photoreal。不要再加载 cinematic-language（已并入 L1）。
      - **宏大真人电影场景 / 真人巨构 / 大尺度实拍环境** → 组合读取 [references/concept-scene-directorial-design.md](references/concept-scene-directorial-design.md)、[references/scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) 与 [references/live-action-cinema-look.md](references/live-action-cinema-look.md) §9.1；复用已观察验证的故事状态变化、真人尺度入口、连续尺度链、唯一巨型 PRIMARY、因果 HANDOFF 和远景失边，不继承验证样本的雪原、天线、暴雪或色板
      - **宏大封闭室内 / 无雾大室内 / 室内空间不靠雾 / 地下大厅、机库、库房、工厂等大空间** → 读取 [references/scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) §16.1；默认干净透明空气，以近景入口、真人尺度链、唯一巨型 PRIMARY、结构遮挡与汇聚、远景结构合并、灯光衰减和暗部终点建立纵深，不自动添加蓝灰雾、烟尘或体积光
     - **半脸单眼 / 眼部极近 / 发丝织物近景 / 参考图只锁身份** → [references/character-closeup-and-identity.md](references/character-closeup-and-identity.md) + photoreal
     - **角色不好看 / 脸不好看 / 不性感 / 没魅力 / NPC 感 / 路人感 / 制式立绘 / 没有主角感** → [references/character-appeal-and-hero-signal.md](references/character-appeal-and-hero-signal.md)；先诊断脸部大形、服装主轮廓、表演主动性或构图显著性中的一个上游失败，不用换皮肤材质或堆配件解决
     - **景别/机位/站位/焦段行为/前景虚化/背景虚化/焦点/景深/慢镜头/静帧时间切片** → [references/shot-and-motion.md](references/shot-and-motion.md)；焦段先写可见空间行为，透视以摄影机站位为主，毫米数只作可选生产简称
     - **MJ 时尚大片 / 塑料人像** → [references/midjourney-fashion-portraits.md](references/midjourney-fashion-portraits.md)
     - **WhiteNoise / 超尺度沙漠** → [references/desert-megastructure.md](references/desert-megastructure.md)
     - **70s 复古科幻 / 21:9 舱体** → [references/retro-sci-fi-live-action.md](references/retro-sci-fi-live-action.md)
     - 程序接入或批量任务 → [references/schema-and-critic.md](references/schema-and-critic.md)
   - 

### 提示词自身的减法（编译压缩）

条款越长，模型越易平均用力。按优先级保留：

| 优先级 | 必留 | 可删/可合并 |
|--------|------|-------------|
| **P0** | 媒介；叙事焦点；主光方向 | 同义形容词串 |
| **P1** | 生命色+哑光块，或场景三层预算；全景再保留单层细节所有权 | 重复的 no 列表（收成一块） |
| **P2** | 一两个具体锚点 | 次要材质长描述 |
| **P3** | 风格微调 | 长情绪词、重复失败条件 |

同一意图只写一次（如 VIDEO MASTER MATTE 一块覆盖，不拆五句 no oily/dewy/sheen）。人在景里、夜景、室内均可先出短版再按需加句。

### 人脸生命色层次（跨风格 · 有人脸即适用）

凡出现可辨识人脸（真人、3D、手绘、赛璐璐、厚涂等），默认补足下列**颜色/生理层次**，避免「单色皮套 / 面具脸」。强度随风格变，逻辑共用：

| 层次 | 默认要求 | 风格提示 |
|------|----------|----------|
| **血色分区** | 颧/颊红润；鼻梁鼻头略暖；额颌更稳 | 写实 soft flush；赛璐璐色块；3D albedo mottling |
| **唇色独立** | 唇有自己更深/更玫的血色，不是脸上同色涂料 | 全风格 |
| **脸–颈连续** | 脸、颈、上胸同一皮肤家族，无换头色差 | 有肩颈入画时必写 |
| **耳鼻透（可选）** | 耳廓/鼻翼略更暖或更透 | 侧光、近景时加强 |

禁止：只用密毛孔/脏噪冒充不匀；把红润写成油光或浓妆腮红贴纸。油光与血色分离。写实详见 photoreal；02A 可有受控 shader 毛孔，但必须从属于 3D look-dev，并保持缩略图一眼可辨的电影 3D 媒介。

**跨媒介导演不变量**：真人摄影、3D、赛璐璐、漫画、绘画、定格等先共用同一套故事、关系、观看路径与显著性所有权，再翻译成各自的材质、线条、光影和成像语法。风格只能改变表达方式，不能重新分配叙事权重；任何非 PRIMARY/HANDOFF 区域若凭高光、纯白亮核、局部反差、锐度、描边、纹理、粒子或尺度成为新的注意力峰值，都属于无主显著性峰值，必须返修。
   - **主体辨识合同**：人物、产品、空间或关键道具需要跨画面复用时，先提炼 2–4 个可见辨识锚点（轮廓/大形、局部结构、颜色/材质、行为/功能道具），用一句「核心记忆点」连接；不用「高级、有故事感、气场强」等抽象词代替画面证据。
   - **参考图视觉权属**：多图输入先为每张图登记 `owns / may_influence / must_not_influence / valid_scales / active_outputs / active_regions`，再映射为目标模型支持的 subject、style、composition、pose 或其他引用方式；出现冲突时以用户明确指定和身份连续优先，不让一张图默认接管全部视觉维度。全身图不能拥有近景脸部证明，左栏身份图不能越权接管右栏姿势、背景和光线；结构化任务运行 `python scripts/validate_visual_contract.py <visual-contract.json>`。
   - **连续性分层**：姓名/型号、视觉年龄或尺度、脸型或几何结构、固定色材、默认服装、标志性道具 = 固定项；表情、姿势、动作、相机、光线、环境 = 场景变量。后续只改明确指定的变量。
   - **同一场景换机位例外**：按二维场景多机位模块将建筑、家具与道具关系、剧情状态和世界光源归入 locked；仅摄影机及其必需的投影、遮挡、反射变化归入 changed。不要把通用“场景变量”解释成换角度时可重新布置房间。
   - **事实边界**：区分用户事实、视觉推断和创作补全。不虚构履历、品牌、机构标识、制服制式、产品功能或历史细节；改用中性描述，或在该信息会显著改变结果时提问。
   - **图像信息证明合同**：剧情或产品识别依赖的关键小道具、手部接触、标志性材质或画中文字，须同时指定「观众要看懂什么、最小可读尺寸、焦点平面、形状/颜色/材质线索」。小面积关键物件优先改构图或中近景，不用广角近摄手部放大换可读性。

4. **拆解风格**
   - 把片名、工作室或艺术家别名转为可观察的媒介、形状、线条、材质、光色、构图、渲染和运动特征。
   - 用户点名风格、需要风格推荐或混合风格时，定向检索 [references/style-cards.md](references/style-cards.md)；不要默认加载全部卡片。
   - 风格卡只拥有媒介与类型翻译，不拥有当前镜头的审美命题、形状语言、配色层级或密度节奏。对场景应用命名风格前必须先通过基础美术门；“高密度概念图”是复杂度上限，不是堆满 `detail_owner_layer` 的许可。
   - 用户输入「手绘奇幻风格」时，读取同名卡片，先完成导演设计再应用风格语法。
   - 用户使用「90 年代日系」「九十年代日本照片」「日系老胶片」等宽泛称呼时，解释为以 1990 年代为中心、允许向前后各延伸约十年的摄影连续谱；先读取 [references/style-01A-japanese-everyday.md](references/style-01A-japanese-everyday.md)，再按参考图或用户指定收窄。
   - 生成原创主体与构图，不复制可识别角色、服装、标志、签名物件或现有镜头。
   - 对在世艺术家的直接模仿，提供不点名的特征组合；不要用同义词规避平台规则。

5. **生成通用母提示词**
   - 只加入会改变画面的信息。
   - 先选长度预算：FAST 或诊断优先 PATCH；简单直接交付优先 COMPACT；常规新建使用 STANDARD；02A、1:1 与复杂 DIRECTOR 使用 FULL_CONTRACT。压缩只删除展示性与重复信息，不删除阻断字段。
   - **提及预算即显著性预算**：PRIMARY 可获身份、形体和必要材质证据；HANDOFF 只写接力线索；SECONDARY 压缩为大轮廓、连续色面/暗面和极少结构关系；QUIET 原则上不枚举零件、褶皱、扣件、线路、划痕或纹理。禁止先写「简化/大色块」再在正/负向穷举次要部件。
   - 需要复用主体时，顺序为：主体锁定与核心记忆点 → 当前场景变量 → 构图与镜头 → 光线与色彩 → 材质与细节 → 约束。单次非连续任务不强制主体锁定段。
   - 把性格、定位和功能转译成可观察证据（眼神、重心、使用痕迹、合身度、道具接触）；删除无法从目标画面验证的心理叙述。
   - 不加入平台参数；不默认添加 `masterpiece`、`best quality`、`8K` 等不可解释质量词。
   - 文字必须逐字准确时，用引号保留原文并明确字体、位置和层级。
   - 比较某一变量时，锁定参考图/seed（若支持）、身份、服装、构图、相机、光线、色彩、材质和背景，只改变一个 `changed_dimension`。

6. **编译模型方言**
   - 用户指定模型、要求可直接粘贴版本、参数建议或模型迁移时，读取 [references/model-adapters.md](references/model-adapters.md) 的通用结构与目标模型章节。
   - 通用母提示词字段不等于所有模型的最终顺序；必须使用目标适配器的 `prompt_order` 重排。不得把 GPT Image、FLUX、Midjourney 或视频模型的注意力顺序当作跨平台规则。
   - 分离 `semantic_prompt` 与 `platform_settings`：画面中必须看见的竖幅／宽幅关系、主体裁切和空间布局写进语义提示词；画幅比例、分辨率、质量档、seed、身份 ID、参考图槽位与控制强度，仅在目标适配器确认存在对应界面或 API 参数时移到设置区。不得把“参数永远不写进提示词”或某个平台的字段习惯扩散为全局规则。
   - 平台路由按当前任务能力、参考图数量、局部锁定能力、文字要求、输出规格与已观察失败类型选择；不得把“某模型永远第一／最后”“只允许处理某一类材质”写成跨版本固定顺序。平台能力未经当前注册表或可靠来源确认时，保留模型中立提示词并标记待核对。
   - **默认模型（本用户工作流）**：任务为人像、1:1 角色模板或将作图生视频身份参考，且用户**未**指定其他模型时，按 **GPT Image / GPT Image 2** 方言编译（见 model-adapters §2.1），并默认按 photoreal §5.1 视频母版验收哑光。
    - 禁止跨模型混用参数；版本或参数不确定时标记「需核对」，不要猜测。先查看 [references/model-registry.md](references/model-registry.md) 的更新时间与适配器状态；注册表过期时只给通用母提示词，不伪造当前版本语法。
    - 正向约束/独立 negative prompt 以目标模型适配器和注册表状态为准；不要把某个旧版本的 FLUX、Runway、Veo 或 Sora 规则写成全局默认。
   - 人像 + 正向约束模型的皮肤写法见 photoreal-skin-and-light-contract 第 9 节。
   - 提示词长度服从当前模型和任务预算；不得把 `80–150 words`、`1500–2000 characters` 或其他经验数值设为全局硬上限。优先删除重复与无主细节，不得为满足字数破坏 02A、1:1、多参考权属或复杂 DIRECTOR 合同。
   - 图生视频主要描述主体、相机和环境如何变化，不重复首帧已有外观。
   - **动作预算**：5 秒最多 1 个主要主体动作 + 1 个相机运动 + 0 次切镜；6–10 秒最多 2 个连续动作节拍，仍优先单镜头。
   - 「保持原构图/主体尺度」与环绕、快速推拉或切镜冲突时，明确指出冲突，同时给出单镜头收敛版和分镜拆分版；不输出已判定超预算的「强制尝试」单提示词。

7. **给出约束与变体**
   - 按模型能力输出负面提示或正向约束。
   - 排除项针对本次主体和构图的高概率失败，按「主体误读、结构/材质、服装/道具、表情/动作、环境/光线、构图/文字、媒介」分组；删除同义词堆叠、无关词库和与正向冲突的项。
   - 只接受正向约束的模型：把身份错位、关键结构缺失、文字错误等阻断项改写为明确正向要求。
   - 仅当用户要求探索、比较、备选或单变量测试时给 3 个变体，并标明 `changed_dimension`；一次只改变镜头、光线、色彩、材质、空间空气强度或动作强度中的一个。FAST 和成片失败诊断默认只给一条完整整合提示词，不给变体。

8. **质量门（Blocking）**
    每次默认只跑下列阻断级检查；详细皮肤/布光验收见 photoreal-skin-and-light-contract 第 10 节；需要正式评分时再读 [references/schema-and-critic.md](references/schema-and-critic.md)（按该文件声明的总分阈值且无 blocking issue）。

   正式成片验收、多参考、角色资产、产品图、DIRECTOR 场景或连续失败时，先读取 [references/image-acceptance-and-retake-contract.md](references/image-acceptance-and-retake-contract.md)，按 `P0 事实/结构/权属 → P1 视觉叙事 → P2 媒介完成度` 逐级验收。P0 任一 `weak/fail/unverified` 即停止，总分、漂亮光影和高级材质不能抵消；结构化记录运行 `python scripts/image_grade_acceptance.py <profile.json>`。

   1. **意图与方言**：意图覆盖、画幅构图、光线/时间冲突、文字准确性、preserve 冲突、模型方言是否混用。
   2. **动作因果**（若有交互/运动）：距离相容、力量有来源与路径、删除特效后动作仍可读。
   3. **结构材质**（若有承重/损坏/产品）：组成、尺度、承重与损坏改变体积，而非贴图噪声。
   4. **主体辨识**：固定项跨镜头一致；2–4 个目标景别可见锚点；无抽象气质冒充特征。
   4A. **视觉断言与角色吸引力**：4–8 条关键事实均可从当前景别回答“是/否”；人物任务若要求漂亮、性感、主角感或反馈 NPC 感，必须检查脸部大形、服装主轮廓、主动表演与构图显著性，不得只追加抽象形容词。
   4B. **场景吸引力与美术指导**：新建场景检查 `aesthetic_thesis / shape_language / palette_hierarchy / density_rhythm / signature_motif / material_mood`；去掉纹理、霓虹和特效后，大形、负空间与综合色彩仍须成立。命名风格不能跳过；细节所有层内部仍须保留大形、1–3 个中型结构和静区。
   4C. **导演镜头与光色设计**：从零生成的非固定排版图必须能指出唯一主构图家族、主体落点、有方向的负空间、景别、摄影机世界位置、焦段行为、焦点所有者与景深策略。黑白灰检查必须指出主导明度家族、PRIMARY 连续大形、最亮/最暗所有者、唯一对比峰值、灰阶桥与主体背景分离，再分配主/辅/强调色面积。删除构图与色彩术语后仍须能从可见几何重建镜头；深焦不得变成全图等锐等密度，浅景深不得抹掉任务所需的时代、地点或关系信息。
   5. **显著性与提及预算**：仅一个主要叙事焦点与明确观看顺序；SECONDARY/QUIET 描述量不得接近 PRIMARY；风格翻译不得擅自增加无主峰值。
   6. **信息证明**：关键道具/接触/文字是否达到可识别尺寸与正确焦平面。
   7. **人像专用**（仅人像/角色 + 真人媒介）：执行 photoreal-skin-and-light-contract 第 10 节清单中与本次光线/景别相关的项。纯白档案图还必须检查背景—主体曝光隔离：背景白不得把人物翻译为整体高调过曝；肤色亮部须低于背景并保留色相，浅色衣物须保留褶皱，人物内部结构阴影须存在。
   7A. **02A 单幅人物专用**：实际交付文本必须通过 `scripts/validate_prompt.py --profile 02a-character-v1`。只出现 `PBR`、`SSS`、`高级电影感` 等概括词，或固定反照率分区、局部 SSS、micro-roughness、高光破碎、眼睛与发丝合同任一缺失，均为阻断失败。
   8. **场景专用**：STANDARD 简单场景检查唯一焦点、可读空间层次、光线方向和必要尺度；DIRECTOR 场景再检查故事秒或运行时刻、唯一中央视觉问题、PRIMARY 与第二观看点、可见观看路径、熟悉尺度证明、2–4 个世界运行证据和明确 QUIET 区。城市大全景、时代背景与氛围建立镜头必须明确唯一 `detail_owner_layer`；若近、中、远两层以上都能数窗格、栏杆、车辆、砖缝或设备，即使画面精致也按 P1 阻断失败。庞大场景还要检查人物是否落地、与门/车辆/平台形成连续尺度链、是否避免微缩模型感；用于视频时人景相对比例和共同透视是否锁定。若触发强空气散射，还要检查其距离连续性、近景实体与远层轮廓。
   9. **视频专用**：动作是否在时长内可完成、是否超动作预算、preserve 与相机运动是否冲突。
   9A. **同一场景多机位专用**：依 scene-multiview-continuity 先完成空间预检，再以同一批 ID 完成全部本镜头关键关系的 P0 盘点，才选第一项返修；局部修正后绑定新成图重新复查全部适用项，不复用旧通过状态。正常遮挡不等于丢失，无法判断不等于通过；未见成片只可完成提示词审查。
   10. **风险**：参考图授权、真人/公众人物、未成年人、角色、品牌、在世艺术家、商业投放。

9. **迭代与成片诊断**
   - 根据生成结果诊断具体失败；优先最小修改，保留已成功部分。
   - 每个 take 只选择 `keep | fix_in_post | edit | re_roll | rewrite` 中一种返工方向。第一次生成前声明 `attempt_budget` 和 good-enough 标准；同一职责连续两次失败、合同冲突、参考越权、景别无法证明或预算耗尽时必须 `rewrite`，不得继续盲目重抽。只有合同正确且失败像一次采样波动时才 `re_roll`，并保持 prompt、模式和参考角色不变。运行 `python scripts/image_retake_triage.py <retake-record.json>`。
   - **成片诊断合同**（用户反馈成片问题、或自审未过时启用；不负责实际调 API）：
     1. 只描述可观察失败（媒介身份、皮肤反射、抢戏、动作因果、景别证据等），不空泛归咎模型。
     2. 匹配 [references/examples.md](references/examples.md) 中最接近的 E#；若无匹配，用同一格式临时写一条。
     3. 每次只改一个 `changed_dimension`；内部形成「删除 / 替换 / 插入」级差分，再把差分整合进完整提示词交付。
     4. 写明通过标准（缩略图可读的一条）。
   - 内部诊断必须包含 `observed_failure / changed_dimension / preserve / delete / replace / insert / pass_condition`；每轮只处理一个上游失败维度。最终不得只显示补丁字段，必须重写为独立可执行全文。
   - 按构图/空间、主体姿态、镜头/焦点、光线、色彩、皮肤、非皮肤材质、媒介质感等维度分别登记「成功、失败、未验证」；生成结果只证明对应维度。
   - 回灌成功经验时只提炼有画面证据的因果写法；某一维度失败时不得把该维度的描述或诊断扩散到其他模块；尤其不得用构图/光线/胶片成功为皮肤写法背书。
   - 将场景专用名词抽象为可迁移控制关系（如「近镜前景尺度→中景主焦点→背景结构」）；除非该地点/物件是任务固定项，不把单张样片标签升级为全局默认。
   - 用户反馈「细节抢戏、服装/机械过度刻画、阴影像补丁」时：先检查是否对次要区域正负向双重穷举。修正顺序为「大轮廓与总体积 → 连续包裹形体的明暗 → 只在曲率/受力/重叠/功能/光源有证据处保留结构标记 → 删除其余部件名与表面纹理」。
   - 用户反馈「大全景层次没拉开、城市细节太满、像建筑展示或航测图」时：使用 `changed_dimension = panorama_detail_ownership`，保留时代、地域、天气、城市大形与当前 PRIMARY，只选择近／中／远一层继续拥有可读细节；另外两层删除零件枚举，改为体块、剪影、色带、距离衰减和静区。禁止用浓雾、浅景深或全局模糊掩盖原有等密度问题。
   - 用户反馈场景「丑、不好看、俗、土、廉价、乱、像游戏截图或素材拼贴」时：读取场景吸引力合同，先在形状语言、配色层级、密度节奏、签名母题、材质气质中定位第一个上游失败轴。整体美术方向失败必须 `rewrite`，不能用加细节、换画质词、加霓虹/雾或继续 `re_roll` 解决；只有单一区域抢眼或局部色偏才 `edit`。
   - 用户反馈「构图平、像随手截图、没有观看顺序、主体位置无意义、前景虚化碍事」时：读取构图色彩语法，以 `composition_family / attention_path / subject_placement_and_negative_space / foreground_role_and_focus_owner` 中第一个失败轴重写可见几何；禁止只追加“三分法、黄金螺旋、电影构图”等标签。
   - 用户反馈「灰平、黑白碎、死黑死白、主体与背景粘连、颜色脏、彩虹、互抢、紫蓝一片、主体不突出」时：先依次检查 `dominant_value_family / primary_value_shape / value_separation / contrast_peak / gray_bridge`，灰阶成立后才检查 `color_structure`；最亮、最暗与最高饱和必须有所有者。整体黑白灰或综合色彩失败时 `rewrite`，不能继续加互补色、霓虹、滤镜或 HDR 光效。
   - 用户反馈「不好看、脸不好看、不性感、没魅力、NPC 感、路人感」时：读取角色吸引力合同，把失败归入脸部设计、服装轮廓、表演主动性或构图显著性；只修改最上游失败轴，并用对应 `visual_assertion` 作为通过标准。
   - 记录模型、版本、prompt、参数、seed、参考图角色和修改项。

## Output Contract

按执行档位输出。FAST 交付整合后的完整单一提示词；STANDARD 使用下列顺序但省略无助于执行的章节；DIRECTOR 可完整展开。任何迭代都不以差分补丁代替完整提示词。用户要求直接可复制版本时，以提示词为主，不强制展示分析过程。

可用章节顺序如下；无内容的非必要章节省略：

1. 创意理解
2. 假设或待确认
3. 风格拆解
4. 通用母提示词
5. 目标模型版
6. 参数建议
7. 排除与约束
8. 三个单变量变体（仅用户要求探索、比较、备选或测试时）
9. 最多五条检查清单
10. 必要的风险说明

当任务包含需要复用的人物、产品、空间或关键道具时，在通用母提示词中给出简洁的「主体锁定」和「核心记忆点」，并明确固定项与场景变量；不适用时省略。关键词模式另有输出合同时，以对应模式为准。

同时提供正向提示词与负向提示词/负向约束时，必须放在同一个可复制代码块内，用 `【正向提示词】` 与 `【负向提示词】` 或 `【负向约束】` 分隔；不要让用户分别复制多个代码块。目标模型只有自然语言正向约束时，仍保留同一代码块，但把负向部分改写为简短的正向终点，不附缺陷词库。

当信息不足时只返回最多 3 个高影响问题；当参数需核对时仍提供通用母提示词，但不得伪造平台语法。

## Reference Routing

按任务类型只加载必要文件；默认不要一次读全库。

| 触发 | 读取 |
|------|------|
| `1：1角色模板` / 左脸右身档案 | [one-to-one-character-template.md](references/one-to-one-character-template.md)；真人媒介 + [photoreal-skin-and-light-contract.md](references/photoreal-skin-and-light-contract.md) |
| 人像/角色 + 真人皮肤、哑光、自然光、去 AI 感 | [photoreal-skin-and-light-contract.md](references/photoreal-skin-and-light-contract.md) |
| `高级电影3D风格` | [style-02A-premium-cinematic-3d.md](references/style-02A-premium-cinematic-3d.md)；与 1:1 同时触发时先读 [validated-02a-1x1-shell.md](references/validated-02a-1x1-shell.md)；**不**加载 photoreal 皮肤合同 |
| `手绘奇幻风格` | [style-04A-hand-painted-fantasy.md](references/style-04A-hand-painted-fantasy.md)；先导演后风格；**1:1已验收**见卡内成功路径 |
| 1980–2000 日系 / 90年代日系 | [style-01A-japanese-everyday.md](references/style-01A-japanese-everyday.md) |
| 其他风格名 / 混合风格 | [style-cards.md](references/style-cards.md) 对应章节（非整本默认加载） |
| 反推 / 参考图复刻 | [reference-image-reconstruction.md](references/reference-image-reconstruction.md) |
| 攻击、承重、道具感、材质失效 | [action-causality-and-material-structure.md](references/action-causality-and-material-structure.md) |
| 模型方言 / 参数 / 图生视频 | [model-adapters.md](references/model-adapters.md) |
| 平台版本、能力状态、官方文档更新时间 | [model-registry.md](references/model-registry.md) |
| 能力模式诊断 / 结构化接入 / 模式检查 / 批量回归 | [capability-matrix.md](references/capability-matrix.md) |
| GPT Image 2 人像 / 1:1 模板（油光、瓷皮、右栏露头） | [model-adapters.md](references/model-adapters.md) §2.1 |
| MJ 场景 / 批量 `-MJ.txt` / 字符上限 | [midjourney-scene-prompts.md](references/midjourney-scene-prompts.md) |
| 模糊年代情绪、导演自动拍法 | [directorial-intent-compiler.md](references/directorial-intent-compiler.md) |
| 从零生成人物/产品/场景/叙事静帧；随机拍法；构图、观看路径、黑白灰、灰阶、明度、冷暖、互补色；构图平、灰平、黑白碎或颜色脏反馈 | [composition-and-color-grammar.md](references/composition-and-color-grammar.md)；纯白档案/固定排版、FAST 未改构图色彩轴、忠实复刻不重设计时除外 |
| 新建场景 / 随机场景设计 / 命名风格场景 / 场景丑俗反馈 | 所有新建场景先执行 SKILL 基础美术门；DIRECTOR、随机设计、命名风格或“丑/俗/廉价/游戏截图感”再读 [scene-appeal-and-art-direction.md](references/scene-appeal-and-art-direction.md) |
| JSON / Critic / 正式评分 | [schema-and-critic.md](references/schema-and-critic.md) |
| 多参考权属有效景别、双栏/多输出分权、结构化视觉证明 | [reference-validity-and-visual-proof.md](references/reference-validity-and-visual-proof.md) |
| 同一场景换机位、正反打、多视角资产、家具/门窗/道具穿帮 | [scene-multiview-continuity.md](references/scene-multiview-continuity.md)；细化参考权属与 P0 验收，不要求三维 |
| 成片失败、回归、最小修改 | [examples.md](references/examples.md) |
| P0/P1/P2 正式验收、编辑/重抽/重写分流、尝试预算 | [image-acceptance-and-retake-contract.md](references/image-acceptance-and-retake-contract.md) |
| 局部修改、提示词限长、直接交付、成片诊断、输出 profile | [edit-budget-and-output-profiles.md](references/edit-budget-and-output-profiles.md) |
| 皮肤原理、修订合同、疑难皮肤诊断 | [skin-shading-notes.md](references/skin-shading-notes.md)（非默认；勿每次人像加载） |
| **DIRECTOR 场景：环境概念设计、世界观关键帧、复杂叙事空间、宏大地点建立镜头** | **先读** [concept-scene-directorial-design.md](references/concept-scene-directorial-design.md)；庞大场景执行尺度链与视频比例锁定，再按空间需求读取 scene-depth；STANDARD 简单场景不强制加载 |
| 场景反推/修改/生成；纵深、大气透视、发光空气、低对比低饱和概念氛围、远景衰减、背景过锐/过糊 | [scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md)；强连续空气见 §2.2 |
| 真人电影感、实拍静帧、胶片响应、纪实观察、去广告/HDR/过锐 | **L1** [live-action-cinema-look.md](references/live-action-cinema-look.md) |
| 宏大真人电影场景、真人巨构、大尺度实拍环境 | [concept-scene-directorial-design.md](references/concept-scene-directorial-design.md) + [scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) + [live-action-cinema-look.md](references/live-action-cinema-look.md) §9.1（已观察成片成功路径） |
| 宏大封闭室内、无雾大室内、地下大厅/机库/库房/工厂等 | [scene-depth-and-atmosphere.md](references/scene-depth-and-atmosphere.md) §16.1（已观察成片成功路径）；干净空气，结构/光衰/暗部递进优先 |
| 具体相机/镜头/胶片/扫描参数 | **L2（原 L3）** [camera-optics-and-capture.md](references/camera-optics-and-capture.md)（仅用户追问器材时；原 cinematic-language 已并入 L1） |
| WhiteNoise / 超尺度沙漠 / Eye of Nevask | [desert-megastructure.md](references/desert-megastructure.md) |
| 70s 复古科幻 / 21:9 废土舱体 / Kodak 2383 | [retro-sci-fi-live-action.md](references/retro-sci-fi-live-action.md) |
| 半脸单眼 / 眼发织物近景 / 参考图身份保真 | [character-closeup-and-identity.md](references/character-closeup-and-identity.md) + photoreal |
| 人像皮肤（全身→特写全景别） | photoreal **全景别皮肤编译骨架** + §5.1；特写再加 character-closeup §6 |
| 景别、机位、站位、焦段行为、焦点、景深、前后景虚化、慢镜头 / 静帧时间切片 | [shot-and-motion.md](references/shot-and-motion.md) |
| MJ 时尚大片 / 塑料人像修正 | [midjourney-fashion-portraits.md](references/midjourney-fashion-portraits.md) |
| 真人电影交付模板组装 | [prompt-templates.md](references/prompt-templates.md) |

主体类型不是人像时，禁止加载 photoreal-skin-and-light-contract。普通出图不读 skin-shading-notes。纯白底/无纵深任务不读 scene-depth-and-atmosphere。未要求电影胶片/纪实观感时不读 live-action-cinema-look；不要因「电影感」一次加载 L1+L2+L3。  
**craft 已融合**：上表专科文件已在本 skill `references/` 内；皮肤与视频母版冲突时永远以 photoreal-skin-and-light-contract 为准。
