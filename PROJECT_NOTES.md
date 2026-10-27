# 互动3D壁纸 — 项目现状 & 开发计划

> 最近更新：2026-10-26（天气特效重写后）
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
├── ui/                      设置窗口和壁纸页共用的界面基础
│   ├── tokens.css           颜色 / 字体 / 圆角变量 + 按钮、开关、分段按钮、滑块（含深度色带）、标签、键帽、毛玻璃
│   └── icons.js             Lucide 图标雪碧图（Icons.svg）+ 滑块填充（UIControls.paintRange）
├── settings.html            设置窗口：只有结构（左侧导航 + 六个页面 + 提示条）
├── settings/
│   ├── settings.css         设置窗口布局
│   ├── main.js              入口：组装外壳和各页面，读一次配置分给各页面
│   ├── shell.js             导航切页、右下角提示条（setStatus）、"正在使用"卡片、导航角标
│   ├── controls.js          各页面共用的小工具：建节点、滑块、分段按钮、开关、按钮
│   ├── depth-preview.js     实时视差预览（WebGL，和壁纸同一个公式）+ 原图 / 深度图切换
│   ├── wallpaper-page.js    "壁纸"页：选图、生成深度图（进度在操作栏）、应用、托盘转来的图片
│   ├── gallery-panel.js     "壁纸"页下方的默认壁纸图库（平铺，末尾"从电脑选择"）
│   ├── parallax-page.js     "视差"页：强度、跟手程度、对焦深度、恢复推荐值
│   ├── elements-tab.js      "元素"页：素材库 + 左右两栏（元素列表 / 调整面板）
│   ├── effects-page.js      "特效"页：天气 + 视频特效
│   ├── music-page.js        "唱片机"页
│   ├── system-page.js       "设置"页：开机自启、深度图缓存
│   └── thumbnail.js         导入素材时生成缩略图
├── renderer/                壁纸页脚本（普通全局脚本，按 index.html 里的顺序加载）
│   ├── shaders.js           背景着色器 + 元素着色器，共用 PARALLAX_GLSL 视差公式
│   ├── ui.js                加载遮罩 / Toast / 错误提示
│   ├── host.js              运行环境抽象：Electron 走 electronAPI，浏览器走 dev/ 下的假数据
│   ├── parallax-scene.js    Scene：Pixi 应用、背景视差滤镜、壁纸 / 深度图纹理
│   ├── weather.js           天气管理器：画布、按配置切换特效、每帧算风和视差
│   ├── weather/             五种天气：kit.js（离屏贴图、贴图矩阵、粒子基类）+ rain / snow / sakura / leaves / sunlight
│   ├── vinyl.js / video-overlay.js   唱片机、全屏视频特效
│   ├── elements/
│   │   ├── sources.js       素材源：图片 / 动图（ImageDecoder）/ 视频 → Pixi 纹理
│   │   ├── element-shader.js 元素着色器实例
│   │   ├── elements-layer.js 元素渲染层：视差位移、深度遮挡、旋转 / 透视变形 / 变色、间隔播放、点击播放、排序
│   │   └── depth-sampler.js CPU 读深度图（自动贴地）
│   ├── edit-mode.js         摆放模式：拖动、角点缩放、边点拉伸、旋转手柄、自由变形、翻转、深度滑块、Enter / Esc
│   └── main.js              入口：配置、鼠标、动画循环、IPC
├── shared/                  纯逻辑（UMD，Node 测试和渲染进程共用，挂在 window.Shared）
│   ├── parallax-math.js     Cover 映射、视差位移、元素屏幕位移
│   ├── elements-model.js    自定义元素数据结构与纯函数
│   ├── playback.js          动图取帧、间隔播放调度、点击播放状态机
│   ├── frame-pacing.js      空闲停帧判断
│   ├── config-sync.js       配置节流保存、只应用变化的配置段
│   └── placement-math.js    摆放几何：框坐标 ↔ 屏幕、拖动、缩放、拉伸、旋转、自由变形、透视权重、点击命中、深度取样
├── src/
│   ├── elements/
│   │   ├── library.js       素材库：识别格式、读 manifest、导入复制、缩略图、file URL
│   │   ├── ipc.js           elements:* / placement:* IPC
│   │   ├── placement-controller.js 摆放会话（保证只有一个窗口，异常时按取消处理）
│   │   └── migrate.js       旧"自定义贴纸"配置迁移
│   ├── wallpaper-native.js  WorkerW 注入
│   ├── ps-helper.js         常驻 PowerShell 助手（按行读输出、异常重启），下面两个共用
│   ├── fullscreen-detector.js 全屏检测
│   ├── desktop-click-watcher.js 桌面单击检测（有"点击播放"元素时才开）
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
| `desktop:click` | M→R | 桌面被单击（坐标相对主显示器），触发"点击播放"的元素；壁纸暂停或摆放中不发 |
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
    instances: [{ id, assetId, visible,
                  transform: { x, y, width, rotation, stretch, flipX, flipY, warp },   // warp：自由变形时四个角的偏移，null 为不变形
                  depth, depthAuto, opacity,
                  playback: { mode: 'static'|'loop'|'interval'|'click', intervalSec, jitterSec, followClick },
                  chroma: { enabled, strength },
                  effects: { hue, saturation, brightness, tint, tintAmount } }],      // 旧实例缺的字段用 transformOf / effectsOf 补齐
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
| 黑胶唱片机 / 视频特效 / 天气粒子 | ✅ | 天气 2026-10-26 重写（贴图预渲染、景深、真实形状和飘落方式） |
| **自定义元素系统** | ✅ | 图片 / GIF / 动态 webp / apng / mp4 / webm；默认两个爆炸；摆放模式（缩放、拉伸、旋转、翻转、自由变形）；深度遮挡；间隔播放；点击播放；抠绿幕；变色 |
| 自定义贴纸 | ♻️ 已移除 | 被自定义元素取代，旧配置自动迁移 |
| 默认壁纸图库（`wallpapers/`） | ✅ | |
| 设置窗口 / 壁纸页界面 | ✅ 2026-10-26 改版 | 左侧导航分六页、统一控件和 Lucide 图标、实时视差预览；摆放模式、Toast、调试面板同一套样式 |
| 打包后独立运行 | ⏸ 暂缓 | |
| 多显示器 | ❌ 不支持 | |

