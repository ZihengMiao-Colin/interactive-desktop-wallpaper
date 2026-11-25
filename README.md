# Kirie 壁纸

**简体中文** | [English](README.en.md)

Kirie（日语"切り絵"，剪纸画）是 Windows 桌面上的伪 3D 视差动态壁纸：选一张图片，AI 自动生成深度图，移动鼠标时画面按远近产生视差，像透过窗户看一个立体场景。还可以往壁纸上放自己的图片、GIF、视频，它们会和场景一起移动，并被前景物体自然遮挡。

安卓手机版在 [interactive-phone-wallpaper](https://github.com/ZihengMiao-Colin/interactive-phone-wallpaper)：同样的视差效果，倾斜手机驱动，深度图在手机本地生成。

## 功能

- **深度视差壁纸**：Depth Anything V2 生成深度图，自定义着色器按深度偏移画面；可调视差强度、平滑度、对焦深度。
- **视频壁纸**：把本地视频（MP4 / WebM 等）设成壁纸，循环播放；可以原样播放、做 3D 视差（整段视频共用一张深度图，适合固定机位的视频）或整体跟着鼠标平移，可以打开声音。
- **我的壁纸**：自己选过的图片和视频都留在壁纸页，一点就能换回来。原文件在同一个盘里挪了位置、改了名字也能自动找回；挪到别的盘的，点一下"找不到文件"的格子选它现在的位置，同一个文件夹里的会一起接上。歌单也一样；视频特效里自己的视频也会自动找回，挪到别的盘的要重新导入。
- **解锁动画**：导入一段视频，每次解锁电脑后全屏播放（盖住任务栏），淡入淡出时长可调，按 Esc 或点鼠标可以跳过，放完回到桌面。程序要在运行才能播放。
- **导入时裁剪**：导入图片壁纸、视频壁纸和解锁视频时弹出裁剪框，拖框决定留下哪一块（比如裁掉水印），比例自动按屏幕锁定；已经导入的也能重新裁。
- **自定义元素**：导入图片 / GIF / 动态 WebP / APNG / MP4 / WebM。
  - 点元素进入摆放模式：拖动移动、拖动角点缩放、调深度，Enter 确认、Esc 取消。
  - 元素随鼠标和同深度的背景一起移动，被更近的物体遮挡；新元素默认"贴地"取深度。
  - 支持绿幕抠像、循环 / 间隔播放、不透明度、显示 / 隐藏，可以同时放多个。
- **其他装饰**：黑胶唱片机（本地音乐歌单，可列表循环 / 单曲循环 / 随机 / 顺序播放；每首歌一张封面，优先用歌曲自带的；能拖进度条；位置可以随意拖）、全屏视频特效（用自己导入的视频）、天气粒子。
- **桌面集成**：注入到桌面图标下方的 WorkerW 层；全屏应用、锁屏、睡眠时自动暂停；托盘菜单、开机自启。

## 下载安装

在 [Releases](https://github.com/ZihengMiao-Colin/interactive-desktop-wallpaper/releases/latest) 页面下载最新的 `Kirie-Setup-<版本>.exe`，双击安装。支持 Windows 10 / 11 64 位。

安装包没有代码签名，Windows 可能提示"Windows 已保护你的电脑"，点"更多信息"→"仍要运行"即可。装了 360 等安全软件时壁纸可能挂不到桌面上。详细的处理步骤见 [安装注意事项（PDF）](docs/install/Kirie-Install-Guide.pdf)。

## 运行

需要 Windows、Node.js，以及放在项目根目录的 Depth Anything V2 Small ONNX 模型（`depth_anything_v2_small*.onnx`，不进仓库，可以用 `export_onnx.py` 导出；有多个时用最大的那个）。深度图由 `onnxruntime-node` 生成，应用本身不需要 Python。

```bash
npm install
```

```bash
npm start
```

- `npm run dev`：同时打开 DevTools。
- 启动后直接打开设置窗口：选择壁纸、生成深度图、调整参数、管理自定义元素。关掉设置窗口后程序留在托盘里，再次打开程序或点托盘图标（右键菜单 → "打开设置"）都能回来。开机自启时只显示壁纸，不弹设置窗口。
- 设置窗口的"设置"页可以换界面主题：夜间（默认）、日间、跟随系统。
- 遇到问题：设置窗口的"设置"页 → "问题反馈" → "生成报告"，会在桌面上生成一个 txt（系统、显卡信息和最近的日志，路径里的 Windows 用户名已去掉），用微信、QQ 发给开发者就行；有 GitHub 账号的话点"打开反馈页…"直接提问题。设置窗口打不开时，托盘右键菜单里也有"问题反馈"。程序完全打不开时，可以直接发日志文件 `%APPDATA%/interactive-desktop-wallpaper/logs/main.log`。
- 卸载：设置窗口的"设置"页 → "卸载软件…"，或者 Windows 设置 → 应用。两种方式都可以选要不要一起删除你的数据（各项设置、导入的元素、生成的深度图）；你电脑里原来的图片和音乐不会删。

## 打包

```bash
npm run build
```

生成 `dist/Kirie-Setup-<版本>.exe`（NSIS 安装包，文件名不带中文，方便传到 GitHub Releases）。打包要求项目根目录有 `depth_anything_v2_small_ir9.onnx`，它会被复制进安装包。第一次打包遇到 `winCodeSign` 解压报"Cannot create symbolic link"的处理办法见 [PROJECT_NOTES.md](PROJECT_NOTES.md) §9 阶段 6。

## 开发

```bash
npm test
```

素材预处理脚本（`tools/`）和 Python 版深度图（`generate_depth_map.py`）用项目内的 `venv/`（装有 onnxruntime / numpy / pillow，版本见 `requirements.txt`，重新建 venv 的命令也写在里面）：

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

**软件图标**：`assets/icon.ico`（16 到 256 九个尺寸，每个尺寸单独画）、`icon.png`、`icon.svg`、`icon-20.svg`（设置窗口标题栏用）都由脚本生成，颜色和形状写在脚本里。改完重新生成，`tools/test_make_icon.py` 会检查 `assets/` 里的是不是最新的。

```bash
venv/Scripts/python.exe tools/make_icon.py
```

## 目录结构

| 路径 | 内容 |
|---|---|
| `main.js`、`preload.js`、`src/` | Electron 主进程、IPC、WorkerW 注入、全屏检测、配置存储、深度图生成（`src/depth/`）、自定义元素素材库与摆放窗口 |
| `index.html`、`renderer/` | 壁纸页面（也是摆放窗口）：Pixi 场景、着色器、自定义元素渲染层、摆放模式 |
| `settings.html`、`settings/` | 设置窗口 |
| `ui/` | 设置窗口和壁纸页共用的样式（颜色、字体、基础控件）、图标和自带字体（`ui/fonts/`） |
| `shared/` | 主进程、渲染进程和测试共用的纯逻辑 |
| `elements/` | 默认元素的 `manifest.json`（现在没有自带素材） |
| `generate_depth_map.py` | Python 版深度图生成（`tools/prepare_wallpapers.py` 用；应用里用的是 `src/depth/`，结果一致） |
| `test/`、`tools/`、`dev/` | 测试、素材预处理脚本、浏览器预览数据 |

更详细的架构说明、已知问题和开发计划见 [PROJECT_NOTES.md](PROJECT_NOTES.md)。

## 技术要点

- **视差公式**：`offset = mouse × (depth − focus) × strength`，带软截断；背景和元素共用同一段 GLSL（`renderer/shaders.js`）和 JS 版本（`shared/parallax-math.js`）。
- **光线步进**：每个像素从最近一层往最远一层找第一个碰到的表面，近处物体挪动时盖住后面的背景，不会被拉扯出重影（思路参考 [depthy](https://github.com/panrafal/depthy)）。
- **深度遮挡**：元素像素和"该像素上实际显示的背景内容"的深度比较，鼠标移动时遮挡边缘跟着前景物体走。
- **动图**：用 Chromium 自带的 WebCodecs `ImageDecoder` 解码，不依赖第三方库。
- **界面**：黑白灰为主、青色强调的终端风格（直角面板、色条加细框、宋体页面标题配少量英文小字），样式全在 `ui/tokens.css` 的 CSS 变量里。字体自带，都是 SIL OFL 授权：思源宋体（Noto Serif SC）、Saira，来自 [Fontsource](https://fontsource.org/)。
- **数据**：配置在 `%APPDATA%/interactive-desktop-wallpaper/config.json`；导入的素材复制到同目录的 `custom_elements/`，原文件挪走也不影响。「我的壁纸」、歌单和视频特效只记路径，另外记下每个文件的 NTFS 编号（`file_ids.json`），文件挪走后按编号找回。

## 许可

代码用 [MIT 许可证](LICENSE)。下面这些不在 MIT 范围内：

- 默认壁纸（`wallpapers/`）：2 张，都是 CC0（作者已放弃版权），分别来自 Pexels 和 Pixabay，作者写在 `wallpapers/manifest.json` 的 `credit` 里。
- 字体（`ui/fonts/`）：SIL OFL 1.1，许可证文件在同一目录。
- 深度模型 Depth Anything V2 Small（不在仓库里，安装包里带了）：Apache-2.0，许可证文本在 `licenses/`，安装后在 `resources/models/`。
