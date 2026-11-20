# 导入的文件挪了、改了名也能接着用 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「我的壁纸」、歌单和封面、视频特效里自己的视频，在同一个盘里被移动或改名后自动接上；接不上时点一下手动接上，同一个旧文件夹里的顺带接上。

**Architecture:** 主进程新模块 `src/file-tracking/`：`file-id.js` 用 `fs.stat` 读 NTFS 文件编号、用 koffi 调 kernel32 的 `OpenFileById` 按编号查现在的路径；`tracker.js` 把编号记在 `userData/file_ids.json`，负责"找不到时按编号找回 + 校验"；`paths.js` 是纯逻辑（收集配置里的路径、批量换路径、顺带接上的换算）；`index.js` 把它们和 `AppStore`、窗口广播接起来（启动 / 设置窗口获得焦点 / 每 60 秒扫描，`files:locate`、`files:relink` 两个 IPC）。窗口收到 `files:relocated` 后把自己记着的路径换掉，不重新加载。

**Tech Stack:** Electron 28 主进程（CommonJS）、koffi 3.3.6、Node 内置 `node --test`。

**Spec:** `docs/superpowers/specs/2026-11-20-file-relocation-design.md`

## Global Constraints

- 只在 Windows 上跑；用户可见的文字都是简体中文，代码注释中文。
- 不复制、不修改用户的原文件；不在整个硬盘里搜文件。
- 宁可显示"找不到文件"，也不能把别的文件当成原来的接上：自动找回必须同时满足 不在 `$Recycle.Bin` 下、同一类文件、大小一样、`dev` + `ino` 一样。
- 网络路径（`\\` 开头或网络盘符）、安装目录 / `resources` 里的文件、userData 里的文件、默认壁纸都不记编号、不扫描。
- 扫描不能卡住主进程；任何一步出错都当"找不到"，不抛到外面。
- 自动找回不弹提示，只写一行日志；手动接上在设置窗口状态栏提示。
- 编号记录放 `userData/file_ids.json`，不进 `config.json`。
- 扫描时机：启动时（建窗口之前）、设置窗口获得焦点、每 60 秒。
- 改动按项目惯例在功能分支 `feat/file-relocation` 上提交，提交信息中文，结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. 网络路径、拔掉的 U 盘、空光驱上的路径出现在配置里：扫描要立刻跳过，不能等系统超时，也不能报错（Task 3 测试）。
2. 异步扫描期间用户改了配置（比如刚移除了那一格）：换路径要对处理那一刻的最新配置做，配置里已经没有的路径什么都不改（Task 1、Task 5 测试）。
3. 同一个文件被两处引用（既是壁纸又是视频特效，或者当前壁纸同时在「我的壁纸」里）：两处一起换（Task 1 测试）。
4. 升级的老用户：没有 `file_ids.json`、或者文件损坏，按空记录处理；第一次扫描给现在还在的文件补记编号（Task 3 测试）。
5. 正在放的歌、正在播的视频特效被挪走：路径更新后不从头重放；唱片机因为文件不在而放不了时先找一次再决定跳不跳（Task 8 实机验证）。

---

### Task 0: 开分支

- [ ] **Step 1:** `git switch -c feat/file-relocation`（从 `main`）。设计文档 `docs/superpowers/specs/2026-11-20-file-relocation-design.md` 和本计划一起在 Task 1 的提交里加进去。

---

### Task 1: 路径纯逻辑 `src/file-tracking/paths.js`

**Files:**
- Create: `src/file-tracking/paths.js`
- Test: `test/file-paths.test.js`

**Interfaces:**
- Consumes: `shared/my-wallpapers.js` 的 `samePath`；`shared/playlist.js` 的 `trackName`。
- Produces:
  - `fileKind(filePath: string) => 'image' | 'video' | 'audio' | null`（按扩展名，不分大小写）。image：jpg jpeg png webp bmp gif；video：mp4 webm mov m4v mkv；audio：mp3 wav flac ogg m4a aac。
  - `collectPaths(config) => string[]`：配置里所有用户文件路径，按 `samePath` 去重，去掉空值。字段：`myWallpapers[].path`、`currentImage`、`currentImageCrop.path`、`currentVideo.path`、`currentVideo.imageAtTime`、`vinyl.playlist[].path`、`vinyl.current`、`vinyl.coverPath`、`videoOverlay.customPath`。
  - `replacePaths(config, moves: Array<{from, to}>) => object | null`：返回要交给 `store.saveConfig` 的部分配置，只包含真的变了的顶层键（`myWallpapers`、`currentImage`、`currentImageCrop`、`currentVideo`、`vinyl`、`videoOverlay`）；一个都没变返回 `null`。匹配用 `samePath`。歌的 `name` 等于 `trackName(from)` 时换成 `trackName(to)`；`videoOverlay.customName` 等于 `from` 的文件名（带扩展名）时换成 `to` 的文件名；别的名字不动。`vinyl` / `videoOverlay` 返回整段（`saveConfig` 对这两段是浅合并，整段给也对）。
  - `relinkMoves({ from, to, missing: string[], exists: (p) => boolean }) => Array<{from, to}>`：第一项永远是 `{ from, to }`；`missing` 里其它路径凡是在 `from` 的文件夹下面（不分大小写），按相对位置拼到 `to` 的文件夹下，`exists` 为真且 `fileKind` 一样的也加进去。用 `path.win32`。

