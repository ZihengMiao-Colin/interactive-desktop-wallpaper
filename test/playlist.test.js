'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PL = require('../shared/playlist');

const A = { path: 'C:/m/a.mp3', name: 'a' };
const B = { path: 'C:/m/b.mp3', name: 'b' };
const C = { path: 'C:/m/c.mp3', name: 'c' };
const vinylOf = (current, playMode = 'list', playlist = [A, B, C]) => ({ playlist, current: current.path, playMode });

test('trackName：去掉目录和扩展名', () => {
    assert.equal(PL.trackName('C:\\音乐\\晴天.mp3'), '晴天');
    assert.equal(PL.trackName('/x/y/a.b.flac'), 'a.b');
    assert.equal(PL.trackName('noext'), 'noext');
});

test('normalizeVinyl：旧配置的单首歌变成一首歌的歌单，loop 换成播放模式，旧字段去掉', () => {
    const v = PL.normalizeVinyl({ enabled: true, audioPath: 'C:/m/a.mp3', audioName: 'a.mp3', loop: false, volume: 0.5 });
    assert.deepEqual(v.playlist, [A]);
    assert.equal(v.current, 'C:/m/a.mp3');
    assert.equal(v.playMode, 'once');
    assert.equal(v.volume, 0.5);
    assert.equal('audioPath' in v, false);
    assert.equal('loop' in v, false);
    assert.equal(PL.normalizeVinyl({ audioPath: 'C:/m/a.mp3' }).playMode, 'list');
});

test('normalizeVinyl：没有歌、坏数据、重复的歌、current 找不到', () => {
    assert.deepEqual(PL.normalizeVinyl(undefined), { playlist: [], current: '', playMode: 'list' });
    const v = PL.normalizeVinyl({ playlist: [A, null, { path: '' }, { path: 'C:/m/b.mp3' }, A], current: 'C:/m/zzz.mp3', playMode: 'oops' });
    assert.deepEqual(v.playlist, [A, B]);
    assert.equal(v.current, 'C:/m/a.mp3');
    assert.equal(v.playMode, 'list');
    // 有 playlist 时不再看旧的 audioPath
    assert.deepEqual(PL.normalizeVinyl({ playlist: [], audioPath: 'C:/m/a.mp3' }).playlist, []);
});

test('currentTrack / currentIndex', () => {
    assert.deepEqual(PL.currentTrack(vinylOf(B)), B);
    assert.equal(PL.currentIndex(vinylOf(C)), 2);
    assert.equal(PL.currentTrack({ playlist: [], current: '' }), null);
    assert.equal(PL.currentIndex({ playlist: [A], current: 'x' }), -1);
});

test('addTracks：追加、跳过已有的歌；原来没有当前歌时从第一首新歌开始', () => {
    const r = PL.addTracks({ playlist: [A], current: A.path }, [{ path: B.path }, { path: A.path }, { path: C.path, name: 'c' }]);
    assert.deepEqual(r.playlist, [A, B, C]);
    assert.equal(r.current, A.path);
    assert.deepEqual(r.added, [B, C]);
    const empty = PL.addTracks({ playlist: [], current: '' }, [{ path: B.path }]);
    assert.equal(empty.current, B.path);
    assert.deepEqual(PL.addTracks({ playlist: [A], current: A.path }, [{ path: A.path }]).added, []);
});

test('removeTrack：删掉当前歌时换成原位置上的下一首（删最后一首时换成新的最后一首），删光为空', () => {
    assert.deepEqual(PL.removeTrack(vinylOf(B), B.path), { playlist: [A, C], current: C.path });
    assert.deepEqual(PL.removeTrack(vinylOf(C), C.path), { playlist: [A, B], current: B.path });
    assert.deepEqual(PL.removeTrack(vinylOf(A), C.path), { playlist: [A, B], current: A.path });
    assert.deepEqual(PL.removeTrack({ playlist: [A], current: A.path }, A.path), { playlist: [], current: '' });
});

test('moveTrack：把第 from 首插到第 before 首前面（before 等于长度时放到最后）', () => {
    const list = [A, B, C];
    assert.deepEqual(PL.moveTrack(list, 0, 3), [B, C, A]);
    assert.deepEqual(PL.moveTrack(list, 2, 0), [C, A, B]);
    assert.deepEqual(PL.moveTrack(list, 0, 2), [B, A, C]);
    assert.deepEqual(PL.moveTrack(list, 1, 1), [A, B, C]);
    assert.deepEqual(PL.moveTrack(list, 1, 2), [A, B, C]);
    assert.deepEqual(PL.moveTrack(list, 5, 0), [A, B, C]);
});

test('step：上一首 / 下一首按列表顺序循环；随机模式的下一首随机挑另一首', () => {
    assert.equal(PL.step(vinylOf(C), 1), A.path);
    assert.equal(PL.step(vinylOf(A), -1), C.path);
    assert.equal(PL.step(vinylOf(A, 'one'), 1), B.path);      // 单曲循环时手动切歌照样往下走
    assert.equal(PL.step(vinylOf(A, 'once'), 1), B.path);
    assert.equal(PL.step(vinylOf(A, 'shuffle'), 1, () => 0), B.path);
    assert.equal(PL.step(vinylOf(A, 'shuffle'), 1, () => 0.99), C.path);
    assert.equal(PL.step(vinylOf(B, 'shuffle'), 1, () => 0.4), A.path);   // 不会挑到自己
    assert.equal(PL.step(vinylOf(B, 'shuffle'), -1), A.path);
    assert.equal(PL.step({ playlist: [], current: '' }, 1), '');
});

test('afterEnded：播完一首后接哪首；顺序播放放完最后一首返回 null', () => {
    assert.equal(PL.afterEnded(vinylOf(B, 'list')), C.path);
    assert.equal(PL.afterEnded(vinylOf(C, 'list')), A.path);
    assert.equal(PL.afterEnded(vinylOf(B, 'one')), B.path);
    assert.equal(PL.afterEnded(vinylOf(B, 'once')), C.path);
    assert.equal(PL.afterEnded(vinylOf(C, 'once')), null);
    assert.equal(PL.afterEnded(vinylOf(A, 'shuffle'), () => 0.6), C.path);
    assert.equal(PL.afterEnded({ playlist: [A], current: A.path, playMode: 'shuffle' }), A.path);
});

test('loopsCurrent：单曲循环，或者只有一首歌且不是顺序播放时，让音频自己循环', () => {
    assert.equal(PL.loopsCurrent(vinylOf(A, 'one')), true);
    assert.equal(PL.loopsCurrent(vinylOf(A, 'list')), false);
    assert.equal(PL.loopsCurrent({ playlist: [A], current: A.path, playMode: 'list' }), true);
    assert.equal(PL.loopsCurrent({ playlist: [A], current: A.path, playMode: 'shuffle' }), true);
    assert.equal(PL.loopsCurrent({ playlist: [A], current: A.path, playMode: 'once' }), false);
});
