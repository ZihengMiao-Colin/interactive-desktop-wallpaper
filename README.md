# 互动桌面壁纸 — 伪 3D 深度视差

基于 **Pixi.js DisplacementFilter** 实现的全屏交互式桌面壁纸。鼠标移动时，画面会根据深度图产生伪 3D 视差效果。

---

## 项目文件结构

```
壁纸/
├── index.html              # 壁纸主页面（全屏 Canvas + 调试面板）
├── settings.html           # 设置窗口页面（Electron）
├── style.css               # 样式（全屏无滚动 + 加载动画 + Toast）
├── app.js                  # 核心逻辑（Pixi.js + DisplacementFilter + IPC）
├── main.js                 # Electron 主进程入口
├── preload.js              # IPC 桥接脚本（安全隔离）
├── package.json            # Electron 项目配置与依赖
├── src/
│   ├── wallpaper-native.js # WorkerW 壁纸层注入模块（Win32 API）
│   ├── tray-manager.js     # 系统托盘管理
│   ├── fullscreen-detector.js # 全屏检测 / 性能守卫
│   └── store.js            # 数据持久化与缓存
├── assets/
│   └── icon.png            # 托盘图标
├── background.png          # 原图（彩色壁纸）—— 你可以替换
├── depth_map.png           # 深度图（黑白灰）—— AI 自动生成或手动制作
├── generate_depth_map.py   # 深度图 AI 生成工具 (Depth Anything V2)
├── 生成深度图.bat           # Windows 一键生成脚本
├── requirements.txt        # Python 依赖清单
└── README.md               # 本文件
```

---

## 如何用自己的图片替换素材

### 1. 准备原图（background.png）

将你喜欢的彩色壁纸图片重命名为 `background.png`，放到项目目录中。

- 支持格式：PNG / JPG
- 推荐分辨率：与你的屏幕分辨率一致（如 1920×1080、2560×1440 等）
- 没有严格限制，任何尺寸都可以（代码会自动使用 Cover 模式缩放）

### 2. 准备深度图（depth_map.png）

**这是整个效果的关键。** 你需要一张与 `background.png` 尺寸相同的灰度图：

| 颜色 | 含义 | 位移效果 |
|------|------|---------|
| **白色** (RGB 255,255,255) | 近景（离观察者最近） | 鼠标移动时偏移最大 |
| **灰色** (RGB ~128,128,128) | 中景 | 偏移量中等 |
| **黑色** (RGB 0,0,0) | 远景（离观察者最远） | 几乎不动 |

#### 方法 A：AI 自动生成（推荐）

项目内置了 **Depth Anything V2** 深度图生成工具，一键将任意图片转为黑白深度图。

**Windows 用户 — 双击运行（最简单）：**

1. 双击 `生成深度图.bat`
2. 将你的壁纸图片拖入窗口，按回车
3. 选择模型大小（推荐选 1 = Small）
4. 等待生成完成 → 自动输出 `depth_map.png`

**命令行方式：**

```bash
# 1. 安装依赖（仅首次需要）
pip install -r requirements.txt

# 2. 生成深度图（Small 模型，最快）
python generate_depth_map.py 你的壁纸.jpg

# 3. 使用更高质量的模型
python generate_depth_map.py 你的壁纸.jpg -m base    # 均衡
python generate_depth_map.py 你的壁纸.jpg -m large   # 最佳质量
```

**模型选择参考：**

| 模型 | 参数量 | 下载大小 | 速度 | 质量 |
|------|--------|----------|------|------|
| small | 25M | ~100MB | 快（CPU 可用） | 良好 |
| base | 98M | ~390MB | 中等 | 优秀 |
| large | 335M | ~1.3GB | 慢（建议 GPU） | 最佳 |

> **首次运行**会自动从 Hugging Face 下载模型文件。
> 如果下载慢，可设置环境变量使用镜像站点：`set HF_ENDPOINT=https://hf-mirror.com`

---

#### 方法 B：其他 AI 深度估算工具