- [ ] **Step 1: 写测试 `test/file-paths.test.js`**

```js
test('fileKind 按扩展名分三类，不认识的是 null', () => {
    assert.equal(fileKind('C:\\a\\B.JPG'), 'image');
    assert.equal(fileKind('C:\\a\\b.gif'), 'image');
    assert.equal(fileKind('C:\\a\\b.m4v'), 'video');
    assert.equal(fileKind('C:\\a\\b.flac'), 'audio');
    assert.equal(fileKind('C:\\a\\b.txt'), null);
    assert.equal(fileKind('C:\\a\\noext'), null);
});

test('collectPaths 收集所有字段并去重', () => {
    const config = {
        myWallpapers: [{ path: 'C:\\w\\a.jpg', type: 'image' }, { path: 'C:\\w\\v.mp4', type: 'video' }],
        currentImage: 'c:/w/A.jpg',                       // 和第一格是同一个文件
        currentImageCrop: { path: 'C:\\w\\a.jpg', x: 0, y: 0, w: 1, h: 1 },
        currentVideo: { path: 'C:\\w\\v.mp4', imageAtTime: 'C:\\w\\old.png' },
        vinyl: { playlist: [{ path: 'D:\\m\\s.mp3', name: 's' }], current: 'D:\\m\\s.mp3', coverPath: 'D:\\m\\c.png' },
        videoOverlay: { customPath: 'C:\\w\\v.mp4' },
    };
    assert.deepEqual(collectPaths(config).sort(), ['C:\\w\\a.jpg', 'C:\\w\\old.png', 'C:\\w\\v.mp4', 'D:\\m\\c.png', 'D:\\m\\s.mp3'].sort());
    assert.deepEqual(collectPaths({}), []);
});

test('replacePaths 换掉每一处引用，包括 imageAtTime 和 vinyl.current', () => { /* 同上配置，moves 覆盖 a.jpg、v.mp4、s.mp3、c.png、old.png；逐字段 assert 新路径；currentImageCrop 的 x/y/w/h 不变；myWallpapers 其它字段（crop、thumb、effect）不变 */ });

test('replacePaths 同一个文件被壁纸和视频特效同时引用时两处都换', () => { /* v.mp4 → E:\\x\\v2.mp4：myWallpapers[1].path、currentVideo.path、videoOverlay.customPath 都是新路径 */ });

test('replacePaths 歌名和视频特效名等于旧文件名时跟着换，用户改过的不动', () => {
    // playlist: [{ path: 'D:\\m\\s.mp3', name: 's' }, { path: 'D:\\m\\t.mp3', name: '我的歌' }]
    // videoOverlay: { customPath: 'C:\\w\\v.mp4', customName: 'v.mp4' }
    // moves: s.mp3 → 'D:\\m\\新名字.mp3'，t.mp3 → 'D:\\n\\t2.mp3'，v.mp4 → 'C:\\w\\v2.mp4'
    // 期望：name '新名字'、'我的歌'；customName 'v2.mp4'
});

test('replacePaths 不分大小写和斜杠方向；没变的段不出现在结果里', () => {
    // 只有 currentImage 'C:\\W\\A.JPG'，move from 'c:/w/a.jpg' → 结果只有 currentImage 一个键
});

test('replacePaths 配置里没有这些路径时返回 null', () => {
    assert.equal(replacePaths({ currentImage: 'C:\\a.jpg' }, [{ from: 'C:\\b.jpg', to: 'C:\\c.jpg' }]), null);
});

test('relinkMoves 第一项是用户选的，同一个旧文件夹（含子文件夹）里同类型且存在的顺带接上', () => {
    const exists = (p) => ['E:\\new\\b.jpg', 'E:\\new\\sub\\c.mp4', 'E:\\new\\d.png'].includes(p);
    const moves = relinkMoves({
        from: 'C:\\old\\a.jpg', to: 'E:\\new\\a2.jpg',
        missing: ['C:\\old\\a.jpg', 'C:\\OLD\\b.jpg', 'C:\\old\\sub\\c.mp4', 'C:\\old\\d.jpg', 'C:\\other\\e.jpg', 'C:\\old\\f.jpg'],
        exists,
    });
    assert.deepEqual(moves, [
        { from: 'C:\\old\\a.jpg', to: 'E:\\new\\a2.jpg' },
        { from: 'C:\\OLD\\b.jpg', to: 'E:\\new\\b.jpg' },
        { from: 'C:\\old\\sub\\c.mp4', to: 'E:\\new\\sub\\c.mp4' },
    ]); // d.jpg 新位置是 d.png 不算（文件名不同就不存在）；e.jpg 不在旧文件夹下；f.jpg 新位置不存在
});
```

