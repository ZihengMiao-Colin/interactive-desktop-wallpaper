# 互动3D壁纸 — 项目现状 & 开发计划

> 最近更新：2026-10-25（自定义元素系统完成后）
> 用途：后续开发的"地图"。改动代码后请顺手更新本文件。

**当前范围（2026-10-25 确认）**
- 只做**电脑端**。Android 版在 `C:\Users\24418\Desktop\2\Wallpaper3D phone`，暂不更新。
- 目前是自己开发、自己用，**暂不考虑打包**。打包相关问题移到 §9 的"暂缓"部分。
- 特效视频素材（`overlay/`、`elements/`）进 git。

---

## 1. 一句话概括

Electron 桌面应用：用户选一张图片 → 调用本地 Python（Depth Anything V2，ONNX）生成灰度深度图 → 渲染进程用 Pixi.js 自定义 2.5D 视差着色器全屏绘制 → 主进程轮询全局鼠标位置，画面随鼠标产生伪 3D 视差。窗口通过 PowerShell + C# 注入到 Windows 桌面 WorkerW 层，显示在桌面图标下方。

在此之上可以叠加：
- **自定义元素**：用户导入的图片 / GIF / 视频（含绿幕），以及自带的默认元素（两个爆炸）。元素在 Pixi 场景里渲染，和背景一样随鼠标视差，并被更近的背景物体遮挡。
- 黑胶唱片机（本地音乐）、全屏视频特效（滤色 / 绿幕）、Canvas 天气粒子。

---

## 2. 技术栈与运行环境

| 项 | 现状 |
|---|---|
| 桌面框架 | Electron ^28.3.3（Chromium 120），electron-builder ^24.9.1 |
| 渲染 | Pixi.js 7.4.2（npm 本地依赖，版本锁定），自定义 Filter / Mesh 着色器 |
| 动图解码 | Chromium 自带的 WebCodecs `ImageDecoder`（没有引入 `@pixi/gif`） |
| 深度模型 | Depth Anything V2 Small；`generate_depth_map.py` 先找本地 ONNX，找不到再走 HuggingFace。ONNX 输入固定 518×518（不能保持原图比例）；输出深度图最长边 1920 |
| Python | 项目内 `venv/`（3.11.9），只装了 onnxruntime / numpy / pillow |
| ONNX 模型 | 根目录（`.gitignore` 忽略）：`_ir9.onnx` 100MB（实际被选中）、`_int8.onnx` 28MB、2MB 的空壳 |
| 测试 | Node 内置 `node --test`（`npm test`）；预处理脚本用 Python `unittest` |
| 平台 | 仅 Windows，仅主显示器 |

- 启动：`npm start`；`npm run dev` 会打开 DevTools。
- 测试：`npm test`；Python 用 `venv/Scripts/python.exe -m unittest tools/test_<名字>.py`（`test_generate_depth_map`、`test_prepare_wallpapers`、`test_prepare_builtin_element`）。
- 浏览器预览（不用启动 Electron 就能看渲染效果）：`venv/Scripts/python.exe -m http.server 8765`，打开 `http://localhost:8765/index.html`；摆放模式加 `?mode=edit`。数据来自 `dev/dev-config.json`。

---

## 3. 文件地图

