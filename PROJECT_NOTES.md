# 互动3D壁纸 — 项目现状梳理 & 开发计划

> 整理日期：2026-10-25
> 依据：读完当前工作区全部源码（含未提交改动）+ git 历史。
> 用途：后续开发的"地图"。改动代码后请顺手更新本文件。

**当前范围（2026-10-25 确认）**
- 只做**电脑端**。Android 版在 `C:\Users\24418\Desktop\2\Wallpaper3D phone`，暂不更新。
- 目前是自己开发、自己用，**暂不考虑打包**。打包相关问题移到 §9 的"暂缓"部分。
- 特效视频素材（`overlay/`、`elements/`）要进 git。

---

## 1. 一句话概括

Electron 桌面应用：用户选一张图片 → 调用本地 Python（Depth Anything V2，ONNX 优先）生成灰度深度图 → 渲染进程用 Pixi.js 自定义 2.5D 视差着色器全屏绘制 → 主进程轮询全局鼠标位置，画面随鼠标产生伪 3D 视差。窗口通过 PowerShell + C# 注入到 Windows 桌面 WorkerW 层，作为真正的壁纸显示在桌面图标下方。

在此基础上（**未提交的 WIP**）又加了 4 个"壁纸自定义元素"：黑胶唱片机（带本地音乐播放）、视频特效覆盖层（滤色 / 绿幕抠图）、Canvas 天气粒子、自定义贴纸。

---

## 2. 技术栈与运行环境

| 项 | 现状 |
|---|---|
| 桌面框架 | Electron ^28.3.3（`node_modules` 已装），electron-builder ^24.9.1 |
| 渲染 | Pixi.js **7.4.2，走 jsDelivr CDN**（`index.html:13`），自定义 `PIXI.Filter` 着色器 |
| 深度模型 | Depth Anything V2 Small；`generate_depth_map.py` 先找本地 ONNX，找不到再走 HuggingFace transformers |
| Python | 项目内 `venv/`（Python 3.11.9），只装了 **onnxruntime 1.31 / numpy / pillow**（没有 torch → 只能走 ONNX 模式） |
| ONNX 模型 | 根目录 3 个（`.gitignore` 忽略，不进仓库）：`_ir9.onnx` 100MB（实际被选中，脚本按文件大小取最大）、`_int8.onnx` 28MB、`depth_anything_v2_small.onnx` 仅 2MB（疑似缺外部权重的空壳） |
| Node | v24.14.0（系统） |
| 平台 | 仅 Windows（WorkerW 注入、全屏检测都依赖 Win32 API） |

启动：`npm start`（`npm run dev` 带 `--dev`，会打开 DevTools）。

---

## 3. 文件地图

```
壁纸/
├── main.js                 主进程：窗口、WorkerW 注入、鼠标轮询、IPC、托盘、全屏/电源监听
├── preload.js              contextBridge 暴露 window.electronAPI（含同步 fs 读文件）
├── index.html              壁纸页：加载层、调试面板、视频层、天气 canvas、贴纸、唱片机、<audio>
├── app.js                  壁纸渲染核心（1676 行）：视差 Shader + 4 个元素管理器 + IPC 监听
├── style.css               壁纸页样式（唱片机/贴纸/视频层等 WIP 样式占一半）
├── settings.html           设置窗口（单文件，内嵌 CSS+JS，约 1750 行）
├── src/
│   ├── wallpaper-native.js WorkerW 注入：写临时 .ps1 → Add-Type C#（编译结果按 hash 缓存成 dll）
│   ├── fullscreen-detector.js 常驻一个 PowerShell，每秒输出 FULLSCREEN/NORMAL，带防抖
│   ├── store.js            config.json + cache_index.json + depth_cache/*.png（userData 下）
│   └── tray-manager.js     托盘菜单
├── generate_depth_map.py   深度图生成（ONNX / HF 双模式，支持 --blur 高斯平滑、--invert）
├── export_onnx.py          把 HF 模型导出成 ONNX（注释里写的是给 Android 项目用）
├── 生成深度图.bat           旧的一键脚本（走系统 python + transformers，和 Electron 流程无关）
├── background.png / background2.png / depth_map.png   默认素材（首次启动兜底）
├── overlay/   （未跟踪）8 个视频特效 mp4 + 缩略图，共约 140MB，main.js 里硬编码为预设
├── elements/  （未跟踪）bomb1.mp4 / bomb2.mp4 —— 计划做成"视频元素"，代码里还没有引用（见 §9 阶段 2）
├── default wallpaper/ （未跟踪）17 张 Pixabay/Pexels 图片 —— 代码里**没有任何引用**
└── dist/      6 月的旧打包产物
```

