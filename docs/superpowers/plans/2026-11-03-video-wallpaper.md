# 视频壁纸 + 我的壁纸 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户可以把本地视频设成桌面壁纸（不动 / 3D 视差 / 整体平移，可开声音），用户自己选过的图片和视频都留在壁纸页的「我的壁纸」里。

**Architecture:** 纯逻辑（列表、当前壁纸、迁移、平移数学、暂停规则）放进 `shared/`，用 `node --test` 测。主进程只负责存配置、存缩略图、转发。壁纸窗口用隐藏的 `<video>` 做 Pixi 纹理，替换背景滤镜的 `uImage`。"不动"和"整体平移"用一张 1×1 的白色深度图，配合 `motionParams` 换算出的强度、对焦和元素深度，不新开着色器分支，只给元素着色器加一个 `uOcclusion` 开关。视频新帧靠 `requestVideoFrameCallback` 叫醒画面，图片壁纸的空闲停帧照旧。

**Tech Stack:** Electron 28、Pixi.js 7.4.2、原生 WebGL（设置页预览）、Node 内置 `node --test`。

**Spec:** [docs/superpowers/specs/2026-11-02-video-wallpaper-design.md](../specs/2026-11-02-video-wallpaper-design.md)

## Global Constraints

- 代码注释用中文；界面文字用简体中文，设计文档和本计划里给出的文案原样使用。
- 不加新依赖，Pixi.js 7.4.2、Electron 28 不变。
- 图片扩展名：`jpg jpeg png webp bmp`；视频扩展名：`mp4 webm mov m4v mkv`（不分大小写）。
- 效果取值 `'none' | 'depth' | 'pan'`（界面上是 不动 / 3D 视差 / 整体平移），默认 `'none'`；声音默认 `false`。
- `currentImage` 只放图片路径；当前视频放在 `currentVideo: { path, effect, sound, imageAtTime }`。旧版本 1.1.0 读新配置不能出问题。
- 图片壁纸现有的行为不能变：视差效果、深度图生成、默认壁纸、元素遮挡、托盘换图、空闲停帧（鼠标静止 3 秒 0 帧）。
- 全屏检测脚本（`src/fullscreen-detector.js`）不改。
- 只改电脑版，不动安卓版。
- 每个任务结束时 `npm test` 全过。提交信息沿用仓库的 `feat: 中文描述` / `docs: …` 格式，末尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- Electron 实测统一用单独的数据目录，不动用户的真实配置：

  ```bash
  npx electron . --dev --user-data-dir="$TEMP/wp-video-test" --disable-features=CalculateNativeWinOcclusion --disable-backgrounding-occluded-windows
  ```

  测试视频可以用仓库里的 `overlay/rain1.mp4`、`elements/bomb1_cut.mp4`（复制到别处再用，别改原文件）。电脑上有 `ffmpeg` 的话转一个 webm 一起测；没有就在 PROJECT_NOTES 里写明 webm 没实测。

## Review Focus

1. 路径里有中文、空格、`#`、`%` 的视频：要能播放、能生成深度图、能出缩略图（一律用 `Host.fileUrl` / `api.toFileUrl` / `pathToFileURL`，不要自己拼 `file://`）。→ Task 6 和 Task 8 的实测步骤。
2. 反复切换视频壁纸：旧视频要完全释放，不能同时响两个声音、内存不能一直涨。→ Task 6 用 `createVideoWallpaper.live` 计数检查。
3. 当前壁纸是 3D 视差视频时清除深度图缓存再重启：按"不动"播放，不报错。→ Task 6 实测。
4. 设置窗口最小化、切到没有预览的页面时，预览视频要停止播放（不能在后台一直解码）。→ Task 8 实测。
5. 没有画面的文件（纯音频的 mp4、把文本文件改名成 `.mp4`）：选中时提示"这个视频格式不支持，换成 MP4 或 WebM 试试"，不加进列表。→ Task 8 实测。

---

### Task 1: 「我的壁纸」和当前壁纸的纯逻辑

**Files:**
- Create: `shared/my-wallpapers.js`（UMD，写法照 `shared/playlist.js`，挂在 `window.Shared.myWallpapers`）
- Test: `test/my-wallpapers.test.js`

**Interfaces:**
- Produces（后面所有任务都用这些名字）:
  - `IMAGE_EXTENSIONS: string[]`、`VIDEO_EXTENSIONS: string[]`、`MOTIONS = ['none', 'depth', 'pan']`
  - `wallpaperType(filePath: string): 'image' | 'video' | null`
  - `samePath(a: string, b: string): boolean`：不分大小写和斜杠方向，任一为空返回 false
  - 条目 `Entry`：图片 `{ path, type: 'image', addedAt, lastUsedAt, thumb, duration }`；视频再加 `effect`、`sound`。`thumb` 是缩略图文件路径（没有时为 `''`），`duration` 是秒（未知时为 0）。
  - `normalizeList(list: any): Entry[]`：去掉坏数据和扩展名不支持的条目；`type` 无效时按扩展名补；按路径去重（保留先出现的）；按 `lastUsedAt` 从新到旧排（稳定排序）
  - `findEntry(list, path): Entry | null`
  - `addEntry(list, { path, type, thumb?, duration? }, now: number): Entry[]`：已有的只把 `lastUsedAt` 改成 `now`，`thumb` / `duration` 只有给了真值才覆盖，效果和声音不动
  - `touchEntry(list, path, now): Entry[]`：没有这一条时原样返回
  - `updateEntry(list, path, patch: { effect?, sound?, thumb?, duration? }): Entry[]`：不改 `lastUsedAt`；不认识的 `effect` 忽略；图片条目忽略 `effect` / `sound`
  - `removeEntry(list, path): { list: Entry[], removed: Entry | null }`
  - `migrateFromCurrentImage(list, currentImage, { isGallery: (p) => boolean, exists: (p) => boolean }, now): Entry[]`
  - `resolveCurrent(config): { type: 'image', path } | { type: 'video', path, effect, sound } | null`
  - `applyPartial(config, descriptor, now): object`：返回交给 `store.saveConfig` 的部分配置
  - `formatDuration(seconds: number): string`

- [ ] **Step 1: 写失败的测试** `test/my-wallpapers.test.js`

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MW = require('../shared/my-wallpapers');

test('wallpaperType：按扩展名分图片和视频，不分大小写', () => {
    assert.equal(MW.wallpaperType('C:\\a\\b.JPG'), 'image');
    assert.equal(MW.wallpaperType('C:/a/b.webp'), 'image');
    assert.equal(MW.wallpaperType('C:/a/b.MP4'), 'video');
    for (const ext of ['webm', 'mov', 'm4v', 'mkv']) assert.equal(MW.wallpaperType('x.' + ext), 'video');
    assert.equal(MW.wallpaperType('C:/a/b.gif'), null);
    assert.equal(MW.wallpaperType('C:/a/noext'), null);
});

