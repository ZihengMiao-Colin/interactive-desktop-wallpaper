# 解锁动画 — 设计

> 2026-11-05。用户想让电脑解锁时有一段自定义的全屏动画：输完密码按回车，全屏播放导入的视频，带淡入淡出，播完回到桌面。写这份文档之前做了一次性实验（几种窗口做法，真实锁屏解锁），下面选定的窗口做法有实测结果。实验程序放在临时目录，没有进项目，关键配置已经抄进本文。

## 为什么做、做成什么样

- 这是一个**单独加的功能**，和壁纸本身没有依赖：用户可以给解锁这一刻配一段自己的视频，让每次打开电脑都有仪式感。
- Windows 不支持在锁屏界面和输密码界面放视频，所以动画只能在解锁之后放。这样也不用改系统文件、不用管理员权限。
- GitHub 上没找到"解锁后放自定义视频"的现成项目。最接近的 [AutoBloom](https://github.com/willnode/autobloom) 只在登录时播放，靠计划任务启动 mpv，没有可以直接用的代码。

## 目标

1. 用户能在设置里导入一个本地视频，并开关这个功能。
2. 每次解锁后，视频**完全盖住主显示器，包括任务栏**（Cover 方式铺满，比例不符时裁切），解锁瞬间看不到桌面和任务栏。
3. 开头从黑屏淡入视频，结尾直接淡出到真实桌面，不再经过黑屏。
4. 淡入、淡出时长用户可以自己调，默认淡入 0.5 秒、淡出 0.7 秒（实测用户觉得合适）。
5. 视频只放一遍，放完回到解锁前的状态：桌面正常显示，焦点还在用户原来的程序上。
6. 设置页有「预览」，不用真的锁屏就能看效果。

## 不做

- 在锁屏界面、输密码界面放视频（系统不支持）。
- 开机后第一次登录放动画（用户定的）：那时程序还没启动，动画要等开机自启后才能放，桌面会先露出来。
- 多个视频、随机播放、按时间段换视频。第一版只有一个视频。
- 副显示器：项目本来就只支持主显示器，副显示器在动画期间照常显示。
- 剪辑、裁剪、音量滑块、「短时间内解锁不重复播放」。
- 改系统锁屏图片、注册计划任务、修改系统文件。
- 安卓版不跟着做。

## 做出来也算失败的情况

- 用户被卡在黑屏或全屏窗口里出不来（这是最严重的）。
- 解锁瞬间先闪一下桌面或任务栏。
- 任务栏露在视频外面。
- 放完动画，用户原来的程序丢了焦点。
- 平时不锁屏的时候也占着窗口、GPU 或内存。全屏窗口只在锁屏到动画结束这段时间存在。
- 动画的声音和壁纸、唱片机的声音叠在一起。

## 实验结论（已实测）

环境：Windows 11 Pro 26200，Electron 28.3.3，主显示器 2560×1600、缩放 150%，输密码解锁。每种做法只测了一次。

| 方案 | 做法 | 用户看到的 | 解锁事件到视频第一帧 |
|---|---|---|---|
| A | 解锁事件到了才建窗口 | **先看到桌面** | 271 毫秒 |
| B | 锁屏时摆好窗口（窗口大小被裁了） | 没看到桌面，**任务栏露在外面** | 43 毫秒 |
| C | 同 B，再关掉 `CalculateNativeWinOcclusion` | 同 B，没有额外好处 | 117 毫秒 |
| F | 同 B，建好窗口后再 `setBounds` | **全盖住，没闪** | 37 毫秒 |
| G | 同 F，合盖或睡眠后唤醒解锁 | **全盖住，没闪** | 44 毫秒 |

由此得出的结论，实现时不要改掉：

- **必须在锁屏时就摆好窗口。** 日志显示，锁屏界面让开比 `unlock-screen` 事件还早 11 ~ 32 毫秒，等事件到了再建窗口一定来不及。
- **必须在窗口建好后再调一次 `setBounds`。** `BrowserWindow` 的构造参数会被裁到工作区（屏幕减去任务栏），2560×1600 的屏幕上窗口只有 1530 高。量了八种配置：建好后 `setBounds` 能铺满（实际 2561×1601，多 1 像素没影响）；可调整大小的窗口用 `setFullScreen` 也能铺满（这个只在没锁屏时量过，没有真实解锁测过）；`resizable: false` 时 `setFullScreen` 和 Win32 `SetWindowPos` 都不起作用。
- **窗口不抢焦点。** `focusable: false` 加 `showInactive()`，解锁后 6 ~ 38 毫秒前台窗口就回到用户原来的程序，放完也还在。
- **不用改 Chromium 的设置。** 有 `backgroundThrottling: false`，窗口在锁屏全程都正常渲染，`document.visibilityState` 一直是 `visible`。
- **睡眠也能走同一条路。** `lock-screen` 比 `suspend` 早约 90 毫秒，窗口来得及建好；睡眠 25 秒后窗口和视频都正常。
- **Esc 跳过有效。** 窗口不能获得焦点，所以 Esc 走 `globalShortcut`，实测两次都正常淡出。
- **淡出用窗口透明度。** 主进程每 16 毫秒调一次 `setOpacity`，能直接看到真实桌面，不用透明窗口。

## 解锁时发生什么

```
锁屏（lock-screen）
  → 功能开着、视频文件在：建全屏窗口，黑底，视频预加载后停在开头。窗口藏在锁屏界面下面，用户看不到
用户输密码解锁（unlock-screen）
  → 通知窗口开始：视频从透明淡入（黑底上就是从黑屏淡入），开始播放，注册 Esc
快放完时（视频时长 − 淡出时长）
  → 窗口整体变透明，露出真实桌面。视频继续放，画面在动着消失
淡出结束
  → 销毁窗口，回到什么都没有的状态
```

状态：`idle` → `preparing`（窗口在建、视频在加载）→ `ready`（等解锁）→ `playing` → `fadingOut` → `idle`。

几个边界：

- 解锁时视频还没加载好（`preparing`）：加载好马上放，最多等 3 秒，超时就关窗口。
- 解锁时没有窗口（`idle`，比如漏了锁屏事件）：当场建窗口播放，可能闪一下桌面，但动画照常放。
- 动画放到一半又锁屏：销毁当前窗口，重新走锁屏流程。
- 连续收到两次 `lock-screen`：第二次不管。
- 淡入加淡出比视频还长：按比例缩短两段，保证不超过视频时长。
- 淡入或淡出设成 0：直接切换，不走动画。
- 解锁时再设一次 `setBounds`，防止锁屏期间接了显示器、改了分辨率；再调一次 `moveTop()`，任务栏是前台窗口时（比如锁屏前刚点过它）会盖在全屏窗口上面。
- 远程桌面会话里不放（`GetSystemMetrics(SM_REMOTESESSION)`）。
- 正在摆放元素时不放。

## 全屏窗口

下面这组配置是实测通过的：

```js
const bounds = screen.getPrimaryDisplay().bounds;
const win = new BrowserWindow({
    ...bounds,
    frame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    focusable: false,          // 不抢焦点，用户原来的程序继续是前台
    hasShadow: false,
    backgroundColor: '#000000',
    webPreferences: { preload, backgroundThrottling: false },
});
win.setBounds(bounds);         // 构造参数被裁到了工作区，这里才真正铺满、盖住任务栏
win.setAlwaysOnTop(true, 'screen-saver');
win.loadFile(pagePath, { query });
win.showInactive();
```

页面只有一个 `<video>`：`object-fit: cover`，默认 `opacity: 0`，开始时加上过渡，淡入时长用配置里的值。页面不要跑 `requestAnimationFrame` 循环，否则锁屏期间也在空转（实验时这台电脑上是每秒 240 次）。

## 跳过和出问题时

用户在任何时候都不能被卡住，所以有好几层保险：

| 情况 | 处理 |
|---|---|
| 按 Esc | 走淡出。`globalShortcut` 从解锁开始注册，淡出时注销。**锁屏期间不注册**：锁屏界面也可能按 Esc，不能把动画取消掉 |
| 点鼠标 | 走淡出。任何状态下点全屏窗口都有效，所以就算收不到解锁事件，用户也能点掉。要监听 `mouseup`：窗口不能激活，Chromium 的子窗口隐藏时 `mousedown` 会被主窗口吞掉，只收得到松开 |
| Esc 注册失败（被别的程序占了） | 记日志，点鼠标仍然有效 |
| 视频文件不见了、解不了 | 锁屏时发现就不建窗口；播放时出错就直接关窗口。解锁后用户只看到正常桌面，不弹提示 |
| 视频 3 秒内加载不好 | 关窗口 |
| 放的时候卡住 | 看门狗：解锁后超过「视频时长 + 淡入 + 5 秒」强制走淡出；时长未知按 120 秒 |
| 收不到解锁事件 | 窗口在 `preparing`、`ready` 时每秒查一次 `powerMonitor.getSystemIdleState(1)`。**读到过 `locked` 之后**，连续两次不是 `locked` 才当解锁处理。加了"读到过"这个条件：万一它读不出 `locked`，也只是这层保险不起作用，不会在锁屏时误触发。实测时每次锁屏都读到了 `locked` |
| 渲染进程崩溃、无响应 | `render-process-gone`、`unresponsive` 时销毁窗口 |
| 程序退出 | `cleanupAndQuit` 里销毁窗口，不留置顶窗口 |

## 设置页

导航加一页「解锁动画」，放在「唱片机」和下面的间隔之间。页面从上到下：

- **开关**「解锁时播放动画」。没有视频时不能打开。
- **视频**：缩略图、文件名、时长，「选择视频…」和「移除」。没有视频时显示空状态。选完视频自动打开开关。
- **淡入时长**、**淡出时长**：滑块，0 ~ 3 秒，步长 0.1 秒，显示当前秒数。
- **声音**：开关，默认关，免得在安静的地方突然响。
- **「预览」按钮**：不用锁屏，走同一个窗口和同一段播放逻辑，Esc 和点鼠标同样能跳过。
- **提示**：开机自启没开时，提示"程序要在运行才能播放，建议打开开机自启"。视频文件找不到时，提示重新选择。

按项目现有的控件和风格写（`settings/controls.js`、`ui/tokens.css`）。

## 数据

```js
unlockAnimation: {
    enabled: false,
    file: '',        // userData/unlock_animation/ 里的文件名，只存文件名
    name: '',        // 原文件名，只用来显示
    thumb: '',       // 同目录下的缩略图文件名
    duration: 0,     // 秒
    fadeInMs: 500,   // 0 ~ 3000
    fadeOutMs: 700,  // 0 ~ 3000
    sound: false,
}
```

- 放进 `NESTED_KEYS`，`getConfig` 里补默认值，时长压到范围内。
- **视频复制一份**到 `userData/unlock_animation/`，用 ASCII 文件名。解锁时用户没法处理"文件在 U 盘上拔掉了"这种事，所以这里和「我的壁纸」只记路径的做法不同。
- 导入流程：对话框选文件 → 设置页用 `makeThumbnailInfo` 确认 Chromium 能解、取缩略图和时长 → 主进程用异步方式复制 → 写配置 → 删旧文件。删不掉（文件被占用）就下次启动时清理，和元素素材的 `cleanupOrphanFiles` 一样。
- 格式沿用 `shared/my-wallpapers.js` 的 `VIDEO_EXTENSIONS`。
- `userData` 卸载时整个删除，不用动 `build/installer.nsh`。

## 和壁纸的配合

- 控制器的 `holdsWallpaper` 并进 `syncWallpaperSignal` 的 `system`：解锁后壁纸继续暂停，动画进入淡出时才恢复。这样不会抢 GPU，淡出时露出来的桌面已经在动。`nextWallpaperSignal` 不用改。
- 唱片机锁屏时本来就不停（暂停路径不碰它），所以单独处理：动画开着声音时，唱片机音量渐变到 0，淡出时渐变回来，只改音量，不碰播放状态和配置。动画静音时音乐照常响。动画的声音在淡出时也跟着降下去。
- 顺序要注意：`unlock-screen` 的处理里，要先调 `handleUnlock`，再清 `isScreenLocked` 并调 `syncWallpaperSignal`，否则壁纸会先恢复一下又暂停，声音会响一下。
- `FullscreenDetector` 已经用 `ignorePid` 忽略本程序的窗口，而且窗口不是前台，不用改。

## 现有代码大概要动的地方

| 位置 | 改动 |
|---|---|
| `shared/unlock-animation.js`（新） | 纯逻辑：配置补全和时长范围、淡出开始时间、状态转换 |
| `src/unlock-animation/controller.js`（新） | 窗口生命周期和状态机，依赖从外面传入，方便测试 |
| `src/unlock-animation/ipc.js`（新） | `unlock:*` IPC，写法参考 `src/elements/ipc.js` |
| `src/unlock-animation/preload.js`（新） | 全屏窗口用的最小 preload，不复用大的 `preload.js` |
| `renderer/unlock-player.html`、`renderer/unlock-player.js`（新） | 全屏窗口的页面 |
| `settings/unlock-page.js`（新）、`settings.html`、`settings/settings.css`、`settings/main.js` | 设置页 |
| `main.js` | 建控制器、`setupPowerMonitor` 里调它、`syncWallpaperSignal`、`cleanupAndQuit` |
| `preload.js` | 暴露 `unlockAnimation` 命名空间 |
| `src/store.js` | 默认配置、`NESTED_KEYS`、目录 |
| `src/win32.js` | 是否远程会话 |
| `README*`、`PROJECT_NOTES*` | 中英文同步更新 |

`package.json` 的 `build.files` 已经包含 `src/**/*` 和 `renderer/**/*`，新文件放在这两个目录下不用改打包配置。

`lock-screen` 的处理要同步开始建窗口，不能等异步操作：睡眠时离 `suspend` 只有约 90 毫秒。

## 验证

单元测试（`test/unlock-animation.test.js`）：配置补全、时长范围、淡入淡出比视频长时的缩短、按事件顺序走状态机（正常流程、加载超时、播放出错、动画中再次锁屏、重复锁屏事件、没窗口时解锁）。

自动检查：用 `powerMonitor.emit` 模拟锁屏解锁，走完整流程；用 `WindowFromPoint` 确认屏幕底部中间最上面是全屏窗口；确认动画结束后窗口已经销毁。

**必须由用户实测**（模拟事件测不出闪屏）：

- Win+L 解锁、合盖或睡眠后解锁：全盖住、没闪、焦点还在原来的程序。
- PIN、指纹、人脸解锁（实验没测）。
- Esc 跳过、点鼠标跳过（实验没测过点鼠标）。
- 开声音时有声音，壁纸和唱片机的声音不叠加（唱片机让路，放完恢复）。
- 视频文件被删掉后解锁：不放，正常进桌面。
- 接外接显示器时，动画放在主显示器上，副显示器不受影响。
- 打包后的安装版：上面的主要流程再走一遍。

## 我替用户定的（可以改）

用户没有明说，是我选的：

- 每次解锁都放，包括睡眠唤醒后的解锁，不限次数。
- 默认不出声。
- Esc 和点鼠标都能跳过。
- 视频复制一份到数据目录，不只记路径。
- 比例不符时裁切铺满（Cover），不留黑边。
- 第一版只有一个视频。
- 视频时长不设上限。
- 副显示器照常显示桌面。
- 全屏游戏里锁屏再解锁也照放，能跳过；独占全屏游戏里的表现没测过。
- 新开一页「解锁动画」，不放进「特效」或「设置」页。

## 留给实现时决定

- 淡入淡出时声音要不要跟着渐变。
- 快放完的判断用 `timeupdate` 还是 `requestVideoFrameCallback`（实验用的 `timeupdate`，误差约 0.25 秒，够用）。
- 导航图标、提示文案、大文件复制时的进度显示。
- 控制器和 `shared/` 里纯逻辑的具体划分。
