# 唱片机：每首歌一张封面 + 进度条拖动 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 歌单每首歌能有自己的封面（自带封面优先），切歌时唱片中间的图跟着换；设置页唱片机卡片里加能拖的进度条。

**Architecture:** 主进程新模块 `src/audio-cover.js` 读歌曲文件自带的封面、找同名图片、把读出的封面缓存成文件，经 IPC `vinyl:resolveCover` 给壁纸和设置页用。进度由壁纸窗口（音乐在那里放）推给主进程，主进程转给设置窗口；设置页拖完发 `vinyl:seek` 经主进程转回壁纸。

**Tech Stack:** Electron 28、原生 JS（全局脚本 + UMD 共享模块）、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-20-vinyl-cover-seek-design.md`

## Global Constraints

- 不加 npm 依赖。
- 软件不带任何默认封面图片和歌曲。
- 代码注释、界面文字用简体中文。
- 去掉 `vinyl.coverPath`；每首歌的自选封面存在 `vinyl.playlist[i].cover`。
- 找封面顺序：自选图（文件还在）→ 文件自带 → 同名图片（`.jpg` `.jpeg` `.png` `.webp`）→ 无。
- 进度不写进配置。
- 设置窗口 820×560 时不能出现横向滚动条。

## Review Focus

1. 刚切歌时拖进度条：设置页的 `current` 已经换了、壁纸还在报上一首的进度 → 不能把上一首的进度显示在新歌上，也不能跳错歌（`path` 对不上就丢弃）。测试：`cleanSeek` / 壁纸 `seek()` 比对 path（Task 3、4）。
2. 唱臂正从停靠位摆进来、还没出声时拖进度条 → 唱臂改摆到新位置，声音从新位置开始，不能卡住不出声。Task 4 真实应用里测。
3. 自带封面数据坏了、标签长度乱写、文件读到一半就完 → 当作没有封面，不抛异常。测试：截断的 ID3 / FLAC / MP4（Task 1）。
4. 自选图被删了 → 回退到自带封面 / 同名图片，"不用这张"按钮仍然能把 `cover` 去掉。测试：`CoverResolver` 自选图不存在（Task 1）。
5. 歌文件被挪走后（文件找回功能换了路径）→ 自选封面路径也要跟着找回。测试：`collectPaths` / `replacePaths` 带 `cover`（Task 2）。

---

### Task 1: 读自带封面、找封面、缓存（`src/audio-cover.js`）

**Files:**
- Create: `src/audio-cover.js`
- Test: `test/audio-cover.test.js`

**Interfaces:**
- Produces:
  - `sniffImage(buf: Buffer) → { mime: string, ext: string } | null`（jpeg / png / gif / webp / bmp）
  - `readEmbeddedCover(read: (offset, length) => Promise<Buffer>, size: number) → Promise<Buffer | null>`：按开头字节认 ID3 / fLaC / mp4；ID3 后面紧跟 fLaC 时 ID3 里没图就接着读 FLAC
  - `sidecarCover(audioPath: string, exists: (p) => boolean) → string`（没有为 `''`）
  - `class CoverResolver { constructor({ cacheDir }); resolve({ path, cover }) → Promise<{ file: string, source: 'manual'|'embedded'|'sidecar'|'none' }>; prune(playlist) → Promise<number> }`

- [ ] **Step 1: 写失败的测试**：手工拼字节的辅助函数（`id3(version, frames, { unsync })`、`apic(type, data)`、`pic22(data)`、`flac(blocks)`、`mp4Cover(data, { moovLast })`），测试：
  - ID3v2.3 两张图，返回 picture type 3 那张；没有 type 3 时返回第一张
  - ID3v2.4 syncsafe 帧长 + 帧级反同步（图片里有 `FF 00`）解对
  - ID3v2.3 整个标签反同步解对；ID3v2.2 `PIC`
  - FLAC `PICTURE` 块；ID3 在前、后面是 FLAC 的
  - mp4 `moov` 在 `mdat` 后面也能找到 `covr`
  - 截断 / 长度乱写 / 不是图片的数据 → `null`，不抛异常
  - `sidecarCover` 按 jpg → jpeg → png → webp 找
  - `CoverResolver`（临时目录）：自选图存在 → manual；自选图不存在 → 回退 embedded；第二次 resolve 不重写缓存文件；同名图片 → sidecar；都没有 → none；`prune` 删掉不属于歌单的缓存文件
- [ ] **Step 2: 跑测试确认失败**：`node --test test/audio-cover.test.js` → 找不到模块
- [ ] **Step 3: 实现**。要点：用 `fs.promises` 读（不阻塞主进程）；ID3 标签最多读 32MB、mp4 的 `moov` 最多读 64MB；缓存文件名 = sha1(小写路径 | 大小 | 修改时间) 前 16 位 + 扩展名；内存里记住每个 key 的结果（含"没有自带封面"）。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交** `feat: 读歌曲文件自带的封面，找同名图片，缓存成文件`

### Task 2: 歌单里的 `cover` 字段

**Files:**
- Modify: `shared/playlist.js`（`toTrack` 保留非空字符串 `cover`；`normalizeVinyl` 去掉 `coverPath`；新增 `setTrackCover(list, trackPath, cover) → list`，`cover` 为 `''` 时删掉字段）
- Modify: `src/store.js`（默认值删掉 `coverPath`）
- Modify: `src/file-tracking/paths.js`（收集、替换 `playlist[].cover`，删掉 `coverPath`）
- Test: `test/playlist.test.js`、`test/file-paths.test.js`、`test/store.test.js`

- [ ] **Step 1: 写失败的测试**：`normalizeVinyl({ playlist: [{ path, cover: 'C:/c.png' }], coverPath: 'x' })` 保留 cover、没有 `coverPath`；`setTrackCover` 设置和清除；`collectPaths` 含 cover；`replacePaths` 换掉 cover；旧配置的 `coverPath` 保存后从磁盘上消失
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: `npm test` 全过**
- [ ] **Step 5: 提交** `feat: 歌单每首歌可以记一张自选封面，去掉整台唱片机共用的封面`

### Task 3: 主进程和 preload 的接口

**Files:**
- Modify: `shared/vinyl-player.js`：`cleanProgress(msg) → { path, currentTime, duration, playing } | null`、`cleanSeek(msg) → { path, time } | null`（数字要有限、不为负，path 非空字符串）
- Modify: `main.js`：`vinyl:resolveCover`（invoke）、`vinyl:progress` / `vinyl:seek` / `vinyl:requestProgress`（send，转发；progress 只在设置窗口显示着时转）、启动后 `prune`；`dialog:selectCover` 标题改成"选择这首歌的封面图片"
- Modify: `preload.js`：`electronAPI.vinyl = { resolveCover, seek, requestProgress, onProgress, sendProgress, onSeek, onProgressRequest }`
- Test: `test/vinyl-player.test.js`

- [ ] **Step 1: 写失败的测试**：`cleanSeek({ path: 'a', time: 3 })` 通过；NaN / 负数 / 没有 path → `null`；`cleanProgress` 的 duration 是 NaN 时变 0
- [ ] **Step 2–4: 实现、`npm test` 全过**
- [ ] **Step 5: 提交** `feat: 唱片机封面和播放进度的 IPC`

### Task 4: 壁纸上的唱片机

**Files:**
- Modify: `renderer/vinyl.js`、`renderer/main.js`

**Interfaces:**
- Consumes: `electronAPI.vinyl.resolveCover / sendProgress / onSeek / onProgressRequest`
- Produces: `VinylPlayerManager#seek(path, time)`、`#reportProgress()`、`onProgress` 回调

