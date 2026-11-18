'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildIssueUrl, REPO_URL } = require('../src/diagnostics/github');

const summary = ['软件版本：1.3.1（安装版）', '系统：Windows 11 Pro 10.0.26200 x64'];
const params = (url) => new URL(url).searchParams;

test('打开本项目的新建 issue 页面，标题带版本号', () => {
    const url = buildIssueUrl({ version: '1.3.1', summary, problems: [], reportFile: 'r.txt' });
    assert.ok(url.startsWith(`${REPO_URL}/issues/new?`), url);
    assert.match(params(url).get('title'), /1\.3\.1/);
});

test('正文有问题描述的位置、拖入报告的提示（带文件名）、自动填的基本信息', () => {
    const body = params(buildIssueUrl({ version: '1.3.1', summary, problems: [], reportFile: '互动3D壁纸-诊断报告-1.txt' })).get('body');
    assert.match(body, /遇到了什么问题/);
    assert.match(body, /互动3D壁纸-诊断报告-1\.txt/);
    assert.match(body, /拖/);
    assert.doesNotMatch(body, /桌面/, '桌面写不进去时报告存在"下载"里，不能写死位置');
    assert.match(body, /- 软件版本：1\.3\.1（安装版）/);
    assert.match(body, /- 系统：Windows 11 Pro/);
});

test('最近的错误放在代码块里', () => {
    const body = params(buildIssueUrl({ version: '1.3.1', summary, problems: ['[e] boom'], reportFile: 'r.txt' })).get('body');
    assert.match(body, /```\n\[e\] boom\n```/);
});

test('没有报告文件（生成失败）时不提拖文件', () => {
    const body = params(buildIssueUrl({ version: '1.3.1', summary, problems: [], reportFile: null })).get('body');
    assert.doesNotMatch(body, /拖/);
});

test('错误太多太长时只留最新的几条，整个地址不超过上限', () => {
    const problems = Array.from({ length: 30 }, (_, i) => `[error] 第 ${i} 条 ` + '很长的错误'.repeat(80));
    const url = buildIssueUrl({ version: '1.3.1', summary, problems, reportFile: 'r.txt', maxLength: 6000 });
    assert.ok(url.length <= 6000, `长度 ${url.length}`);
    const body = params(url).get('body');
    assert.match(body, /第 29 条/);
    assert.doesNotMatch(body, /第 0 条/);
});

test('单条错误本身就很长时截短，至少留下最新的一条', () => {
    const problems = ['[error] ' + '很'.repeat(3000)];
    const url = buildIssueUrl({ version: '1.3.1', summary, problems, reportFile: 'r.txt', maxLength: 6000 });
    assert.ok(url.length <= 6000, `长度 ${url.length}`);
    assert.match(params(url).get('body'), /\[error\] 很/);
});
