# 解锁动画 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在设置里导入一段视频，每次解锁电脑后全屏播放（盖住任务栏），淡入淡出，放完回到桌面。

**Architecture:** 锁屏时建好全屏窗口并预加载视频，解锁后开始播放。状态转换是纯函数（`shared/unlock-animation.js`），窗口生命周期由主进程控制器管（`src/unlock-animation/controller.js`），全屏页面只负责放视频和上报事件。

**Tech Stack:** Electron 28、原生 `<video>`、`node --test`。不加新依赖。

**Spec:** `docs/superpowers/specs/2026-11-05-unlock-animation-design.md`

## 开始之前

在新分支上做，不要直接改 `main`：

```bash
git checkout -b feat/unlock-animation
git add docs/superpowers/specs/2026-11-05-unlock-animation-design.md docs/superpowers/plans/2026-11-05-unlock-animation.md
git commit -m "docs: 解锁动画设计和实现计划"
```

基线：`npm test` 全过（当前 230 个）。摆放窗口的修复在分支 `refs/heads/claude/strange-taussig-2a7b8b`，本计划不依赖它。

## Global Constraints

- 代码注释用中文；代码、变量名用英文。不加新依赖，不改版本号，不推送。
- 提交信息结尾带 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 新文件只放在 `src/`、`renderer/`、`settings/`、`shared/` 下，`package.json` 的打包配置不用改。
- 默认值：`fadeInMs: 500`、`fadeOutMs: 700`、`sound: false`、`enabled: false`。时长范围 0 ~ 3000 毫秒。
- 加载超时 3000 毫秒。看门狗：视频时长 + 淡入 + 5000 毫秒，时长未知时 120000 毫秒。
- 全屏窗口的配置必须和 spec「全屏窗口」一节一致，特别是建好后再 `setBounds`、`focusable: false`、`showInactive()`、`backgroundThrottling: false`。
- 全屏窗口只在锁屏到动画结束这段时间存在。全屏页面不跑 `requestAnimationFrame` 循环。
- 锁屏期间不注册 Esc。`lock-screen` 的处理要同步开始建窗口。

## Review Focus

1. 人脸、指纹秒解锁：锁屏后马上解锁，视频还没加载好，要等加载好再放，3 秒还没好就关窗口（Task 3）。
2. 动画放到一半又锁屏：旧窗口迟到的事件不能影响新窗口（Task 3）。
3. 锁屏期间视频文件被删或解不了：不放，也不留黑屏（Task 2、Task 3）。
4. 特别短的视频配默认淡入淡出：时长按比例缩短，不出错（Task 1、Task 2）。
5. 手改过或旧版本的配置：时长越界、类型不对、开着开关却没有视频，都读成合法值（Task 1、Task 2）。

---

### Task 1: 纯逻辑

**Files:**
- Create: `shared/unlock-animation.js`（UMD，写法同 `shared/my-wallpapers.js`，挂在 `Shared.unlockAnimation`）
- Test: `test/unlock-animation.test.js`

**Interfaces:**
- Produces:
  - `DEFAULTS`：`{ enabled: false, file: '', name: '', thumb: '', duration: 0, fadeInMs: 500, fadeOutMs: 700, sound: false }`
  - `FADE_MAX_MS = 3000`、`LOAD_TIMEOUT_MS = 3000`
  - `normalizeConfig(value) -> config`
  - `fitFades(fadeInMs, fadeOutMs, durationMs) -> { fadeInMs, fadeOutMs }`
  - `fadeOutStartMs(durationMs, fadeOutMs) -> number`
  - `watchdogMs(durationMs, fadeInMs) -> number`
  - `opacityAt(elapsedMs, fadeOutMs) -> number`
  - `transition(state, event) -> { state, actions: string[] }`，没有定义的组合返回原状态和空数组
  - `isActive(state) -> boolean`：`starting`、`playing` 为 true

状态转换表（动作按顺序执行，`–` 表示忽略）：

| 状态 | `lock` | `unlock` | `preview` | `ready` | `nearEnd` | `skip` | `timeout` | `error` `closed` `abort` | `fadeDone` |
|---|---|---|---|---|---|---|---|---|---|
| `idle` | `preparing` [create] | `starting` [create] | `starting` [create] | – | – | – | – | – | – |
| `preparing` | – | `starting` | – | `ready` | – | `idle` [destroy] | – | `idle` [destroy] | – |
| `ready` | – | `playing` [start] | – | – | – | `idle` [destroy] | – | `idle` [destroy] | – |
| `starting` | `preparing` [destroy, create] | – | – | `playing` [start] | – | `idle` [destroy] | `idle` [destroy] | `idle` [destroy] | – |
| `playing` | `preparing` [destroy, create] | – | – | – | `fadingOut` [fade] | `fadingOut` [fade] | `fadingOut` [fade] | `idle` [destroy] | – |
| `fadingOut` | `preparing` [destroy, create] | – | – | – | – | – | – | `idle` [destroy] | `idle` [destroy] |

