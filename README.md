# 互动3D壁纸

**简体中文** | [English](README.en.md)

Windows 桌面上的伪 3D 视差动态壁纸：选一张图片，AI 自动生成深度图，移动鼠标时画面按远近产生视差，像透过窗户看一个立体场景。还可以往壁纸上放自己的图片、GIF、视频，它们会和场景一起移动，并被前景物体自然遮挡。

## 功能

- **深度视差壁纸**：Depth Anything V2 生成深度图，自定义着色器按深度偏移画面；可调视差强度、平滑度、对焦深度。
- **自定义元素**：导入图片 / GIF / 动态 WebP / APNG / MP4 / WebM，或使用自带的默认元素（爆炸）。
  - 点元素进入摆放模式：拖动移动、拖动角点缩放、调深度，Enter 确认、Esc 取消。
  - 元素随鼠标和同深度的背景一起移动，被更近的物体遮挡；新元素默认"贴地"取深度。
  - 支持绿幕抠像、循环 / 间隔播放、不透明度、显示 / 隐藏，可以同时放多个。
- **其他装饰**：黑胶唱片机（播放本地音乐）、全屏视频特效（雨、雪、老电影）、天气粒子。
- **桌面集成**：注入到桌面图标下方的 WorkerW 层；全屏应用、锁屏、睡眠时自动暂停；托盘菜单、开机自启。

## 运行

需要 Windows、Node.js，以及放在项目根目录的 Depth Anything V2 Small ONNX 模型（`depth_anything_v2_small*.onnx`，不进仓库，可以用 `export_onnx.py` 导出；有多个时用最大的那个）。深度图由 `onnxruntime-node` 生成，应用本身不需要 Python。

```bash
npm install
```

```bash
npm start
```

- `npm run dev`：同时打开 DevTools。
- 托盘图标左键或右键菜单 → "打开设置"：选择壁纸、生成深度图、调整参数、管理自定义元素。
- 日志在 `%APPDATA%/interactive-desktop-wallpaper/logs/main.log`。

## 打包

```bash
npm run build
```

生成 `dist/Interactive3DWallpaper-Setup-1.0.0.exe`（NSIS 安装包，文件名不带中文，方便传到 GitHub Releases）。打包要求项目根目录有 `depth_anything_v2_small_ir9.onnx`，它会被复制进安装包。第一次打包遇到 `winCodeSign` 解压报"Cannot create symbolic link"的处理办法见 [PROJECT_NOTES.md](PROJECT_NOTES.md) §9 阶段 6。

## 开发

```bash
npm test
```

素材预处理脚本（`tools/`）和 Python 版深度图（`generate_depth_map.py`）用项目内的 `venv/`（装有 onnxruntime / numpy / pillow）：

```bash
venv/Scripts/python.exe -m unittest tools/test_prepare_builtin_element.py
```

**浏览器预览**：不启动 Electron 也能看渲染效果和摆放模式，数据来自 `dev/dev-config.json`。

```bash
venv/Scripts/python.exe -m http.server 8765
```

然后打开 `http://localhost:8765/index.html`，摆放模式加 `?mode=edit`。

**添加默认元素**：绿幕视频先用脚本裁到主体区域并生成缩略图，再把它打印出的条目加进 `elements/manifest.json`。

```bash
venv/Scripts/python.exe tools/prepare_builtin_element.py elements/xxx.mp4 --id xxx --name "名称"
```

## 目录结构

| 路径 | 内容 |
|---|---|
| `main.js`、`preload.js`、`src/` | Electron 主进程、IPC、WorkerW 注入、全屏检测、配置存储、深度图生成（`src/depth/`）、自定义元素素材库与摆放窗口 |
| `index.html`、`renderer/` | 壁纸页面（也是摆放窗口）：Pixi 场景、着色器、自定义元素渲染层、摆放模式 |
| `settings.html`、`settings/` | 设置窗口 |
| `shared/` | 主进程、渲染进程和测试共用的纯逻辑 |
| `elements/` | 默认元素素材与 `manifest.json` |
| `overlay/` | 全屏视频特效素材 |
| `generate_depth_map.py` | Python 版深度图生成（`tools/prepare_wallpapers.py` 用；应用里用的是 `src/depth/`，结果一致） |
| `test/`、`tools/`、`dev/` | 测试、素材预处理脚本、浏览器预览数据 |

更详细的架构说明、已知问题和开发计划见 [PROJECT_NOTES.md](PROJECT_NOTES.md)。

## 技术要点

- **视差公式**：`offset = mouse × (depth − focus) × strength`，带软截断；背景和元素共用同一段 GLSL（`renderer/shaders.js`）和 JS 版本（`shared/parallax-math.js`）。
- **深度遮挡**：元素像素和"该像素上实际显示的背景内容"的深度比较，鼠标移动时遮挡边缘跟着前景物体走。
- **动图**：用 Chromium 自带的 WebCodecs `ImageDecoder` 解码，不依赖第三方库。
- **数据**：配置在 `%APPDATA%/interactive-desktop-wallpaper/config.json`；导入的素材复制到同目录的 `custom_elements/`，原文件挪走也不影响。
