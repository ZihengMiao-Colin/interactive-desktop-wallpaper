# 自定义元素系统 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可以把图片 / GIF / 视频作为元素加到视差壁纸上，在全屏摆放窗口里拖动、缩放、调深度后确认；元素在 Pixi 场景内渲染，视差和深度遮挡与背景一致。

**Architecture:** 纯逻辑（视差数学、数据模型、播放调度、摆放几何）写成 `shared/` 下的 UMD 模块，Node 测试和渲染进程共用。主进程新增 `src/elements/`（素材库、摆放窗口控制器、IPC）。渲染进程先把 1676 行的 `app.js` 拆进 `renderer/`，再新增 `renderer/elements/`（素材源、元素着色器、元素层、深度取样）和 `renderer/edit-mode.js`。设置页的"自定义贴纸"tab 换成"自定义元素"tab。

**Tech Stack:** Electron 28.3.3（Chromium 120）、Pixi.js 7.4.2（沿用 CDN）、WebCodecs `ImageDecoder`（解码动图）、Node 内置测试 `node --test`、Python 3.11 venv + ffmpeg（只用于预处理默认素材）。

**Spec:** `docs/superpowers/specs/2026-10-25-custom-elements-design.md`

## Global Constraints

- 不新增 npm 依赖。动图用 Chromium 自带的 `ImageDecoder`，不用 `@pixi/gif`。
- 渲染进程没有打包器：一律用普通 `<script>` 全局脚本。`shared/` 模块用下面的 UMD 头，挂到 `window.Shared.<name>`，Node 端 `module.exports`。
  ```js
  (function (root, factory) {
      const mod = factory();
      if (typeof module === 'object' && module.exports) module.exports = mod;
      else (root.Shared = root.Shared || {}).NAME = mod;
  })(typeof self !== 'undefined' ? self : this, function () { /* ... */ });
  ```
- 代码注释用中文；界面文案用中文；标识符、命令、报错保持英文。
- 只处理主显示器；仅 Windows。
- 坐标约定：`transform.x / y` 是元素中心点，相对主显示器的归一化坐标 0~1；`transform.width` 是相对屏幕宽度的比例；高度 = 宽度 ÷ 素材宽高比。
- 宽度范围 **0.03 ~ 1.5**；新元素默认宽度 **0.25**、中心 **(0.5, 0.5)**、不透明度 **1**、`rotation` 固定 **0**。
- 深度约定：0 最远，1 最近（与深度图白 = 近一致）。场景比元素近时元素被挡。
- 播放默认值：静态图片 `static`；动图 `loop`；用户导入的视频 `loop`、抠像关闭；默认爆炸 `interval`，`intervalSec` **10**、`jitterSec` **3**、抠像开启。`intervalSec` 指"播完后等待多少秒再播"，实际等待时间在 `intervalSec ± jitterSec` 内均匀随机，最少 1 秒。
- 用户导入的文件复制到 `userData/custom_elements/`。
- 摆放窗口：Enter 确认、Esc 取消；摆放期间暂停真实壁纸渲染。
- 提交在分支 `feat/custom-elements` 上进行（Task 0 建分支）。

## Review Focus

1. **路径含中文、空格、`#`、`%`**（例如 `D:\图片\猫 #1 100%.gif`）：导入、缩略图、壁纸上播放都正常。→ Task 6 `importUserAsset` 和 `toFileUrl` 测试。
2. **素材文件丢失或损坏**（副本被删、视频编码不支持）：这个元素跳过并在设置页标红，其他元素照常显示，壁纸不报初始化失败。→ Task 3 `resolveInstances` 测试；Task 10 验证步骤。
3. **分辨率或缩放比例变化**（1920×1080 换到 2560×1440，或 100% 换到 150%）：元素在屏幕上的相对位置和相对大小不变。→ Task 5 `rectFromTransform` 测试。
4. **摆放窗口异常**：重复点"重新摆放"、Alt+Tab 离开后回来、渲染进程崩溃时，不能出现两个摆放窗口，也不能留下置顶窗口。→ Task 8 `PlacementController` 测试。
5. **旧配置或损坏配置**（没有 `customElements`；`instances` 不是数组；还有旧 `sticker`）：启动不崩，按默认值处理，旧贴纸被迁移。→ Task 6 store 测试；Task 3 `legacyStickerToInstance` 测试。

---

### Task 0: 提交现有 WIP 并建分支

**Files:**
- Modify: `.gitignore`（加 `.superpowers/`）

- [ ] **Step 1: 冒烟运行。** `npm run dev` 运行约 20 秒，看主进程日志里有没有 `Error` / `TypeError`，并确认出现 `[Main] App startup complete`；看完退出（托盘"退出"，或结束 electron 进程）。有报错先记下来告诉用户，不在这一步修。
- [ ] **Step 2: `.gitignore` 加一行 `.superpowers/`。**
- [ ] **Step 3: 分三次提交到 `main`。**
  ```bash
  git add app.js generate_depth_map.py index.html main.js preload.js settings.html src/store.js src/tray-manager.js style.css .gitignore
  git commit -m "feat: 壁纸自定义元素（唱片机/视频特效/天气/贴纸）与深度图目录管理"
  git add overlay elements
  git commit -m "chore: 添加特效视频素材"
  git add PROJECT_NOTES.md CLAUDE.md docs
  git commit -m "docs: 项目梳理、自定义元素设计与实施计划"
  ```
  `default wallpaper/` 先不提交。
- [ ] **Step 4: 建分支。** `git checkout -b feat/custom-elements`。预期：`git status` 干净（只剩 `default wallpaper/` 未跟踪）。

---

### Task 1: 拆分 app.js（行为不变）+ 浏览器预览

**Files:**
- Create: `renderer/shaders.js`、`renderer/parallax-scene.js`、`renderer/ui.js`、`renderer/weather.js`、`renderer/sticker.js`、`renderer/vinyl.js`、`renderer/video-overlay.js`、`renderer/main.js`
- Delete: `app.js`
- Modify: `index.html`（替换 `<script src="app.js">`；调试面板默认值 30 改成 20）
- Create: `.claude/launch.json`（已被 gitignore，本地用）

