'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AppStore } = require('../src/store');
const { registerUnlockIpc } = require('../src/unlock-animation/ipc');

/** 1×1 的 JPEG 就够了，这里只看文件有没有写出来 */
const THUMB = 'data:image/jpeg;base64,/9j/4AAQ';

function setup({ dialogResult } = {}) {
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-unlock-src-'));
    const store = new AppStore({ userDataPath: fs.mkdtempSync(path.join(os.tmpdir(), 'wp-unlock-data-')) });
    const handlers = new Map();
    const listeners = new Map();
    const broadcasts = { count: 0 };
    const controller = { events: [], previewResult: true, previews: 0 };
    controller.handlePlayerEvent = (sender, name) => controller.events.push([sender, name]);
    controller.preview = () => { controller.previews++; return controller.previewResult; };

    registerUnlockIpc({
        ipcMain: {
            handle: (channel, fn) => handlers.set(channel, fn),
            on: (channel, fn) => listeners.set(channel, fn),
        },
        dialog: { showOpenDialog: async () => dialogResult || { canceled: true, filePaths: [] } },
        store,
        getDialogParent: () => null,
        broadcastConfig: () => { broadcasts.count++; },
        controller,
    });

    const src = (name) => {
        const file = path.join(srcDir, name);
        fs.writeFileSync(file, 'video');
        return file;
    };
    return {
        store,
        broadcasts,
        controller,
        src,
        unlockFile: (name) => path.join(store.getUnlockAnimationDir(), name),
        invoke: (channel, ...args) => handlers.get(channel)({}, ...args),
        emit: (channel, event, ...args) => listeners.get(channel)(event, ...args),
    };
}

test('setVideo 复制视频、打开开关、记下原文件名', async () => {
    const { invoke, src, unlockFile, broadcasts } = setup();
    const { config } = await invoke('unlock:setVideo', { path: src('我的 #1.MP4'), thumbDataUrl: THUMB, duration: 6 });
    const u = config.unlockAnimation;
    assert.equal(u.enabled, true);
    assert.equal(u.name, '我的 #1.MP4');
    assert.equal(u.duration, 6);
    assert.match(u.file, /^video_[0-9a-f-]+\.mp4$/);
    assert.ok(fs.existsSync(unlockFile(u.file)));
    assert.ok(fs.existsSync(unlockFile(u.thumb)));
    assert.equal(broadcasts.count, 1);
});

test('换视频时删掉旧文件和旧缩略图', async () => {
    const { invoke, src, unlockFile } = setup();
    const input = { path: src('a.mp4'), thumbDataUrl: THUMB, duration: 6 };
    const first = (await invoke('unlock:setVideo', input)).config.unlockAnimation;
    await invoke('unlock:setVideo', input);
    assert.equal(fs.existsSync(unlockFile(first.file)), false);
    assert.equal(fs.existsSync(unlockFile(first.thumb)), false);
});

test('不支持的格式返回错误，配置不变', async () => {
    const { invoke, src, store } = setup();
    const res = await invoke('unlock:setVideo', { path: src('a.txt'), thumbDataUrl: THUMB, duration: 6 });
    assert.ok(res.error);
    assert.equal(store.getConfig().unlockAnimation.file, '');
});

test('原文件不见了返回错误，配置不变', async () => {
    const { invoke, store } = setup();
    const res = await invoke('unlock:setVideo', { path: 'C:/nope/a.mp4', thumbDataUrl: THUMB, duration: 6 });
    assert.ok(res.error);
    assert.equal(store.getConfig().unlockAnimation.file, '');
});

test('remove 清掉视频，保留淡入淡出和声音', async () => {
    const { invoke, src, store, unlockFile } = setup();
    const added = (await invoke('unlock:setVideo', { path: src('a.mp4'), thumbDataUrl: THUMB, duration: 6 })).config.unlockAnimation;
    store.saveConfig({ unlockAnimation: { fadeInMs: 1200, sound: true } });
    const u = (await invoke('unlock:remove')).config.unlockAnimation;
    assert.deepEqual([u.file, u.name, u.thumb, u.duration, u.enabled, u.fadeInMs, u.sound], ['', '', '', 0, false, 1200, true]);
    assert.equal(fs.existsSync(unlockFile(added.file)), false);
});

test('getInfo：有视频时给缩略图地址', async () => {
    const { invoke, src } = setup();
    await invoke('unlock:setVideo', { path: src('a.mp4'), thumbDataUrl: THUMB, duration: 6 });
    const info = await invoke('unlock:getInfo');
    assert.equal(info.exists, true);
    assert.match(info.thumbUrl, /^file:\/\//);
});

test('getInfo：没选过视频', async () => {
    const { invoke } = setup();
    assert.deepEqual(await invoke('unlock:getInfo'), { exists: false, thumbUrl: null });
});

test('getInfo：文件被删了 exists 是 false', async () => {
    const { invoke, src, unlockFile } = setup();
    const u = (await invoke('unlock:setVideo', { path: src('a.mp4'), thumbDataUrl: THUMB, duration: 6 })).config.unlockAnimation;
    fs.unlinkSync(unlockFile(u.file));
    assert.equal((await invoke('unlock:getInfo')).exists, false);
});

test('selectVideo：取消时返回 canceled', async () => {
    assert.deepEqual(await setup().invoke('unlock:selectVideo'), { canceled: true });
});

test('selectVideo：返回路径、file URL 和文件名', async () => {
    const res = await setup({ dialogResult: { canceled: false, filePaths: ['C:/videos/我的 #1.mp4'] } }).invoke('unlock:selectVideo');
    assert.equal(res.path, 'C:/videos/我的 #1.mp4');
    assert.equal(res.name, '我的 #1.mp4');
    assert.match(res.url, /^file:\/\/.*%23/);
});

test('preview 转给控制器', async () => {
    const { invoke, controller } = setup();
    controller.previewResult = false;
    assert.equal(await invoke('unlock:preview'), false);
    assert.equal(controller.previews, 1);
});

test('播放页面的事件转给控制器，带上发送方', () => {
    const { emit, controller } = setup();
    const sender = {};
    emit('unlock:player-event', { sender }, 'ready');
    assert.deepEqual(controller.events, [[sender, 'ready']]);
});