- [ ] **Step 2:** `node --test test/file-paths.test.js`，期望 FAIL（`Cannot find module '../src/file-tracking/paths'`）。
- [ ] **Step 3:** 实现 `src/file-tracking/paths.js`（导出上面四个函数和三个扩展名数组 `IMAGE_EXTENSIONS`、`VIDEO_EXTENSIONS`、`AUDIO_EXTENSIONS`）。说明：设计文档写的是放 `shared/`，但只有主进程用、要用 Node 的 `path.win32`，所以放在 `src/file-tracking/`。
- [ ] **Step 4:** `node --test test/file-paths.test.js`，期望全过。
- [ ] **Step 5: 提交**（连同设计文档和本计划）

```bash
git add src/file-tracking/paths.js test/file-paths.test.js docs/superpowers/specs/2026-11-20-file-relocation-design.md docs/superpowers/plans/2026-11-20-file-relocation.md
git commit -m "feat: 文件找回的路径逻辑（收集、批量换路径、顺带接上）"
```

---

### Task 2: 文件编号 `src/file-tracking/file-id.js`

**Files:**
- Create: `src/file-tracking/file-id.js`
- Test: `test/file-id.test.js`

**Interfaces:**
- Produces:
  - `readFileId(filePath: string) => { vol: string, id: string, size: number } | null`：`fs.statSync(p, { bigint: true })`，`vol = dev.toString(16)`，`id = ino.toString()`，`size = Number(size)`；不是普通文件或出错返回 `null`。
  - `volumeOf(root: string) => string | null`：盘符根目录的 `dev` 十六进制。
  - `findPathById(record: { vol, id }, hintPath: string) => string | null`：按下面的步骤查现在的路径（不做类型、大小、回收站校验，那是 Task 3 的事）。
  - `isLocalDrivePath(filePath: string) => boolean`：不是 `\\` 开头、有盘符，`GetDriveTypeW(根目录)` 是 2（可移动）、3（固定）或 6（内存盘）。
- 实现要点（koffi 懒加载，和 `src/win32.js` 一样在函数第一次调用时 `require('koffi')`；加载失败时 `findPathById` 返回 `null`、`isLocalDrivePath` 返回 `false`）：
  - `FILE_ID_DESCRIPTOR`：`{ dwSize: uint32, Type: uint32, FileId: int64, pad: int64 }`，`dwSize = 24`，`Type = 0`（FileIdType），`FileId = BigInt(record.id)`。
  - 根目录句柄：`CreateFileW(root, 0, 7, null, 3 /*OPEN_EXISTING*/, 0x02000000 /*FILE_FLAG_BACKUP_SEMANTICS*/, 0)`；先用 `volumeOf(root)` 确认和 `record.vol` 一样。
  - `OpenFileById(hRoot, desc, 0x80 /*FILE_READ_ATTRIBUTES*/, 7, null, 0x02000000)`；`GetFinalPathNameByHandleW(h, buf, 1024, 0)`；去掉开头的 `\\?\`，以 `\\?\UNC\` 开头的返回 `null`。
  - 句柄（`-1` 表示失败）用完都 `CloseHandle`，放在 `finally` 里。
  - 文件头注释写清楚：同一个盘里移动、改名编号不变；跨盘移动、FAT32 / exFAT、ReFS 找不回；2026-11-20 实测普通用户权限可用。

- [ ] **Step 1: 写测试 `test/file-id.test.js`**（在 `os.tmpdir()` 下建临时目录，本机是 NTFS）

```js
test('readFileId 读出卷号、编号和大小；文件夹和不存在的文件返回 null', () => {
    // 写 'hello'（5 字节）→ { vol: /^[0-9a-f]+$/, id: /^\d+$/, size: 5 }；readFileId(dir) === null；readFileId(dir + '\\nope.jpg') === null
});