**Interfaces:**
- Produces（全局，按此顺序加载：shaders → ui → parallax-scene → weather → sticker → vinyl → video-overlay → main）：
  - `PARALLAX_VERTEX_SHADER`、`PARALLAX_FRAGMENT_SHADER`（shaders.js）
  - `UI.showLoading(msg)`、`UI.hideLoading()`、`UI.showToast(msg, ms = 2500)`、`UI.showError(msg)`
  - `Scene`（parallax-scene.js）：
    - `Scene.app: PIXI.Application`
    - `Scene.load(bgSource: string, depthSource: string | null) -> Promise<void>`：首次加载和换壁纸共用；`depthSource` 为 null 或加载失败时用灰色占位深度图；**销毁上一组纹理**。
    - `Scene.setParallax(mouseX, mouseY, strength, focus) -> void`：参数就是写进 `uMouse` 的值（已取反）。
    - `Scene.getCover() -> { scaleX, scaleY, offsetX, offsetY }`
    - `Scene.getDepthTexture() -> PIXI.Texture`
    - `Scene.getDepthImage() -> HTMLImageElement | HTMLCanvasElement`
    - `Scene.addLayer(displayObject) -> void`：加在背景之上。
  - 类名不变：`WeatherParticleManager`、`StickerManager`、`VinylPlayerManager`、`VideoOverlayManager`。
  - `renderer/main.js`：`CONFIG`、IPC 监听、`updateLoop`、`start()`。

- [ ] **Step 1: 按上面的文件把 `app.js` 的代码原样搬过去。** 只做三件事：把初始化 / 重载合并成 `Scene.load`（换壁纸时 `destroy(true)` 旧纹理）；`isElectron` 在 `main.js` 顶部定义；删掉死代码（`saveConfigToMain`、`originalBindEvents`、`loadImageFromDataURL`）和过时的 DisplacementFilter 注释。`init()` 里"读配置 → 决定背景 / 深度来源 → 兜底到 `background.png`"的逻辑放在 `main.js` 的 `resolveInitialSources() -> Promise<{ bg: string, depth: string | null }>`。`getUserDataPath` 那条走不通的兜底删掉。
- [ ] **Step 2: 写 `.claude/launch.json`。** 配置 `name: "browser-preview"`、`runtimeExecutable: "venv/Scripts/python.exe"`、`runtimeArgs: ["-m", "http.server", "8765"]`、`port: 8765`。
- [ ] **Step 3: 浏览器验证。** `preview_start` 启动 `browser-preview`，打开 `http://localhost:8765/index.html`。预期：背景图显示；移动鼠标有视差；控制台无报错。
- [ ] **Step 4: Electron 验证。** `npm run dev` 运行约 20 秒，预期：渲染进程日志出现 `[App] 已通知主进程渲染就绪`，没有 `ReferenceError`。
- [ ] **Step 5: 提交。** `git add -A renderer index.html && git rm app.js && git commit -m "refactor: 拆分 app.js 到 renderer/，换壁纸时释放旧纹理"`

---

### Task 2: 视差数学共享模块

**Files:**
- Create: `shared/parallax-math.js`、`test/parallax-math.test.js`
- Modify: `package.json`（`"test": "node --test \"test/*.test.js\""`）、`renderer/shaders.js`、`renderer/parallax-scene.js`、`index.html`（在 shaders.js 之前加载 `shared/parallax-math.js`）

**Interfaces:**
- Produces（`Shared.parallax`）：
  - `coverTransform(screenW, screenH, imgW, imgH) -> { scaleX, scaleY, offsetX, offsetY }`（与现在 `updateCoverUniforms` 的算法一致）
  - `strengthFromMultiplier(m) -> number`：`m / 1000 * 1.25`
  - `parallaxUV(mouseX, mouseY, depth, focus, strength) -> [number, number]`：`mouse * (depth - focus) * strength`，再做软截断（`maxDist = max(0.035, strength * 1.6)`；超出时 `p / len * (maxDist + (len - maxDist) * 0.2)`）
  - `elementScreenShift(mouseX, mouseY, depth, focus, strength, cover) -> [dx, dy]`：屏幕归一化位移 = `-parallaxUV(...) / [cover.scaleX, cover.scaleY]`
  - `screenToImageUV(u, v, cover) -> [number, number]`
- Produces（`renderer/shaders.js`）：`PARALLAX_GLSL`，一个 GLSL 字符串，定义 `vec2 parallaxUV(vec2 mouse, float depth, float focus, float strength)`，背景片元着色器改为拼接它。

- [ ] **Step 1: 写失败测试 `test/parallax-math.test.js`。**
  ```js
  test('cover：同比例无裁切', () => deepEqual(coverTransform(1920,1080,1920,1080), {scaleX:1,scaleY:1,offsetX:0,offsetY:0}));
  test('cover：超宽屏上下裁切', () => { const c = coverTransform(2560,1080,1920,1080); approx(c.scaleY, 0.75); approx(c.offsetY, 0.125); equal(c.scaleX, 1); });
  test('parallaxUV：普通位移', () => approxArr(parallaxUV(1,0,0.8,0.5,0.025), [0.0075, 0]));
  test('parallaxUV：软截断', () => approxArr(parallaxUV(3,0,1,0,0.025), [0.047, 0]));
  test('焦平面不动', () => approxArr(parallaxUV(1,1,0.5,0.5,0.05), [0,0]));
  test('elementScreenShift 按 cover 换算且取反', () => approxArr(elementScreenShift(1,0,0.8,0.5,0.025,{scaleX:0.5,scaleY:1,offsetX:0.25,offsetY:0}), [-0.015, 0]));
  test('分辨率无关：同比例不同分辨率结果相同', () => deepEqual(coverTransform(1920,1080,4000,3000), coverTransform(2560,1440,4000,3000)));
  ```
  （`approx` 用 1e-6 容差）