- [ ] **Step 1: 写失败的测试**

```js
test('normalizeConfig 补默认值', () => assert.deepEqual(normalizeConfig(undefined), DEFAULTS));
test('normalizeConfig 把时长压到范围内并取整', () => {
    assert.equal(normalizeConfig({ fadeInMs: 9999 }).fadeInMs, 3000);
    assert.equal(normalizeConfig({ fadeOutMs: -5 }).fadeOutMs, 0);
    assert.equal(normalizeConfig({ fadeInMs: 'abc' }).fadeInMs, 500);
    assert.equal(normalizeConfig({ fadeInMs: 612.4 }).fadeInMs, 612);
});
test('normalizeConfig 没有视频时开关读成关', () => {
    assert.equal(normalizeConfig({ enabled: true }).enabled, false);
    assert.equal(normalizeConfig({ enabled: true, file: 'a.mp4' }).enabled, true);
});
test('normalizeConfig 类型不对时读成默认值', () => {
    assert.equal(normalizeConfig({ file: 5 }).file, '');
    assert.equal(normalizeConfig({ duration: -1 }).duration, 0);
    assert.equal(normalizeConfig({ sound: 'yes' }).sound, false);
});
test('fitFades：放得下不变，放不下按比例缩短，时长未知不变', () => {
    assert.deepEqual(fitFades(500, 700, 5000), { fadeInMs: 500, fadeOutMs: 700 });
    assert.deepEqual(fitFades(500, 700, 600), { fadeInMs: 250, fadeOutMs: 350 });
    assert.deepEqual(fitFades(500, 700, 0), { fadeInMs: 500, fadeOutMs: 700 });
});
test('fadeOutStartMs：时长未知时返回 Infinity，只靠 ended 结束', () => {
    assert.equal(fadeOutStartMs(6000, 700), 5300);
    assert.equal(fadeOutStartMs(300, 700), 0);
    assert.equal(fadeOutStartMs(0, 700), Infinity);
    assert.equal(fadeOutStartMs(NaN, 700), Infinity);
});
test('watchdogMs', () => {
    assert.equal(watchdogMs(6000, 500), 11500);
    assert.equal(watchdogMs(0, 500), 120000);
});
test('opacityAt', () => {
    assert.equal(opacityAt(0, 700), 1);
    assert.equal(opacityAt(350, 700), 0.5);
    assert.equal(opacityAt(900, 700), 0);
    assert.equal(opacityAt(0, 0), 0);
});
```

再把转换表逐行写成表驱动测试 `transition 和转换表一致`，并加：

```js
test('没定义的组合不变', () => assert.deepEqual(transition('ready', 'lock'), { state: 'ready', actions: [] }));
test('isActive', () => {
    assert.equal(isActive('starting'), true);
    assert.equal(isActive('playing'), true);
    assert.equal(isActive('ready'), false);
    assert.equal(isActive('fadingOut'), false);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/unlock-animation.test.js`
Expected: FAIL，找不到模块 `../shared/unlock-animation`

- [ ] **Step 3: 实现 `shared/unlock-animation.js`**

