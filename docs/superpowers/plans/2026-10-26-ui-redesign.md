# 前端界面改版 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 设置窗口改成左侧导航 + 分页、统一控件和图标、加实时视差预览；壁纸页的摆放模式、Toast、加载提示、调试面板换成同一套样式。

**Architecture:** 新建 `ui/`（两个页面共用的 token、基础控件样式、Lucide 雪碧图）。`settings.html` 只留结构，样式进 `settings/settings.css`，原来的内联脚本按页面拆成 `settings/*-page.js`，由 `settings/main.js` 组装。每个页面模块沿用现有写法：全局函数 `initXxx(deps)` 返回一个小对象。

**Tech Stack:** Electron 28（Chromium 120）、原生 JS / CSS、WebGL1（预览）、Node `node --test`。

**Spec:** `docs/superpowers/specs/2026-10-26-ui-redesign-design.md`；视觉参照 `.superpowers/mockups/ui-redesign.html`（token 和控件 CSS 可以直接从 mockup 搬）。

## Global Constraints

- 不改 `preload.js`、IPC 通道、`config.json` 结构；主进程只改 `createSettingsWindow` 的窗口选项。
- 不引入框架、构建步骤和新的运行时依赖；图标和字体必须离线可用。
- 代码注释用中文；界面文字用白话、简体中文。
- 不提交、不推送（用户说了再做）。
- 实测前备份 `%APPDATA%/interactive-desktop-wallpaper/config.json`，测完恢复。
- 设置窗口：960×660，最小 820×560，`titleBarStyle: 'hidden'`，`titleBarOverlay: { color: '#0b0f15', symbolColor: '#97a3b4', height: 36 }`，`backgroundColor: '#10161e'`。
- 颜色 / 字体 / 圆角取 spec "视觉规范" 表里的值，变量名一致。

## Review Focus

1. 选中一张没有深度图的图片：预览静止并提示"生成深度图后可以预览视差"，"应用壁纸"灰掉，生成完自动切到深度图、预览开始能动。
2. 5000px 以上的大图：预览纹理先缩到最长边 2048 再上传，不能黑屏或报 `texImage2D` 错误；拿不到 WebGL 时退回普通 `<img>`。
3. 拖元素调整面板的滑块时收到配置广播：面板不能重绘（沿用 `hold()` 800ms），松手后再重绘且选中项不变。
4. 删除当前选中的元素 / 素材丢失：右栏切到第一个元素或引导文字；缺文件的卡片标红不报错。
5. 窗口缩到最小 820×560：没有横向滚动条，操作栏和图库不溢出。

---

### Task 1: 共用 UI 基础（`ui/`）

**Files:**
- Create: `ui/tokens.css`、`ui/icons.js`

**Interfaces:**
- Produces: CSS 变量（spec 表格里的全部名称，另加 `--warp: #ffcc6a`、`--r-lg/md/sm`、`--font`）；类名 `.i`（图标）、`.btn`（`.primary/.ghost/.danger/.sm/.icon`）、`.switch`、`.seg`、`input[type=range]`（读 `--p` 画已走过部分）、`input[type=range].depth`（深度色带）、`.depth-range`（两端"远 / 近"）、`.chip`（`.ok/.accent/.warn`）、`kbd`、`.glass`。
- Produces: 全局 `Icons`：`Icons.svg(name: string, className = 'i') → SVGSVGElement`；脚本加载时把 `<svg><symbol id="i-<name>">…</svg>` 插到 `document.body` 开头，HTML 里可直接写 `<svg class="i"><use href="#i-check"/></svg>`。
- Produces: 全局 `UIControls.paintRange(input)`：按 value / min / max 设置 `--p`；并在 `document` 上监听 `input` 事件自动调用。代码里给滑块赋值后必须调用 `paintRange`。