- [ ] **Step 2: `npm test` → FAIL（模块不存在）。**
- [ ] **Step 3: 实现 `shared/parallax-math.js`；`PARALLAX_GLSL` 写成和 JS 同一公式；`parallax-scene.js` 的 cover 计算和 `uStrength` 改为调用这个模块。**
- [ ] **Step 4: `npm test` → PASS；浏览器预览视差观感不变。**
- [ ] **Step 5: 提交。** `git commit -m "refactor: 视差公式抽成共享模块并加测试"`

---

### Task 3: 元素数据模型

**Files:**
- Create: `shared/elements-model.js`、`test/elements-model.test.js`

**Interfaces:**
- 类型（注释里写成 JSDoc typedef）：
  - `Asset = { id, name, type: 'image'|'animated'|'video', file, thumb: string|null, builtin: boolean, aspect?: number, defaults?: { width?, playback?, chroma? } }`。默认素材的 id 形如 `builtin:bomb1`，用户素材形如 `user:<uuid>`。
  - `Instance`：设计文档 §5.5 的结构；`playback = { mode: 'static'|'loop'|'interval', intervalSec, jitterSec }`，`chroma = { enabled, strength }`（strength 0~1）。
- Produces（`Shared.elements`）：
  - `LIMITS = { minWidth: 0.03, maxWidth: 1.5 }`、`DEFAULT_WIDTH = 0.25`
  - `emptyCustomElements() -> { library: [], instances: [] }`
  - `normalizeCustomElements(raw) -> { library, instances }`：不是对象或数组字段不合法时回退为空数组。
  - `defaultPlayback(asset) -> playback`
  - `createInstance(asset, id) -> Instance`
  - `clampWidth(w) -> number`
  - `sortForRender(instances) -> Instance[]`：深度升序（远的先画），同深度保持原顺序；返回新数组。
  - `resolveInstances(instances, assetsById: Map) -> { ok: Array<{instance, asset}>, broken: string[] }`：找不到素材的实例 id 进 `broken`。
  - `upsertInstance(ce, instance) -> ce`、`removeInstance(ce, instanceId) -> ce`
  - `patchInstance(ce, instanceId, patch) -> ce`：`transform` / `playback` / `chroma` 按字段合并；宽度夹紧；patch 里有 `depth` 时把 `depthAuto` 设为 false。
  - `removeAsset(ce, assetId) -> { ce, removedInstanceIds: string[] }`
  - `legacyStickerToInstance(sticker, screenW, screenH, imgAspect) -> { x, y, width, depth, opacity } | null`：`sticker.enabled` 为假或没有 `imagePath` 时返回 null。旧贴纸的 `positionX/Y` 是左上角百分比，`size` 是像素宽度。
  - 所有函数都不修改入参。

- [ ] **Step 1: 写失败测试。**
  ```js
  test('图片默认静止，动图和用户视频默认循环', ...)        // mode: static / loop / loop
  test('默认素材的播放配置优先', ...)                        // bomb defaults → interval 10/3
  test('createInstance 默认值', ...)                         // x .5 y .5 width .25 rotation 0 opacity 1 depthAuto true visible true effects {}
  test('createInstance 使用素材自带默认宽度', ...)           // defaults.width 0.2 → 0.2
  test('clampWidth 夹到 0.03~1.5', ...)                      // 0.001→0.03, 9→1.5
  test('sortForRender 远的在前、同深度保持顺序且不改原数组', ...)
  test('resolveInstances 找不到素材的进 broken', ...)        // broken: ['i2']
  test('patchInstance 改深度后 depthAuto=false，宽度被夹紧，chroma 只合并给出的字段', ...)
  test('removeAsset 级联删除实例', ...)                      // removedInstanceIds: ['i1','i3']
  test('normalizeCustomElements 处理 null / instances 不是数组', ...)
  test('legacyStickerToInstance 换算', () => deepEqual(
      legacyStickerToInstance({enabled:true,imagePath:'a.png',positionX:85,positionY:20,size:192,opacity:0.9,depth:0.7}, 1920,1080, 1),
      {x:0.9, y:0.2888889, width:0.1, depth:0.7, opacity:0.9}))   // y 用近似比较
  test('legacyStickerToInstance 未启用返回 null', ...)
  ```
- [ ] **Step 2: `npm test` → FAIL。**
- [ ] **Step 3: 实现 `shared/elements-model.js`。** 实例 id 由调用方传入；本模块不生成 id。
- [ ] **Step 4: `npm test` → PASS。**
- [ ] **Step 5: 提交。** `git commit -m "feat: 自定义元素数据模型"`

---

### Task 4: 播放调度与动图取帧

**Files:**
- Create: `shared/playback.js`、`test/playback.test.js`

**Interfaces:**
- Produces（`Shared.playback`）：
  - `pickFrame(durationsMs: number[], elapsedMs: number) -> number`：循环播放时第几帧；时长为 0 或负数的帧按 100ms 算。
  - `class IntervalScheduler(constructor({ intervalSec, jitterSec }, rng = Math.random))`
    - `tick(nowMs, ended: boolean) -> 'start' | 'hide' | null`：第一次 tick 立即返回 `'start'`；播放中 `ended` 为真时返回 `'hide'` 并排定下一次 = `now + max(1, intervalSec + (rng()*2-1)*jitterSec) * 1000`；到点返回 `'start'`。
    - `pause(nowMs)`、`resume(nowMs)`：暂停期间不计时，待播时间整体顺延。
    - `get playing: boolean`

