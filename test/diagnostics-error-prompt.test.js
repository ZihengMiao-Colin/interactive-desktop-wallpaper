'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createErrorPrompt } = require('../src/diagnostics/error-prompt');

const MINUTE = 60 * 1000;

/**
 * 假的对话框：记下每次弹框的参数，用 answer() 模拟用户点按钮。
 * label 是按钮文字，checked 是"本次运行不再提示"有没有勾。
 */
function setup({ minIntervalMs = 10 * MINUTE } = {}) {
    const shown = [];
    const calls = { report: 0, quit: 0 };
    let clock = 0;
    let pending = null;
    const prompt = createErrorPrompt({
        showDialog: (options) => new Promise((resolve) => {
            shown.push(options);
            pending = { options, resolve };
        }),
        onReport: async () => { calls.report += 1; },
        onQuit: () => { calls.quit += 1; },
        now: () => clock,
        minIntervalMs,
    });
    return {
        prompt, shown, calls,
        advance: (ms) => { clock += ms; },
        async answer(label, checked = false) {
            const { options, resolve } = pending;
            pending = null;
            resolve({ response: options.buttons.indexOf(label), checkboxChecked: checked });
            await new Promise((r) => setImmediate(r));
        },
    };
}

test('出错时弹中文提示框，带错误信息和"生成诊断报告"按钮', async () => {
    const t = setup();
    t.prompt.notify(new Error('boom'));
    assert.equal(t.shown.length, 1);
    const options = t.shown[0];
    assert.deepEqual(options.buttons, ['生成诊断报告', '忽略', '退出程序']);
    assert.match(options.detail, /boom/);
    assert.match(options.message, /出错/);
    assert.ok(options.checkboxLabel);
});

test('框还开着时又出错，不弹第二个', async () => {
    const t = setup();
    t.prompt.notify(new Error('a'));
    t.prompt.notify(new Error('b'));
    assert.equal(t.shown.length, 1);
});

test('关掉后 10 分钟内再出错不弹，过了 10 分钟再弹', async () => {
    const t = setup();
    t.prompt.notify(new Error('a'));
    await t.answer('忽略');
    t.advance(9 * MINUTE);
    t.prompt.notify(new Error('b'));
    assert.equal(t.shown.length, 1);
    t.advance(2 * MINUTE);
    t.prompt.notify(new Error('c'));
    assert.equal(t.shown.length, 2);
});

test('勾了"本次运行不再提示"之后不再弹', async () => {
    const t = setup();
    t.prompt.notify(new Error('a'));
    await t.answer('忽略', true);
    t.advance(60 * MINUTE);
    t.prompt.notify(new Error('b'));
    assert.equal(t.shown.length, 1);
});

test('点"生成诊断报告"生成报告，不退出', async () => {
    const t = setup();
    t.prompt.notify(new Error('a'));
    await t.answer('生成诊断报告');
    assert.deepEqual(t.calls, { report: 1, quit: 0 });
});

test('点"退出程序"退出，点"忽略"什么都不做', async () => {
    const quit = setup();
    quit.prompt.notify(new Error('a'));
    await quit.answer('退出程序');
    assert.deepEqual(quit.calls, { report: 0, quit: 1 });

    const ignore = setup();
    ignore.prompt.notify(new Error('a'));
    await ignore.answer('忽略');
    assert.deepEqual(ignore.calls, { report: 0, quit: 0 });
});

test('启动失败：只有生成报告和退出两个按钮，没有勾选框，生成报告后也退出', async () => {
    const t = setup();
    t.prompt.notify(new Error('init'), { fatal: true });
    const options = t.shown[0];
    assert.deepEqual(options.buttons, ['生成诊断报告', '退出程序']);
    assert.equal(options.checkboxLabel, undefined);
    assert.match(options.message, /启动失败/);
    await t.answer('生成诊断报告');
    assert.deepEqual(t.calls, { report: 1, quit: 1 });
});

test('启动失败时就算勾过不再提示、刚弹过，也要弹', async () => {
    const t = setup();
    t.prompt.notify(new Error('a'));
    await t.answer('忽略', true);
    t.prompt.notify(new Error('init'), { fatal: true });
    assert.equal(t.shown.length, 2);
});

test('生成报告出错、弹框本身出错，都不往外抛', async () => {
    const prompt = createErrorPrompt({
        showDialog: async () => ({ response: 0, checkboxChecked: false }),
        onReport: async () => { throw new Error('disk full'); },
        onQuit: () => {},
    });
    await prompt.notify(new Error('a'));

    const broken = createErrorPrompt({
        showDialog: async () => { throw new Error('not ready'); },
        onReport: async () => {},
        onQuit: () => {},
    });
    await broken.notify(new Error('a'));
});
