'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { redactUserName, PLACEHOLDER } = require('../src/diagnostics/redact');

test('Windows 路径里的用户名换成占位符', () => {
    assert.equal(
        redactUserName('[Store] Data dir: C:\\Users\\Alice\\AppData\\Roaming\\app', 'Alice'),
        `[Store] Data dir: C:\\Users\\${PLACEHOLDER}\\AppData\\Roaming\\app`,
    );
});

test('正斜杠、JSON 转义的双反斜杠也换', () => {
    assert.equal(redactUserName('file:///C:/Users/Alice/a.png', 'Alice'), `file:///C:/Users/${PLACEHOLDER}/a.png`);
    assert.equal(redactUserName('"C:\\\\Users\\\\Alice\\\\a.png"', 'Alice'), `"C:\\\\Users\\\\${PLACEHOLDER}\\\\a.png"`);
});

test('不区分大小写（Windows 路径本来就不分）', () => {
    assert.equal(redactUserName('c:\\users\\ALICE\\x', 'Alice'), `c:\\users\\${PLACEHOLDER}\\x`);
});

test('中文用户名在 file:// 地址里是 URL 编码的，也要换', () => {
    const encoded = encodeURIComponent('张三');
    assert.equal(redactUserName(`file:///C:/Users/${encoded}/a.png`, '张三'), `file:///C:/Users/${PLACEHOLDER}/a.png`);
    assert.equal(redactUserName('C:\\Users\\张三\\a.png', '张三'), `C:\\Users\\${PLACEHOLDER}\\a.png`);
});

test('路径以用户目录结尾、后面跟引号或空格时也换', () => {
    assert.equal(redactUserName('home=C:\\Users\\Alice end', 'Alice'), `home=C:\\Users\\${PLACEHOLDER} end`);
    assert.equal(redactUserName("'C:\\Users\\Alice'", 'Alice'), `'C:\\Users\\${PLACEHOLDER}'`);
    assert.equal(redactUserName('C:\\Users\\Alice', 'Alice'), `C:\\Users\\${PLACEHOLDER}`);
});

test('别的用户目录、名字只是开头相同的目录不动', () => {
    assert.equal(redactUserName('C:\\Users\\Public\\x', 'Alice'), 'C:\\Users\\Public\\x');
    assert.equal(redactUserName('C:\\Users\\Alicex\\x', 'Alice'), 'C:\\Users\\Alicex\\x');
});

test('用户名里有正则特殊字符', () => {
    assert.equal(redactUserName('C:\\Users\\a.b(1)\\x', 'a.b(1)'), `C:\\Users\\${PLACEHOLDER}\\x`);
    assert.equal(redactUserName('C:\\Users\\aXb\\x', 'a.b'), 'C:\\Users\\aXb\\x');
});

test('8.3 短路径（TEMP 里常见的 ALICEW~1）也换', () => {
    assert.equal(
        redactUserName('C:\\Users\\ALICEW~1\\AppData\\Local\\Temp', 'Alice Wang'),
        `C:\\Users\\${PLACEHOLDER}\\AppData\\Local\\Temp`,
    );
});

test('不在路径里的同名文字不动（用户名可能是一串数字，会误伤时间戳）', () => {
    assert.equal(redactUserName('[2026-11-18 24418] took 24418ms', '24418'), '[2026-11-18 24418] took 24418ms');
});

test('没有用户名时原样返回', () => {
    assert.equal(redactUserName('C:\\Users\\Alice\\x', ''), 'C:\\Users\\Alice\\x');
    assert.equal(redactUserName('C:\\Users\\Alice\\x', undefined), 'C:\\Users\\Alice\\x');
});