- [ ] **Step 1: 写失败测试。**
  ```js
  test('pickFrame 循环', () => { equal(pickFrame([100,100,100], 250), 2); equal(pickFrame([100,100,100], 310), 0); });
  test('pickFrame 0 时长按 100ms', () => equal(pickFrame([0,0], 150), 1));
  test('间隔播放时序（rng=0.5 无抖动）', () => {
      const s = new IntervalScheduler({intervalSec:10, jitterSec:3}, () => 0.5);
      equal(s.tick(0,false),'start'); equal(s.tick(5000,false),null); equal(s.tick(7000,true),'hide');
      equal(s.tick(16999,false),null); equal(s.tick(17000,false),'start'); });
  test('抖动边界', ...)            // hide@7000：rng=0 → start@14000；rng=1 → start@20000
  test('最少等 1 秒', ...)         // intervalSec 0.2 jitter 0 → 1000ms
  test('暂停顺延', ...)            // hide@7000，pause@10000，resume@20000 → start@27000
  ```
- [ ] **Step 2: `npm test` → FAIL。**
- [ ] **Step 3: 实现 `shared/playback.js`。**
- [ ] **Step 4: `npm test` → PASS。**
- [ ] **Step 5: 提交。** `git commit -m "feat: 元素间隔播放调度与动图取帧"`

---

### Task 5: 摆放几何

**Files:**
- Create: `shared/placement-math.js`、`test/placement-math.test.js`

**Interfaces:**
- Consumes：`Shared.elements.clampWidth`（Node 端 `require('./elements-model')`，浏览器端读 `Shared.elements`）
- Produces（`Shared.placement`）：
  - `rectFromTransform(transform, assetAspect, screenW, screenH) -> { left, top, width, height }`（像素）
  - `moveTransform(transform, dxPx, dyPx, screenW, screenH) -> transform`：中心点夹在 0~1。
  - `resizeFromCorner(transform, corner: 'nw'|'ne'|'sw'|'se', pointerX, pointerY, assetAspect, screenW, screenH) -> transform`：对角固定、等比缩放；宽度取"指针到对角的水平距离"与"垂直距离 × 宽高比"中较大者，再夹紧到 0.03~1.5。
  - `bottomCenter(transform, assetAspect, screenW, screenH) -> [u, v]`（屏幕归一化）
  - `sampleGray(data: Uint8ClampedArray, w, h, u, v) -> number`：RGBA 数据取 R 通道最近邻，返回 0~1；u / v 越界时夹紧。

- [ ] **Step 1: 写失败测试。**
  ```js
  test('rect 换分辨率等比', () => { const t={x:.5,y:.5,width:.25,rotation:0};
      deepEqual(rectFromTransform(t,2,1920,1080), {left:720,top:420,width:480,height:240});
      deepEqual(rectFromTransform(t,2,2560,1440), {left:960,top:560,width:640,height:320}); });
  test('move 夹紧', ...)                  // 拖出屏幕后 x === 1
  test('se 角缩放保持 nw 角不动', ...)     // 新 rect.left/top 与原来相同
  test('缩放夹紧到 3%~150%', ...)
  test('bottomCenter', () => deepEqual(bottomCenter({x:.5,y:.5,width:.25},2,1920,1080), [0.5, 0.6111111]))  // 近似比较
  test('sampleGray 取 R 并夹紧', ...)
  ```
- [ ] **Step 2: `npm test` → FAIL。**
- [ ] **Step 3: 实现 `shared/placement-math.js`。**
- [ ] **Step 4: `npm test` → PASS。**
- [ ] **Step 5: 提交。** `git commit -m "feat: 元素摆放几何计算"`

---

### Task 6: 素材库与配置存储

**Files:**
- Create: `src/elements/library.js`、`test/library.test.js`、`test/store.test.js`
- Modify: `src/store.js`

**Interfaces:**
- Consumes：`Shared.elements`（`require('../../shared/elements-model')`）
- Produces（`src/elements/library.js`，CommonJS）：
  - `IMPORT_EXTENSIONS: string[]`（png jpg jpeg webp bmp gif apng mp4 webm mov mkv m4v，用于对话框过滤）
  - `detectAssetType(filePath) -> 'image'|'animated'|'video'|null`：按扩展名判断，webp / png 再读文件头：webp 的 VP8X 动画标志位（第 20 字节 `& 0x02`）→ animated；png 在 `IDAT` 之前出现 `acTL` → animated；gif 一律 animated。
  - `loadBuiltinAssets(elementsDir) -> Asset[]`：读 `manifest.json`；文件缺失的条目跳过并 `console.warn`；`file` / `thumb` 转成绝对路径。
  - `importUserAsset(srcPath, libraryDir, id) -> Asset`：`id` 形如 `user:<uuid>`。复制为 `libraryDir/<uuid><小写扩展名>`（文件名去掉 `user:` 前缀，Windows 文件名不能含冒号）；`name` 取原文件名（去扩展名）；不支持的类型抛 `Error('UNSUPPORTED_FILE')`。
  - `removeUserAssetFiles(asset) -> void`：删除副本和缩略图，文件不存在时忽略。
  - `saveThumbnail(libraryDir, assetId, dataUrl) -> string`：写 `<uuid>_thumb.jpg`，返回路径。
  - `toFileUrl(absPath) -> string`：`url.pathToFileURL(absPath).href`
- Produces（`src/store.js`）：
  - `new AppStore({ userDataPath } = {})`：不传时用 `app.getPath('userData')`。
  - 默认配置去掉 `sticker`，加 `customElements: { library: [], instances: [] }`；`getConfig()` 对它走 `normalizeCustomElements`；`saveConfig({ customElements })` 时 `library` / `instances` **整体替换**。
  - `deleteConfigKeys(keys: string[]) -> void`
  - `getElementsDir() -> string`：`userData/custom_elements`，不存在就创建。

- [ ] **Step 1: 写失败测试 `test/library.test.js`**（用 `fs.mkdtempSync` 建临时目录；webp / png 头用测试里手工拼出的字节）
  ```js
  test('按扩展名识别图片和视频（大小写不敏感）', ...)    // 'A.PNG' → image，'b.MP4' → video，'c.txt' → null
  test('动态 webp 和 apng 识别为 animated', ...)
  test('导入含中文、空格、#、% 的文件', () => {
      const src = write(tmp, '猫 #1 100%.PNG', pngBytes);
      const a = importUserAsset(src, libDir, 'user:abc');
      equal(a.type, 'image'); equal(a.name, '猫 #1 100%'); ok(fs.existsSync(a.file)); ok(a.file.endsWith('.png'));
      const u = toFileUrl(a.file); ok(!u.includes('#')); equal(url.fileURLToPath(u), a.file); });
  test('导入不支持的文件抛 UNSUPPORTED_FILE', ...)
  test('loadBuiltinAssets 跳过缺文件的条目', ...)
  test('removeUserAssetFiles 文件已不存在也不报错', ...)
  ```