test('同一个盘里移动加改名后，findPathById 找到新路径', () => {
    // a\b\测试 壁纸.mp4 → 记 readFileId → rename 到 c\改了名字.mp4 → findPathById(rec, 旧路径) 和新路径 samePath
});

test('文件删掉后 findPathById 返回 null', () => {});

test('卷号对不上时 findPathById 返回 null', () => {
    // findPathById({ ...rec, vol: 'deadbeef' }, 旧路径) === null
});

test('isLocalDrivePath：本地盘是 true，UNC 和没有盘符的是 false', () => {
    assert.equal(isLocalDrivePath(os.tmpdir() + '\\x.jpg'), true);
    assert.equal(isLocalDrivePath('\\\\server\\share\\x.jpg'), false);
    assert.equal(isLocalDrivePath('relative\\x.jpg'), false);
});
```

- [ ] **Step 2:** `node --test test/file-id.test.js`，期望 FAIL（模块不存在）。
- [ ] **Step 3:** 实现 `src/file-tracking/file-id.js`。
- [ ] **Step 4:** `node --test test/file-id.test.js`，期望全过。
- [ ] **Step 5:** 提交 `feat: 按 NTFS 文件编号查文件现在的路径`。

---

### Task 3: 记编号和找回 `src/file-tracking/tracker.js`

**Files:**
- Create: `src/file-tracking/tracker.js`
- Test: `test/file-tracker.test.js`

**Interfaces:**
- Consumes: Task 1 的 `fileKind`、`samePath`；Task 2 的 `readFileId`、`findPathById`。
- Produces: `class FileTracker`
  - `constructor({ dataFile: string, shouldTrack: (p) => boolean, fileIds = require('./file-id'), access = fs.promises.access })`：构造时读 `dataFile`；不存在或 JSON 坏了按空记录 `{}`。记录的 key 是规范化路径（小写、`/` 换成 `\`），值 `{ path, vol, id, size }`。
  - `async record(paths: string[]) => void`：`shouldTrack` 为假的跳过；文件在的，没记过或者 `vol/id/size` 和记录不一样就更新；不在 `paths` 里的记录删掉；有变化才写盘。
  - `async findMoves(paths: string[]) => Array<{from, to}>`：`shouldTrack` 为真、`access` 失败（文件不在）、有记录的，调 `locate`，找到的收集起来。
  - `locate(fromPath: string) => string | null`：`findPathById(record, fromPath)` 拿到候选后校验：路径里没有 `\$recycle.bin\`（不分大小写）、`fileKind` 和 `fromPath` 一样、`readFileId(候选)` 的 `vol`、`id`、`size` 都和记录一样；任何异常返回 `null`。
  - `rename(moves: Array<{from, to}>) => void`：把记录从旧 key 挪到新 key（`path` 换成新路径），写盘。

- [ ] **Step 1: 写测试 `test/file-tracker.test.js`**（真文件、真 `file-id`，临时目录）

```js
test('记过编号的文件改名、挪到子文件夹后 findMoves 找到它', async () => {
    // record([a.jpg]) → rename 到 sub\b.jpg → findMoves([a.jpg]) 深等于 [{ from: a.jpg, to: sub\b.jpg }]
});

test('删掉的、挪进 $Recycle.Bin 文件夹的、改了大小的、换成别的扩展名的都找不回', async () => {
    // 四个文件分别 record；然后：删除 / rename 到 '$Recycle.Bin\\x.jpg' / rename 后追加字节 / rename 成 .txt
    // findMoves 返回 []
});

test('没记过编号的文件不见了时找不回，不报错', async () => {});

test('shouldTrack 为假的路径不记、不查（网络路径立刻跳过）', async () => {
    // shouldTrack: (p) => !p.startsWith('\\\\')；paths 里放 '\\\\no-such-host\\share\\a.jpg'
    // record 和 findMoves 都在 200ms 内返回，dataFile 里没有这条；access 桩记录被调用的路径，断言没调到它
});