> `.claude/settings.local.json` 里还指向旧的 Android 路径 `c:\Users\24418\Desktop\项目\Wallpaper3D`。现在 Android 项目在 `C:\Users\24418\Desktop\2\Wallpaper3D phone`，不在本次范围内。

---

## 4. 核心流程

### 4.1 启动
1. `app.whenReady` → `new AppStore()` → 注册 IPC → `createWallpaperWindow()` → 托盘 → 全屏检测 → 电源监听。
2. 壁纸窗口 `ready-to-show`：发送 `config:load`，开始 30fps 鼠标轮询，异步注入 WorkerW。
   - 成功：`show()` + 0 / 1.5s / 4s 三次 `nudgeWallpaperRepaint`。
   - 失败：退化为普通窗口 + `setIgnoreMouseEvents(true)` + `moveTop()`。
3. 渲染进程 `start()` → `init()`：读 config → 有 `currentImage` 且有深度缓存就用它，否则用 `background.png` + `depth_map.png`；深度图缺失时生成灰色占位图。

### 4.2 换壁纸（设置窗口）
`选择壁纸` → `dialog:selectImage` → `生成深度图` → `depth:generate`（spawn venv python，stdout 逐行转发成 `depth:progress`）→ 输出写到 `depth_cache/<hash>.png` 并记入索引 → `应用壁纸` → `wallpaper:apply`（保存 `currentImage`，发 `image:new`）→ 壁纸窗口读缓存 → `reloadWithNewImages()` 只换 uniform 纹理。

### 4.3 视差渲染（`app.js:101-185`）
- 顶点着色器直接输出 0~1 的 `aVertexPosition` 作为 UV，绕开 Pixi 默认 filter 的 framebuffer 比例拉伸。
- 片元着色器：Cover 映射（`uCoverScale/Offset`）→ 采样深度 R 通道 → `parallax = uMouse * (depth - uFocus) * uStrength` → 软截断 → clamp 后采样原图。
- `updateLoop`：帧率无关的 Lerp（`1 - (1-s)^delta`），`uStrength = parallaxMultiplier / 1000 * 1.25`。

### 4.4 参数同步
任何地方改参数 → `config:save` → 主进程写 `config.json` 并**把完整 config 广播给壁纸窗口** → `onLoadConfig` 更新 `CONFIG` 和所有元素管理器。

---

## 5. IPC 一览

| 通道 | 方向 | 作用 |
|---|---|---|
| `dialog:selectImage` / `selectAudio` / `selectCover` / `selectSticker` / `selectOverlayVideo` | R→M invoke | 文件对话框（selectImage 还会**顺带**给壁纸窗口发 `image:new`） |
| `overlay:getPresets` | R→M | 内置视频特效列表（硬编码在 `main.js:409-485`） |
| `depth:generate` / `depth:progress` | R→M / M→R | 调 Python 生成深度图 / 进度 |
| `cache:saveDepthMap` / `cache:getDepthMap` / `cache:clearAll` | R→M | 深度图缓存 |
| `depth:getCacheDir` / `openCacheDir` / `selectCacheDir` | R→M | 深度图目录管理（可迁移） |
| `config:save` / `config:get` / `config:load` | R→M / M→R | 配置读写 + 广播 |
| `wallpaper:apply` / `image:new` | R→M / M→R | 应用壁纸 |
| `mouse:move` | M→R | 全局鼠标坐标（30fps，静止不发） |
| `renderer:pause` / `renderer:resume` | M→R | 全屏/锁屏/睡眠时暂停 |
| `renderer:ready` / `renderer:depthGenerated` | R→M | 就绪通知 / 存深度图 |
| `app:openSettings` / `toggleAutoLaunch` / `getAutoLaunch` / `app:quit` | R→M | 应用控制 |

