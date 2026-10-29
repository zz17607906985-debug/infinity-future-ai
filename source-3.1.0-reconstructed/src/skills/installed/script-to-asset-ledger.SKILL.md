---
name: script-to-asset-ledger
description: Convert a complete screenplay or episodic script into a traceable, production-ready asset workbook with exhaustive entity reconciliation, character costume coverage, injury/recovery timelines, scene lifecycle phases, asset creators, and collaborative approval status. Uses a multi-pass agentic workflow with Master History for entity normalization and state tracking. High-quality image/video prompts are compiled via the visual-prompt-engineer skill and delivered only as separate self-executing Prompt Pack files (never written into the workbook). Use when the user asks to extract or audit scenes, characters, costumes, props, continuity states, episode appearances, first-appearance evidence, image-generation descriptions, task assignments, asset production ownership, approval/usability tracking, or to improve an existing script breakdown / asset list. Read and reconcile the full正文, not only character bios, synopses, scene summaries, or sample episodes.
---

# Script To Asset Ledger

## Goal

Produce an editable `.xlsx` asset ledger from the complete screenplay. The workbook must answer six questions with正文 evidence and production tracking:

1. What reusable assets exist?
2. In which episode, scene, and story-time phase does each asset appear?
3. When does its visible state change, and when does that state end, recover, or remain unresolved?
4. Which raw candidates were merged, excluded, or left pending, so omissions can be audited?
5. Who produced each asset image?
6. Has each asset been approved for use, sent back for changes, or rejected?

Treat a user-provided workbook as a **failure/reference sample** unless the user explicitly says its content is authoritative. Reuse its useful layout conventions, but never copy its entities, counts, continuity claims, or inferred descriptions without checking the full screenplay.

## Non-negotiable rules

- **Full text before conclusions.** Process every episode and preserve line, episode, and scene boundaries. Never claim completeness from a synopsis, character bio, keyword count, or structural QC alone.
- **Candidate universe before filtering.** Inventory every scene heading, dialogue speaker, subtitle/name tag, named action-line reference, stable relationship/title, functional crowd, costume mention, bodily/appearance state, prop, vehicle, document, and build/damage/repair/completion cue before deciding what becomes an asset.
- **Reconcile every candidate.** Every raw candidate must appear in `实体核对表` as `纳入`, `排除`, or `待确认`. An included item links to a canonical asset ID; an alias links to the same canonical ID. Never silently discard candidates.
- **Preserve non-body exclusions.** A name found only in人物小传 or剧情大纲 still receives an exclusion/pending row even when it has no正文 episode number; do not force a false episode onto it.
- **Separate identity from state.** A person, physical location, or prop keeps one base ID. Production-distinct costume, injury, aging, dirt/damage, construction, repair, completion, dressing, or version changes become linked timeline rows.
- **Use precise chronology.** Record episode plus scene when available, and record explicit story-time anchors such as `当天稍后`, `三天后`, or `一年后`. Do not turn an episode interval into a claim of continuous state unless evidence supports it.
- **Separate fact from inference.** Use `明确描写`, `场景连续推断`, or `无法确定`. Inferred continuity must state its basis. Unknown recovery/change points stay `未交代` or `待确认`; never invent them.
- **Never auto-approve assets.** Every generated asset row defaults to `确认状态=待确认` and blank `资产制作人` unless the input explicitly supplies reviewed production data. Only `已通过` means the asset may be used.

## Required workflow（多 Pass + Master History）

执行时严格按顺序完成。每 Pass 结束后必须更新并持久化中间态 `master_history.json`（完整 Schema 见 `references/decision-rules.md` §7），再进入下一 Pass。禁止跳过或合并 Pass。支持断点续跑：根据 `meta.lastUpdatedPass` 判断从何处继续。

### Pass 0 · Inventory & Structure
1. Confirm the authoritative files, file type, episode count, episode boundaries, and completeness.
2. Extract DOCX/PDF/DOC/TXT/Markdown/Fountain while preserving line breaks, episode headings, scene headings, dialogue speakers, and subtitle/name tags. Record missing or ambiguous sections before proceeding.
3. Build an episode-scene index. Give each scene a stable reference such as `12-3`. Record location, interior/exterior, time of day, story-time jump, present characters, visible states, costume cues, props, and state-change verbs.

### Pass 1 · Candidate Universe Collection（只收集，不判定）
Scan all channels listed in the non-negotiable rules. Keep raw spellings and titles. Do not apply asset thresholds or any inclusion/exclusion decisions during collection.
- Scene headings (location, character, time, state words)
- Dialogue speakers
- Subtitles, name tags, phone/video on-screen labels
- Named action-line references, stable relationship titles, functional crowds, costume mentions, bodily/appearance states, props, vehicles, documents
- Dialogue-mentioned names/places/objects that may appear later
- Build/damage/repair/completion, costume change, bandage/injury/recovery, time-jump cues

Output the complete `raw_candidate_universe`.

### Pass 2 · Specialized Harvester
Run four specialized sub-passes (results merge into Master History):
- 2a. Characters & identity channel
- 2b. Costume & appearance channel
- 2c. Scene lifecycle channel
- 2d. Props & state-chain channel