```
壁纸/
├── main.js                  主进程：窗口、WorkerW 注入、鼠标轮询、IPC、托盘、全屏/电源监听、摆放窗口
├── preload.js               contextBridge 暴露 window.electronAPI（含 elements / placement 命名空间）
├── index.html               壁纸页（也是摆放窗口，?mode=edit）
├── style.css                壁纸页样式（含摆放模式 UI）
├── settings.html            设置窗口（内嵌 CSS + 大部分 JS）
├── settings/
│   ├── elements-tab.js      设置页"自定义元素"页签
│   ├── gallery-panel.js     设置页可折叠的"默认壁纸"面板
│   ├── depth-preview.js     设置页预览区：原图 / 深度图切换
│   └── thumbnail.js         导入素材时生成缩略图
├── renderer/                壁纸页脚本（普通全局脚本，按 index.html 里的顺序加载）
│   ├── shaders.js           背景着色器 + 元素着色器，共用 PARALLAX_GLSL 视差公式
│   ├── ui.js                加载遮罩 / Toast / 错误提示
│   ├── host.js              运行环境抽象：Electron 走 electronAPI，浏览器走 dev/ 下的假数据
│   ├── parallax-scene.js    Scene：Pixi 应用、背景视差滤镜、壁纸 / 深度图纹理
│   ├── weather.js / vinyl.js / video-overlay.js   天气、唱片机、全屏视频特效
│   ├── elements/
│   │   ├── sources.js       素材源：图片 / 动图（ImageDecoder）/ 视频 → Pixi 纹理
│   │   ├── element-shader.js 元素着色器实例
│   │   ├── elements-layer.js 元素渲染层：视差位移、深度遮挡、间隔播放、排序
│   │   └── depth-sampler.js CPU 读深度图（自动贴地）
│   ├── edit-mode.js         摆放模式：拖动、角点缩放、深度滑块、Enter / Esc
│   └── main.js              入口：配置、鼠标、动画循环、IPC
├── shared/                  纯逻辑（UMD，Node 测试和渲染进程共用，挂在 window.Shared）
│   ├── parallax-math.js     Cover 映射、视差位移、元素屏幕位移
│   ├── elements-model.js    自定义元素数据结构与纯函数
│   ├── playback.js          动图取帧、间隔播放调度
│   ├── frame-pacing.js      空闲停帧判断
│   ├── config-sync.js       配置节流保存、只应用变化的配置段
│   └── placement-math.js    摆放几何：矩形换算、拖动、角点缩放、深度取样
├── src/
│   ├── elements/
│   │   ├── library.js       素材库：识别格式、读 manifest、导入复制、缩略图、file URL
│   │   ├── ipc.js           elements:* / placement:* IPC
│   │   ├── placement-controller.js 摆放会话（保证只有一个窗口，异常时按取消处理）
│   │   └── migrate.js       旧"自定义贴纸"配置迁移
│   ├── wallpaper-native.js  WorkerW 注入
│   ├── fullscreen-detector.js 全屏检测（常驻 PowerShell）
│   ├── store.js             config.json / 深度缓存 / custom_elements 目录
│   ├── gallery.js           默认壁纸图库：读 manifest、按路径查找、旧路径迁移
│   └── tray-manager.js      托盘菜单
├── elements/                默认元素：manifest.json + 裁剪后的 *_cut.mp4 + 缩略图（原始 bomb*.mp4 保留）
├── wallpapers/              默认壁纸图库：manifest.json + 图片 + depth/ + thumbs/
├── overlay/                 全屏视频特效素材
├── tools/prepare_builtin_element.py  默认绿幕元素预处理（裁剪 / 缩放 / 缩略图）
├── tools/prepare_wallpapers.py       默认壁纸图库素材生成（缩图 / 缩略图 / 深度图；`--depth-only` 只重算深度图）
├── dev/                     浏览器预览用的假配置和示例 GIF
├── test/                    Node 单元测试
├── generate_depth_map.py / export_onnx.py / 生成深度图.bat
├── background.png / background2.png / depth_map.png   默认素材
└── default wallpaper/       （未跟踪）默认壁纸的原图，图库素材由它生成，可以删除
```

---

## 4. 核心流程

### 4.1 启动
1. `app.whenReady` → `new AppStore()` → **迁移旧贴纸配置** → 注册 IPC → 创建壁纸窗口 → 托盘 → 全屏检测 → 电源监听。
2. 壁纸窗口 `ready-to-show`：发 `config:load`，开始 30fps 鼠标轮询，异步注入 WorkerW。
3. 渲染进程 `start()`：读配置 → 有上次的壁纸就用它和它的深度缓存（没有缓存时用占位深度图）→ `Scene.load` → 加载自定义元素 → 启动 ticker。

### 4.2 换壁纸（设置窗口）
`选择壁纸` → `生成深度图`（spawn venv python）→ `应用壁纸`（保存 `currentImage`，发 `image:new`）→ 壁纸窗口 `Scene.load` 换纹理并释放旧纹理。

### 4.3 视差渲染
- 背景：屏幕 UV 按 Cover 映射到图片 UV → 取深度 → `parallaxUV = mouse × (depth − focus) × strength`（软截断）→ 偏移采样。
- 自定义元素：整体按自身深度平移 `−parallaxUV / coverScale`，和同深度的背景移动完全一致。
- 遮挡：元素每个像素和"该像素上实际显示的背景内容"的深度比较（先按背景的视差偏移再取深度），场景更近就挡住，边缘 `smoothstep` 过渡。