- [Depth Anything V2 官方 Demo](https://huggingface.co/spaces/depth-anything/Depth-Anything-V2) — 在线体验
- [LeiaPix Converter](https://convert.leiapix.com/) — 在线工具，上传图片自动生成深度图
- [MiDaS](https://github.com/isl-org/MiDaS) — 经典深度估计模型
- Photoshop "神经滤镜" → "深度模糊" → 导出深度图

---

#### 方法 C：手动在 Photoshop 中绘制

1. 打开 `background.png`
2. 新建图层，用黑白灰画笔绘制深度信息
3. 近处的物体涂白，远处的背景涂黑，中间涂灰色
4. 导出为 `depth_map.png`

### 3. 调整参数

在 `app.js` 文件顶部的 `CONFIG` 对象中修改默认参数：

```javascript
const CONFIG = {
    parallaxMultiplier: 30,   // 视差强度：更大 = 更明显的3D效果（建议 10~60）
    smoothness: 0.08,         // 平滑度：更小 = 更平滑但有延迟（建议 0.05~0.15）
    hideDebugPanel: false,    // 设为 true 隐藏调试面板
};
```

或者在壁纸运行时通过右上角的调试面板实时调整。

---

## 如何在 Lively Wallpaper 中使用

### 步骤 1：安装 Lively Wallpaper

- [Microsoft Store 免费下载](https://www.microsoft.com/store/productId/9NTM2QC6QWS7)
- 或从 [GitHub Releases](https://github.com/rocksdanister/lively/releases) 下载

### 步骤 2：添加壁纸

1. 打开 Lively Wallpaper
2. 点击左下角 **"+"（添加壁纸）** 按钮
3. 选择 **"网页 / Web"** 类型
4. 在 URL 字段中输入本地 HTML 文件路径，例如：
   ```
   file:///C:/Users/你的用户名/Desktop/项目/壁纸/index.html
   ```
5. 点击 **"确定"** 或 **"添加"**

### 步骤 3：配置壁纸行为

在 Lively 中对新添加的壁纸右键 → 设置：

- **当桌面获得焦点时暂停**：建议关闭（这样鼠标移动时始终有视差效果）
- **在全屏应用时暂停**：建议开启（游戏/全屏视频时节省资源）

### 步骤 4：隐藏调试面板

壁纸配置好后，修改 `app.js` 中的配置：

```javascript
hideDebugPanel: true,
```

---

## 在 Wallpaper Engine 中使用

1. 打开 Wallpaper Engine
2. 点击右下角 **"从文件安装"** → **"打开本地壁纸"**
3. 选择项目中的 `index.html`
4. 确认导入即可

同样建议在导入前将 `hideDebugPanel` 设为 `true`。

---

## 深度图生成工具 — 命令行参考

```bash
# 查看帮助
python generate_depth_map.py --help

# 基本用法
python generate_depth_map.py wallpaper.jpg

# 指定输出路径
python generate_depth_map.py photo.png -o my_depth_map.png

# 使用 Base 模型（更高质量）
python generate_depth_map.py photo.jpg -m base

# 反转深度图（黑色=近景，白色=远景）
python generate_depth_map.py photo.jpg --invert

# 强制使用 CPU
python generate_depth_map.py photo.jpg --device cpu
```

---

## 技术架构说明

| 层级 | 技术 | 作用 |
|------|------|------|
| 渲染引擎 | **Pixi.js v7** (CDN) | WebGL 加速的 2D 渲染 |
| 核心滤镜 | **DisplacementFilter** | 基于深度图的像素位移 |
| 动画算法 | **Lerp 线性插值** | 平滑的惯性阻尼效果 |
| 交互输入 | **mousemove** 事件 | 实时鼠标位置追踪 |
| 坐标归一化 | **[-1, 1] 映射** | 屏幕分辨率无关的偏移计算 |
| 缩放模式 | **Cover** | 图片始终填满屏幕不留黑边 |
| 深度生成 | **Depth Anything V2** | AI 自动从图片生成深度图 |

### DisplacementFilter 原理简述

1. 滤镜读取深度图（`depth_map.png`）每个像素的颜色值
2. 颜色值决定该位置的"位移量"：白色位移最大，黑色不动
3. 根据鼠标位置动态改变滤镜的 `scale`（强度）
4. 白色区域（近景）大幅偏移 → 黑色区域（远景）几乎不动 → 形成视差

### Lerp 平滑原理

```
currentX += (targetX - currentX) × smoothness
```

每帧只移动"剩余距离"的一部分，smoothness 控制追赶速度。值越小越平滑但延迟越大。

---

## 离线使用说明

当前项目使用 CDN 引入 Pixi.js（需要联网）。如需完全离线使用：

1. 下载 [pixi.min.js v7.4.2](https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js)
2. 放到项目目录中
3. 修改 `index.html` 中的 script 标签：
   ```html
   <!-- 从 CDN -->
   <!-- <script src="https://cdn.jsdelivr.net/npm/pixi.js@7.4.2/dist/pixi.min.js"></script> -->

   <!-- 改为本地 -->
   <script src="pixi.min.js"></script>
   ```