`fitFades` 放不下时用 `Math.floor` 取整。`transition` 用一张对象表，不要写成一串 `if`。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/unlock-animation.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add shared/unlock-animation.js test/unlock-animation.test.js
git commit -m "feat: 解锁动画的配置、时长和状态转换纯逻辑"
```

---

### Task 2: 配置和文件

**Files:**
- Modify: `src/store.js`（`NESTED_KEYS`、`getConfig`、`_defaultConfig`，加 `getUnlockAnimationDir`）
- Create: `src/unlock-animation/files.js`
- Test: `test/unlock-files.test.js`、`test/store.test.js`

**Interfaces:**
- Consumes: Task 1 的 `DEFAULTS`、`normalizeConfig`、`fitFades`；`shared/my-wallpapers.js` 的 `VIDEO_EXTENSIONS`；`src/elements/library.js` 的 `cleanupOrphanFiles(dir, [{file, thumb}])`（要绝对路径）
- Produces:
  - `store.getUnlockAnimationDir() -> string`：`userData/unlock_animation`，不存在就创建
  - `config.unlockAnimation`：已经过 `normalizeConfig`
  - `importVideo(srcPath, dir, id) -> Promise<string>`：异步复制成 `<id>.<小写扩展名>`，返回文件名；扩展名不支持时抛 `Error('UNSUPPORTED_FILE')`
  - `removeFiles(dir, names) -> void`：跳过空字符串，删不掉不抛错
  - `cleanupUnlockFiles(dir, config) -> string[]`：清掉目录里配置没引用的文件
  - `resolvePlayback(config, dir, { preview = false } = {}) -> Playback | null`
  - `Playback`：`{ filePath, sound, fadeInMs, fadeOutMs, durationMs }`，`fadeInMs`、`fadeOutMs` 已经过 `fitFades`

- [ ] **Step 1: 写失败的测试**

`test/store.test.js` 加：

```js
test('解锁动画默认关闭，旧配置补默认值', () => {
    const c = storeWithConfig({ parallaxMultiplier: 10 }).store.getConfig().unlockAnimation;
    assert.equal(c.enabled, false);
    assert.equal(c.fadeInMs, 500);
    assert.equal(c.fadeOutMs, 700);
});
test('解锁动画按字段保存，越界的时长读出来压到范围内', () => {
    const { store } = storeWithConfig();
    store.saveConfig({ unlockAnimation: { file: 'a.mp4', fadeInMs: 9000 } });
    store.saveConfig({ unlockAnimation: { sound: true } });
    const c = store.getConfig().unlockAnimation;
    assert.equal(c.file, 'a.mp4');
    assert.equal(c.fadeInMs, 3000);
    assert.equal(c.sound, true);
});
```

`test/unlock-files.test.js`（用 `fs.mkdtempSync` 建临时目录）：

```js
test('importVideo 用 ASCII 文件名，中文和特殊字符的原文件也能导入', async () => {
    const src = writeFile(srcDir, '我的 #1.MP4');
    assert.equal(await importVideo(src, dir, 'video_abc'), 'video_abc.mp4');
    assert.ok(fs.existsSync(path.join(dir, 'video_abc.mp4')));
});
test('importVideo 拒绝不支持的扩展名', async () => {
    await assert.rejects(importVideo(writeFile(srcDir, 'a.txt'), dir, 'x'), /UNSUPPORTED_FILE/);
});
test('resolvePlayback：关着或没有文件时返回 null', () => {
    assert.equal(resolvePlayback({ ...cfg, enabled: false }, dir), null);
    assert.equal(resolvePlayback({ ...cfg, file: '' }, dir), null);
});
test('resolvePlayback：文件被删了返回 null', () => {
    fs.unlinkSync(path.join(dir, cfg.file));
    assert.equal(resolvePlayback(cfg, dir), null);
});
test('resolvePlayback：预览不看开关', () => {
    assert.ok(resolvePlayback({ ...cfg, enabled: false }, dir, { preview: true }));
});
test('resolvePlayback：短视频的淡入淡出按比例缩短', () => {
    const p = resolvePlayback({ ...cfg, duration: 0.6 }, dir);
    assert.deepEqual([p.fadeInMs, p.fadeOutMs, p.durationMs], [250, 350, 600]);
});
test('cleanupUnlockFiles 只留配置引用的文件', () => {
    writeFile(dir, 'old.mp4');
    assert.deepEqual(cleanupUnlockFiles(dir, cfg), ['old.mp4']);
    assert.ok(fs.existsSync(path.join(dir, cfg.file)));
});
test('removeFiles 跳过空名字和不存在的文件', () => {
    assert.doesNotThrow(() => removeFiles(dir, ['', 'nope.mp4']));
});
```

其中 `cfg` 是 `{ ...DEFAULTS, enabled: true, file: 'video_abc.mp4', duration: 6 }`，测试开始时建好这个文件。

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/unlock-files.test.js test/store.test.js`
Expected: FAIL，找不到模块 `../src/unlock-animation/files`，store 的两个新测试失败

- [ ] **Step 3: 实现 `src/store.js` 的改动和 `src/unlock-animation/files.js`**