---

## 6. 配置结构（`src/store.js:289-339`）

```js
{
  parallaxMultiplier: 20, smoothness: 0.08, focusDepth: 0.5, blurRadius: 8,
  autoLaunch, currentImage, depthCacheDir, hideDebugPanel: true,
  vinyl:        { enabled, position, scale, volume, playing, loop, audioPath, audioName, coverPath },
  weather:      { type: none|rain|snow|sakura|leaves|sunlight, density, speed, parallax },
  sticker:      { enabled, imagePath, positionX, positionY, size, opacity, depth },
  videoOverlay: { enabled, presetId, customPath, customName, blendMode: auto|screen|chroma, opacity, speed },
}
```
存储位置：`%APPDATA%/interactive-desktop-wallpaper/`（`config.json`、`cache_index.json`、`depth_cache/`）。

---

## 7. 功能完成度

| 功能 | 状态 | 说明 |
|---|---|---|
| 深度视差渲染 | ✅ 可用 | 10-14 提交的自定义 Shader，已解决拉伸和割裂 |
| WorkerW 注入 | ✅ 可用 | 9-30 修过卡死与选错窗口 |
| 深度图生成（ONNX） | ✅ 可用（仅开发环境） | 依赖项目内 `venv` + 根目录 onnx 文件 |
| 深度图缓存/迁移目录 | ✅ 可用 | 未提交 |
| 全屏/锁屏暂停 | ✅ 可用 | |
| 托盘、开机自启 | ✅ 基本可用 | 托盘"更换壁纸"流程不完整（见 §8） |
| 黑胶唱片机 + 本地音乐 | 🟡 WIP 未提交 | |
| 视频特效覆盖层 | 🟡 WIP 未提交 | 视频素材未跟踪，打包配置未包含 |
| 天气粒子 | 🟡 WIP 未提交 | |
| 自定义贴纸 | 🟡 WIP 未提交 | |
| 默认壁纸图库（`default wallpaper/`） | ⬜ 未开始 | 只放了素材 |
| 自定义元素系统（图片 / GIF / 视频，含 `elements/` 爆炸） | ⬜ 设计已定，未开工 | 会替换掉"自定义贴纸"，见 §9 阶段 2 和设计文档 |
| 打包后能独立运行 | ⏸ 暂缓 | 现阶段不考虑，见 §8 #1 |
| 多显示器 | ❌ 不支持 | 只处理主显示器 |

---

## 8. 已发现的问题 / 风险（按优先级）

### 🔴 P0 — 影响核心流程
1. ⏸（暂缓，等打包时再处理）**打包产物无法生成深度图、无法播放内置特效。** `package.json` 的 `build.files` 不含 `generate_depth_map.py`、`overlay/`、`elements/`、onnx 模型；`main.js:576,591` 用 `__dirname` 定位脚本和 `venv`，进了 asar 之后 spawn 不了。用户机器上也不会有 Python。
2. **Pixi.js 走 CDN**（`index.html:13`）。开机自启时网络还没起来，或离线，壁纸直接白屏/报错。自用也会碰到，改成本地文件成本很低。
3. **"选择"等于"应用"。** `dialog:selectImage`（`main.js:325-328`）选完就给壁纸窗口发 `image:new`：有缓存时壁纸在用户点"应用"之前就被换掉；没缓存时弹"请在设置窗口中生成深度图"。但 `currentImage` 只在 `wallpaper:apply` 里保存，结果是壁纸换了，重启后又变回去。
4. **托盘"更换壁纸..."**（`main.js:792-801`）：不保存 `currentImage`，没缓存时也不会触发生成，只弹个 toast，等于半个功能。