test('normalizeList：去掉坏数据、补默认值、按路径去重、按最近用过排序', () => {
    const list = MW.normalizeList([
        null, { path: '' }, { path: 'C:/v/a.gif' },
        { path: 'C:/v/old.mp4', type: 'video', addedAt: 1, lastUsedAt: 1, effect: 'zoom', sound: 'yes' },
        { path: 'C:/p/new.jpg', addedAt: 5, lastUsedAt: 5 },
        { path: 'c:\\v\\OLD.mp4', type: 'video', lastUsedAt: 9 },
    ]);
    assert.deepEqual(list, [
        { path: 'C:/p/new.jpg', type: 'image', addedAt: 5, lastUsedAt: 5, thumb: '', duration: 0 },
        { path: 'C:/v/old.mp4', type: 'video', addedAt: 1, lastUsedAt: 1, thumb: '', duration: 0, effect: 'none', sound: false },
    ]);
    assert.deepEqual(MW.normalizeList(undefined), []);
});

test('addEntry：新的放最前；已有的只更新 lastUsedAt，保留效果和声音，给了缩略图才换', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video', thumb: 'T1', duration: 24 }, 100);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 200);
    assert.deepEqual(list.map((e) => e.path), ['C:/p/b.png', 'C:/v/a.mp4']);
    list = MW.updateEntry(list, 'C:/v/a.mp4', { effect: 'pan', sound: true });
    list = MW.addEntry(list, { path: 'c:\\v\\A.mp4', type: 'video' }, 300);
    assert.equal(list.length, 2);
    assert.deepEqual(list[0], { path: 'C:/v/a.mp4', type: 'video', addedAt: 100, lastUsedAt: 300, thumb: 'T1', duration: 24, effect: 'pan', sound: true });
});

test('updateEntry：不认识的效果不改，不动 lastUsedAt；图片没有效果和声音', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video' }, 100);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 50);
    list = MW.updateEntry(list, 'C:/v/a.mp4', { effect: 'zoom', sound: true });
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').effect, 'none');
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').sound, true);
    assert.equal(MW.findEntry(list, 'C:/v/a.mp4').lastUsedAt, 100);
    list = MW.updateEntry(list, 'C:/p/b.png', { effect: 'pan', sound: true, thumb: 'T' });
    const img = MW.findEntry(list, 'C:/p/b.png');
    assert.equal('effect' in img, false);
    assert.equal('sound' in img, false);
    assert.equal(img.thumb, 'T');
});

test('touchEntry / removeEntry / findEntry', () => {
    let list = MW.addEntry([], { path: 'C:/v/a.mp4', type: 'video' }, 1);
    list = MW.addEntry(list, { path: 'C:/p/b.png', type: 'image' }, 2);
    list = MW.touchEntry(list, 'C:\\V\\A.MP4', 3);
    assert.equal(list[0].path, 'C:/v/a.mp4');
    assert.deepEqual(MW.touchEntry(list, 'C:/none.png', 4), list);
    assert.equal(MW.findEntry(list, 'c:\\p\\B.png').path, 'C:/p/b.png');
    const { list: rest, removed } = MW.removeEntry(list, 'C:/p/b.png');
    assert.equal(removed.path, 'C:/p/b.png');
    assert.deepEqual(rest.map((e) => e.path), ['C:/v/a.mp4']);
    assert.equal(MW.removeEntry(rest, 'C:/zzz.png').removed, null);
});

test('migrateFromCurrentImage：当前是用户自己的图片、文件还在时加进列表', () => {
    const ctx = { isGallery: (p) => p.startsWith('G:'), exists: (p) => !p.includes('gone') };
    assert.deepEqual(MW.migrateFromCurrentImage([], 'C:/p/me.jpg', ctx, 7).map((e) => e.path), ['C:/p/me.jpg']);
    assert.deepEqual(MW.migrateFromCurrentImage([], 'G:/wallpapers/a.jpg', ctx, 7), []);
    assert.deepEqual(MW.migrateFromCurrentImage([], 'C:/p/gone.jpg', ctx, 7), []);
    assert.deepEqual(MW.migrateFromCurrentImage([], '', ctx, 7), []);
});

test('resolveCurrent：有视频且 imageAtTime 对得上就用视频，否则用 currentImage', () => {
    const video = { path: 'C:/v/x.mp4', effect: 'pan', sound: true, imageAtTime: 'C:/p/a.jpg' };
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/a.jpg', currentVideo: video }),
        { type: 'video', path: 'C:/v/x.mp4', effect: 'pan', sound: true });
    // 旧版本之后又换了图片
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/b.jpg', currentVideo: video }),
        { type: 'image', path: 'C:/p/b.jpg' });
    // 应用视频时还没有当前图片；坏的 effect 读成 none
    assert.deepEqual(MW.resolveCurrent({ currentImage: '', currentVideo: { path: 'C:/v/x.mp4', effect: 'zoom', imageAtTime: '' } }),
        { type: 'video', path: 'C:/v/x.mp4', effect: 'none', sound: false });
    assert.deepEqual(MW.resolveCurrent({ currentImage: 'C:/p/a.jpg', currentVideo: null }), { type: 'image', path: 'C:/p/a.jpg' });
    assert.equal(MW.resolveCurrent({}), null);
});

test('applyPartial：应用图片清掉 currentVideo；应用视频记下当时的 currentImage，不改 currentImage', () => {
    const config = {
        currentImage: 'C:/p/a.jpg',
        myWallpapers: [
            { path: 'C:/p/a.jpg', type: 'image', addedAt: 1, lastUsedAt: 1 },
            { path: 'C:/v/x.mp4', type: 'video', addedAt: 2, lastUsedAt: 2 },
        ],
    };
    const pv = MW.applyPartial(config, { type: 'video', path: 'C:/v/x.mp4', effect: 'depth', sound: false }, 50);
    assert.deepEqual(pv.currentVideo, { path: 'C:/v/x.mp4', effect: 'depth', sound: false, imageAtTime: 'C:/p/a.jpg' });
    assert.equal('currentImage' in pv, false);
    assert.equal(pv.myWallpapers[0].path, 'C:/v/x.mp4');
    assert.equal(pv.myWallpapers[0].lastUsedAt, 50);
    const pi = MW.applyPartial(config, { type: 'image', path: 'C:/p/a.jpg' }, 60);
    assert.equal(pi.currentImage, 'C:/p/a.jpg');
    assert.equal(pi.currentVideo, null);
    assert.equal(pi.myWallpapers[0].path, 'C:/p/a.jpg');
});