test('file_ids.json 不存在或损坏时按空记录处理，record 之后写出合法 JSON', async () => {
    // dataFile 写入 '{坏的' → new FileTracker 不抛 → record([a.jpg]) → JSON.parse(读文件) 里有 a.jpg 的记录
});

test('record 删掉配置里已经不用的记录；原位置换成别的文件时更新记录', async () => {});

test('rename 把记录挪到新路径，之后 locate 用新路径的记录', async () => {});
```

- [ ] **Step 2:** `node --test test/file-tracker.test.js`，期望 FAIL。
- [ ] **Step 3:** 实现 `src/file-tracking/tracker.js`。
- [ ] **Step 4:** `node --test test/file-tracker.test.js`，期望全过。
- [ ] **Step 5:** 提交 `feat: 记住导入文件的编号，找不到时按编号找回并校验`。

---

### Task 4: 深度图缓存跟着改 key（`src/store.js`）

**Files:**
- Modify: `src/store.js`（深度图缓存一节，`getDepthCache` 附近）
- Test: `test/store.test.js`

**Interfaces:**
- Produces: `AppStore#moveDepthCache(oldPath: string, newPath: string) => boolean`：旧 key（`_hashPath(oldPath)`）没有条目返回 `false`；有就把深度图文件改名为同目录下 `${_hashPath(newPath)}.png`，索引里删旧 key、写新 key（`imagePath`、`depthFile` 换新的，`imageSize`、`imageMtimeMs`、`cachedAt` 保留），`_saveCacheIndex()`（会顺带重写卸载清单），返回 `true`。新 key 已有条目时覆盖（并删掉它原来的深度图文件）。改名失败返回 `false`，索引不动。

- [ ] **Step 1: 写测试**（加在 `test/store.test.js`）

```js
test('moveDepthCache 把缓存挪到新路径：旧路径查不到，新路径查得到且不用重新生成', () => {
    // 临时目录里建 img.png，saveDepthCache(img, dataUrl)；renameSync 到 moved.png；
    // moveDepthCache(img, moved) === true；hasDepthCache(moved) === true；getDepthCache(moved) === dataUrl 对应的内容；
    // depth_cache 目录里只剩一个 png，文件名是新 key
});

test('moveDepthCache 旧路径没有缓存时返回 false，不改索引', () => {});
```

- [ ] **Step 2:** `node --test test/store.test.js`，期望新加的两个 FAIL。
- [ ] **Step 3:** 实现 `moveDepthCache`。
- [ ] **Step 4:** `node --test test/store.test.js`，期望全过。
- [ ] **Step 5:** 提交 `feat: 深度图缓存可以跟着文件的新路径改 key`。

---

### Task 5: 主进程接线（`src/file-tracking/index.js`、`main.js`、`preload.js`）

**Files:**
- Create: `src/file-tracking/index.js`
- Modify: `main.js`（`startApp`、`broadcastConfig`、`createSettingsWindow`、`registerIpcHandlers` 里的 `myWallpapers:setThumb`）、`preload.js`
- Test: `test/file-tracking.test.js`

**Interfaces:**
- Consumes: Task 1 `collectPaths`、`replacePaths`、`relinkMoves`、`fileKind`；Task 3 `FileTracker`；Task 4 `store.moveDepthCache`；`shared/my-wallpapers.js` 的 `resolveCurrent`、`findEntry`、`samePath`。
- Produces: `createFileTracking({ store, dataFile, shouldTrack, sendToWindows, broadcastConfig, applyWallpaper, showRelinkDialog, log, tracker? }) => api`
  - `sendToWindows(channel, payload)`：发给壁纸窗口和设置窗口（main.js 里实现）。
  - `showRelinkDialog({ fromPath, kind }) => Promise<string | null>`：main.js 里用 `dialog.showOpenDialog(dialogParent(), …)` 实现，标题 `找到「${文件名}」现在的位置`，过滤器只放这一类的扩展名（Task 1 导出的数组）。
  - `api.scan() => Promise<void>`：同一时间只跑一个（正在跑就返回同一个 Promise）。`findMoves(collectPaths(config))` → 有结果就 `applyMoves` → `record(collectPaths(最新配置))`。整个包在 try/catch 里，出错只写日志。
  - `api.applyMoves(moves)`（内部用，导出给测试）：`replacePaths(store.getConfig(), moves)`（处理时的最新配置）为 `null` 就什么都不做；否则 `store.saveConfig(partial)`、每个 move `store.moveDepthCache`、`tracker.rename(moves)`、`sendToWindows('files:relocated', moves)`、`broadcastConfig()`、`log` 一行 `[FileTracking] 找回: from → to`。
  - `api.locate(filePath) => Promise<string | null>`：给 `files:locate` 用。文件在就返回原路径；否则 `tracker.locate`，找到就 `applyMoves([{ from, to }])` 并返回 `to`。
  - `api.relink(fromPath) => Promise<{ to, count } | { canceled: true } | { error: string }>`：`showRelinkDialog`；取消返回 `{ canceled: true }`；`fileKind` 不一样返回 `{ error: '要选同一种文件' }`；`fromPath` 是「我的壁纸」里的、而选的文件已经是另一格：`{ error: '这个文件已经在「我的壁纸」里了' }`；否则 `missing = collectPaths(config).filter(p => !fs.existsSync(p))`、`relinkMoves(...)`、`applyMoves`；移动的路径里有当前壁纸（`resolveCurrent` 在 apply 之前取）就 `applyWallpaper(resolveCurrent(最新配置))`；返回 `{ to, count: moves.length }`。
  - `api.noteConfigChanged()`：去抖 2 秒后 `record(collectPaths(config))`。
  - `api.start()` / `api.stop()`：每 60 秒 `scan()`（`setInterval(...).unref()`）。
  - `api.registerIpc(ipcMain)`：`files:locate`（参数 `filePath`）→ `locate`；`files:relink`（参数 `fromPath`）→ `relink`。
