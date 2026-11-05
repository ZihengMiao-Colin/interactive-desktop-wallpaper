'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const unlockAnimation = require('../shared/unlock-animation');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'unlock-player.js'), 'utf8');

/** 在假的页面环境里跑播放页脚本，返回上报记录和发事件的方法 */
function loadPage() {
    const reports = [];
    const documentEvents = new EventEmitter();
    const video = new EventEmitter();
    video.addEventListener = (name, fn) => video.on(name, fn);
    video.style = {};
    video.play = () => Promise.resolve();

    vm.runInNewContext(SOURCE, {
        location: { search: '?video=v.mp4&fadeInMs=500&fadeOutMs=700&sound=0' },
        URLSearchParams,
        Shared: { unlockAnimation },
        setInterval,
        clearInterval,
        performance,
        document: {
            getElementById: () => video,
            addEventListener: (name, fn) => documentEvents.on(name, fn),
        },
        unlockPlayer: {
            report: (name) => reports.push(name),
            onStart() {},
            onFadeOut() {},
        },
    });
    return { reports, documentEvents };
}

test('松开鼠标就跳过：窗口不能激活时按下事件可能收不到，松开总能收到', () => {
    const { reports, documentEvents } = loadPage();
    documentEvents.emit('mouseup');
    assert.deepEqual(reports, ['skip']);
});