### 4.4 自定义元素
- 设置页点素材 → `elements:startPlacement` → 主进程开全屏置顶的摆放窗口（`index.html?mode=edit`），同时静默暂停壁纸。
- 摆放窗口里拖动 / 缩放 / 调深度（新元素默认"自动贴地"）→ Enter 或"确认"→ `placement:commit` → 写配置 → 关窗 → 恢复壁纸并广播配置。
- Esc、取消、窗口被关、渲染进程崩溃、无响应都按取消处理，不会留下置顶窗口。

### 4.5 配置同步
任何改动 → 主进程写 `config.json` → `broadcastConfig()` 同时推给壁纸窗口和设置窗口。

---

## 5. IPC 一览

| 通道 | 方向 | 作用 |
|---|---|---|
| `dialog:selectImage` / `selectAudio` / `selectCover` / `selectOverlayVideo` | R→M | 文件对话框，只返回路径 |
| `settings:prepareImage` | M→R | 托盘选了一张没有深度图的图片：设置窗口生成深度图后自动应用 |
| `overlay:getPresets` | R→M | 全屏视频特效列表 |
| `gallery:list` | R→M | 默认壁纸图库列表 |
| `depth:generate` / `depth:progress` | R→M / M→R | 生成深度图 / 进度 |
| `cache:*`、`depth:*CacheDir` | R→M | 深度图缓存与目录（`cache:getDepthMap` 对默认壁纸返回自带的深度图） |
| `config:save` / `config:get` / `config:load` | R→M / M→R | 配置读写 + 广播（壁纸窗口和设置窗口） |
| `wallpaper:apply` / `image:new` | R→M / M→R | 应用壁纸 |
| `mouse:move` | M→R | 全局鼠标坐标 |
| `renderer:pause` / `renderer:resume` | M→R | 暂停 / 恢复；带 `{ silent: true }` 时不弹提示 |
| `elements:getBuiltin` / `import` / `removeAsset` / `saveThumb` / `updateInstance` / `removeInstance` / `startPlacement` | R→M | 自定义元素 |
| `placement:getDraft` / `commit` / `cancel` | R→M | 摆放窗口 |
| `renderer:ready`、`app:*` | R→M | 就绪通知、应用控制 |

---

## 6. 配置结构（`src/store.js`、`shared/elements-model.js`）

```js
{
  parallaxMultiplier: 20, smoothness: 0.08, focusDepth: 0.5, blurRadius: 8,
  autoLaunch, currentImage, depthCacheDir, hideDebugPanel: true,
  vinyl:        { enabled, position, scale, volume, playing, loop, audioPath, audioName, coverPath },
  weather:      { type, density, speed, parallax },
  videoOverlay: { enabled, presetId, customPath, customName, blendMode, opacity, speed },
  customElements: {
    library:   [{ id: 'user:<uuid>', name, type: 'image'|'animated'|'video', file, thumb, builtin: false, importedAt }],
    instances: [{ id, assetId, visible, transform: { x, y, width, rotation }, depth, depthAuto, opacity,
                  playback: { mode: 'static'|'loop'|'interval', intervalSec, jitterSec },
                  chroma: { enabled, strength }, effects: {} }],
  },
}
```
- 存储位置：`%APPDATA%/interactive-desktop-wallpaper/`（`config.json`、`cache_index.json`、`depth_cache/`、`custom_elements/`）。
- 默认元素不在配置里，来自 `elements/manifest.json`，id 为 `builtin:<id>`。

---

## 7. 功能完成度