- main.js 里：
  - `shouldTrack(p)`：`isLocalDrivePath(p)`，并且不是默认壁纸（`findGalleryEntry(gallery, p)`），不在 `app.getAppPath()`、`process.resourcesPath`、`app.getPath('userData')` 下面。
  - `startApp` 改成 `async`；在"升级到有「我的壁纸」的版本"那段之后、`cleanupOrphanFiles` 之前：`fileTracking = createFileTracking({...}); await fileTracking.scan(); fileTracking.start();`。`fileTracking.registerIpc(ipcMain)` 放进 `registerIpcHandlers()`。
  - `broadcastConfig()` 末尾：`if (fileTracking) fileTracking.noteConfigChanged();`
  - `createSettingsWindow()`：`settingsWindow.on('focus', () => fileTracking && fileTracking.scan());`
  - `myWallpapers:setThumb`：新缩略图和条目原来的 `thumb` 不一样时删掉旧的（手动接上后重新生成缩略图要用，否则旧文件留在 `wallpaper_thumbs/`）。
  - `cleanupAndQuit` 里 `fileTracking.stop()`。
- preload.js：`files: { locate: (p) => ipcRenderer.invoke('files:locate', p), relink: (p) => ipcRenderer.invoke('files:relink', p), onRelocated: (cb) => ipcRenderer.on('files:relocated', (_e, moves) => cb(moves)) }`。

- [ ] **Step 1: 写测试 `test/file-tracking.test.js`**（真 `AppStore`（临时 userData）、真文件；`sendToWindows`、`broadcastConfig`、`applyWallpaper`、`showRelinkDialog` 用桩记录调用）

```js
test('scan：当前图片壁纸改名后，配置里所有引用、深度图缓存都换成新路径，窗口收到 files:relocated', async () => {
    // config: currentImage = a.jpg，myWallpapers 有 a.jpg（带 crop），saveDepthCache(a.jpg)
    // scan() 记编号 → rename a.jpg → b.jpg → scan()
    // 断言：currentImage、currentImageCrop.path、myWallpapers[0].path 都是 b.jpg，crop 还在；hasDepthCache(b.jpg)；
    // sendToWindows 收到 ['files:relocated', [{ from: a.jpg, to: b.jpg }]]，且在 broadcastConfig 之前
});

test('scan：配置里已经没有的路径（扫描期间被移除）不改配置', async () => {
    // applyMoves([{ from: 不在配置里的路径, to: ... }]) 之后 saveConfig 没被调用、没有发 files:relocated
});

test('两次 scan 同时调用只跑一遍', async () => {});

test('relink：选了新文件夹里的文件，同一个旧文件夹里其它找不到的顺带接上，返回总数', async () => {
    // 配置引用 old\a.jpg、old\b.mp4（都不存在）、old\c.jpg（不存在，新文件夹里也没有）
    // new\a2.jpg、new\b.mp4 存在；showRelinkDialog 返回 new\a2.jpg
    // 结果 { to: new\a2.jpg, count: 2 }；c.jpg 还是旧路径
});

test('relink：选的文件已经是「我的壁纸」里的另一格时不接', async () => {});

test('relink：接上的是当前壁纸就重新应用', async () => {
    // applyWallpaper 被调用一次，参数的 path 是新路径
});

test('relink：取消对话框返回 { canceled: true }，什么都不改', async () => {});
```

