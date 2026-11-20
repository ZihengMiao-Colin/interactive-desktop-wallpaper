'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FileTracker } = require('../src/file-tracking/tracker');
const { samePath } = require('../shared/my-wallpapers');

function setup(options = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tracker-'));
    const dataFile = path.join(dir, 'file_ids.json');
    const make = (name, content = 'data') => {
        const p = path.join(dir, name);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, content);
        return p;
    };
    const tracker = new FileTracker({ dataFile, shouldTrack: () => true, ...options });
    return { dir, dataFile, make, tracker };
}

const saved = (dataFile) => JSON.parse(fs.readFileSync(dataFile, 'utf8'));

test('记过编号的文件改名、挪到子文件夹后 findMoves 找到它', async () => {
    const { dir, make, tracker } = setup();
    const a = make('a.jpg');
    await tracker.record([a]);
    const b = path.join(dir, 'sub', 'b.jpg');
    fs.mkdirSync(path.dirname(b));
    fs.renameSync(a, b);
    const moves = await tracker.findMoves([a]);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].from, a);
    assert.ok(samePath(moves[0].to, b), `找到的是 ${moves[0].to}`);
});

test('删掉的、挪进 $Recycle.Bin 文件夹的、改了大小的、换成别的扩展名的都找不回', async () => {
    const { dir, make, tracker } = setup();
    const deleted = make('deleted.jpg');
    const recycled = make('recycled.jpg');
    const grown = make('grown.jpg');
    const renamed = make('renamed.jpg');
    await tracker.record([deleted, recycled, grown, renamed]);

    fs.unlinkSync(deleted);
    fs.mkdirSync(path.join(dir, '$Recycle.Bin', 'S-1-5-21'), { recursive: true });
    fs.renameSync(recycled, path.join(dir, '$Recycle.Bin', 'S-1-5-21', '$R123.jpg'));
    const grownTo = path.join(dir, 'grown2.jpg');
    fs.renameSync(grown, grownTo);
    fs.appendFileSync(grownTo, 'more');
    fs.renameSync(renamed, path.join(dir, 'renamed.txt'));

    assert.deepEqual(await tracker.findMoves([deleted, recycled, grown, renamed]), []);
});

test('没记过编号的文件不见了时找不回，不报错', async () => {
    const { dir, make, tracker } = setup();
    const a = make('a.jpg');
    fs.renameSync(a, path.join(dir, 'b.jpg'));
    assert.deepEqual(await tracker.findMoves([a]), []);
});

test('shouldTrack 为假的路径不记、不查（网络路径立刻跳过）', async () => {
    const accessed = [];
    const access = async (p) => { accessed.push(p); return fs.promises.access(p); };
    const { dataFile, make, tracker } = setup({ shouldTrack: (p) => !p.startsWith('\\\\'), access });
    const local = make('a.jpg');
    const unc = '\\\\no-such-host\\share\\a.jpg';
    const started = Date.now();
    await tracker.record([local, unc]);
    assert.deepEqual(await tracker.findMoves([local, unc]), []);
    assert.ok(Date.now() - started < 200);
    assert.ok(!accessed.includes(unc));
    assert.equal(Object.values(saved(dataFile)).some((r) => r.path === unc), false);
});

test('file_ids.json 不存在或损坏时按空记录处理，record 之后写出合法 JSON', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-tracker-'));
    const dataFile = path.join(dir, 'file_ids.json');
    fs.writeFileSync(dataFile, '{坏的');
    const tracker = new FileTracker({ dataFile, shouldTrack: () => true });
    const a = path.join(dir, 'a.jpg');
    fs.writeFileSync(a, 'x');
    await tracker.record([a]);
    const records = Object.values(saved(dataFile));
    assert.equal(records.length, 1);
    assert.equal(records[0].path, a);
    assert.equal(records[0].size, 1);
});

test('record 删掉配置里已经不用的记录；原位置换成别的文件时更新记录', async () => {
    const { dataFile, make, tracker } = setup();
    const a = make('a.jpg');
    const b = make('b.jpg');
    await tracker.record([a, b]);
    const before = Object.values(saved(dataFile)).find((r) => r.path === a);

    fs.unlinkSync(a);
    make('a.jpg', 'another file');   // 同一个位置换成了别的文件
    await tracker.record([a]);
    const records = Object.values(saved(dataFile));
    assert.equal(records.length, 1);
    assert.equal(records[0].path, a);
    assert.notEqual(records[0].id + ':' + records[0].size, before.id + ':' + before.size);
});

test('rename 把记录挪到新路径，之后 locate 用新路径的记录', async () => {
    const { dir, make, tracker } = setup();
    const a = make('a.jpg');
    await tracker.record([a]);
    const b = path.join(dir, 'b.jpg');
    fs.renameSync(a, b);
    tracker.rename([{ from: a, to: b }]);
    const c = path.join(dir, 'c.jpg');
    fs.renameSync(b, c);
    assert.equal(tracker.locate(a), null);
    assert.ok(samePath(tracker.locate(b), c));
});

test('壁纸图片挪走后被改成 gif 时找不回（「我的壁纸」不支持 gif）', async () => {
    const { dir, make, tracker } = setup();
    const a = make('a.jpg');
    await tracker.record([a]);
    fs.renameSync(a, path.join(dir, 'a.gif'));
    assert.deepEqual(await tracker.findMoves([a]), []);
});