- [ ] **Step 2: 写失败测试 `test/store.test.js`**
  ```js
  test('没有 customElements 的旧配置读出空结构', ...)
  test('instances 不是数组时回退为空数组', ...)
  test('saveConfig 整体替换 instances', ...)
  test('deleteConfigKeys 删除 sticker 后读不到', ...)
  ```
- [ ] **Step 3: `npm test` → FAIL。**
- [ ] **Step 4: 实现 `library.js`，修改 `store.js`。**
- [ ] **Step 5: `npm test` → PASS。**
- [ ] **Step 6: 提交。** `git commit -m "feat: 自定义元素素材库与配置存储"`

---

### Task 7: 默认素材（裁剪两个爆炸）

**Files:**
- Create: `tools/prepare_builtin_element.py`、`tools/test_prepare_builtin_element.py`、`elements/manifest.json`、`elements/bomb1_cut.mp4`、`elements/bomb2_cut.mp4`、`elements/bomb1_thumb.jpg`、`elements/bomb2_thumb.jpg`
- Modify: `test/library.test.js`（加一条读真实 manifest 的测试）

**Interfaces:**
- Produces：
  - `nongreen_bbox(frames: list[np.ndarray(H,W,3) uint8], green_threshold=0.15) -> (x0, y0, x1, y1)`：所有帧中 `G - max(R, B) < threshold`（按 0~1 计）像素的并集外框。
  - 命令行：`venv/Scripts/python.exe tools/prepare_builtin_element.py elements/bomb1.mp4 --id bomb1 --name "爆炸 1"`：每 5 帧取一帧算外框 → 四周外扩 4% → 宽高取偶数 → ffmpeg 裁剪，宽度超过 1024 时缩到 1024，30fps，`-an -movflags +faststart`，输出 `<id>_cut.mp4`；缩略图取 30% 时长处一帧，用 ffmpeg `chromakey` 抠掉绿色后叠在 `#2b2d38` 上，最长边 256，输出 `<id>_thumb.jpg`；同时打印可以直接放进 manifest 的 JSON 条目。
  - `elements/manifest.json`：
    ```json
    { "version": 1, "elements": [
      { "id": "bomb1", "name": "爆炸 1", "type": "video", "file": "bomb1_cut.mp4", "thumb": "bomb1_thumb.jpg",
        "aspect": <输出宽/高>, "width": 0.25,
        "playback": { "mode": "interval", "intervalSec": 10, "jitterSec": 3 },
        "chroma": { "enabled": true, "strength": 0.5 } },
      { "id": "bomb2", ... 同上 ... } ] }
    ```

- [ ] **Step 1: 写失败测试 `tools/test_prepare_builtin_element.py`**（unittest）：纯绿帧中间画一块红色方块 → 外框等于方块；两帧各有一块 → 外框为并集；全绿 → 抛 `ValueError`。
- [ ] **Step 2: `venv/Scripts/python.exe -m unittest tools/test_prepare_builtin_element.py` → FAIL。**
- [ ] **Step 3: 实现脚本。** ffmpeg 从 PATH 取（本机在 `E:\Program\ffmpeg\bin`）。
- [ ] **Step 4: 单测 PASS；对 bomb1、bomb2 各跑一次，写 `manifest.json`。** 用 `Read` 查看两张缩略图：爆炸完整、四周没有绿边。
- [ ] **Step 5: `test/library.test.js` 加"真实 manifest 能读出 2 个 video 素材且文件都存在"，`npm test` → PASS。**
- [ ] **Step 6: 提交。** `git commit -m "feat: 默认爆炸元素素材与预处理脚本"`

---

### Task 8: 摆放窗口控制器、IPC 与 preload

**Files:**
- Create: `src/elements/placement-controller.js`、`src/elements/ipc.js`、`test/placement-controller.test.js`
- Modify: `main.js`、`preload.js`

**Interfaces:**
- Consumes：Task 3 `Shared.elements`、Task 6 `library` / `store`
- Produces（`src/elements/placement-controller.js`）：
  ```
  class PlacementController {
    constructor({ createWindow: () => WinLike, onCommit: (instance) => void, onEnd: () => void })
    start(draft: { instance, asset, isNew }) -> boolean   // 已有会话时聚焦现有窗口并返回 false
    getDraft() -> draft | null
    commit(instance) -> boolean                            // 无会话时返回 false
    cancel() -> void
    get active -> boolean
  }
  ```
  `WinLike` 是一个 EventEmitter，带 `focus()`、`close()`、`isDestroyed()`、`webContents`（也是 EventEmitter）。窗口 `closed`、`webContents` 的 `render-process-gone`、窗口 `unresponsive` 都按取消处理。每个会话 `onEnd` 恰好调用一次。
- Produces（`src/elements/ipc.js`）：`registerElementsIpc({ ipcMain, dialog, store, elementsDir, getWallpaperWindow, getSettingsWindow, broadcastConfig, placement })`，注册：
  | 通道 | 参数 → 返回 |
  |---|---|
  | `elements:getBuiltin` | → `Asset[]` |
  | `elements:import` | → `{ asset } \| { canceled: true } \| { error: string }`（中文错误文案） |
  | `elements:removeAsset` | `assetId` → `boolean`（同时删副本和实例） |
  | `elements:saveThumb` | `assetId, dataUrl` → `string \| null` |
  | `elements:updateInstance` | `instanceId, patch` → `boolean` |
  | `elements:removeInstance` | `instanceId` → `boolean` |
  | `elements:startPlacement` | `{ assetId } \| { instanceId }` → `boolean` |
  | `placement:getDraft` | → `{ instance, asset } \| null` |
  | `placement:commit` | `instance` → `boolean` |
  | `placement:cancel` | → `void` |
  修改配置后都调用 `broadcastConfig()`。