- [ ] **Step 2:** `node --test test/file-tracking.test.js`，期望 FAIL。
- [ ] **Step 3:** 实现 `src/file-tracking/index.js`。
- [ ] **Step 4:** `node --test test/file-tracking.test.js`，期望全过。
- [ ] **Step 5:** 改 `main.js`、`preload.js`；`npm test` 全过。
- [ ] **Step 6:** `npm run dev` 启动一次（用单独的数据目录，见 Task 8 的启动命令），看 `logs/main.log` 里没有报错、启动正常。
- [ ] **Step 7:** 提交 `feat: 启动、切回设置窗口、每分钟检查导入的文件，挪走的自动接上`。

---

### Task 6: 壁纸窗口：路径变了不重新加载（唱片机、视频特效）

**Files:**
- Modify: `renderer/host.js`、`renderer/main.js`、`renderer/vinyl.js`、`renderer/video-overlay.js`

**Interfaces:**
- Consumes: Task 5 的 preload `files.onRelocated`、`files.locate`。
- Produces:
  - `Host.onFilesRelocated(cb)`：Electron 下转给 `window.electronAPI.files.onRelocated`，浏览器预览里什么都不做。
  - `renderer/main.js`：`Host.onFilesRelocated((moves) => { vinylManager.applyRelocations(moves); videoOverlayManager.applyRelocations(moves); })`（摆放窗口不用）。
  - `VinylPlayer#applyRelocations(moves)`：`from === this.currentAudioPath` 时：如果 `this.skippingPath === from`（这首正因为放不了在处理）就把 `currentAudioPath`、`skippingPath` 清空，让接下来的配置重新加载新路径；否则只把 `currentAudioPath` 换成 `to`（不重放）。`from === this.currentCoverPath` 时换成 `to`。
  - `VinylPlayer#skipBroken()`：保留现有的防重入判断，之后如果是 Electron、当前这首文件不在（`electronAPI.fileExists`），先 `await electronAPI.files.locate(path)`：找到了就返回（主进程会发 `files:relocated` 和新配置，按上一条重新加载），找不到再走原来的"提示并跳到下一首"（把原来的这段挪进 `skipToNext()`）。
  - `VideoOverlay#applyRelocations(moves)`：`this.config.customPath === from` 时换成 `to`，这样随后的 `setConfig` 认为 `customPath` 没变，不重新加载视频。
- 没有自动测试（这几个类没有单元测试），在 Task 8 实机验证。

- [ ] **Step 1:** 按上面改四个文件。
- [ ] **Step 2:** `npm test` 全过；浏览器预览（`venv/Scripts/python.exe -m http.server 8765`，打开 `http://localhost:8765/index.html`）控制台没有新报错。
- [ ] **Step 3:** 提交 `feat: 歌和视频特效的文件被挪走后接着放，不从头重放`。

---

### Task 7: 设置窗口：手动接上和选中状态

**Files:**
- Modify: `settings/my-wallpapers-panel.js`、`settings/wallpaper-page.js`、`settings/music-page.js`、`settings/effects-page.js`、`settings/settings.css`（如需要）

**Interfaces:**
- Consumes: preload 的 `files.relink`、`files.onRelocated`；`makeThumbnailInfo`；`api.myWallpapers.setThumb`。
- 提示文字（固定）：
  - 成功：`count === 1` 时 `已找回「${文件名}」`；否则 `已找回「${文件名}」，另外还找回了 ${count - 1} 个`。
  - 失败：直接显示返回的 `error`，状态栏 `error` 样式。取消不提示。
- 改动：
  - **我的壁纸**：找不到文件的格子点击时改成 `api.files.relink(entry.path)`；成功后对新路径重新生成缩略图：`makeThumbnailInfo(api.toFileUrl(to), entry.type, entry.crop)` → `api.myWallpapers.setThumb(to, dataUrl)`，并把 `thumbTried` 里的新路径去掉以免被跳过。格子的 `title`：找不到时 `找不到文件，点一下选它现在的位置`。列表提示 `hintEl` 有内容时改成 `同一个盘里挪动、改名会自动找回`。
  - **壁纸页**：`api.files.onRelocated(moves)`：`selectedPath` 和某个 `from` 是同一个文件时换成 `to`，`selectedVideo` 的 `path` 也换，调 `panel.setSelected(selectedPath)`。
  - **唱片机页**：歌单里找不到的那一行点击改成 `api.files.relink(track.path)`（提示同上）；`文件找不到了` 改成 `文件找不到了，点一下重新找`。
  - **特效页**：`customVideoPath` 有值但 `api.fileExists` 为假时，文件名后面加 `（找不到文件）`，用现有的警告样式；`api.files.onRelocated` 里 `customVideoPath` 换成新路径，`customVideoName` 等于旧文件名时换成新文件名，再 `renderSelection()`。