- [ ] **Step 1:** 用 lucide-static@0.460.0 的 `icons/*.svg` 生成 `ui/icons.js`，图标清单：image image-plus layers shapes sparkles disc-3 settings plus folder-open wand-sparkles check x eye eye-off trash-2 move rotate-ccw flip-horizontal-2 flip-vertical-2 square-dashed play pause music cloud-rain snowflake flower-2 leaf sun ban circle-check circle-alert info loader-circle chevron-down mouse-pointer-click。文件头写许可（ISC）、版本和"新增图标从同版本 icons/<name>.svg 复制 path"。`UIControls` 也放在这个文件里（两个页面都要用）。
- [ ] **Step 2:** 从 mockup 搬 token 和控件样式到 `ui/tokens.css`，补 `:focus-visible` 和 `prefers-reduced-motion`。
- [ ] **Step 3:** 验证：浏览器打开一个只引这两个文件的临时页面（scratchpad），图标和控件显示正常，控制台无报错。

### Task 2: 设置窗口外壳（窗口、导航、Toast、样式）

**Files:**
- Modify: `main.js`（`createSettingsWindow`）、`settings.html`（整体重写为结构）
- Create: `settings/settings.css`、`settings/shell.js`、`settings/controls.js`、`settings/main.js`

**Interfaces:**
- Consumes: Task 1。
- Produces: `initShell() → { setStatus(msg: string, cls?: ''|'success'|'error'), showPage(name: 'wallpaper'|'parallax'|'elements'|'effects'|'music'|'system'), setBadge(page, text: string), setNowUsing({ name: string, thumbUrl: string }|null), onPageChange(cb: (name) => void) }`。Toast 在窗口右下，`''`/`success` 3000ms、`error` 6000ms，新的顶掉旧的。
- Produces: `Controls`（`settings/controls.js`）：`el(tag, className?, text?)`、`icon(name)`、`rangeRow({ label, desc?, min, max, step?, value, format, depth? , onInput }) → { row, input, setValue(v) }`、`segmented(container, onChange)` 返回 `{ set(value) }`（按钮用 `data-value`）、`switchEl(checked, onChange) → { root, input }`。
- Produces: `settings.html` 里每页一个 `<section class="page" id="page-<name>">`；导航按钮 `data-page`；页面里各控件的 id 在后面任务里定，沿用原 id 的尽量沿用。
- `settings/main.js` 最后加载：创建 `configSaver`（沿用 `Shared.configSync.createConfigSaver(..., 100)` 和 `beforeunload` flush），依次 init 各页面，`getConfig()` 一次后调用各页面的 `load(config)`，再 `getAutoLaunch()`。

- [ ] **Step 1:** 改 `createSettingsWindow` 的选项（见 Global Constraints），`title` 保持 `'互动3D壁纸 - 设置'`。
- [ ] **Step 2:** 写 `settings.html` 骨架（标题栏 `-webkit-app-region: drag`、右侧给系统按钮留 140px，侧边栏、六个空 section、Toast 容器），脚本顺序：`ui/icons.js` → `shared/*.js` → `renderer/shaders.js`（取 `PARALLAX_GLSL`）→ `settings/controls.js` → `settings/shell.js` → 各页面 → `settings/main.js`。
- [ ] **Step 3:** 写 `settings.css`（布局、侧边栏、页面头、`.list/.row`、图库、元素、特效、唱片机样式，从 mockup 搬）。
- [ ] **Step 4:** 验证：`npm run dev` 后打开设置窗口（第二个实例），导航切换六页，标题栏能拖、系统按钮在右上，`setStatus` 弹 Toast。

### Task 3: 实时视差预览（`settings/depth-preview.js` 重写）

**Files:**
- Modify: `settings/depth-preview.js`

**Interfaces:**
- Consumes: `PARALLAX_GLSL`（`renderer/shaders.js`）、`Shared.parallax.coverTransform / strengthFromMultiplier`、`Shared.framePacing.isSettled`。
- Produces: `initDepthPreview() → { showImage(dataUrl: string, info: { name: string, tag: '默认壁纸'|'你的图片', size?: string }), setUsing(using: boolean), setDepth(url: string|null, opts?: { show?: boolean }), setParams({ parallaxMultiplier?, smoothness?, focusDepth? }), mount(slot: HTMLElement) }`。预览 DOM 只有一份，`mount` 把它移到当前页面的槽位（壁纸页大、视差页小）。