`getConfig` 里 `unlockAnimation: normalizeConfig(this._config.unlockAnimation)`，`_defaultConfig` 里放 `unlockAnimation: { ...DEFAULTS }`，`NESTED_KEYS` 加 `'unlockAnimation'`。`durationMs` 用 `Math.round(duration * 1000)`。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/unlock-files.test.js test/store.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/store.js src/unlock-animation/files.js test/unlock-files.test.js test/store.test.js
git commit -m "feat: 解锁动画的配置和视频文件管理"
```

---

### Task 3: 控制器

**Files:**
- Create: `src/unlock-animation/controller.js`
- Test: `test/unlock-controller.test.js`

**Interfaces:**
- Consumes: Task 1 的 `transition`、`isActive`、`opacityAt`、`watchdogMs`、`LOAD_TIMEOUT_MS`；Task 2 的 `Playback`
- Produces:

```js
class UnlockAnimationController {
    /**
     * @param {object} deps
     * @param {(opts?: {preview?: boolean}) => Playback|null} deps.getPlayback
     * @param {(playback: Playback) => BrowserWindow} deps.createWindow
     * @param {(win: BrowserWindow) => void} deps.refitWindow
     * @param {(onSkip: () => void) => boolean} deps.registerSkipKey
     * @param {() => void} deps.unregisterSkipKey
     * @param {() => boolean} deps.isSessionLocked
     * @param {() => void} deps.onHoldChange
     */
    constructor(deps)
    get state()            // string
    get holdsWallpaper()   // boolean：isActive(state)
    handleLock()
    handleUnlock()
    preview()              // boolean：是否开始了预览
    handlePlayerEvent(sender, name)  // name: 'ready' | 'near-end' | 'skip' | 'error'
    dispose()
}
```

行为（测试之外实现要遵守的）：

- `handleLock`：`getPlayback()` 为 null 时派发 `abort`，否则记下 playback 再派发 `lock`。
- `handleUnlock`：`idle` 时 `getPlayback()` 为 null 就什么都不做，否则派发 `unlock`。
- `preview`：不在 `idle` 或 `getPlayback({ preview: true })` 为 null 时返回 false。
- `destroy` 动作先清掉 `this._win` 再销毁窗口，这样窗口的 `closed` 事件不会再派发一次。
- `start` 动作：`refitWindow(win)`，再 `win.webContents.send('unlock:start')`。
- `fade` 动作：`setInterval` 每 16 毫秒调 `win.setOpacity(opacityAt(...))`，到 0 后派发 `fadeDone`。淡出时长为 0 时第一次触发就结束，不用单独处理。
- 窗口的 `closed`、`unresponsive`、`webContents` 的 `render-process-gone`，只有来自当前窗口才派发 `closed`。
- 进入 `starting` 启动 `LOAD_TIMEOUT_MS` 计时，进入 `playing` 启动看门狗，到时派发 `timeout`。状态变化时清掉上一个计时。
- 每次状态变化后：`isActive` 从假变真时注册 Esc（注册失败写 `console.warn`），从真变假时注销；`holdsWallpaper` 变化时调 `onHoldChange`。
- `preparing`、`ready` 期间每 1000 毫秒调一次 `isSessionLocked()`：读到过 true 之后连续两次 false，就派发 `unlock`。

- [ ] **Step 1: 写失败的测试**

测试用 `t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] })`。假窗口写法同 `test/placement-controller.test.js`，再加 `setOpacity`（记下每次的值）、`webContents.send`（记下通道）、`destroy()`（同步发 `closed`）。`setup(overrides)` 返回 `{ c, wins, calls }`，默认 `getPlayback` 返回 `{ filePath: 'v.mp4', sound: false, fadeInMs: 500, fadeOutMs: 700, durationMs: 6000 }`。下面的示例省略了每个测试开头的 `setup()` 和开启假计时器的代码。

```js
test('锁屏建窗口，解锁只发 start，不再建窗口', () => {
    c.handleLock();
    assert.equal(wins.length, 1);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    c.handleUnlock();
    assert.equal(c.state, 'playing');
    assert.equal(wins.length, 1);
    assert.deepEqual(wins[0].webContents.sent, ['unlock:start']);
    assert.equal(calls.refit, 1);
});
test('功能关着时锁屏解锁什么都不做', () => {
    const { c, wins } = setup({ getPlayback: () => null });
    c.handleLock();
    c.handleUnlock();
    assert.equal(wins.length, 0);
    assert.equal(c.state, 'idle');
});
test('视频没加载好就解锁：加载好再放', () => {
    c.handleLock();
    c.handleUnlock();
    assert.equal(c.state, 'starting');
    assert.deepEqual(wins[0].webContents.sent, []);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.state, 'playing');
});
test('解锁后 3 秒还没加载好就关窗口', (t) => {
    c.handleLock();
    c.handleUnlock();
    t.mock.timers.tick(3000);
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});
test('解锁时没有窗口：当场建窗口，加载好就放', () => {
    c.handleUnlock();
    assert.equal(wins.length, 1);
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.state, 'playing');
});
test('快放完时淡出，透明度降到 0 后销毁窗口', (t) => {
    play();                                   // 走到 playing 的小工具
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    assert.equal(c.state, 'fadingOut');
    t.mock.timers.tick(800);
    assert.equal(wins[0].opacities.at(-1), 0);
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});
test('Esc 解锁后才注册，淡出时注销', () => {
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(calls.register, 0);
    c.handleUnlock();
    assert.equal(calls.register, 1);
    calls.onSkip();
    assert.equal(c.state, 'fadingOut');
    assert.equal(calls.unregister, 1);
});
test('Esc 注册失败时点鼠标仍然有效', () => {
    const s = setup({ registerSkipKey: () => false });
    play(s);
    s.c.handlePlayerEvent(s.wins[0].webContents, 'skip');
    assert.equal(s.c.state, 'fadingOut');
});
test('等加载时跳过：直接关窗口', () => {
    c.handleUnlock();
    c.handlePlayerEvent(wins[0].webContents, 'skip');
    assert.equal(c.state, 'idle');
});
test('看门狗到时走淡出', (t) => {
    play();
    t.mock.timers.tick(11500);
    assert.equal(c.state, 'fadingOut');
});
test('播放出错直接关窗口', () => {
    play();
    c.handlePlayerEvent(wins[0].webContents, 'error');
    assert.equal(c.state, 'idle');
    assert.equal(wins[0].isDestroyed(), true);
});
test('放到一半再次锁屏：换新窗口，旧窗口的事件被忽略', () => {
    play();
    const old = wins[0];
    c.handleLock();
    assert.equal(old.isDestroyed(), true);
    assert.equal(c.state, 'preparing');
    assert.equal(wins.length, 2);
    c.handlePlayerEvent(old.webContents, 'ready');
    assert.equal(c.state, 'preparing');
});
test('窗口崩溃、无响应都回到 idle', () => {
    play();
    wins[0].webContents.emit('render-process-gone');
    assert.equal(c.state, 'idle');
});
test('holdsWallpaper 解锁时变真，淡出时变假，各通知一次', () => {
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    assert.equal(c.holdsWallpaper, false);
    c.handleUnlock();
    assert.equal(c.holdsWallpaper, true);
    c.handlePlayerEvent(wins[0].webContents, 'near-end');
    assert.equal(c.holdsWallpaper, false);
    assert.equal(calls.hold, 2);
});
test('读到过锁定后连续两次没锁定，按解锁处理', (t) => {
    locked = true;
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    t.mock.timers.tick(1000);
    locked = false;
    t.mock.timers.tick(1000);
    assert.equal(c.state, 'ready');
    t.mock.timers.tick(1000);
    assert.equal(c.state, 'playing');
});
test('从没读到过锁定：不会自己开始放', (t) => {
    locked = false;
    c.handleLock();
    c.handlePlayerEvent(wins[0].webContents, 'ready');
    t.mock.timers.tick(10000);
    assert.equal(c.state, 'ready');
});
test('预览不看开关，忙的时候返回 false', () => {
    assert.equal(c.preview(), true);
    assert.equal(calls.lastOpts.preview, true);
    assert.equal(c.preview(), false);
});
test('dispose 销毁窗口、注销按键', () => {
    play();
    c.dispose();
    assert.equal(wins[0].isDestroyed(), true);
    assert.equal(calls.unregister, 1);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/unlock-controller.test.js`
Expected: FAIL，找不到模块 `../src/unlock-animation/controller`

- [ ] **Step 3: 实现 `src/unlock-animation/controller.js`**

所有状态变化都走一个 `_dispatch(event)`：调 `transition`，没变化就返回；先写新状态，再执行动作，再处理计时、Esc、轮询和 `onHoldChange`。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/unlock-controller.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/unlock-animation/controller.js test/unlock-controller.test.js
git commit -m "feat: 解锁动画控制器，管窗口、计时、跳过和各种出错情况"
```

---

### Task 4: 全屏窗口和播放页面

**Files:**
- Create: `src/unlock-animation/player-window.js`、`src/unlock-animation/preload.js`、`renderer/unlock-player.html`、`renderer/unlock-player.js`
- Test: `test/unlock-player-window.test.js`

**Interfaces:**
- Consumes: Task 1 的 `fadeOutStartMs`（页面用 `<script src="../shared/unlock-animation.js">` 加载）；Task 2 的 `Playback`；`src/elements/library.js` 的 `toFileUrl`
- Produces:
  - `createPlayerWindow({ BrowserWindow, screen }, playback) -> BrowserWindow`
  - `refitPlayerWindow(win, screen) -> void`：`win.setBounds(screen.getPrimaryDisplay().bounds)`
  - 页面 query：`{ video, fadeInMs, fadeOutMs, sound }`，`sound` 是 `'1'` 或 `'0'`
  - preload 暴露 `window.unlockPlayer = { report(name), onStart(cb) }`，通道 `unlock:player-event`（渲染 → 主）、`unlock:start`（主 → 渲染）

- [ ] **Step 1: 写失败的测试**

假 `BrowserWindow` 把调用顺序记到数组里：

```js
test('窗口选项和 spec 一致', () => {
    const o = make().win.options;
    assert.equal(o.focusable, false);
    assert.equal(o.skipTaskbar, true);
    assert.equal(o.frame, false);
    assert.equal(o.backgroundColor, '#000000');
    assert.equal(o.webPreferences.backgroundThrottling, false);
});
test('建好后先 setBounds 铺满，再置顶、加载、不抢焦点地显示', () => {
    const { win } = make();
    assert.deepEqual(win.calls.map((c) => c[0]), ['setBounds', 'setAlwaysOnTop', 'loadFile', 'showInactive']);
    assert.deepEqual(win.calls[0][1], SCREEN);
    assert.deepEqual(win.calls[1].slice(1), [true, 'screen-saver']);
});
test('query 带上视频地址、淡入淡出和声音', () => {
    const { query } = make({ sound: true, fadeInMs: 250 }).win.calls[2][2];
    assert.equal(query.fadeInMs, '250');
    assert.equal(query.sound, '1');
    assert.match(query.video, /^file:\/\//);
});
test('refitPlayerWindow 按当前主显示器设大小', () => {
    const win = { setBounds(b) { this.b = b; } };
    refitPlayerWindow(win, fakeScreen);
    assert.deepEqual(win.b, SCREEN);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/unlock-player-window.test.js`
Expected: FAIL，找不到模块 `../src/unlock-animation/player-window`

- [ ] **Step 3: 实现四个文件**

`player-window.js` 的配置照抄 spec「全屏窗口」，页面路径 `path.join(__dirname, '..', '..', 'renderer', 'unlock-player.html')`。

页面：一个 `<video preload="auto" playsinline>`，`object-fit: cover`，`opacity: 0`，黑色背景，`cursor: none`。脚本要做的：

- 读 query，设 `muted`，给 `<video>` 设 `transition: opacity <fadeInMs>ms ease-out`，最后才设 `src`。
- `loadeddata` 上报 `ready`；`error` 或 `play()` 被拒绝上报 `error`；`mousedown` 上报 `skip`。
- 收到 `onStart`：`opacity` 设成 1，调 `play()`。
- `timeupdate` 时 `currentTime * 1000 >= fadeOutStartMs(duration * 1000, fadeOutMs)` 上报 `near-end`；`ended` 也上报。只报一次。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/unlock-player-window.test.js`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/unlock-animation/player-window.js src/unlock-animation/preload.js renderer/unlock-player.html renderer/unlock-player.js test/unlock-player-window.test.js
git commit -m "feat: 解锁动画的全屏窗口和播放页面"
```

---

### Task 5: 接进主进程

**Files:**
- Create: `src/unlock-animation/ipc.js`
- Modify: `main.js`、`preload.js`、`src/win32.js`
- Test: `test/unlock-ipc.test.js`

**Interfaces:**
- Consumes: Task 2 的文件函数和 `store.getUnlockAnimationDir()`；Task 3 的控制器；Task 4 的窗口函数；`library.js` 的 `saveThumbnail(dir, id, dataUrl)`（返回绝对路径）、`toFileUrl`
- Produces:
  - `registerUnlockIpc({ ipcMain, dialog, store, getDialogParent, broadcastConfig, controller }) -> void`
  - `unlock:selectVideo` → `{ canceled: true } | { path, url, name }`
  - `unlock:setVideo`（`{ path, thumbDataUrl, duration }`）→ `{ config } | { error }`。成功时写入 `file`、`name`（含扩展名的原文件名）、`thumb`、`duration`，`enabled: true`，删掉旧文件，广播配置。`id` 用 `'video_' + randomUUID()`
  - `unlock:remove` → `{ config }`：文件、缩略图都删掉，`file`、`name`、`thumb` 清空，`duration: 0`，`enabled: false`，淡入淡出和声音保留
  - `unlock:getInfo` → `{ exists: boolean, thumbUrl: string | null }`
  - `unlock:preview` → boolean
  - `unlock:player-event`（`ipcMain.on`）→ `controller.handlePlayerEvent(event.sender, name)`
  - `electronAPI.unlockAnimation = { selectVideo, setVideo, remove, getInfo, preview }`
  - `win32.isRemoteSession() -> boolean`：`GetSystemMetrics(0x1000) !== 0`

- [ ] **Step 1: 写失败的测试**

假 `ipcMain` 用 `Map` 存处理函数，`store` 用真的 `AppStore({ userDataPath: 临时目录 })`：

```js
test('setVideo 复制视频、打开开关、记下原文件名', async () => {
    const { config } = await invoke('unlock:setVideo', { path: src('我的 #1.MP4'), thumbDataUrl: THUMB, duration: 6 });
    const u = config.unlockAnimation;
    assert.equal(u.enabled, true);
    assert.equal(u.name, '我的 #1.MP4');
    assert.match(u.file, /^video_[0-9a-f-]+\.mp4$/);
    assert.ok(fs.existsSync(path.join(store.getUnlockAnimationDir(), u.file)));
    assert.equal(broadcasts.count, 1);
});
test('换视频时删掉旧文件', async () => {
    const first = (await invoke('unlock:setVideo', input)).config.unlockAnimation.file;
    await invoke('unlock:setVideo', input);
    assert.equal(fs.existsSync(path.join(store.getUnlockAnimationDir(), first)), false);
});
test('不支持的格式返回错误，配置不变', async () => {
    const res = await invoke('unlock:setVideo', { ...input, path: src('a.txt') });
    assert.ok(res.error);
    assert.equal(store.getConfig().unlockAnimation.file, '');
});
test('remove 清掉视频，保留淡入淡出和声音', async () => {
    await invoke('unlock:setVideo', input);
    store.saveConfig({ unlockAnimation: { fadeInMs: 1200, sound: true } });
    const u = (await invoke('unlock:remove')).config.unlockAnimation;
    assert.deepEqual([u.file, u.enabled, u.fadeInMs, u.sound], ['', false, 1200, true]);
});
test('getInfo：文件被删了 exists 是 false', async () => {
    const u = (await invoke('unlock:setVideo', input)).config.unlockAnimation;
    fs.unlinkSync(path.join(store.getUnlockAnimationDir(), u.file));
    assert.equal((await invoke('unlock:getInfo')).exists, false);
});
test('播放页面的事件转给控制器，带上发送方', () => {
    emit('unlock:player-event', { sender: SENDER }, 'ready');
    assert.deepEqual(controller.events, [[SENDER, 'ready']]);
});
```

- [ ] **Step 2: 运行，确认失败**

Run: `node --test test/unlock-ipc.test.js`
Expected: FAIL，找不到模块 `../src/unlock-animation/ipc`

- [ ] **Step 3: 实现 `src/unlock-animation/ipc.js`、`preload.js` 的命名空间、`src/win32.js` 的 `isRemoteSession`**

对话框用 `VIDEO_EXTENSIONS`，写法参考 `src/elements/ipc.js`。

- [ ] **Step 4: 运行，确认通过**

Run: `node --test test/unlock-ipc.test.js`
Expected: PASS

- [ ] **Step 5: 改 `main.js`**

- 引入 `globalShortcut`。在 `registerIpcHandlers()` 之前建控制器：
  - `getPlayback`：不是预览时，`isPlacing` 或远程会话（`getWin32().isRemoteSession()`，加载失败当作不是）返回 null；否则调 `resolvePlayback`
  - `createWindow`、`refitWindow`：Task 4 的函数
  - `registerSkipKey`：`globalShortcut.register('Escape', onSkip)`；`unregisterSkipKey`：`globalShortcut.unregister('Escape')`
  - `isSessionLocked`：`powerMonitor.getSystemIdleState(1) === 'locked'`
  - `onHoldChange`：`syncWallpaperSignal`
- `syncWallpaperSignal` 的 `system` 改成 `isScreenLocked || isSuspended || unlockAnimation.holdsWallpaper`。
- `lock-screen` 处理里**先**调 `unlockAnimation.handleLock()`。`unlock-screen` 处理里**先**调 `unlockAnimation.handleUnlock()`，再清 `isScreenLocked`、调 `syncWallpaperSignal`。
- `registerIpcHandlers` 里调 `registerUnlockIpc`。
- `cleanupAndQuit` 里调 `unlockAnimation.dispose()`。
- `startApp` 里元素清理的旁边调 `cleanupUnlockFiles`。

- [ ] **Step 6: 跑全部测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 7: 用模拟事件走一遍真实程序**

用一个临时的数据目录，不要碰用户真实的配置。在临时目录的 `config.json` 里写好 `unlockAnimation`，把 `elements/bomb1_cut.mp4` 复制到它的 `unlock_animation/` 下。用 `npx electron . --inspect=9229 --user-data-dir=<临时目录>` 启动，通过调试端口的 `Runtime.evaluate` 依次执行：

```js
process.mainModule.require('electron').powerMonitor.emit('lock-screen')
process.mainModule.require('electron').powerMonitor.emit('unlock-screen')
```

Expected：视频盖住任务栏播放，淡出后回到桌面；放完后 `BrowserWindow.getAllWindows()` 里没有播放窗口；`logs/main.log` 没有报错。

- [ ] **Step 8: 提交**

```bash
git add main.js preload.js src/win32.js src/unlock-animation/ipc.js test/unlock-ipc.test.js
git commit -m "feat: 解锁动画接进主进程，锁屏解锁时自动播放"
```

---

### Task 6: 设置页

**Files:**
- Create: `settings/unlock-page.js`
- Modify: `settings.html`、`settings/settings.css`、`settings/main.js`、`ui/icons.js`

**Interfaces:**
- Consumes: Task 5 的 `api.unlockAnimation`；`makeThumbnailInfo(url, 'video')`（`settings/thumbnail.js`）；`Controls.bindRange`、`Controls.setRange`；`Shared.myWallpapers.formatDuration`
- Produces: `initUnlockPage({ api, saver, setStatus, onPageChange }) -> { load(config) }`

- [ ] **Step 1: 加图标和页面结构**

`ui/icons.js` 加 `i-lock-open`（Lucide 0.460.0 的 `lock-open`）：

```html
<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>
```

`settings.html`：

- 导航：在「唱片机」后面、`.nav-spacer` 前面加 `data-page="unlock"`，文字「解锁动画」，英文 `Unlock`。
- 页面 `#page-unlock`：标题「解锁动画」，英文 `Unlock animation`，说明「解锁电脑后全屏播放一段你的视频，放完回到桌面。」右上角是开关 `#unlock-enabled`。
- 下面是 `.list.cf`，每行用现有的 `.row`：
  - 视频：`<img id="unlock-thumb">`、`#unlock-video-name`、`#unlock-video-duration`，按钮 `#btn-unlock-select`（「选择视频…」）、`#btn-unlock-remove`（「移除」）
  - 淡入时长：`<input type="range" id="unlock-fade-in" min="0" max="3" step="0.1">`、`#unlock-fade-in-value`
  - 淡出时长：同上，`#unlock-fade-out`、`#unlock-fade-out-value`
  - 声音：开关 `#unlock-sound`，说明「默认关闭，免得在安静的地方突然响」
- 底部：按钮 `#btn-unlock-preview`（「预览」），提示 `<p class="note" id="unlock-note" hidden>`。
- 脚本：`shared/unlock-animation.js`、`settings/unlock-page.js`，放在 `settings/main.js` 之前。

`settings/settings.css` 加缩略图样式（96×54，`object-fit: cover`），其余沿用现有类。

- [ ] **Step 2: 实现 `settings/unlock-page.js`**

- 没有视频时：`#unlock-enabled`、「移除」、「预览」禁用，显示「还没有选择视频」。
- 「选择视频…」：`selectVideo` → `makeThumbnailInfo` 失败时 `setStatus('这个视频打不开，换一个试试', 'error')` → 按钮禁用、`setStatus('正在导入视频…')` → `setVideo` → 按返回的配置重画。
- 滑块显示 `0.5 秒`，保存时换算成毫秒：`saver.save({ unlockAnimation: { fadeInMs: Math.round(v * 1000) } })`。
- 开关：`saver.save({ unlockAnimation: { enabled } })`、`{ sound }`。
- 「预览」：`saver.flush()` 后调 `preview()`，返回 false 时 `setStatus('现在不能预览，稍后再试', 'error')`。
- 提示：`getInfo().exists` 为 false 时显示「视频文件找不到了，请重新选择」；否则开机自启没开时显示「程序要在运行才能播放，建议在「设置」里打开开机自动启动」；都不是就隐藏。切到这一页时重新检查（`onPageChange`）。

`settings/main.js` 里接上，`load` 放进现有的 `Promise.all`。

- [ ] **Step 3: 在浏览器里看页面**

用 Browser pane 打开 `settings.html`，切到「解锁动画」。
Expected：导航有新项，页面排版正常，夜间和日间主题都正常，控制台没有报错。

- [ ] **Step 4: 在真实程序里走一遍**

`npx electron . --dev --user-data-dir=<临时目录>`（不碰用户真实的配置），选 `elements/bomb1_cut.mp4`。
Expected：显示缩略图、文件名、时长，开关自动打开；改滑块后重开窗口值还在；「预览」全屏播放，Esc 和点鼠标都能跳过；「移除」后回到空状态，`unlock_animation/` 里的文件没了。

- [ ] **Step 5: 跑全部测试并提交**

Run: `npm test`
Expected: 全部 PASS

```bash
git add settings.html settings/settings.css settings/main.js settings/unlock-page.js ui/icons.js
git commit -m "feat: 设置页加解锁动画，能选视频、调淡入淡出、开声音和预览"
```

---

### Task 7: 真实验收和文档

**Files:**
- Modify: `README.md`、`README.en.md`、`PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`

- [ ] **Step 1: 请用户实测（模拟事件测不出闪屏）**

用 `npm run dev` 或打包版，请用户逐项确认：

| 项目 | 期望 |
|---|---|
| Win+L 后输密码解锁 | 全盖住任务栏，没闪，放完焦点还在原来的程序 |
| 合盖或睡眠后解锁 | 同上 |
| PIN、指纹、人脸解锁 | 同上 |
| Esc 跳过、点鼠标跳过 | 马上淡出 |
| 淡入淡出改成 0 和 3 秒 | 分别直接切换、慢慢过渡 |
| 开声音 | 有声音，壁纸和唱片机的声音不叠加 |
| 删掉 `unlock_animation/` 里的视频后解锁 | 不放，正常进桌面 |
| 接外接显示器 | 只放在主显示器，副显示器不受影响 |

同时看 `logs/main.log`：确认 `getSystemIdleState` 这层保险的实际表现，把结果写进笔记。

有问题先修再继续，修的时候用 superpowers:systematic-debugging。

- [ ] **Step 2: 打包验证**

Run: `npm run build`
Expected：生成 `dist/Interactive3DWallpaper-Setup-1.2.0.exe`。安装后走一遍选视频、预览、Win+L 解锁，确认打包版的页面路径和视频加载正常。

- [ ] **Step 3: 更新文档**

- `README.md`、`README.en.md`：功能列表加解锁动画。
- `PROJECT_NOTES.md`：§1 概括、§3 文件地图、§4 加「解锁动画」流程、§5 IPC 表、§6 配置结构、§9 加新阶段（实验结论、实测结果、没测到的项目）。
- `PROJECT_NOTES.en.md` 同步，以中文版为准。

- [ ] **Step 4: 跑全部测试并提交**

Run: `npm test`
Expected: 全部 PASS

```bash
git add README.md README.en.md PROJECT_NOTES.md PROJECT_NOTES.en.md
git commit -m "docs: 记录解锁动画的做法和实测结果"
```