### 🟠 P1 — 正确性 / 资源
5. `preload.js:218-221` `getUserDataPath` 在 preload 里 `require('electron').app`，渲染进程拿不到 `app`，调用必抛异常（`app.js:340` 的 userData 兜底路径永远走不通）。
6. `reloadWithNewImages`（`app.js:1590`）换纹理时不 `destroy()` 旧纹理，反复换壁纸会持续占用显存。
7. **一直以 60fps 满帧渲染**：鼠标静止、Lerp 已收敛时 ticker 仍然每帧跑 Shader；绿幕模式还有一条独立的 rAF 循环。常驻壁纸，耗电和 GPU 占用值得优化。
8. 拖动滑块时每个 `input` 事件都会 `config:save` → 同步写 `config.json` → 广播完整 config → 壁纸窗口把 4 个元素管理器全部 `setConfig` 一遍。需要 debounce，并且只下发变化的部分。
9. 注入失败的兜底模式里 `moveTop()`（`main.js:186`）会把全屏透明窗口提到所有程序上面（虽然点击能穿透，画面还是盖住了）。
10. 单实例锁（`main.js:838`）写在 `whenReady().then(...)` 注册之后，第二个实例在 quit 前仍可能跑完初始化逻辑。推荐写法是先拿锁，拿到了再注册 ready。
11. 深度缓存只按**文件大小**判断原图有没有变（`store.js:229-237`），同路径换了张同样大小的图会命中旧深度图。改用 mtime+size 即可。
12. 设置页生成深度图时写死了 `'small'`（`settings.html:921`）；Python 端非 small 也会回退成 small。模型选择实际上是摆设。

### 🟡 P2 — 代码整洁 / 体验
13. 死代码：`app.js:1532-1545`（`saveConfigToMain`、`originalBindEvents`）、`loadImageFromDataURL`（`app.js:1628`）。
14. 注释和 README 已过时：还在讲 DisplacementFilter、默认强度 30、Lively/Wallpaper Engine 用法；`index.html` 调试面板的默认值写的是 30，`CONFIG` 里是 20。
15. `CONFIG.hideDebugPanel = config.hideDebugPanel !== false`（`app.js:1511`）：配置里没有这个字段时也会隐藏面板。如果本意是"打包后默认隐藏"，那这样写没错，但浏览器预览和开发模式下就看不到面板了。
16. 天气 canvas 没有按 `devicePixelRatio` 缩放，高 DPI 屏幕上会发糊。
17. Shader 用的是 `precision mediump float`，在大图和高分屏上 UV 精度可能不够，出现细微抖动。
18. 视频素材要进 git：`overlay/` 139MB、`elements/` 5.7MB。远端是 GitHub，单文件超过 100MB 会被拒，超过 50MB 会有警告；`old1.mp4` 53.7MB 会触发警告，但能推上去。这些文件进了历史以后仓库会一直这么大。如果之后素材会越来越多，可以考虑改用 Git LFS，或者先用 ffmpeg 把 2K 素材压一下再提交。
19. `生成深度图.bat` 和 `requirements.txt` 仍按 torch/transformers 路线写，和实际用的 ONNX 路线不一致。

---

## 9. 开发计划（建议顺序）

### 阶段 0 — 先把 WIP 落地（半天）
- [ ] 跑一遍 `npm run dev`，手动过一遍 4 个元素和深度图流程，确认 WIP 能用。
- [ ] 分三次提交：①深度图目录管理 + 托盘入口 ②壁纸自定义元素代码 ③视频素材（`overlay/`、`elements/`；推送前注意 §8 #18 的体积问题）。
- [ ] `default wallpaper/` 要不要进 git，等阶段 4 的图库功能定下来再说。