- [ ] **Step 1:** WebGL1 画一个全屏四边形，片元着色器 = `PARALLAX_GLSL` + 壁纸同款主函数（cover 映射、`clamp(…, 0.001, 0.999)`），"深度图"模式采样深度纹理。纹理用 `createImageBitmap` 缩到最长边 ≤ 2048。
- [ ] **Step 2:** 鼠标在预览上：目标 = 取反后的归一化坐标；离开时目标回 0。每帧 `k = 1 - (1 - smoothness)^(dt/16.67)`，`isSettled` 收敛后停止 rAF，不常驻。
- [ ] **Step 3:** 没有深度图时静止并显示提示；`getContext('webgl')` 失败时退回 `<img>`。
- [ ] **Step 4:** 验证：浏览器打开设置页（`?` 无 electronAPI 时页面不能报错退出）或 Electron 里选一张默认壁纸，鼠标移动有视差；切深度图；选 6000px 图片不报错。

### Task 4: 壁纸页（选择 / 生成 / 应用、图库、正在使用）

**Files:**
- Create: `settings/wallpaper-page.js`
- Modify: `settings/gallery-panel.js`

**Interfaces:**
- Consumes: Task 2 的 `setStatus / setNowUsing`，Task 3 的 preview。
- Produces: `initGalleryPanel({ api, onSelect(entry), onPickFile() }) → { ready: Promise, find(path), setSelected(path) }`（不再折叠，网格末尾是"从电脑选择…"格，"使用中"标记跟着 `config.currentImage` 走）。
- Produces: `initWallpaperPage({ api, saver, setStatus, setNowUsing, preview, gallery }) → { load(config): Promise, setBlur(value: number) }`。

- [ ] **Step 1:** 原内联脚本里的 `selectImagePath / generateDepth / onDepthProgress / applySelectedWallpaper / onPrepareImage / 边缘平滑` 逻辑整体搬过来，进度显示改到操作栏（状态区换成进度条 + 文字），状态文字走 `setStatus`。
- [ ] **Step 2:** 正在使用：`load` 和每次 `onLoadConfig` 时按 `currentImage` 更新侧边栏卡片（默认壁纸用 thumb，自己的图片用 `toFileUrl`）和预览的"使用中"。
- [ ] **Step 3:** 验证：选默认壁纸 → 应用；选自己的图片 → 生成（进度条走完、自动切深度图）→ 应用；改边缘平滑后"应用壁纸"灰掉并提示重新生成。

### Task 5: 视差、特效、唱片机、设置四页

**Files:**
- Create: `settings/parallax-page.js`、`settings/effects-page.js`、`settings/music-page.js`、`settings/system-page.js`

**Interfaces:**
- Consumes: `Controls`、`saver`、`setStatus`、preview。
- Produces: 各自 `init…Page(deps) → { load(config) }`；`initParallaxPage` 另收 `wallpaperPage.setBlur`（恢复推荐值时同步边缘平滑），并在滑块变化时调用 `preview.setParams`；`initSystemPage({ api, setStatus, onCacheCleared })`。

- [ ] **Step 1:** 视差页：三行（视差强度、跟手程度、对焦深度用深度色带）+ "恢复推荐值"（`{ parallaxMultiplier: 20, smoothness: 0.08, focusDepth: 0.5, blurRadius: 8 }`）；页内放预览槽位。
- [ ] **Step 2:** 特效页：天气六格（`none/rain/snow/sakura/leaves/sunlight` → 无/细雨/落雪/落樱/枫叶/光斑）、密度分段、速度、视差开关；视频特效开关、预设卡片、自己的视频（导入 / 使用这个视频）、混合方式分段、不透明度、速度。保存的配置字段和原来逐一对应。
- [ ] **Step 3:** 唱片机页：开关、正在播放卡片（封面用 `toFileUrl(coverPath)`，无则默认唱片样式）、导入音乐、播放 / 暂停、音量、四角位置、大小、封面更换 / 用默认。
- [ ] **Step 4:** 设置页：开机自启、缓存路径（点击打开）、打开文件夹、更改位置、清除缓存（`confirm` 后清除，并通过 `onCacheCleared` 让壁纸页把"应用壁纸"灰掉）。
- [ ] **Step 5:** 验证：每个控件改一下，主进程日志 / `config.json` 里对应字段变了，壁纸上效果跟着变。