- Produces（`main.js`）：`broadcastConfig()` 把 `store.getConfig()` 以 `config:load` 发给壁纸窗口**和**设置窗口（现有 `config:save` 也改用它）。`createPlacementWindow()`：主显示器 bounds、`frame:false`、`alwaysOnTop` 级别 `'screen-saver'`、`skipTaskbar`、`focusable:true`、`backgroundColor:'#000'`，加载 `index.html?mode=edit`。会话开始时向壁纸发 `renderer:pause`，`onEnd` 时发 `renderer:resume`。
- Produces（`preload.js`）：
  ```
  electronAPI.elements = { getBuiltin, importFile, removeAsset, saveThumb, updateInstance, removeInstance, startPlacement }
  electronAPI.placement = { getDraft, commit, cancel }
  electronAPI.toFileUrl(path) -> string     // 调 library.toFileUrl
  ```

- [ ] **Step 1: 写失败测试 `test/placement-controller.test.js`**（用 EventEmitter 做假窗口）
  ```js
  test('重复 start 只开一个窗口并聚焦已有窗口', ...)       // 第二次返回 false，createWindow 调用 1 次，focus 被调用
  test('commit 调 onCommit、关窗、onEnd 一次', ...)
  test('窗口被关掉视为取消', ...)                          // onCommit 未调用，onEnd 1 次
  test('渲染进程崩溃视为取消并关窗', ...)
  test('commit 之后再 cancel 不会重复 onEnd', ...)
  ```
- [ ] **Step 2: `npm test` → FAIL。**
- [ ] **Step 3: 实现控制器、`ipc.js`，接入 `main.js` / `preload.js`。** `startPlacement({ assetId })` 时用 `crypto.randomUUID()` 生成实例 id，调 `createInstance`；`{ instanceId }` 时复制现有实例，`isNew: false`。
- [ ] **Step 4: `npm test` → PASS；`npm run dev` 启动无报错。**
- [ ] **Step 5: 提交。** `git commit -m "feat: 自定义元素 IPC 与摆放窗口控制器"`

---

### Task 9: 渲染端 Host 与素材源

**Files:**
- Create: `renderer/host.js`、`renderer/elements/sources.js`、`dev/dev-config.json`
- Modify: `index.html`（按顺序加载 `shared/*.js`、`renderer/host.js`、`renderer/elements/sources.js`）

**Interfaces:**
- Produces（`window.Host`）：
  - `Host.isElectron: boolean`、`Host.mode: 'wallpaper' | 'edit'`（读 `?mode=`）
  - `Host.getConfig() -> Promise<config>`、`Host.onConfig(cb) -> void`
  - `Host.getBuiltinAssets() -> Promise<Asset[]>`
  - `Host.fileUrl(path) -> string`、`Host.readBytes(path) -> Promise<Uint8Array>`
  - `Host.placement = { getDraft(), commit(instance), cancel() }`
  - 浏览器实现：配置读 `dev/dev-config.json`（字段：`customElements`，以及一个可选的 `draft: { instance, asset }`）；默认素材读 `elements/manifest.json`，路径拼成相对路径；`commit` / `cancel` 只 `console.info('[DevHost] ...')`，并把结果存到 `window.__lastPlacement`。
- Produces（`renderer/elements/sources.js`）：`createElementSource(asset) -> Promise<ElementSource>`，失败时 reject。
  ```
  ElementSource = {
    texture: PIXI.Texture, width, height, animated: boolean,
    play(), pause(), restart(), setLoop(bool), hasEnded() -> boolean,
    update(nowMs),          // 动图换帧；其他类型为空操作
    destroy()
  }
  ```
  - image：`PIXI.Texture.from(Host.fileUrl(file))`，等待加载完成。
  - animated：`Host.readBytes` → `new ImageDecoder({ data, type })` → 逐帧解码成 `ImageBitmap` 并记下时长，最多 **600** 帧（超出就截断并 `console.warn`）→ 画到一个 canvas 上，用 `Shared.playback.pickFrame` 换帧后 `texture.baseTexture.update()`。只有 1 帧时 `animated = false`。
  - video：隐藏的 `<video muted playsinline preload="auto">`，`src = Host.fileUrl(file)`；`PIXI.Texture.from(video, { resourceOptions: { autoPlay: false } })`；`hasEnded()` 读 `video.ended`。

- [ ] **Step 1: 实现 `host.js` 和 `sources.js`；`dev/dev-config.json` 放 3 个实例**：`builtin:bomb1`（interval）、一个用 `background2.png` 的静态图片素材、一个 GIF 素材。GIF 测试文件：用 ffmpeg 从 `elements/bomb2_cut.mp4` 转出 `dev/sample.gif`（2 秒，320 宽）。
- [ ] **Step 2: 浏览器验证。** 预览页控制台执行 `await createElementSource(asset)`，三种素材都能返回；GIF 的 `animated === true`；一个不存在的路径会 reject。
- [ ] **Step 3: 提交。** `git commit -m "feat: 渲染端 Host 抽象与元素素材源"`

---

### Task 10: 元素渲染层（视差 + 深度遮挡 + 抠像）

**Files:**
- Create: `renderer/elements/element-shader.js`、`renderer/elements/elements-layer.js`
- Modify: `renderer/shaders.js`（加 `ELEMENT_VERTEX_SHADER`、`ELEMENT_FRAGMENT_SHADER`）、`renderer/main.js`（创建图层、在 `updateLoop` 里驱动、暂停 / 恢复联动）、`index.html`。空闲降帧不在本计划内，留给 `PROJECT_NOTES.md` 阶段 3。