| 功能 | 状态 | 说明 |
|---|---|---|
| 深度视差渲染 | ✅ | 背景着色器改为 highp，公式与元素共用 |
| WorkerW 注入 | ✅ | |
| 深度图生成（ONNX） | ✅（仅开发环境） | 依赖项目内 `venv` + 根目录 onnx 文件 |
| 深度图缓存 / 迁移目录 | ✅ | |
| 全屏 / 锁屏暂停 | ✅ | 自定义元素的视频和间隔计时也会暂停 |
| 托盘、开机自启 | ✅ | 托盘"更换壁纸"：有缓存直接应用，没有就在设置窗口生成后自动应用 |
| 黑胶唱片机 / 视频特效 / 天气粒子 | ✅ | |
| **自定义元素系统** | ✅ | 图片 / GIF / 动态 webp / apng / mp4 / webm；默认两个爆炸；摆放模式；深度遮挡；间隔播放；抠绿幕 |
| 自定义贴纸 | ♻️ 已移除 | 被自定义元素取代，旧配置自动迁移 |
| 默认壁纸图库（`default wallpaper/`） | ⬜ 未开始 | |
| 打包后独立运行 | ⏸ 暂缓 | |
| 多显示器 | ❌ 不支持 | |

---

## 8. 已知问题 / 风险

### 🔴 P0
1. ⏸（暂缓到打包时）打包产物无法生成深度图、无法播放内置素材：`build.files` 不含 Python 脚本、模型、`overlay/`、`elements/`；`main.js` 用 `__dirname` 找 `venv`。
2. ~~Pixi.js 走 CDN~~ ✅ 改为 npm 本地依赖
3. ~~"选择"等于"应用"~~ ✅ 选择只返回路径，只有"应用壁纸"会换壁纸并保存 `currentImage`
4. ~~托盘"更换壁纸"流程不完整~~ ✅ 有缓存直接应用；没有缓存在设置窗口生成后自动应用

### 🟠 P1
5. ~~preload 的 `getUserDataPath` 必抛异常~~ ✅ 已删除
6. ~~换壁纸不释放旧纹理~~ ✅ `Scene.load` 会 `destroy(true)` 旧纹理
7. ~~一直满帧渲染~~ ✅ 空闲停帧：鼠标静止、视差收敛、没有天气粒子和播放中的视频 / 动图时停掉 ticker（实测静止 3 秒 0 帧）；有动画时帧率上限 60（这台机器屏幕约 240Hz，实测下雪时 2 秒 481 帧 → 118 帧）
8. ~~拖滑块时每次 input 都写盘并广播~~ ✅ 设置页和调试面板节流保存（首次立即发送，之后每 100ms 最多一次，实测 30 次拖动 → 5 次广播）；壁纸只重新应用变了的配置段
9. 注入失败的兜底模式 `moveTop()` 会把全屏窗口提到所有程序上面。
10. 单实例锁写在 `whenReady` 之后。
11. ~~深度缓存只按文件大小判断~~ ✅ 改为大小 + 修改时间（旧索引没有修改时间的条目仍只比大小）
12. 设置页生成深度图写死 `'small'` —— 按用户决定只用 small 模型，保持现状。

### 🟡 P2
13. ~~死代码~~ ✅ 拆分 `app.js` 时已清理
14. ~~README 过时~~ ✅ 已重写
15. `hideDebugPanel` 没配置时默认隐藏（Electron 下符合预期；浏览器预览不受影响）。
16. ~~天气 canvas 没按 DPR 缩放~~ ✅
17. ~~mediump 精度~~ ✅ 改为 highp
18. 视频素材都进了 git：`overlay/` 139MB（`old1.mp4` 53.7MB 推到 GitHub 会有警告）。素材继续增多的话考虑 Git LFS。
19. `生成深度图.bat`、`requirements.txt` 仍按 torch 路线写。
20. 自定义元素：摆放模式只处理主显示器；动图最多解码 600 帧；元素多了以后没有数量上限提示。

---

## 9. 开发计划

### ✅ 阶段 0 — WIP 落地（已完成）
### ✅ 阶段 2 — 自定义元素系统（已完成）
- 设计：[docs/superpowers/specs/2026-10-25-custom-elements-design.md](docs/superpowers/specs/2026-10-25-custom-elements-design.md)
- 计划：[docs/superpowers/plans/2026-10-25-custom-elements.md](docs/superpowers/plans/2026-10-25-custom-elements.md)

### ✅ 阶段 1 — 修核心流程（已完成）
- [x] Pixi 改成本地依赖，摆脱 CDN。
- [x] 把"选择图片"和"应用壁纸"分开。
- [x] 托盘"更换壁纸"走完整流程。
- [x] 修 `getUserDataPath`。
- [x] 换纹理时销毁旧纹理。
- [x] 缓存校验改成大小 + 修改时间。