### Task 6: 元素页（`settings/elements-tab.js` 重写渲染）

**Files:**
- Modify: `settings/elements-tab.js`

**Interfaces:**
- Consumes: `Controls`、`setStatus`、`setBadge('elements', String(n))`。
- Produces: `initElementsTab({ api, setStatus, setBadge })`（签名只多一个 `setBadge`）。

- [ ] **Step 1:** 素材网格（默认 + 自己添加 + "添加素材"格，悬停"放到壁纸上"，自己添加的有移除按钮，缺文件标红）；页头"添加素材"按钮复用导入逻辑。
- [ ] **Step 2:** 左右两栏：列表项（缩略图、名称、播放摘要、眼睛按钮）；右栏分组（位置 / 颜色 / 播放 / 绿幕抠像），控件和保存字段与原 `renderInstanceDetails` 一致，播放方式改分段按钮。`selectedId` 不存在时选第一个；没有元素时显示引导文字。
- [ ] **Step 3:** 保留 `hold()` / `saveInstance` 防抖和"恢复原色立即重绘"的逻辑。
- [ ] **Step 4:** 验证：放两个爆炸，切换选中、拖颜色滑块不中断、隐藏 / 删除 / 重新摆放可用，导航角标跟着数量变。

### Task 7: 壁纸页界面（摆放模式、Toast、加载、调试面板）

**Files:**
- Modify: `index.html`、`style.css`、`renderer/edit-mode.js`、`renderer/ui.js`、`renderer/main.js`（只动调试面板折叠按钮那几行）

**Interfaces:**
- Consumes: Task 1。
- Produces: `#placement-hint` 内有 `#placement-title`（edit-mode 写入"摆放「名称」"）；`#placement-depth-auto`（"自动"标签，按 `instance.depthAuto` 显示）；深度数值只显示数字；`#debug-toggle` 用箭头图标，折叠靠 `.collapsed` 旋转。

- [ ] **Step 1:** `index.html` 引 `ui/tokens.css`、`ui/icons.js`，按 mockup 改摆放提示、工具条（图标按钮 + `title`）、调试面板标签（"跟手程度"，对焦深度用 `.depth`）。
- [ ] **Step 2:** `style.css` 改摆放框 / 手柄 / 旋转点 / 自由变形（`--warp`）/ 工具条 / Toast / 加载 / 初始化失败 / 调试面板为 token + `.glass`。
- [ ] **Step 3:** `edit-mode.js`：写标题、深度数值和"自动"标签分开；`main.js` 折叠按钮不再改 `textContent`。
- [ ] **Step 4:** 验证：浏览器预览 `index.html?mode=edit` 和 Electron 摆放窗口里拖、缩放、旋转、自由变形、翻转、复原、确认、取消都正常；Toast 在暂停 / 恢复时出现。

### Task 8: 收尾验证和文档

**Files:**
- Modify: `PROJECT_NOTES.md`

- [ ] **Step 1:** `npm test`；`venv/Scripts/python.exe -m unittest tools/test_generate_depth_map.py tools/test_prepare_wallpapers.py tools/test_prepare_builtin_element.py`，全部通过。
- [ ] **Step 2:** Electron 实测（CDP 截图）：六页、默认壁纸面板、深度图预览、元素调整面板、摆放模式；窗口缩到 820×560 检查溢出；控制台无错误。
- [ ] **Step 3:** 恢复备份的 `config.json`。
- [ ] **Step 4:** 更新 `PROJECT_NOTES.md`：文件地图（`ui/`、`settings/` 新文件）、功能完成度、阶段记录、打包注意（`build.files` 不含 `ui/ settings/ shared/`）。