---

## 8. 已知问题 / 风险

### 🔴 P0
1. ⏸（暂缓到打包时）打包产物无法生成深度图、无法播放内置素材：`build.files` 不含 Python 脚本、模型、`overlay/`、`elements/`；`main.js` 用 `__dirname` 找 `venv`。另外 `build.files` 也没有 `ui/`、`settings/`、`shared/`、`wallpapers/`，打包时要一起加。
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
21. 天气粒子画在单独的 Canvas 2D 图层上，盖在整张壁纸上面，不会被近处的物体挡住（想要"雪落在树后面"得把天气挪进 Pixi 场景做深度遮挡）。光斑的光源固定在左上角，可能和壁纸里实际的光线方向不一致。

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
1. [x] 默认壁纸图库：`wallpapers/`（17 张，带深度图和缩略图，`manifest.json` 记录中文名、来源和原文件名），设置页"壁纸管理"里可折叠的"默认壁纸"面板（默认收起；界面改版后改成"壁纸"页下方平铺）。素材由 `tools/prepare_wallpapers.py` 从原图生成，改进深度图算法后重跑即可。原图目录 `default wallpaper/` 未改动、未提交，可以删除；删掉后旧的当前壁纸路径会在启动时自动换成图库里的同一张。
2. [x] 深度图质量 + 设置页深度图预览。
   - 没有用保边滤波：壁纸是按深度挪像素的，深度图边缘越锐利，移动时越容易撕开；用原图引导的保边滤波试过，还会在深度图里留下斑点。
   - 现在的后处理（`generate_depth_map.py` 的 `postprocess_depth`）：模型输出用浮点放大到输出尺寸 → 近处轮廓向外扩"模糊影响半径"那么多 → 高斯平滑（三次均值滤波逼近）。过渡带整个落在背景一侧，主体轮廓移动时保持完整，拉伸落到背景上。"边缘平滑"滑块是高斯的 σ（按输出深度图像素计），外扩距离由它算出（`blur_support`）。
   - 输出深度图最长边 1920（原来是原图尺寸），6000px 的大图整个流程约 1.2 秒。
   - 设置页预览区右上角"原图 | 深度图"切换；有深度图时才出现，刚生成完自动切到深度图。
   - 17 张默认壁纸的深度图已用新算法重算（`prepare_wallpapers.py --depth-only`）。用户自己图片的旧缓存仍有效，重新点"生成深度图"才会换成新算法。
3. [x] 自定义元素进阶。
   - 变色（设置页"调整"里）：色相、饱和度、亮度、染色（颜色 + 强度，按亮度乘上染色颜色，白色元素也能染）、恢复原色。在元素着色器里做，放在抠像之后。
   - 旋转（摆放模式框上方的圆点，按住 Shift 每次 15°）、单向拉伸（边中点，`transform.stretch` 是高度相对原始比例的倍数）、水平 / 垂直翻转。
   - 自由变形：工具条"自由变形"后单独拖四个角，贴图按透视铺开（顶点带齐次权重 q，见 `projectiveWeights`）；拖成凹四边形时不接受。"复原"清掉旋转、拉伸、翻转和变形。
   - 点击播放（播放方式第三项）：平时停在第一帧，点中元素时播放一次；打开"在点击位置出现"后平时隐藏，点桌面哪里就在那里播放一次（自动深度时取点击处的深度）。
   - 桌面点击检测：常驻助手每 15ms 读左键状态，按下到松开 ≤500ms、移动 ≤6px 且松开处是桌面（根窗口类名 Progman / WorkerW）才算；只在有显示中的点击播放元素时开启。和全屏检测共用 `src/ps-helper.js`。
   - 实测：Electron 里渲染、摆放手柄、设置页调色、主进程转发点击都验证过；真实鼠标点桌面这一步要人工试（自动测试不能去点用户的桌面）。
