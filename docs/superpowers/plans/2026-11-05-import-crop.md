# 导入时裁剪 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 导入图片壁纸、视频壁纸和解锁视频时可以手动裁剪，裁掉的部分在任何时候都不会出现在桌面上。

**Architecture:** 裁剪只记一个相对原图的区域 `{ x, y, w, h }`，不生成新文件。纯逻辑放 `shared/crop.js` 和 `shared/parallax-math.js`；壁纸在着色器里按区域做 Cover 映射并把取色限制在区域内；解锁视频用 CSS `object-view-box`。裁剪框是设置窗口里的 `<dialog>`，三个入口共用。

**Tech Stack:** Electron 28（Chromium 120）、Pixi.js 7.4.2、原生 WebGL（设置页预览）、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-05-import-crop-design.md`

## Global Constraints

- 没有裁剪时，所有函数的结果和现在完全一样：默认壁纸、老用户的现有壁纸不受影响。
- 所有 `crop` 字段没有值时不写这个键（`resolveCurrent`、`currentVideo`、`resolvePlayback`、条目），现有的 `deepEqual` 测试不用改。`unlockAnimation.crop` 例外，默认值是 `null`。
- `currentImage` 必须保持字符串。
- 用户提到提交之前不提交，全部做完后再问。
- 代码注释用中文。改 `PROJECT_NOTES.md` 要同步 `PROJECT_NOTES.en.md`，改 `README.md` 同步 `README.en.md`。
- 改完 `renderer/shaders.js` 不用同步安卓版：只加了裁剪限制，视差算法没变。

## Review Focus

1. 配置被手改、或者数值是 `NaN`、负数、超过 1：读成没有裁剪或收回范围内，不能让画面黑掉。
2. 换了显示器、屏幕比例和存的裁剪不一样：框打开时在原来的范围内收成新比例；壁纸照常显示，不超出原来的范围。
3. 竖图放到横屏、横图放到竖屏：默认框正确，比例文字也对。
4. 同一个文件重新导入：框打开时带着原来的裁剪；点确定换成新的；点取消列表不变。
5. 旧版本换过图片后 `currentImageCrop` 对不上 `currentImage`：不用这个裁剪。

---

### Task 1: 裁剪纯逻辑 `shared/crop.js`

**Files:**
- Create: `shared/crop.js`（UMD，挂在 `Shared.crop`）
- Test: `test/crop.test.js`

**Interfaces:**
- Produces:
  - `normalizeCrop(value) → {x,y,w,h}|null`：有一个值不是有限数、或者收回 0~1 后宽高小于 `0.01` 时返回 `null`
  - `ratioInImage(imgW, imgH, screenW, screenH) → number`：框在图片 UV 里的宽高比 = 屏幕比例 ÷ 图片比例
  - `defaultCrop(imgW, imgH, screenW, screenH) → crop`
  - `moveCrop(crop, dx, dy) → crop`
  - `resizeCrop(start, corner, dx, dy, ratio) → crop`：`corner` 是 `'nw'|'ne'|'se'|'sw'`，对角固定，比例不变，宽高都不小于 `MIN_SIDE = 0.1`（图片本身放不下时取放得下的最大值）
  - `fitCropToRatio(crop, ratio) → crop`：中心不变，在原范围内收成新比例
  - `ratioLabel(screenW, screenH) → string`：匹配 `16:9 16:10 21:9 32:9 4:3 3:2 5:4 5:3`（误差 2.5%），竖屏把两个数对调，匹配不上写 `1.60:1`
  - `isLowRes(crop, imgW, imgH, screenPxW, screenPxH) → boolean`：裁剪后的像素宽或高比屏幕小 1% 以上
  - `viewBoxInset(crop) → string`：`inset(上% 右% 下% 左%)`
  - `formatQuery(crop) → 'x,y,w,h'`、`parseQuery(text) → crop|null`

- [ ] **Step 1:** 写测试，覆盖：`normalizeCrop` 对 `null`、`NaN`、负数、超过 1、宽度 0；`defaultCrop(1920,1280,1600,1000)` 是 `{x:0, y:1/32, w:1, h:15/16}`；竖图 `defaultCrop(1000,2000,1600,1000)` 宽 1、高 0.3125 且上下居中；`moveCrop` 拖出边界时贴边；`resizeCrop` 四个角都保持对角不动、比例不变、不超出图片、不小于最小值，只上下拖也能缩放；`fitCropToRatio` 结果在原范围内；`ratioLabel(1707,1067)` 是 `16:10`，`(1080,1920)` 是 `9:16`，`(1000,900)` 是 `1.11:1`；`isLowRes`；`parseQuery(formatQuery(c))` 等于 `c`，`parseQuery('a,b')` 是 `null`。
- [ ] **Step 2:** `node --test test/crop.test.js`，应该失败（模块不存在）。
- [ ] **Step 3:** 实现 `shared/crop.js`。
- [ ] **Step 4:** 再跑，全过。

### Task 2: 视差数学

**Files:**
- Modify: `shared/parallax-math.js`
- Test: `test/parallax-math.test.js`

**Interfaces:**
- Produces（都在 `Shared.parallax`）：
  - `cropCover(screenW, screenH, imgW, imgH, crop) → cover`：`crop` 为空时等于 `coverTransform`；否则 `coverTransform(screenW, screenH, imgW*crop.w, imgH*crop.h)` 再按 `crop` 换算回图片 UV
  - `cropZoom(screenW, screenH, imgW, imgH, crop) → number`：`cropCover.scaleX / coverTransform.scaleX`，强度乘它
  - `cropBounds(crop) → [minX, minY, maxX, maxY]`：`crop` 为空时 `[0.001, 0.001, 0.999, 0.999]`，否则向内缩区域尺寸的 0.1%
  - `panCover(cover, maxShift, crop = null)`：`room` 改成按区域宽高算（`w - 2*maxShift`、`h - 2*maxShift`），不传 `crop` 时结果不变

- [ ] **Step 1:** 写测试：没有裁剪时 `cropCover` 和 `coverTransform` 相等、`cropZoom` 是 1；屏幕四角经 `screenToImageUV` 都落在区域内；区域比例和屏幕不同时也不超出；`cropZoom` 下位移在屏幕上和不裁时一样（`elementScreenShift` 对比）；整体平移时鼠标在四个角、屏幕四角取到的 UV 都在区域内；`cropBounds` 两种情况。
- [ ] **Step 2:** 跑，失败。
- [ ] **Step 3:** 实现。
- [ ] **Step 4:** 跑，全过。

### Task 3: 配置、当前壁纸、IPC

**Files:**
- Modify: `shared/my-wallpapers.js`、`src/store.js`、`main.js`、`preload.js`
- Test: `test/my-wallpapers.test.js`、`test/store.test.js`

**Interfaces:**
- Consumes: `normalizeCrop`（UMD 依赖写法照 `shared/placement-math.js`）。
- Produces:
  - 条目带 `crop`；`addEntry(list, {path,type,thumb,duration,crop}, now)`；`updateEntry` 的 `patch.crop`（`null` 清掉）
  - `withCrop(descriptor, config) → descriptor`：按路径从列表取 `crop`，列表里没有时看当前壁纸，都没有就去掉 `crop` 键
  - `resolveCurrent` 返回值带 `crop`；`applyPartial` 写 `currentVideo.crop` / `currentImageCrop: {path,x,y,w,h}|null`
  - `store.saveWallpaperThumb(filePath, dataUrl, suffix = '')`：文件名 `thumb_<hash><suffix>.jpg`
  - `api.getScreenInfo() → {width, height, scaleFactor}`（`app:getScreenInfo`）
  - `api.myWallpapers.add({..., crop})`、`api.myWallpapers.setCrop(filePath, crop, thumbDataUrl) → entry`（`myWallpapers:setCrop`）

- [ ] **Step 1:** 写测试：`normalizeList` 保留合法 `crop`、丢掉坏的；`addEntry` 已有条目给了新 `crop` 就换、没给就留；`updateEntry` 改和清；`withCrop` 三种情况；`resolveCurrent` 视频和图片都带 `crop`、`currentImageCrop.path` 对不上时不带（Review Focus 5）；`applyPartial` 两种写法；`saveWallpaperThumb` 带后缀时是另一个文件。
- [ ] **Step 2:** 跑，失败。
- [ ] **Step 3:** 实现 `shared/my-wallpapers.js`、`store.saveWallpaperThumb`。
- [ ] **Step 4:** 改 `main.js`：`applyWallpaper` 用 `withCrop`；`myWallpapers:add` 带 `crop`；加 `myWallpapers:setCrop` 和 `app:getScreenInfo`。`add` 和 `setCrop` 换缩略图时用 `_<时间戳>` 后缀并删掉旧文件（地址不变的话浏览器会一直显示旧缩略图）。改 `preload.js`。
- [ ] **Step 5:** `npm test`，全过。

### Task 4: 壁纸渲染

**Files:**
- Modify: `renderer/shaders.js`、`renderer/parallax-scene.js`、`renderer/main.js`、`renderer/elements/element-shader.js`、`renderer/elements/elements-layer.js`、`index.html`

**Interfaces:**
- Consumes: `cropCover`、`cropZoom`、`cropBounds`、`panCover`、`resolveCurrent` 的 `crop`。
- Produces: `Scene.load(bg, depth, crop = null)`；`Scene.loadVideo(video, {motion, depthSource, crop})`；`Scene.getCropZoom()`；`Scene.getCropBounds()`。

- [ ] **Step 1:** 背景和元素着色器加 `uniform vec2 uCropMin; uniform vec2 uCropMax;`，`clamp` 改用它们。滤镜和元素 shader 的默认值 `[0.001, 0.001]`、`[0.999, 0.999]`。
- [ ] **Step 2:** `parallax-scene.js`：`applySources` 记下 `crop`，`updateCover` 改用 `cropCover`、`panCover(cover, panStrength, crop)`，写裁剪 uniform，算出 `cropZoom`。
- [ ] **Step 3:** `renderer/main.js`：`updateLoop` 的强度乘 `Scene.getCropZoom()`；`showImageWallpaper(path, depth, crop)`；`showVideoWallpaper` 传 `crop`；`resolveInitialSources` 和 `onShowWallpaper` 带上 `crop`。
- [ ] **Step 4:** `elements-layer.js` 每帧写 `uCropMin` / `uCropMax`。`index.html` 在 `my-wallpapers.js` 前加 `shared/crop.js`。
- [ ] **Step 5:** `npm test` 全过，浏览器预览模式（`venv/Scripts/python.exe -m http.server 8765`）能出图、控制台没有着色器错误。

### Task 5: 解锁视频

**Files:**
- Modify: `shared/unlock-animation.js`、`src/unlock-animation/files.js`、`src/unlock-animation/ipc.js`、`src/unlock-animation/player-window.js`、`renderer/unlock-player.html`、`renderer/unlock-player.js`、`preload.js`
- Test: `test/unlock-animation.test.js`、`test/unlock-files.test.js`、`test/unlock-ipc.test.js`、`test/unlock-player-window.test.js`、`test/unlock-player-page.test.js`

**Interfaces:**
- Consumes: `normalizeCrop`、`formatQuery`、`parseQuery`、`viewBoxInset`。
- Produces: `unlockAnimation.crop`；`resolvePlayback` 带 `crop`；`unlock:setVideo` 带 `crop`；`unlock:setCrop({crop, thumbDataUrl}) → {config}|{error}`；`unlock:getInfo` 多返回 `videoUrl`；`api.unlockAnimation.setCrop`。

- [ ] **Step 1:** 写测试：`normalizeConfig` 读 `crop`、坏值读成 `null`；`resolvePlayback` 有裁剪时带上、没有时不带键；`setVideo` 存 `crop`、换视频时不带 `crop` 就清掉；`setCrop` 换缩略图并删旧文件、没有视频时返回 `error`；`getInfo` 的 `videoUrl`；播放窗口有裁剪时 `query.crop` 是 `x,y,w,h`、没有时没有这个键；播放页收到 `crop` 时 `video.style.objectViewBox` 是 `inset(...)`。
- [ ] **Step 2:** 跑，失败。
- [ ] **Step 3:** 实现。`unlock-player.html` 在 `unlock-animation.js` 前加 `../shared/crop.js`。
- [ ] **Step 4:** `npm test`，全过。

### Task 6: 裁剪框和缩略图

**Files:**
- Create: `settings/crop-dialog.js`
- Modify: `settings.html`、`settings/settings.css`、`settings/thumbnail.js`、`ui/icons.js`、`settings/main.js`

**Interfaces:**
- Consumes: `Shared.crop`、`api.getScreenInfo`。
- Produces:
  - `initCropDialog({ api }) → { open({ type: 'image'|'video', url, name, crop }) → Promise<crop|null> }`：`null` 是取消；打不开时 reject
  - `makeThumbnailInfo(fileUrl, type, crop = null)`：只画区域

- [ ] **Step 1:** `settings.html` 加 `<dialog class="confirm crop-dialog" id="crop-dialog">`：标题、文件名、舞台、视频时间滑块、比例提示、模糊提示、"恢复默认"、"取消"、"确定"。`shared/crop.js` 放在 `my-wallpapers.js` 前，`settings/crop-dialog.js` 放在页面脚本前。
- [ ] **Step 2:** 实现 `settings/crop-dialog.js`：图片用 `<img>`，视频用静音的 `<video>`（默认停在时长 30% 处，滑块改 `currentTime`，15 秒读不出来 reject，关闭时释放）。舞台按素材比例和窗口大小算出像素尺寸，窗口变化时重算。拖动用 pointer 事件和 `moveCrop` / `resizeCrop`。框外用大 `box-shadow` 压暗。`cancel` 事件（Esc）算取消，焦点默认在"确定"上。
- [ ] **Step 3:** `settings/settings.css` 写样式，要放得进默认 960 宽的窗口。`ui/icons.js` 加 Lucide 的 `crop` 图标。
- [ ] **Step 4:** `makeThumbnailInfo` 加 `crop`。`settings/main.js` 建好裁剪框传给壁纸页和解锁页。

### Task 7: 三个入口和预览

**Files:**
- Modify: `settings/wallpaper-page.js`、`settings/my-wallpapers-panel.js`、`settings/depth-preview.js`、`settings/unlock-page.js`、`settings/settings.css`、`settings.html`

**Interfaces:**
- Consumes: Task 3、5、6 的全部接口。
- Produces: `preview.setCrop(crop)`；`showImage` / `showVideo` 的 `info.crop`；`initMyWallpapersPanel` 的 `onCrop(entry)`。

- [ ] **Step 1:** `depth-preview.js`：着色器加裁剪 uniform；`draw` 用 `cropCover`、`cropZoom`、`panCover(…, crop)`、`cropBounds`。
- [ ] **Step 2:** `my-wallpapers-panel.js`：× 旁边加裁剪按钮（`span[role=button]`），文件找不到时不加，`busy` 时不显示；"使用中"往左多让一格；`fillThumb` 带 `entry.crop`。
- [ ] **Step 3:** `wallpaper-page.js`：`pickFromComputer` 在确认能读之后弹框，取消就返回，框的初始值用已有条目的 `crop`，缩略图用裁好的；`selectEntry` / `selectImagePath` / `selectVideo` 把 `crop` 传给预览；新增 `recropEntry(entry)`：确定后 `setCrop`，选中的话 `preview.setCrop`，是当前壁纸的话再走一次 `api.applyWallpaper(current)`。
- [ ] **Step 4:** `unlock-page.js`：选视频时弹框；`settings.html` 加 `btn-unlock-crop`（"重新裁剪"），没有视频或文件不在时禁用，用 `getInfo` 的 `videoUrl`。

### Task 8: 实测和文档

**Files:**
- Modify: `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`、`README.md`、`README.en.md`

- [ ] **Step 1:** 用单独的 `--user-data-dir` 启动真实应用，不动真实配置，按 spec 的"验证"一节逐条实测。特别确认 `object-view-box` 对 `<video>` 有效，不行就换成外层容器定位放大。
- [ ] **Step 2:** 更新文档：文件地图、4.x 流程、IPC 表、配置结构、功能表、已知限制、§9 新阶段（写清楚实测了什么、没实测什么）。
- [ ] **Step 3:** `npm test` 全过，报告结果，问用户要不要提交。