- [ ] **Step 1: 封面**：`setConfig` 里换成按"当前歌 path + cover"变了才去 resolve，结果回来时 key 还对才换图；没有封面显示原来的纯色标签。`applyRelocations` 去掉 `currentCoverPath` 那行。
- [ ] **Step 2: 进度**：`timeupdate`、`durationchange`、`seeked`、`play`、`pause`、`emptied` 时 `reportProgress()`。
- [ ] **Step 3: 跳转**：path 对不上、时长未知就不跳；限制在 `[0, duration]`；没要播放 → 只改位置；在出声 → `recue()`；要播放但还没出声（唱臂在摆）→ `play()` 重来。
- [ ] **Step 4: 浏览器预览（`index.html`）打开无报错**
- [ ] **Step 5: 提交** `feat: 壁纸上的唱片机按每首歌换封面，能跳到指定位置`

### Task 5: 设置页

**Files:**
- Modify: `settings.html`、`settings/music-page.js`、`settings/settings.css`、`settings/main.js`（把 `onPageChange` 传给唱片机页）

- [ ] **Step 1: 封面**：按"path|cover"缓存 resolve 结果，窗口重新获得焦点时清掉重问；卡片唱片、每行小封面按钮（点了换图，不播放）、"唱片封面"一行显示当前这首的来源，"更换…"、"不用这张"（有自选图时才显示）。
- [ ] **Step 2: 进度条**：`.player-text` 里加一行 `当前时间 + range + 总长`；拖动中不吃进度广播；`change` 时 `seek`；切到唱片机页、窗口获得焦点时 `requestProgress`；进度的 path 不是当前歌、时长未知时禁用并显示 `--:--`。
- [ ] **Step 3: 浏览器打开 `settings.html` 看样子；820×560 无横向滚动**
- [ ] **Step 4: 提交** `feat: 设置页唱片机每首歌的封面和进度条`

### Task 6: 真实应用验证 + 文档

- [ ] 单独的数据目录启动 Electron，用 `壁纸素材/唱片机/` 两首 + ffmpeg 做的带封面 mp3 / flac / m4a 副本，测设计文档"测试"一节列的情况
- [ ] 更新 `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`（配置结构、IPC 表、文件结构、阶段记录、删掉 `coverPath` 那条注意事项）
- [ ] 提交 `docs: 记录每首歌的封面和进度条`