- 没有自动测试（这些页面没有单元测试），在 Task 8 实机验证。

- [ ] **Step 1:** 按上面改。
- [ ] **Step 2:** `npm test` 全过。
- [ ] **Step 3:** 提交 `feat: 找不到的壁纸和歌点一下重新找，设置页跟着换路径`。

---

### Task 8: 实机验证

用真实应用的测试做法（单独的数据目录 + CDP 端口，见记忆里的 "Real-app testing recipe"）：`node_modules/electron/dist/electron.exe . --user-data-dir=<scratchpad 目录> --remote-debugging-port=9333 --inspect=9334 --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`，测试文件放在 scratchpad 下，不碰用户自己的配置和文件。文件对话框通过 inspector 换成返回指定路径。

- [ ] **Step 1:** 导入一张图片和一个视频进「我的壁纸」并生成深度图，把图片设成当前壁纸；退出；把图片改名、视频挪到子文件夹；重新启动。期望：桌面直接是那张图（没有"找不到上次的壁纸"提示），设置页两格正常显示、没有"找不到文件"，深度图没有重新生成（`depth_cache` 里文件数量不变、名字换成新 key）。
- [ ] **Step 2:** 软件开着时把「我的壁纸」里的视频改名，切回设置窗口。期望：格子正常，`logs/main.log` 有一行 `[FileTracking] 找回`。
- [ ] **Step 3:** 歌单加两首歌并开始播放第一首，播放中把它改名。期望：等下一次扫描（或切回设置窗口）后，歌单里显示新名字，歌没有从头重放。把第二首挪走后切到它（不等扫描）。期望：能直接放，不提示跳过。
- [ ] **Step 4:** 视频特效用自己的视频，播放中改名。期望：特效页显示新文件名，视频不闪不重放。
- [ ] **Step 5:** 把一个装着两张图片的文件夹复制到另一个文件夹再删掉原文件夹（模拟跨盘移动，编号会变）。期望：两格显示"找不到文件"；点其中一格，对话框（桩）返回新位置后两格都恢复，状态栏 `已找回「…」，另外还找回了 1 个`，缩略图重新生成。如果其中一张是当前壁纸，桌面马上恢复。
- [ ] **Step 6:** 把一张图片删进回收站（`Shell.Application` 的 `InvokeVerb('delete')` 或 PowerShell `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile` 带 `SendToRecycleBin`），切回设置窗口。期望：显示"找不到文件"，不会接到回收站里。
- [ ] **Step 7:** 截图（设置页「我的壁纸」、歌单）留证据。结束时停掉启动 Electron 的后台任务。

---

### Task 9: 文档和收尾

**Files:**
- Modify: `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`、`README.md`、`README.en.md`

- [ ] **Step 1:** `PROJECT_NOTES.md`：顶部"最近更新"加 2026-11-20 这一条；§3 文件地图加 `src/file-tracking/` 四个文件；§4 加一节"4.9 导入的文件挪了以后"（编号、三个扫描时机、校验规则、手动接上和顺带接上、做不到的情况）；4.6 末尾那句"和我的壁纸只记路径不同"改成和现在一致；§5 IPC 表加 `files:locate` / `files:relink` / `files:relocated`；§6 存储位置加 `file_ids.json`；§7 功能表加一行；§9 加阶段 22（做了什么、测试数量、实机验证结果）。
- [ ] **Step 2:** `README.md` 数据那一条补一句：「我的壁纸」、歌单、视频特效只记位置，同一个盘里挪动、改名后会自动找回，挪到别的盘后点一下"找不到文件"的格子重新接上。
- [ ] **Step 3:** 同步英文版 `PROJECT_NOTES.en.md`、`README.en.md`。
- [ ] **Step 4:** `npm test` 全过。
- [ ] **Step 5:** 提交 `docs: 记录导入文件挪动后自动找回`。之后问用户要不要合并回 `main`。
