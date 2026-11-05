'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const unlockAnimation = require('../shared/unlock-animation');
const crop = require('../shared/crop');

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'unlock-player.js'), 'utf8');

/** 在假的页面环境里跑播放页脚本，返回上报记录和发事件的方法 */
function loadPage(search = '?video=v.mp4&fadeInMs=500&fadeOutMs=700&sound=0') {
    const reports = [];
    const documentEvents = new EventEmitter();
    const video = new EventEmitter();
    video.addEventListener = (name, fn) => video.on(name, fn);
    video.style = {};
    video.play = () => Promise.resolve();

    vm.runInNewContext(SOURCE, {
        location: { search },
        URLSearchParams,
        Shared: { unlockAnimation, crop },
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
    return { reports, documentEvents, video };
}

test('松开鼠标就跳过：窗口不能激活时按下事件可能收不到，松开总能收到', () => {
    const { reports, documentEvents } = loadPage();
    documentEvents.emit('mouseup');
    assert.deepEqual(reports, ['skip']);
});

test('有裁剪时只显示裁剪区域，没有时不动样式', () => {
    const search = '?video=v.mp4&fadeInMs=500&fadeOutMs=700&sound=0';
    assert.equal(loadPage(search + '&crop=0.1,0.2,0.5,0.25').video.style.objectViewBox,
        'inset(20.0000% 40.0000% 55.0000% 10.0000%)');
    assert.equal('objectViewBox' in loadPage(search).video.style, false);
    assert.equal('objectViewBox' in loadPage(search + '&crop=a,b').video.style, false);
});
