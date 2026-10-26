'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createConfigSaver, changedSections } = require('../shared/config-sync');

/** 可控的假时钟：advance 时按到期顺序执行定时器 */
function fakeTimers() {
    let now = 0;
    const queue = [];
    return {
        now: () => now,
        setTimeout: (fn, ms) => { const h = { fn, at: now + ms }; queue.push(h); return h; },
        clearTimeout: (h) => { const i = queue.indexOf(h); if (i >= 0) queue.splice(i, 1); },
        advance(ms) {
            now += ms;
            for (const h of queue.filter((x) => x.at <= now).sort((a, b) => a.at - b.at)) {
                queue.splice(queue.indexOf(h), 1);
                h.fn();
            }
        },
        pending: () => queue.length,
    };
}

function setup() {
    const sent = [];
    const timers = fakeTimers();
    const saver = createConfigSaver((partial) => sent.push(partial), 100, timers);
    return { sent, timers, saver };
}

test('第一次改动立即发送', () => {
    const { sent, saver } = setup();
    saver.save({ parallaxMultiplier: 30 });
    assert.deepEqual(sent, [{ parallaxMultiplier: 30 }]);
});

test('间隔内的多次改动合并成一次，在间隔结束时发送最后的值', () => {
    const { sent, timers, saver } = setup();
    saver.save({ a: 1 });
    timers.advance(10);
    saver.save({ b: 2 });
    timers.advance(10);
    saver.save({ b: 3, vinyl: { volume: 0.5 } });
    saver.save({ vinyl: { scale: 1.2 } });
    assert.equal(sent.length, 1);
    timers.advance(80);
    assert.deepEqual(sent[1], { b: 3, vinyl: { volume: 0.5, scale: 1.2 } });
    timers.advance(1000);
    assert.equal(sent.length, 2);
});

test('安静一段时间后，下一次改动又立即发送', () => {
    const { sent, timers, saver } = setup();
    saver.save({ a: 1 });
    timers.advance(500);
    saver.save({ a: 2 });
    assert.deepEqual(sent, [{ a: 1 }, { a: 2 }]);
});

test('flush 立即发出待发送的改动，并取消定时器', () => {
    const { sent, timers, saver } = setup();
    saver.save({ a: 1 });
    saver.save({ a: 2 });
    saver.flush();
    assert.deepEqual(sent, [{ a: 1 }, { a: 2 }]);
    assert.equal(timers.pending(), 0);
    saver.flush();
    assert.equal(sent.length, 2, '没有待发送内容时 flush 不发送');
});

test('changedSections：第一次全部算变化，之后只报告变了的段', () => {
    const keys = ['weather', 'vinyl'];
    const first = changedSections({}, { weather: { type: 'rain' }, vinyl: { volume: 0.6 } }, keys);
    assert.deepEqual(first.changed, ['weather', 'vinyl']);

    const same = changedSections(first.snapshot, { weather: { type: 'rain' }, vinyl: { volume: 0.6 } }, keys);
    assert.deepEqual(same.changed, []);

    const vinylOnly = changedSections(same.snapshot, { weather: { type: 'rain' }, vinyl: { volume: 0.7 } }, keys);
    assert.deepEqual(vinylOnly.changed, ['vinyl']);
});

test('changedSections：缺失的段不算变化，快照保留旧值且不修改入参', () => {
    const keys = ['weather', 'vinyl'];
    const prev = changedSections({}, { weather: { type: 'rain' }, vinyl: { volume: 0.6 } }, keys).snapshot;
    const frozen = JSON.stringify(prev);
    const r = changedSections(prev, { vinyl: { volume: 0.6 } }, keys);
    assert.deepEqual(r.changed, []);
    assert.equal(r.snapshot.weather, prev.weather);
    assert.equal(JSON.stringify(prev), frozen);
});