test('formatDuration：分:秒，未知时为空', () => {
    assert.equal(MW.formatDuration(24.4), '0:24');
    assert.equal(MW.formatDuration(65), '1:05');
    assert.equal(MW.formatDuration(3661), '61:01');
    assert.equal(MW.formatDuration(0), '');
    assert.equal(MW.formatDuration(NaN), '');
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/my-wallpapers.test.js`
Expected: FAIL，`Cannot find module '../shared/my-wallpapers'`

- [ ] **Step 3: 实现 `shared/my-wallpapers.js`**

`resolveCurrent` 的规则：`currentVideo.path` 非空，并且 `imageAtTime` 和 `currentImage` 都为空或 `samePath` 相等，才用视频。`applyPartial` 应用视频时 `imageAtTime` 取 `config.currentImage || ''`，`myWallpapers` 用 `touchEntry(normalizeList(config.myWallpapers), path, now)`。

- [ ] **Step 4: 跑测试，确认通过**

Run: `npm test`
Expected: 全部 PASS（原有 180 个 + 新增 9 个）

- [ ] **Step 5: 提交**

```bash
git add shared/my-wallpapers.js test/my-wallpapers.test.js
git commit -m "feat: 我的壁纸和当前壁纸的纯逻辑"
```

---

### Task 2: 整体平移的数学

**Files:**
- Modify: `shared/parallax-math.js`（加两个函数，加进返回的对象）
- Test: `test/parallax-math.test.js`（追加）

**Interfaces:**
- Produces:
  - `panCover(cover: {scaleX, scaleY, offsetX, offsetY}, maxShift: number) → cover`：缩放系数 `z = min(1, (1 − 2·maxShift) / scaleX, (1 − 2·maxShift) / scaleY)`，两个方向都乘 `z`，中心不变。保证四周至少留出 `maxShift` 的图片 UV 余量。
  - `motionParams(motion: string, strength: number, focus: number) → { strength, focus, elementDepth: number | null, occlusion: boolean }`：
    - `'depth'`（以及不认识的值）→ `{ strength, focus, elementDepth: null, occlusion: true }`
    - `'none'` → `{ strength: 0, focus, elementDepth: null, occlusion: false }`
    - `'pan'` → `{ strength, focus: 0, elementDepth: 1, occlusion: false }`（配合全白的深度图：整张画面都在深度 1，位移 = 鼠标 × 强度）

- [ ] **Step 1: 写失败的测试**（追加到 `test/parallax-math.test.js`，沿用文件里已有的近似比较写法；没有的话写一个 `close(a, b)`，`Math.abs(a − b) < 1e-9`）

```js
test('panCover：整体平移时放大画面，四周至少留出 maxShift 的余量', () => {
    const c = P.panCover({ scaleX: 1, scaleY: 0.8, offsetX: 0, offsetY: 0.1 }, 0.05);
    close(c.scaleX, 0.9); close(c.scaleY, 0.72); close(c.offsetX, 0.05); close(c.offsetY, 0.14);
    assert.deepEqual(P.panCover({ scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }, 0), { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 });
});

test('motionParams：三种效果换算出的强度、对焦、元素深度和遮挡', () => {
    assert.deepEqual(P.motionParams('depth', 0.02, 0.5), { strength: 0.02, focus: 0.5, elementDepth: null, occlusion: true });
    assert.deepEqual(P.motionParams('none', 0.02, 0.5), { strength: 0, focus: 0.5, elementDepth: null, occlusion: false });
    assert.deepEqual(P.motionParams('pan', 0.02, 0.5), { strength: 0.02, focus: 0, elementDepth: 1, occlusion: false });
    assert.deepEqual(P.motionParams('zoom', 0.02, 0.5), P.motionParams('depth', 0.02, 0.5));
});

test('整体平移：元素的屏幕位移和背景一样，移到最边上也不出图片范围', () => {
    const s = P.strengthFromMultiplier(30);
    const cover = P.panCover(P.coverTransform(1920, 1080, 1920, 1080), s);
    const m = P.motionParams('pan', s, 0.5);
    for (const [mx, my] of [[1, 1], [-1, -1], [0.6, -0.4]]) {
        const [u, v] = P.rayMarchUV(() => 1, 0.5, 0.5, mx, my, m.focus, m.strength, 1, 1);
        const [dx, dy] = P.elementScreenShift(mx, my, m.elementDepth, m.focus, m.strength, cover);
        close(dx, -(u - 0.5) / cover.scaleX);
        close(dy, -(v - 0.5) / cover.scaleY);
        // 屏幕四角对应的图片 UV 加上位移后仍在 [0, 1] 里
        for (const [sx, sy] of [[0, 0], [1, 1]]) {
            const [iu, iv] = P.screenToImageUV(sx, sy, cover);
            const [ru, rv] = P.rayMarchUV(() => 1, iu, iv, mx, my, m.focus, m.strength, 1, 1);
            assert.ok(ru >= -1e-9 && ru <= 1 + 1e-9 && rv >= -1e-9 && rv <= 1 + 1e-9);
        }
    }
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/parallax-math.test.js`
Expected: FAIL，`P.panCover is not a function`

- [ ] **Step 3: 在 `shared/parallax-math.js` 实现 `panCover`、`motionParams`，加进返回的对象**

- [ ] **Step 4: 跑测试，确认通过**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add shared/parallax-math.js test/parallax-math.test.js
git commit -m "feat: 整体平移的放大和视差参数换算"
```

---

### Task 3: 配置和缩略图存储

**Files:**
- Modify: `src/store.js`
- Test: `test/store.test.js`（追加）

**Interfaces:**
- Consumes: `normalizeList`（Task 1）
- Produces:
  - 默认配置加 `myWallpapers: []`、`currentVideo: null`。**不要**把它们加进 `NESTED_KEYS`（数组和对象都整体替换）。`myWallpapersVersion` 不放进默认配置（Task 4 靠"没有它"判断要不要迁移）。
  - `getConfig()` 里 `myWallpapers: normalizeList(this._config.myWallpapers)`；`currentVideo` 不是带 `path` 字符串的对象时读成 `null`。
  - `getWallpaperThumbsDir(): string` → `<userData>/wallpaper_thumbs`（不存在就创建）
  - `saveWallpaperThumb(filePath: string, dataUrl: string): string` → 写 `thumb_<hash>.jpg`，返回路径。hash 和深度图用同一个算法（把 `_hashPath` 里算哈希的部分抽成 `_pathHash(filePath)`，`_hashPath` 改成 `'depth_' + this._pathHash(...)`，深度图文件名不能变）。
  - `deleteWallpaperThumb(thumbPath: string): boolean` → 只删 `wallpaper_thumbs` 目录里、确实存在的文件。

- [ ] **Step 1: 写失败的测试**（追加到 `test/store.test.js`，用文件里已有的 `storeWithConfig`）

```js
test('新用户：我的壁纸为空，没有当前视频', () => {
    const config = storeWithConfig().store.getConfig();
    assert.deepEqual(config.myWallpapers, []);
    assert.equal(config.currentVideo, null);
});

test('读配置时整理我的壁纸；坏的 currentVideo 读成 null', () => {
    const { store } = storeWithConfig({ myWallpapers: [null, { path: 'C:/p/a.jpg' }, { path: 'C:/x.gif' }], currentVideo: 'oops' });
    const config = store.getConfig();
    assert.deepEqual(config.myWallpapers.map((e) => e.path), ['C:/p/a.jpg']);
    assert.equal(config.currentVideo, null);
});

test('currentVideo 整体替换，重新打开后原样读回', () => {
    const { store, dir } = storeWithConfig();
    store.saveConfig({ currentVideo: { path: 'C:/v/x.mp4', effect: 'pan', sound: true, imageAtTime: '' } });
    store.saveConfig({ currentVideo: { path: 'C:/v/y.mp4', effect: 'none', sound: false, imageAtTime: 'C:/p/a.jpg' } });
    const reopened = new AppStore({ userDataPath: dir });
    assert.deepEqual(reopened.getConfig().currentVideo, { path: 'C:/v/y.mp4', effect: 'none', sound: false, imageAtTime: 'C:/p/a.jpg' });
});

test('saveWallpaperThumb：存进 wallpaper_thumbs，同一个文件（不分大小写和斜杠）写到同一张', () => {
    const { store, dir } = storeWithConfig();
    const dataUrl = 'data:image/jpeg;base64,' + Buffer.from('abc').toString('base64');
    const p1 = store.saveWallpaperThumb('C:/v/x.mp4', dataUrl);
    assert.equal(path.dirname(p1), path.join(dir, 'wallpaper_thumbs'));
    assert.match(path.basename(p1), /^thumb_[0-9a-f]+\.jpg$/);
    assert.equal(fs.readFileSync(p1, 'utf8'), 'abc');
    assert.equal(store.saveWallpaperThumb('c:\\v\\X.mp4', dataUrl), p1);
});

test('deleteWallpaperThumb：只删 wallpaper_thumbs 里的文件', () => {
    const { store, dir } = storeWithConfig({ parallaxMultiplier: 10 });
    const p1 = store.saveWallpaperThumb('C:/v/x.mp4', 'data:image/jpeg;base64,YWJj');
    assert.equal(store.deleteWallpaperThumb(path.join(dir, 'config.json')), false);
    assert.ok(fs.existsSync(path.join(dir, 'config.json')));
    assert.equal(store.deleteWallpaperThumb(p1), true);
    assert.equal(fs.existsSync(p1), false);
    assert.equal(store.deleteWallpaperThumb(p1), false);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/store.test.js`
Expected: 新增的 5 个 FAIL

- [ ] **Step 3: 按 Interfaces 修改 `src/store.js`**

- [ ] **Step 4: 跑测试，确认通过（原有的深度缓存测试也要过，说明深度图文件名没变）**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
git add src/store.js test/store.test.js
git commit -m "feat: 配置里加我的壁纸和当前视频，存壁纸缩略图"
```

---

### Task 4: 主进程和 preload：选择、列表、应用、迁移

**Files:**
- Modify: `main.js`、`preload.js`、`renderer/main.js`（只改换壁纸消息的名字）

**Interfaces:**
- Consumes: Task 1 全部、Task 3 的 store 方法
- Produces（preload 的 `window.electronAPI`）:
  - `selectWallpaperFile(): Promise<{ path, type } | null>` → IPC `dialog:selectWallpaper`。对话框标题"选择壁纸图片或视频"，过滤器依次是：`图片和视频`（两组扩展名合起来）、`图片`、`视频`。旧的 `selectImage` / `dialog:selectImage` 保留到 Task 8 再删。
  - `myWallpapers.add({ path, type, thumbDataUrl?, duration? }): Promise<Entry>` → IPC `myWallpapers:add`。`wallpaperType(path) !== type` 时抛错。有 `thumbDataUrl` 就 `store.saveWallpaperThumb`，把路径写进条目。
  - `myWallpapers.remove(path): Promise<boolean>` → IPC `myWallpapers:remove`，同时 `store.deleteWallpaperThumb(removed.thumb)`。
  - `myWallpapers.update(path, { effect?, sound? }): Promise<Entry | null>` → IPC `myWallpapers:update`
  - `myWallpapers.setThumb(path, thumbDataUrl): Promise<Entry | null>` → IPC `myWallpapers:setThumb`（不改排序）
  - 上面四个改完都 `broadcastConfig()`。
  - `applyWallpaper(descriptor)`：`descriptor` 为 `{ type: 'image', path }` 或 `{ type: 'video', path, effect, sound }`；主进程收到字符串时当成图片（设置页 Task 8 之前还在传字符串）。
  - `onShowWallpaper(callback)`：替换 `onNewImage`，IPC 通道从 `image:new` 改成 `wallpaper:show`，参数是 descriptor。
  - `generateDepthMap(filePath, blurRadius)` 签名不变：`wallpaperType(filePath) === 'video'` 时改用新的 `decodeVideoFramePixels(filePath)` 取像素。
- 主进程内部:
  - `applyWallpaper(descriptor)`：`store.saveConfig(applyPartial(store.getConfig(), descriptor, Date.now()))` → 发 `wallpaper:show` → `broadcastConfig()`。
  - 托盘 `changeWallpaperFromTray`：选完图片先 `addEntry` 存进 `myWallpapers`，其余流程不变，应用时传 `{ type: 'image', path }`。

- [ ] **Step 1: preload 加 `decodeVideoFramePixels(filePath): Promise<{ width, height, rgba }>`**

在 preload 里建 `<video>`（`muted`、`preload = 'auto'`、`src = toFileUrl(filePath)`），`loadedmetadata` 后跳到 `Math.min(duration * VIDEO_DEPTH_FRAME_AT, Math.max(0, duration - 0.1))`（`VIDEO_DEPTH_FRAME_AT = 0.3`，避开开头的黑场），`seeked` 后画到 `OffscreenCanvas` 取 `getImageData`，最后 `removeAttribute('src')` + `load()` 释放。15 秒没结果或 `error` 时抛 `Error('无法读取视频画面')`。

- [ ] **Step 2: preload 按 Interfaces 加 / 改 API**（`selectWallpaperFile`、`myWallpapers.*`、`applyWallpaper` 的注释改成 descriptor、`onShowWallpaper` 替换 `onNewImage`、`generateDepthMap` 分支）

- [ ] **Step 3: main.js 加对话框、四个 `myWallpapers:*` 处理器，改 `applyWallpaper` 和托盘**

`main.js` 顶部 `require('./shared/my-wallpapers')`。

- [ ] **Step 4: main.js 启动迁移**（放在现有 `migrateLegacyImagePath(currentImage, gallery)` 那段旁边）

1. `currentVideo.imageAtTime` 也用 `migrateLegacyImagePath` 换一遍，变了就存回。原因：开发版和安装版各有一份图库，`currentImage` 被换成另一份图库的路径后，`imageAtTime` 不跟着换的话视频会被误判成"旧版本换过图片"。
2. "第一次运行用图库第一张"的条件改成 `!currentImage && !currentVideo`：应用视频时 `currentImage` 可能是空的，不加这个条件，重启后 `imageAtTime` 就对不上了。
3. 配置里 `myWallpapersVersion !== 1` 时：`migrateFromCurrentImage(config.myWallpapers, config.currentImage, { isGallery: (p) => !!findGalleryEntry(gallery, p), exists: fs.existsSync }, Date.now())`，和 `myWallpapersVersion: 1` 一起存。只跑一次。

- [ ] **Step 5: `renderer/main.js` 的 `onNewImage` 改成 `onShowWallpaper`**

这一步只处理 `type === 'image'`（按 `descriptor.path` 走原来的流程）；视频在 Task 6 做。

- [ ] **Step 6: 检查语法、跑测试**

Run: `node --check main.js && node --check preload.js && npm test`
Expected: 没有输出错误，测试全部 PASS

- [ ] **Step 7: Electron 实测**（用 Global Constraints 里的命令启动；数据目录是新的）

- 设置页从图库选一张默认壁纸 → 应用 → 桌面换图，鼠标动有视差。
- 在设置窗口的 DevTools 控制台运行 `await electronAPI.myWallpapers.add({ path: '<一张本地图片>', type: 'image' })`，再运行 `await electronAPI.getConfig()`，`myWallpapers` 里有这一条；`remove` 后没了。
- 托盘「更换壁纸」选一张图片 → 配置里 `myWallpapers` 有它。
- 退出，在 `$TEMP/wp-video-test/config.json` 里手动写一个 `currentVideo: { path: 'X:/none.mp4', imageAtTime: '<和 currentImage 不同的路径>' }`，再启动：壁纸是 `currentImage` 那张图，日志里没有报错。

- [ ] **Step 8: 提交**

```bash
git add main.js preload.js renderer/main.js
git commit -m "feat: 主进程支持选择视频、我的壁纸列表和按类型应用壁纸"
```

---

### Task 5: 暂停原因：被窗口挡住时开了声音的视频继续放

**Files:**
- Modify: `shared/frame-pacing.js`、`main.js`
- Test: `test/frame-pacing.test.js`（追加）

**Interfaces:**
- Produces:
  - `Shared.framePacing.keepVideoPlaying(reason: string | undefined, sound: boolean): boolean` → 只有 `reason === 'covered' && sound` 为 true。
  - `renderer:pause` 的参数统一带 `reason`：全屏检测 `{ reason: 'covered' }`；`suspend`、`lock-screen` 是 `{ reason: 'system' }`；摆放窗口 `{ silent: true, reason: 'placement' }`。
  - `resumeWallpaper(info = {})`：摆放中不发；全屏还没结束（`!isRenderingActive`）时改发 `renderer:pause` `{ silent: true, reason: 'covered' }`（解锁时还被窗口挡着，开了声音的视频要接着放）；否则发 `renderer:resume`（带上 `info`）。摆放窗口的 `onEnd` 改成调 `resumeWallpaper({ silent: true })`。

- [ ] **Step 1: 写失败的测试**（追加到 `test/frame-pacing.test.js`）

```js
test('keepVideoPlaying：只有被窗口挡住、并且开了声音时视频继续放', () => {
    assert.equal(FP.keepVideoPlaying('covered', true), true);
    assert.equal(FP.keepVideoPlaying('covered', false), false);
    assert.equal(FP.keepVideoPlaying('system', true), false);
    assert.equal(FP.keepVideoPlaying('placement', true), false);
    assert.equal(FP.keepVideoPlaying(undefined, true), false);
});
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `node --test test/frame-pacing.test.js`
Expected: FAIL，`FP.keepVideoPlaying is not a function`

- [ ] **Step 3: 实现 `keepVideoPlaying`，按 Interfaces 改 `main.js` 里发 `renderer:pause` 的四处（全屏、睡眠、锁屏、摆放窗口）和 `resumeWallpaper`**

- [ ] **Step 4: 跑测试、检查语法**

Run: `node --check main.js && npm test`
Expected: 全部 PASS

- [ ] **Step 5: Electron 实测（图片壁纸的暂停行为不能变）**

最大化一个窗口约 1 秒后，日志里有 `Fullscreen app detected`，壁纸页 Toast "壁纸已暂停"；还原窗口后恢复。打开一个元素的摆放窗口再取消，壁纸恢复，没有 Toast。

- [ ] **Step 6: 提交**

```bash
git add shared/frame-pacing.js test/frame-pacing.test.js main.js
git commit -m "feat: 暂停壁纸时带上原因，被窗口挡住时可以让视频继续出声"
```

---

### Task 6: 壁纸窗口播放视频壁纸

**Files:**
- Create: `renderer/video-wallpaper.js`
- Modify: `renderer/parallax-scene.js`、`renderer/shaders.js`、`renderer/elements/element-shader.js`、`renderer/elements/elements-layer.js`、`renderer/edit-mode.js`、`renderer/main.js`、`index.html`

**Interfaces:**
- Consumes: `resolveCurrent`（Task 1）、`motionParams` / `panCover`（Task 2）、`keepVideoPlaying` / 暂停原因（Task 5）、`onShowWallpaper` descriptor（Task 4）
- Produces:
  - `createVideoWallpaper(filePath: string, { sound = false } = {}): Promise<VideoWallpaper>`，全局函数（和 `renderer/elements/sources.js` 一样是普通脚本）。`VideoWallpaper = { video, texture, width, height, play(), pause(), setSound(on: boolean), onFrame(cb: () => void), destroy() }`。
    - `<video>`：`loop`、`playsInline`、`preload = 'auto'`、`muted = !sound`、`src = Host.fileUrl(filePath)`。`loadeddata` 时 resolve；`error` 时 reject `Error('视频无法播放')`；15 秒（`VIDEO_LOAD_TIMEOUT_MS = 15000`）reject `Error('视频读取超时')`。加载完以后再出 `error` 只 `console.error`，画面停在最后一帧。
    - 纹理：`PIXI.Texture.from(video, { resourceOptions: { autoPlay: false } })`，然后把 `texture.baseTexture.resource.autoUpdate = false`，由自己的 `requestVideoFrameCallback` 循环先调 `resource.update()` 再调 `onFrame` 的回调。这样纹理更新和"要不要重画"只有一个来源。
    - `createVideoWallpaper.live`：还没 `destroy` 的实例个数，给实测用。
    - `destroy()`：取消帧回调、`pause()`、`removeAttribute('src')`、`load()`、`texture.destroy(true)`，`live` 减一。重复调用不出错。
  - `Scene`（`renderer/parallax-scene.js`）新增：
    - `loadVideo(videoWallpaper, { motion, depthSource }): Promise<void>`：`motion === 'depth'` 但 `depthSource` 为空（比如缓存被清了）时按 `'none'` 处理并 `console.warn`。`'depth'` 用 `depthSource` 加载深度图；`'none'` / `'pan'` 用 1×1 的白色画布当深度图。替换后释放旧背景：旧的是视频就调它的 `destroy()`，是图片就照原来 `destroy(true)`。
    - `load(bgSource, depthSource)`（图片）照旧，额外：如果当前背景是视频就释放它，`motion` 设回 `'depth'`。
    - `getMotion(): 'depth' | 'none' | 'pan'`、`hasDepth(): boolean`（`motion === 'depth'`）
    - `setParallax(mouseX, mouseY, strength, focus)` 签名不变：`motion === 'pan'` 且 `strength` 变了时重算 cover（`updateCover` 在 pan 时用 `panCover(coverTransform(...), strength)`）。
    - `renderOnce()`：`app.renderer.render(app.stage)`。
  - 元素着色器加 `uniform float uOcclusion;`，`vis = mix(1.0, vis, uOcclusion)`；`element-shader.js` 的默认 uniform 加 `uOcclusion: 1`。
  - `ElementsLayer.update(nowMs, mouseX, mouseY, strength, focus, motion = { elementDepth: null, occlusion: true })`：`motion.elementDepth` 不为 null 时位移和 `uElemDepth` 都用它；`uOcclusion = motion.occlusion ? 1 : 0`。`handleClick` 记 `clickAt.depth` 时，`this.scene.hasDepth()` 为 false 就用 `instance.depth`，不去采样。
  - `edit-mode.js`：`scene.hasDepth()` 为 false 时 `applyAutoDepth` 直接返回，"自动"标签隐藏。

- [ ] **Step 1: 写 `renderer/video-wallpaper.js`，`index.html` 加脚本**

`shared/my-wallpapers.js` 放在 `shared/playlist.js` 后面，`renderer/video-wallpaper.js` 放在 `renderer/parallax-scene.js` 后面。

- [ ] **Step 2: 改着色器、`element-shader.js`、`elements-layer.js`、`edit-mode.js`**

- [ ] **Step 3: 改 `Scene`**

- [ ] **Step 4: 改 `renderer/main.js`**

- 状态：`currentWallpaper`（descriptor）、`currentVideo`（`VideoWallpaper | null`）、`pauseReason`（运行中为 null）。
- `async function showWallpaper(descriptor)`：图片走原来的流程；视频依次：深度图（只有 `effect === 'depth'` 时 `getDepthCache`）→ `createVideoWallpaper(path, { sound: !isEditMode && descriptor.sound })` → `Scene.loadVideo` → `video.onFrame(onVideoFrame)` → `syncVideoPlayback()` → `wake()`。失败时 Toast `切换壁纸失败: <message>`，桌面保持原来的壁纸（新建的视频要 `destroy`）。
- `onVideoFrame()`：`!renderPaused && !Scene.app.ticker.started` 时 `Scene.renderOnce()`。ticker 在跑时什么都不做（下一帧自然会画）。
- `syncVideoPlayback()`：没有视频就返回；`!renderPaused` 或 `keepVideoPlaying(pauseReason, currentWallpaper.sound)` 时 `play()`，否则 `pause()`。
- `onPauseRender(info)`：`pauseReason = info.reason || 'system'`，其余照旧，最后 `syncVideoPlayback()`。`onResumeRender`：`pauseReason = null`，最后 `syncVideoPlayback()`。
- `updateLoop`：`const m = Shared.parallax.motionParams(Scene.getMotion(), strength, focus)`；背景用 `m.strength` / `m.focus`；`elementsLayer.update(now, -x, -y, m.strength, m.focus, m)`。天气、唱片机不变。
- 启动：`resolveInitialSources` 改成用 `Shared.myWallpapers.resolveCurrent(config)`。文件不在就退回 `background.png`，等加载完弹 Toast `找不到上次的壁纸：<文件名>`（图片和视频都弹）；视频加载失败也退回 `background.png`，Toast `视频壁纸加载失败：<message>`。摆放窗口（`isEditMode`）同样加载视频，但一直静音。

- [ ] **Step 5: 跑测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 6: Electron 实测**（视频从设置窗口 DevTools 控制台应用：`await electronAPI.applyWallpaper({ type: 'video', path: '<视频>', effect: 'none', sound: false })`）

- `effect` 分别为 `'none'`、`'pan'`、`'depth'`（先 `await electronAPI.generateDepthMap('<视频>', 5)`）：桌面循环播放；不动时鼠标移动画面不动；整体平移时画面跟着鼠标平移，移到屏幕角上也看不到边缘被拉伸的像素；3D 视差和图片壁纸一样有前后层次。
- 每种效果下各放一个元素（设置页元素页随便放一个）：不动时元素不跟鼠标动、不被挡；整体平移时元素和画面一起动、不被挡；3D 视差时和图片壁纸一样。天气、唱片机、全屏视频特效开着都照常显示。
- 在摆放窗口里放元素：不动 / 整体平移时没有"自动"标签，不报错。
- 静止时帧数：在壁纸窗口的 DevTools 里，鼠标不动 3 秒后 `Scene.app.ticker.started === false`，但视频仍在走（`document` 里看不到 video，用 `createVideoWallpaper.live === 1` 加上肉眼看桌面）。
- `sound: true`：桌面出声；最大化一个窗口：声音不断；锁屏（Win+L）再解锁、窗口仍最大化：声音接着响；还原窗口后画面恢复。`sound: false` 时最大化窗口视频暂停。
- 换回一张图片壁纸：声音停，`createVideoWallpaper.live === 0`；鼠标静止 3 秒后 ticker 停（图片停帧没坏）。
- （Review Focus 2）两个视频来回应用 10 次：`createVideoWallpaper.live` 一直是 1，只有一个声音。
- （Review Focus 1）把测试视频复制成 `$TEMP/视频 测试 #1 %.mp4`，用这个路径应用、生成深度图，都正常。
- （Review Focus 3）应用一个 3D 视差视频后，设置页「设置」→「清除缓存…」，重启：桌面按不动播放，日志只有一条 warn。
- 删掉当前视频文件（先复制一份），重启：桌面是 `background.png`，Toast "找不到上次的壁纸：…"。

- [ ] **Step 7: 提交**

```bash
git add renderer/video-wallpaper.js renderer/parallax-scene.js renderer/shaders.js renderer/elements/element-shader.js renderer/elements/elements-layer.js renderer/edit-mode.js renderer/main.js index.html
git commit -m "feat: 壁纸窗口播放视频壁纸，支持不动、3D 视差、整体平移和声音"
```

---

### Task 7: 设置页预览播放视频

**Files:**
- Modify: `settings/depth-preview.js`、`settings/main.js`、`settings.html`（脚本 `shared/my-wallpapers.js` 加在 `shared/playlist.js` 后面）

**Interfaces:**
- Consumes: `motionParams` / `panCover`（Task 2）
- Produces（`initDepthPreview()` 返回的对象新增）:
  - `showVideo(fileUrl: string, info: { name, tag }): Promise<{ width, height, duration }>`：换成视频，回到原图模式、清掉深度图。`<video>`（`muted`、`loop`、`playsInline`）放进 `#preview` 里并设 `hidden`（方便实测时用 `document.querySelector('#preview video')` 找到）。读不出来时 reject。
  - `setMotion(motion: 'depth' | 'none' | 'pan')`：`showImage` 时重置为 `'depth'`。
  - `setActive(active: boolean)`：false 时视频暂停、不重画；true 时接着播。
- 内部规则:
  - 视频每出一帧（`requestVideoFrameCallback`）就把 `<video>` 上传到纹理单元 0 再画一帧；鼠标动画照旧用 rAF。大于 `PREVIEW_MAX_TEXTURE` 的视频直接上传，不缩放（视频纹理每帧都要传，先缩到画布上反而更慢）。
  - `none` / `pan` 时深度纹理绑一张 1×1 白色纹理，`uDepthSize = (1, 1)`；`pan` 时 cover 用 `panCover`；强度、对焦按 `motionParams` 换算。
  - `isLive()`：有画面，并且（`pan`，或者 `depth` 且有深度图）。
  - 提示文字 `PREVIEW_HINT` 加 `still: '这个视频设为不动，画面不跟鼠标移动'`；`none` 时显示它。右上角"原图 | 深度图"只在 `depth` 且有深度图时出现。
  - 尺寸文字 `sizeEl` 写成 `1920 × 1080 · 0:24`（时长用 `formatDuration`）。
- `settings/main.js`：`shell.onPageChange` 和 `document` 的 `visibilitychange` 里都调 `preview.setActive(!document.hidden && <当前页有预览槽>)`。

- [ ] **Step 1: 按 Interfaces 修改 `settings/depth-preview.js`**

- [ ] **Step 2: `settings/main.js` 接 `setActive`，`settings.html` 加脚本**

- [ ] **Step 3: 跑测试**

Run: `npm test`
Expected: 全部 PASS（这一步没有新单元测试；预览在 Task 8 接到界面上后实测）

- [ ] **Step 4: 提交**

```bash
git add settings/depth-preview.js settings/main.js settings.html
git commit -m "feat: 设置页预览可以播放视频并显示三种效果"
```

---

### Task 8: 壁纸页选择视频：效果、声音、深度图、应用

**Files:**
- Modify: `settings/wallpaper-page.js`、`settings/gallery-panel.js`、`settings/thumbnail.js`、`settings.html`、`settings/settings.css`、`preload.js`、`main.js`（删掉旧的 `selectImage` / `dialog:selectImage`）

**Interfaces:**
- Consumes: Task 1、Task 4 的 preload API、Task 7 的预览 API
- Produces:
  - `thumbnail.js`：`makeThumbnailInfo(fileUrl, type): Promise<{ dataUrl, width, height, duration }>`（图片的 `duration` 为 0）；`makeThumbnail` 改成调它取 `dataUrl`，元素页不受影响。宽或高为 0（纯音频）时 reject `Error('无法读取画面尺寸')`（已有）。
  - `settings.html`：在 `.depth-bar` 的 `#depth-state` 前面加

    ```html
    <div class="video-ctrl" id="video-ctrl" hidden>
        <span class="label">效果</span>
        <div class="seg" id="video-motion">
            <button type="button" data-value="none">不动</button>
            <button type="button" data-value="depth">3D 视差</button>
            <button type="button" data-value="pan">整体平移</button>
        </div>
        <label for="video-sound">声音</label>
        <label class="switch"><input type="checkbox" id="video-sound"><span></span></label>
    </div>
    ```

    `.depth-bar.no-depth` 时隐藏 `.smooth`、`#btn-generate-depth` 和 `#depth-state`，"应用壁纸"仍然靠右。820×560 窗口下不出横向滚动条（允许换行）。
  - `wallpaper-page.js`：
    - 选中状态从"图片路径"扩展成 `selected = { type, path, entry }`。新增 `selectVideo(entry, { quiet })`；`selectImagePath` 保留。
    - "从电脑选择…"（这一步还在默认壁纸第一格，文字改成两行"从电脑选择…" / "图片或视频"）：`api.selectWallpaperFile()` → `makeThumbnailInfo(api.toFileUrl(path), type)`，失败时提示条报错并结束（视频是 `这个视频格式不支持，换成 MP4 或 WebM 试试`，图片是 `这张图片读不出来`）→ `api.myWallpapers.add({ path, type, thumbDataUrl, duration })` → 按类型选中。
    - 选中视频：`preview.showVideo` 读不出来时报同样的错；显示 `#video-ctrl`，效果和声音取条目的值；`preview.setMotion(effect)`；`depth` 时查 `getDepthCache`，和图片一样显示深度图状态。
    - 改效果 / 声音：`api.myWallpapers.update(path, { effect } | { sound })`，界面和预览立刻跟着变；**不影响桌面**，要点"应用壁纸"。
    - "应用壁纸"可点：图片照旧；视频是 `effect !== 'depth'`，或者有深度图并且不是"平滑改了需要重新生成"。点了传 `{ type: 'video', path, effect, sound }`；图片传 `{ type: 'image', path }`。提示条：视频是 `视频壁纸已应用`，图片照旧。
    - "生成深度图"对视频照样调 `api.generateDepthMap(path, blur)`（Task 4 已经支持）。
    - `markDepthStale()` 对 3D 视差的视频也生效。
    - 托盘转来的图片（`onPrepareImage`）流程不变，应用时改传 descriptor。
  - `gallery-panel.js`："使用中"标记按 `resolveCurrent(config)` 的路径判断（当前是视频时，默认壁纸都不标）。

- [ ] **Step 1: `thumbnail.js` 加 `makeThumbnailInfo`**

- [ ] **Step 2: `settings.html` / `settings.css` 加视频控件和 `.no-depth` 样式**

- [ ] **Step 3: `wallpaper-page.js`、`gallery-panel.js` 按 Interfaces 修改；删掉 preload 的 `selectImage` 和 main.js 的 `dialog:selectImage`**

- [ ] **Step 4: 跑测试、检查语法**

Run: `node --check main.js && node --check preload.js && npm test`
Expected: 全部 PASS

- [ ] **Step 5: Electron 实测**

- 「从电脑选择…」选一个 mp4：预览开始播放（静音）、标"你的视频"、尺寸后面有时长；操作栏是 效果（不动选中）/ 声音（关）/ 应用壁纸。
- 切到 3D 视差：出现深度图状态和边缘平滑；生成深度图后自动切到深度图，能应用；改边缘平滑 → "平滑改了，需要重新生成"、应用变灰。
- 切到整体平移：鼠标在预览上移动，画面整体平移。切到不动：提示"这个视频设为不动…"。
- 改了效果不点应用：桌面不变；点应用后桌面按新效果。打开声音再应用：桌面出声，预览仍然静音。
- 再选一张图片：一切和以前一样（深度图状态、生成、应用、托盘换图）。
- 应用视频后，默认壁纸里没有"使用中"标记。
- （Review Focus 4）预览在播视频时切到「元素」页：`document.querySelector('#preview video').paused === true`；切回「壁纸」页接着播；最小化设置窗口时也暂停。
- （Review Focus 5）选一个纯音频 mp4（没有的话把一个 `.txt` 复制改名成 `.mp4`）：提示"这个视频格式不支持，换成 MP4 或 WebM 试试"，`getConfig()` 的 `myWallpapers` 里没有它。
- （Review Focus 1）选 `$TEMP/视频 测试 #1 %.mp4`：缩略图、预览、深度图都正常。
- 窗口缩到 820×560：没有横向滚动条。

- [ ] **Step 6: 提交**

```bash
git add settings/wallpaper-page.js settings/gallery-panel.js settings/thumbnail.js settings.html settings/settings.css preload.js main.js
git commit -m "feat: 壁纸页可以选择视频，设置效果、声音并应用"
```

---

### Task 9: 「我的壁纸」栏、正在使用、视差页提示

**Files:**
- Create: `settings/my-wallpapers-panel.js`
- Modify: `settings/gallery-panel.js`、`settings/wallpaper-page.js`、`settings/parallax-page.js`、`settings.html`、`settings/settings.css`

**Interfaces:**
- Consumes: Task 1、Task 4 的 `myWallpapers.*`、Task 8 的 `makeThumbnailInfo` 和选择流程
- Produces:
  - `initMyWallpapersPanel({ api, onSelect: (entry) => void, onPick: () => void, setStatus }) → { setSelected(path), setBusy(busy), refresh(config) }`
  - `settings.html` 在默认壁纸那一组前面加

    ```html
    <div class="group" id="mine-group">
        <div class="group-head">
            <h2>我的壁纸</h2><span class="en">Mine</span>
            <span class="count" id="mine-count"></span>
            <span class="hint" id="mine-hint">你自己的图片和视频</span>
        </div>
        <div class="gallery" id="mine-grid"></div>
    </div>
    ```

- 规则:
  - 一直显示。第一格永远是「从电脑选择…」/「图片或视频」（从默认壁纸挪过来，`gallery-panel.js` 删掉添加格和 `onPickFile`）。后面按 `myWallpapers` 的顺序（最近用过的在前）。
  - 有条目时提示改成 `只记住位置，原文件挪走后会失效`，数量显示条目个数；没有时是 `你自己的图片和视频`，不显示数量。
  - 格子沿用 `.wp` 的样式。视频左下角 `Icons.svg('play')` 加 `formatDuration(duration)`。缩略图用 `api.toFileUrl(entry.thumb)`；没有 `thumb` 且文件还在时，用 `makeThumbnailInfo` 补生成，再调 `api.myWallpapers.setThumb`（同一条只补一次，失败就留着空白底）。
  - `api.fileExists(path)` 为 false 时格子加 `missing`，显示 `<span class="chip warn">找不到文件</span>`；点它提示 `找不到这个文件，可能被移动或删除了`，不选中。
  - 悬停时右上角出现 ×（`Icons.svg('x')`，`title="从列表里移除（不删原文件）"`），点了调 `api.myWallpapers.remove(path)`，不触发选中。移除的正好是选中的那一条时，预览保持不动。
  - 正在用的那一条（`resolveCurrent(config).path`）标 `使用中`，和默认壁纸一样。
  - 多于一行时这一版不折叠（设计里留给实现时看：实测 5 条以上挤得厉害再加"展开"，并记进 PROJECT_NOTES）。
  - 生成深度图期间 `setBusy(true)`，格子不能点（和默认壁纸一样）。
- 正在使用卡片（`wallpaper-page.js` 的 `refreshNowUsing`）：用 `resolveCurrent(config)`。默认壁纸用图库缩略图；我的壁纸里有缩略图就用缩略图，没有就用原文件；名字是图库名或文件名。
- 视差页（`parallax-page.js`）：页面说明下面加 `<p class="page-note" id="parallax-video-note" hidden></p>`。当前壁纸是视频且 `effect === 'none'` 时显示 `当前视频壁纸设为不动，这些设置不起作用`；`'pan'` 时显示 `当前视频壁纸是整体平移：视差强度和跟手程度起作用，对焦深度不起作用`；其余隐藏。`load(config)` 和 `api.onLoadConfig` 时都更新（`initParallaxPage` 需要多接一个 `api`）。

- [ ] **Step 1: 写 `settings/my-wallpapers-panel.js`，`settings.html` 加结构和脚本（放在 `gallery-panel.js` 前面）、`settings.css` 加样式**

- [ ] **Step 2: 改 `gallery-panel.js`、`wallpaper-page.js`（接面板、正在使用卡片）、`parallax-page.js`、`settings/main.js`（给视差页传 `api`）**

- [ ] **Step 3: 跑测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 4: Electron 实测**（新的数据目录）

- 第一次打开：「我的壁纸」只有一格「从电脑选择…」，默认壁纸第一格是图库第一张。
- 选一张图片、一个视频：两格出现在前面，视频带 ▶ 和时长；最近选的排最前；应用后标"使用中"，正在使用卡片是对应的缩略图和名字。
- 重启：列表、顺序、视频的效果和声音都还在。
- 悬停点 ×：从列表移除，原文件还在，`wallpaper_thumbs` 里那张缩略图没了。
- 把一个已加入的文件改名：格子显示"找不到文件"，点它有提示，能移除。
- 用一份只有 `currentImage`（指向自己的图片）的旧配置启动：这张图出现在「我的壁纸」里；再启动一次不会重复加。
- 视差页：当前是不动的视频 / 整体平移的视频 / 图片时，提示分别正确。
- 窗口缩到 820×560：没有横向滚动条。

- [ ] **Step 5: 提交**

```bash
git add settings/my-wallpapers-panel.js settings/gallery-panel.js settings/wallpaper-page.js settings/parallax-page.js settings/main.js settings.html settings/settings.css
git commit -m "feat: 壁纸页加我的壁纸栏，正在使用和视差页支持视频"
```

---

### Task 10: 文档和整体验证

**Files:**
- Modify: `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`、`README.md`、`README.en.md`

- [ ] **Step 1: 整体验证**

Run: `npm test`
Expected: 全部 PASS

再用新的数据目录完整走一遍设计文档"验证"一节的清单，记下哪些做了、哪些没做（比如没有 webm 文件、没在集成显卡上测）。顺带粗看资源占用：图片壁纸静止时 0 帧；视频壁纸静止时 ticker 停、画面按视频帧率更新。

- [ ] **Step 2: 更新 `PROJECT_NOTES.md`**

- §1 一句话概括、§3 文件地图（新文件：`shared/my-wallpapers.js`、`renderer/video-wallpaper.js`、`settings/my-wallpapers-panel.js`）、§4.2 换壁纸流程、§5 IPC 表（`dialog:selectWallpaper`、`myWallpapers:*`、`wallpaper:show` 替换 `image:new`、`renderer:pause` 带 `reason`）、§6 配置结构（`myWallpapers`、`myWallpapersVersion`、`currentVideo`，`currentImage` 只放图片的原因）、§7 功能表。
- §9 加"阶段 11 — 视频壁纸 + 我的壁纸"：链接设计和本计划，写做了什么、实测了什么、没测什么、留给实现时决定的那几项最后怎么定的。
- 最近更新日期。

- [ ] **Step 3: 同步 `PROJECT_NOTES.en.md`；`README.md` / `README.en.md` 的功能列表加一条视频壁纸和我的壁纸**

- [ ] **Step 4: 提交**

```bash
git add PROJECT_NOTES.md PROJECT_NOTES.en.md README.md README.en.md
git commit -m "docs: 记录视频壁纸和我的壁纸"
```