### 阶段 1 — 修核心流程（P0 #2 #3 #4、P1 #5 #6 #11）
- [ ] Pixi 改成本地文件（`npm i pixi.js@7.4.2`，或者把 `pixi.min.js` 放进项目），摆脱 CDN。
- [ ] 把"选择图片"和"应用壁纸"分开：`dialog:selectImage` 不再发 `image:new`。
- [ ] 托盘"更换壁纸"改成：打开设置窗口并预选这张图（或在主进程里直接走"生成 → 应用"的完整流程）。
- [ ] 修 `getUserDataPath`（改成 IPC invoke）。
- [ ] 换纹理时销毁旧纹理。
- [ ] 缓存校验改成 mtime+size。

### 阶段 2 — 自定义元素系统（设计已定）
设计文档：[docs/superpowers/specs/2026-10-25-custom-elements-design.md](docs/superpowers/specs/2026-10-25-custom-elements-design.md)

要点：用户可以导入图片 / GIF / 视频作为元素，素材库里带默认元素（先放两个爆炸）；点元素进入全屏摆放模式，拖动、缩放、调深度后确认；可以同时放多个；元素在 Pixi 场景内渲染，视差和深度遮挡与背景一致；替换掉现有的"自定义贴纸"。

### 阶段 3 — 性能（P1 #7 #8）
- [ ] 空闲降帧：`|target - current| < ε` 且没有动态元素时停掉 ticker，收到 `mouse:move` 再启动。
- [ ] 滑块 debounce（例如 100ms）；`config:load` 只下发变化的部分。
- [ ] 天气 canvas 按 DPR 缩放；视差 shader 改用 `highp`。

### 阶段 4 — 其他新功能
- [ ] **默认壁纸图库**：用 `default wallpaper/` 的 17 张图，预先生成好深度图，设置页做成网格，点一下就能用。
- [ ] 深度图质量：把高斯模糊换成保边滤波（guided / bilateral），减少物体边缘的"拉丝"；可选让用户手动涂抹修正深度。
- [ ] 设置页让模型选择真正生效（P1 #12），并加深度图预览（原图 / 深度图对比）。
- [ ] 多显示器：每个显示器一个窗口，鼠标坐标按显示器换算。

### 阶段 5 — 收尾
- [ ] 清理死代码（P2 #13），重写 README（反映 Electron + ONNX 的真实架构）。
- [ ] 删掉或更新 `生成深度图.bat`、`requirements.txt`。

### ⏸ 暂缓 — 打包（等决定发给别人用时再做）
- 深度推理去掉 Python：主进程改用 `onnxruntime-node` 直接跑 ONNX 模型（推荐），预处理 / 后处理用 `sharp` 或手写实现；打包后只需带一个模型文件（int8 版 28MB）。
- `overlay/`、`elements/`、模型、默认素材放进 `extraResources`，路径统一用 `app.isPackaged ? process.resourcesPath : __dirname` 解析。
- 在干净机器上验证。

---

## 10. 已确认的决定（2026-10-25）

| 问题 | 结论 |
|---|---|
| `elements/` 爆炸视频用途 | 做成用户可以单独加到壁纸上的自定义元素，和天气、唱片机平级 |
| 自用还是分发 | 目前自己开发，暂不考虑打包 |
| Android 版 | 在 `C:\Users\24418\Desktop\2\Wallpaper3D phone`，暂不更新，当前只做电脑端 |
| 视频素材进 git | 进 |

### 第二轮确认（2026-10-25）
- 视频元素默认播放方式由设计者决定（一次性素材间隔播放，其余循环）。
- 可以同时放多个元素。
- 要做深度遮挡。
- 自定义元素支持多种格式（图片、GIF、视频等），流程是"添加 → 元素栏 → 点击 → 拖拽 → 确认"，素材库里带默认元素。以后会扩展变色、移动、旋转、变形，这一版先做基础功能。