4. [x] 前端界面改版（2026-10-26，用户把方案交给助手决定，看过 mockup 后确认）。
   - 设计：[docs/superpowers/specs/2026-10-26-ui-redesign-design.md](docs/superpowers/specs/2026-10-26-ui-redesign-design.md)；计划：[docs/superpowers/plans/2026-10-26-ui-redesign.md](docs/superpowers/plans/2026-10-26-ui-redesign.md)。
   - 设置窗口 960×660（最小 820×560），深色标题栏（`titleBarStyle: 'hidden'` + `titleBarOverlay`）。左侧导航：壁纸、视差、元素（角标是壁纸上的元素个数）、特效、唱片机，底部"正在使用"卡片和"设置"。操作结果改成右下角提示条（`setStatus` 签名没变）。
   - 实时视差预览：壁纸页和视差页共用一个 WebGL 预览（`mount` 挪到当前页面），着色器直接用 `renderer/shaders.js` 的 `PARALLAX_GLSL`，参数换算用 `Shared.parallax`，所以和桌面效果一致；纹理先缩到最长边 2048；鼠标不动、画面收敛后停帧；没有 WebGL 时退回 `<img>`。
   - 深度色带：所有调"深度"的滑块轨道画成左远右近的深度图渐变（对焦深度、元素深度、摆放工具条、调试面板）。
   - 用词：阻尼平滑度 → 跟手程度；天气名字缩短（细雨 / 落雪 / 落樱 / 枫叶 / 光斑）。功能、IPC、配置字段都没变。
   - 生成深度图期间图库不能点（原来只禁用了"选择壁纸"按钮，生成中换图会把结果记到别的图上）；清除缓存后默认壁纸仍可直接应用（它们的深度图不在缓存里）。
   - 摆放模式：提示条写"摆放「名称」"；深度数值和"自动"标签分开显示；翻转只留图标；自由变形开着时按钮和变形点都是琥珀色（`--warp`）。
   - 实测（Electron + CDP）：六个页面、图库选择并应用、托盘转来的图片生成深度图并自动应用、预览视差和深度图切换、元素页（拖滑块不重绘、切换选中、播放方式、隐藏、删除后选回第一个）、摆放窗口、壁纸页 Toast 和调试面板、窗口缩到 820×560 不出横向滚动条。没实测："清除缓存"按钮（会删用户的深度图缓存，留给人工试）；CDP 截图看不到系统标题栏按钮。
   - 实测窗口被别的窗口挡住时页面会变成 hidden，CDP 截图会卡住，启动时加 `--disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows`。
5. [x] 天气特效重写（2026-10-26，用户嫌形状太简单，交给助手按判断写）。
   - 配置字段、设置页、`WeatherParticleManager` 的接口（`setConfig` / `isActive` / `update`）都没变。
   - 形状全部用代码画（不用网络图片素材，没有版权问题），第一次用到时画成离屏贴图缓存，之后每帧只 `drawImage`。
   - 每个粒子有深度 z：越近越大、落得越快、视差越大；最近一层用模糊过的贴图（景深）。按 z 排序，重生时保留 z。
   - 细雨：竖直渐变雨丝（头亮尾淡），整帧共用一个风向。不画落地水花（不知道壁纸里地面在哪）。
   - 落雪：柔边雪粒 + 中近景的六角雪晶（慢慢转）+ 最近一层失焦雪团；两个频率叠加的飘摆。
   - 落樱：真实花瓣形状（基部窄、顶端 V 形缺口），粉到白的渐变和脉纹，翻到背面换背面贴图；侧对时保留三成宽度，不压成细线。
   - 枫叶：按裂片生成的七裂 / 五裂枫叶轮廓（带锯齿），五种配色、叶脉、叶柄、干边、斑点；"摆荡"和"翻滚"两种落法。
   - 光斑：左上方照进来的光柱（画在 1/4 分辨率离屏画布上再放大）+ 光柱里被照亮的浮尘 + 原地淡入淡出的失焦光圈；图层用 `mix-blend-mode: screen`。
   - 风 = 缓慢阵风 + 鼠标左右位置（`env.wind`），各天气按自己的比例吃风。
   - 实测（Electron，1708×1068 @1.5）：五种天气"适中"和"浓密"都跑满 60 帧上限，天气每帧 0.1~0.55ms。浏览器里和旧版对比，枫叶、樱花、光斑更省；雨和雪粒子数翻倍，每帧多几百微秒。
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