**Interfaces:**
- Consumes：`Scene`（Task 1）、`Shared.parallax`（Task 2）、`Shared.elements`（Task 3）、`Shared.playback`（Task 4）、`Shared.placement`（Task 5）、`Host` / `createElementSource`（Task 9）
- Produces：
  - `createElementShader(texture, depthTexture) -> PIXI.Shader`。uniforms：`uSampler`、`uDepth`、`uScreenSize`、`uCoverScale`、`uCoverOffset`、`uMouse`、`uStrength`、`uFocus`、`uElemDepth`、`uOpacity`、`uChromaEnabled`（0 / 1）、`uChromaStrength`。
  - `class ElementsLayer`：
    ```
    constructor(scene)
    setElements(customElements, builtinAssets) -> Promise<{ broken: string[] }>   // 按实例 id 复用 mesh，assetId 变了才重新加载素材
    setDraft(instance | null, asset | null) -> Promise<void>                        // 编辑模式用；同 id 的已保存实例会被草稿替代
    update(nowMs, mouseX, mouseY, strength, focus) -> void
    pause(nowMs) / resume(nowMs)
    getAssetAspect(instanceId) -> number
    ```
  - 每个实例是一个 `PIXI.Mesh`（单位方形 geometry，属性 `aVertexPosition` + `aUvs`），位置和缩放取 `rectFromTransform` 加上 `elementScreenShift(...) × 屏幕尺寸`；按 `sortForRender` 排序；`visible: false` 或间隔播放的空档期 `mesh.visible = false`。
- 片元着色器的遮挡与抠像（实现者无法从签名推出，照写）：
  ```glsl
  vec2 baseUV = vScreenUV * uCoverScale + uCoverOffset;
  float d0 = texture2D(uDepth, baseUV).r;
  vec2 shownUV = clamp(baseUV + parallaxUV(uMouse, d0, uFocus, uStrength), vec2(0.001), vec2(0.999));
  float sceneDepth = texture2D(uDepth, shownUV).r;          // 该像素实际显示内容的深度
  float vis = smoothstep(-0.03, 0.03, (uElemDepth + 0.02) - sceneDepth);
  vec4 c = texture2D(uSampler, vUvs);
  float k = 1.0;
  if (uChromaEnabled > 0.5) {
      float lo = mix(0.20, 0.02, uChromaStrength);
      float g = c.g - max(c.r, c.b);
      k = 1.0 - smoothstep(lo, lo + 0.10, g);
      c.g = min(c.g, max(c.r, c.b));                        // 去溢色
  }
  gl_FragColor = c * (k * vis * uOpacity);                  // 预乘 alpha 输出
  ```
  顶点着色器：`vScreenUV = (translationMatrix * vec3(aVertexPosition, 1.0)).xy / uScreenSize`。

- [ ] **Step 1: 实现 shader 和 `ElementsLayer`，接入 `renderer/main.js`。** 壁纸模式下 `setElements` 的数据来自 `Host.getConfig()` 和 `Host.onConfig`；`renderer:pause` / `resume` 同时暂停 / 恢复图层；每个实例的素材加载失败单独 catch，计入 `broken`，不影响其他实例。
- [ ] **Step 2: 浏览器验证（dev-config 的 3 个实例）。** 截图确认：
  - 爆炸绿色被抠掉，播完消失，约 10 秒后再出现。
  - 把鼠标移到屏幕两侧，元素和同深度的背景一起移动，没有相对漂移。
  - 把某个元素深度调到小于前景（改 dev-config 后刷新），前景会挡住元素，边缘柔和，没有错位。
  - GIF 在动。
- [ ] **Step 3: 损坏素材验证。** 在 dev-config 里加一个指向不存在文件的实例，刷新：其余元素正常，控制台有一条 warn，页面没有出现"初始化失败"。
- [ ] **Step 4: 提交。** `git commit -m "feat: 自定义元素渲染层（视差、深度遮挡、绿幕抠像）"`

---

### Task 11: 摆放编辑模式

**Files:**
- Create: `renderer/edit-mode.js`、`renderer/elements/depth-sampler.js`
- Modify: `index.html`（`#placement-ui` DOM）、`style.css`（摆放 UI 样式）、`renderer/main.js`（`Host.mode === 'edit'` 时走编辑模式）

**Interfaces:**
- Consumes：`ElementsLayer.setDraft` / `getAssetAspect`、`Shared.placement`、`Host.placement`、`Scene.getDepthImage` / `getCover`
- Produces：
  - `createDepthSampler(depthImage) -> { sample(u, v) -> number }`：缩到最长边 512 后取 `ImageData`，内部调 `sampleGray`；`u` / `v` 是图片 UV。
  - `startEditMode({ scene, layer, host }) -> Promise<void>`
  - DOM：`#placement-ui` > `#placement-hint`（文案："摆放模式 · 拖动移动，拖动角点缩放，Enter 确认，Esc 取消"）、`#placement-box` > `.handle[data-corner="nw|ne|sw|se"]`、`#placement-toolbar` > `#placement-depth`（range 0~100）、`#placement-confirm`（"✓ 确认"）、`#placement-cancel`（"✕ 取消"）。
- 行为：
  - 编辑模式不启动天气、唱片机、视频特效，不响应鼠标视差（`mouse` 固定为 0）。
  - 草稿实例 `depthAuto` 为真时，每次移动或缩放后 `depth = sampler.sample(...screenToImageUV(...bottomCenter(...)))`，并同步到滑块；手动拖滑块后 `depthAuto = false`。
  - Enter / 确认 → `host.placement.commit(instance)`；Esc / 取消 → `host.placement.cancel()`。
  - 工具条跟随虚线框；框靠近屏幕底部时，工具条放到框上方。

- [ ] **Step 1: 实现编辑模式。**
- [ ] **Step 2: 浏览器验证。** 打开 `http://localhost:8765/index.html?mode=edit`（dev-config 带 draft）：
  - 拖动：框跟手，元素实时移动。
  - 拖角点：对角固定、等比缩放；缩到最小、放到最大时都被夹住。
  - 把元素拖到前景物体后面：深度滑块自动变化，遮挡实时更新。
  - 手动拖滑块后再移动，深度不再变。
  - Enter 后 `window.__lastPlacement` 是新的 transform / depth；Esc 打出 cancel 日志。