### ✅ 阶段 3 — 性能（已完成）
- [x] 空闲停帧：鼠标静止、视差收敛、且没有天气粒子和播放中的视频 / 动图时停 ticker；鼠标移动、配置变化、窗口尺寸变化时唤醒；间隔播放的元素在等待期间也停帧，到点由定时器唤醒（`shared/frame-pacing.js`、`ElementsLayer.needsFrames / nextWakeMs`）。
- [x] 设置页和调试面板节流保存（`shared/config-sync.js` 的 `createConfigSaver`）；主进程仍广播完整配置，壁纸端用 `changedSections` 只重新应用变了的段。
- [x] 天气 canvas 按 DPR 缩放。
- [x] 视差 shader 改用 highp。
- [x] 帧率上限 60（`renderer/parallax-scene.js` 的 `MAX_FPS`），高刷新率屏幕上有动画时不再按刷新率满帧渲染。

### 阶段 4 — 其他新功能（2026-10-26 确定范围，按此顺序做）
1. [x] 默认壁纸图库：`wallpapers/`（17 张，带深度图和缩略图，`manifest.json` 记录中文名、来源和原文件名），设置页"壁纸管理"里可折叠的"默认壁纸"面板（默认收起）。素材由 `tools/prepare_wallpapers.py` 从原图生成，改进深度图算法后重跑即可。原图目录 `default wallpaper/` 未改动、未提交，可以删除；删掉后旧的当前壁纸路径会在启动时自动换成图库里的同一张。
2. [x] 深度图质量 + 设置页深度图预览。
   - 没有用保边滤波：壁纸是按深度挪像素的，深度图边缘越锐利，移动时越容易撕开；用原图引导的保边滤波试过，还会在深度图里留下斑点。
   - 现在的后处理（`generate_depth_map.py` 的 `postprocess_depth`）：模型输出用浮点放大到输出尺寸 → 近处轮廓向外扩"模糊影响半径"那么多 → 高斯平滑（三次均值滤波逼近）。过渡带整个落在背景一侧，主体轮廓移动时保持完整，拉伸落到背景上。"边缘平滑"滑块是高斯的 σ（按输出深度图像素计），外扩距离由它算出（`blur_support`）。
   - 输出深度图最长边 1920（原来是原图尺寸），6000px 的大图整个流程约 1.2 秒。
   - 设置页预览区右上角"原图 | 深度图"切换；有深度图时才出现，刚生成完自动切到深度图。
   - 17 张默认壁纸的深度图已用新算法重算（`prepare_wallpapers.py --depth-only`）。用户自己图片的旧缓存仍有效，重新点"生成深度图"才会换成新算法。
3. [ ] 自定义元素进阶：变色、旋转、变形（数据结构已预留 `transform.rotation`、`effects`）；点击桌面触发播放。
- ~~设置页模型选择~~：不做，只用 small 模型（用户决定）。
- ~~多显示器~~：不做（用户决定）。

### 阶段 5 — 收尾
- [ ] 删掉或更新 `生成深度图.bat`、`requirements.txt`。

### ⏸ 暂缓 — 打包
- 深度推理改用 `onnxruntime-node`，去掉 Python。
- 素材和模型放进 `extraResources`，路径用 `app.isPackaged ? process.resourcesPath : __dirname`。

---

## 10. 已确认的决定（2026-10-25）

| 问题 | 结论 |
|---|---|
| `elements/` 爆炸视频用途 | 做成用户可以单独加到壁纸上的自定义元素 |
| 自用还是分发 | 目前自己开发，暂不考虑打包 |
| Android 版 | 在 `C:\Users\24418\Desktop\2\Wallpaper3D phone`，暂不更新 |
| 视频素材进 git | 进 |
| 视频元素默认播放方式 | 一次性素材间隔播放（播完等 10±3 秒），其余循环 |
| 同时放多个元素 | 可以，同一素材也可以放多份 |
| 深度遮挡 | 要做（已完成） |
| 自定义元素格式 | 图片、GIF、视频等；流程"添加 → 元素栏 → 点击 → 拖拽 → 确认" |
| 以后扩展 | 变色、移动、旋转、变形，这一版只做基础功能 |