Each sub-pass extracts only its domain, producing preliminary structured records + evidence excerpts.

### Pass 3 · Continuity Agent（核心）
Maintain a growing **Master History** as the single source of truth:
1. **Matchmaker（实体归一）**：Resolve aliases, spelling variants, relationship titles, and functional crowds into canonical IDs. Every normalization decision is recorded in `实体核对表` with the original candidate preserved.
2. **Observer（状态追踪）**：For every retained entity, maintain the full state timeline (costume phases, injury/appearance states, scene phases, prop versions). Enforce evidence hierarchy (`明确描写` / `场景连续推断` / `无法确定`). After any time jump, default to `无法确定`; never invent recovery. `已恢复` requires explicit recovery evidence.

### Pass 4 · Reconciliation & Coverage Audit
1. Assign every raw candidate an explicit decision (`纳入` / `排除` / `待确认`) in `实体核对表`.
2. Enforce coverage gates:
   - Costume phases of every visual character must exactly union to that character’s `可视出场集` (or a justified exemption).
   - Scene phases must exactly union to every appearance of that scene.
3. Surface all gaps and conflicts; never silently discard.

### Pass 5 · Production Description & Prompt Generation
1. Ground base designs in all relevant evidence. Put stable identity features in base rows and phase-specific visual differences in timeline rows. Label reasonable visual completion as suggestion, not canon. These descriptions stay in the workbook (for human reading and continuity), but **no generation prompts** are written into the `.xlsx`.
2. Generate short Bibles (stable features + first-appearance evidence) for characters, key locations, and hero props. Record them in Master History.
3. For every production asset that needs an image/video prompt:
   - Extract structured visual intent from Master History: Bible, immutable features, current mutable state (costume / injury / scene phase / prop state), evidence type, continuity constraints, and aspect-ratio type (1:1 / 21:9 / 16:9).
   - Hand this structured intent to the **visual-prompt-engineer** skill for high-quality compilation（母提示词 → 主体分流 → 风格路由 / 1:1角色模板 / 场景纵深与大气 scene-depth-and-atmosphere / 模型方言：人像默认 GPT Image 2、场景可走 MJ 16:9 / 视频母版哑光等）.
   - Separate **immutable** (locked identity) from **mutable** (phase-specific change). `无法确定` content must never be written as fact inside prompts.
4. **Deliver all generation prompts as separate files only** — self-executing Prompt Packs (Markdown). Do **not** put prompts into the workbook. **Organize into three folders: `人物/`、`场景/`、`道具/`**. Filename must include episode for sorting (e.g. `第3集-陈默-便装纱布-1x1.md`; use first visual episode or range). Each Pack includes Bible, state, continuity, and aspect-ratio rules: single **1:1** (挂台账ID，GPT Image 2 + 视频母版哑光); group **21:9** (一字排开；每人各写可区分外貌+服装+气质；负向含克隆脸); scene **16:9** (scene-depth / MJ). Ready for Seedance / Kling / GPT Image / 即梦 etc.
5. Every asset row in the workbook defaults to `确认状态=待确认` and blank `资产制作人`.

### Pass 6 · Build & Final QC
Use `scripts/build_asset_workbook.mjs` with the normalized JSON contract. Initialize or preserve `确认状态` and `资产制作人`, run positive and negative validation, inspect key ranges, scan formula errors, and render every sheet before delivery. All original Completion Gates remain mandatory.

## Continuity requirements

### Characters and costumes

- `人物综合资产表` 以角色分组：先 `人物基础`，再跟该角色的 `服装阶段` 与 `角色状态`。`可视出场集` 与全部提及分开记录。
- **有变化才拆服装行。** 若角色全程只有一套稳定服装且覆盖全部可视出场，只写一行服装记录，不必为“形式完整”再拆多余阶段。真正因职业、事件、季节、时间跳跃、仪式、伤病处理等产生可见差异时，才拆多阶段。
- 服装阶段的覆盖并集必须精确等于该角色 `可视出场集`，或给出明确豁免理由。禁止用一句「全剧固定服装」糊弄有明显换装证据的角色。
- 审计**所有**可视角色，不只主角。群演/路人仅在有复用价值时建档。
- 沾水、血迹、包扎、破损等通常作为 `状态变体` 挂在基础服装下，不轻易新建整套服装。
- 行内避免重复样板句；长证据优先精炼，完整原文放在证据/核对相关列或表。

### Injury, recovery, and other character states

- Record wounds, illness, bandages, mobility limits, pregnancy, aging, haircut/makeup changes, dirt/wetness, arrest/custody appearance, and other visually actionable states as `角色状态` rows directly under the matching character in `人物综合资产表`.
- Each state row records onset episode/scene, last confirmed episode, resolution status, resolution episode/scene when known, onset evidence, resolution evidence, duration basis, asset action, and linked base costume.
- `已恢复` requires explicit recovery/normal-appearance evidence. If the script stops mentioning an injury, use `未交代`; do not extend it to a later episode or declare recovery by intuition.
- If a state changes within one episode, scene references control the order. If time jumps, record the story-time anchor.