- [ ] **Step 3: Electron 验证。** `npm run dev` 后，在 DevTools 控制台调用 `electronAPI.elements.startPlacement({ assetId: 'builtin:bomb1' })`。预期：全屏摆放窗口出现；Esc 后窗口关闭，壁纸恢复；再来一次后按 Enter，`config.json` 里多了一个实例，壁纸上出现这个元素。（这一步会盖住屏幕，先告诉用户。）
- [ ] **Step 4: 提交。** `git commit -m "feat: 自定义元素摆放编辑模式"`

---

### Task 12: 设置页"自定义元素"、移除贴纸、迁移旧配置

**Files:**
- Create: `settings/elements-tab.js`、`settings/thumbnail.js`
- Modify: `settings.html`（tab 按钮和面板、引入脚本、删除贴纸相关 HTML / JS）、`main.js`（删 `dialog:selectSticker`；启动时调 `migrateLegacySticker`）、`preload.js`（删 `selectSticker`）、`index.html`（删贴纸 DOM 和 `renderer/sticker.js` 引用）、`renderer/main.js`（删 `StickerManager` 相关调用）
- Delete: `renderer/sticker.js`

**Interfaces:**
- Consumes：`electronAPI.elements.*`、`electronAPI.getConfig`、`electronAPI.onLoadConfig`、`electronAPI.fileExists`、`electronAPI.toFileUrl`（Task 8）；`Shared.elements.legacyStickerToInstance`（Task 3）
- Produces：
  - `makeThumbnail(fileUrl, type) -> Promise<string>`：JPEG data URL，最长边 256。图片直接缩放；GIF 用 `<img>` 取第一帧；视频跳到 `min(0.5, duration / 2)` 秒取帧。
  - `initElementsTab({ api, setStatus }) -> void`，面板 id `tab-elements`，tab 按钮文案"🧩 自定义元素"，内容：
    1. `#btn-import-element`："＋ 添加自定义元素（图片 / GIF / 视频）"。导入成功后生成缩略图并 `saveThumb`。`makeThumbnail` 失败说明这个文件 Chromium 读不了（例如 mkv 的编码不支持）：立即 `removeAsset`，并提示"无法读取这个文件（格式不支持或文件已损坏）"。
    2. `#elements-builtin-grid`（标题"默认元素"）、`#elements-user-grid`（标题"我添加的"）：格子里是缩略图、名称、类型标签（图片 / GIF / 视频）；点击 → `startPlacement({ assetId })`。用户素材的格子带"移除"按钮；如果壁纸上有它的实例，先 `confirm('壁纸上有 N 个这个元素，会一起删除，确定吗？')`。文件丢失（`fileExists` 为假）时格子标红，提示"文件丢失"。
    3. `#elements-instance-list`（标题"壁纸上的元素"）：每行显示缩略图、名称、播放方式摘要、显示 / 隐藏开关、"重新摆放"、"删除"；展开后有深度（0~100）、不透明度（10~100）、播放方式（静态图片只有"静止"；其他类型"循环 / 间隔播放"）、播放间隔（1~120 秒，仅间隔播放时显示）、绿幕抠像开关和强度（0~100，仅视频 / 动图）。滑块改动 150ms 防抖后调 `updateInstance`。
    4. 收到 `onLoadConfig` 时整体重绘列表。
  - `migrateLegacySticker({ store, elementsDir, screenSize, getImageAspect })`（`main.js` 或 `src/elements/ipc.js`）：旧 `sticker.enabled` 为真且图片存在时导入素材库、生成实例，然后 `deleteConfigKeys(['sticker'])`；没有可迁移的贴纸也删掉这个键。

- [ ] **Step 1: 实现 tab、缩略图、迁移；删除所有贴纸代码。** 删完后 `grep -ri sticker` 只应剩迁移函数和 `legacyStickerToInstance`。
- [ ] **Step 2: Electron 验证。** 在 `config.json` 里手工写一份旧 `sticker`（enabled，指向 `background2.png`），然后 `npm run dev`：
  - 设置页里贴纸 tab 消失，"自定义元素"里出现一个由旧贴纸迁移来的实例，`config.json` 里已经没有 `sticker`。
  - 导入一个中文名 + 空格 + `#` 的 png、一个 gif、一个 mp4：缩略图都正常；mp4 的抠像默认关闭。
  - 同一个素材点两次，"壁纸上的元素"里出现两行，可以分别调整。
  - 把 `custom_elements` 里某个副本删掉，重开设置页：对应格子标红，壁纸上其他元素正常。
  - 移除一个有实例的用户素材：先弹确认框，确认后实例一起消失。
- [ ] **Step 3: `npm test` → PASS。**
- [ ] **Step 4: 提交。** `git commit -m "feat: 设置页自定义元素 tab，移除旧贴纸并迁移配置"`

---

### Task 13: 端到端验收与文档

**Files:**
- Modify: `PROJECT_NOTES.md`（§3 文件地图、§5 IPC、§6 配置、§7 完成度、§9 阶段 2 打勾）、`README.md`（改写为 Electron + ONNX + 自定义元素的真实架构，删掉 Lively / Wallpaper Engine / DisplacementFilter 等过时内容）

- [ ] **Step 1: 逐条对照设计文档 §7 的 10 条完成标准。** 能自动或在浏览器里确认的自己确认；需要看真实桌面的（第 3、6、7、9 条）列成清单请用户肉眼确认，附上要看的现象。
- [ ] **Step 2: 全屏暂停。** `npm run dev` 后开一个全屏视频或游戏，日志出现 `Fullscreen app detected`；退出全屏后元素视频继续播放。
- [ ] **Step 3: 更新 `PROJECT_NOTES.md` 和 `README.md`。**
- [ ] **Step 4: 提交。** `git commit -m "docs: 更新项目笔记与 README"`