### Scenes and lifecycle stages

- **有变化才拆行。** 仅当场景存在生产上可区分的生命周期变化（施工→竣工、完好→损毁→修复、毛坯→落成等）时，才拆成 `场景基础` + 多条 `场景阶段`。若全程只有一个稳定阶段且覆盖全部出场，只写一行合并记录，不再强制拆基础+阶段。
- `场景阶段` 只写与基础结构的**差异点**，不要把完整空间描述再抄一遍。
- 组合后的阶段覆盖必须等于该场景全部出现集。真正需要不同资产的阶段（如施工 vs 竣工）不得合并成一行。
- 日夜、天气、轻微陈设变化若不影响几何与制作设计，可复用同一阶段，不必另起一行。
- 行内避免重复样板句（如「同一物理空间只建一个场景资产」）；此类说明放在表头注释或说明区，不逐行粘贴。

### Props and other assets

- Track meaningful lifecycle states such as sealed/opened, intact/broken, blank/signed, original/forged, raw/assembled/completed, clean/bloodied, powered off/on, or seized/returned.
- Split a new prop asset only when geometry, readable content, or production treatment materially changes. Otherwise keep a state chain with evidence and asset-action guidance.

## Workbook contract

Create these sheets. Do not split character base data, costume phases, and character states into separate primary sheets. Do not split scene base data and scene phases into separate primary sheets.

- `任务分工表`: continuous story/event segments; assign A-I without splitting a continuous event merely to balance counts.
- `场景综合资产表`: group by `场景ID`. **有真实生命周期变化时**才写 `场景基础` + 多条 `场景阶段`；单阶段场景合并为一行。阶段行只写差异点。保留证据、资产动作与样式图占位。**Do not include generation prompts.**
- `人物综合资产表`: group by `角色ID`. 先 `人物基础`，再跟有实际变化的 `服装阶段` 与 `角色状态`。全程单套服装且无状态变化的角色保持精简。**Do not include generation prompts.**
- `道具资产表`: one row per reusable/story-relevant prop with evidence-backed state/version chain. **Do not include generation prompts.**
- `实体核对表`: complete raw candidate inventory with canonical ID, source channels, occurrence count, decision, reason, and confidence.
- `证据与质检表`: evidence rows plus builder-generated QC summary rows. This is not a substitute for `实体核对表`.

The required workbook contains six sheets. Prefer compactness: do not create base+phase pairs merely for formal completeness. Use a `记录类型` column and distinct conditional formatting when multiple row types exist under the same entity. Never require the user to switch tabs to compare a base asset with its linked changes.

**Generation prompts must never appear in the workbook.** All image/video prompts are delivered exclusively as separate self-executing Prompt Pack files (Markdown).

Every production asset row in `场景综合资产表`, `人物综合资产表`, and `道具资产表` must include:

- `确认状态`: dropdown with `待确认`, `已通过`, `需修改`, and `不采用`. `已通过` means usable; all other values mean not approved for direct use.
- `资产制作人`: editable text naming the person who produced the corresponding asset image.

Place both columns next to `资产优先级`. Apply clear conditional formatting to `确认状态`: green for `已通过`, yellow for `待确认`, red for `需修改`, and gray for `不采用`.

Keep image placeholder columns blank and wide. Use frozen headers, filters, wrapped text, restrained borders, and data validation for categorical fields. Use conditional formatting for status and QC decisions rather than hardcoded row colors.

## Completion gates

Do not deliver until all gates pass:

- `已读取集数` exactly covers `1..总集数`; otherwise stop and report an incomplete source.
- Every retained base asset and phase/state row has a unique ID, source evidence, and an included reconciliation record.
- Every character candidate from headings, speakers, subtitle tags, action lines, and named references has a decision.
- Costume coverage equals every non-exempt character's visual episode set; gaps are errors, not notes.
- Scene-phase coverage equals every scene's appearance episode set.
- Every recorded character-state change has onset evidence and a defensible resolution status; `已恢复` has recovery evidence.
- All aliases and exclusions have reasons; `待确认` rows remain visible.
- No generation prompt (in separate Prompt Packs) silently contradicts an `无法确定` field.
- Every asset row has a legal `确认状态`; missing input defaults to `待确认`. Never infer `已通过` from evidence confidence or QC success.
- Formula/error scan and render pass succeed for all sheets.
- The workbook contains **no** image/video generation prompt columns or cells.

Name the workbook `《剧名》资产台账.xlsx` unless the user requests another name. Deliver generation prompts only as separate self-executing Prompt Pack Markdown files (e.g. `《剧名》_PromptPacks/` or individual `.md` files). In the final response report episode count, retained base-asset counts, scene/costume/state phase counts, excluded/pending candidate counts, asset confirmation counts, any unresolved continuity risks, and the list of Prompt Pack files. Link the workbook and the Prompt Pack files. Do not claim completeness beyond the reconciliation and QC evidence.

Read `references/decision-rules.md` for the inclusion matrix, evidence hierarchy, timeline rules, JSON contract, and QC checks.
