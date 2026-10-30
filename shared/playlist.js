/**
 * playlist.js — 唱片机歌单的纯逻辑（主进程、壁纸页、设置页共用）
 *
 * 配置里的 vinyl：
 *   playlist: [{ path, name }]   同一个文件只出现一次，path 兼作这首歌的 id
 *   current:  当前这首歌的 path（歌单为空时是 ''）
 *   playMode: 'list' 列表循环 | 'one' 单曲循环 | 'shuffle' 随机播放 | 'once' 顺序播放（放完最后一首停下）
 * 旧版本只有一首歌（audioPath / audioName / loop），读配置时由 normalizeVinyl 换成一首歌的歌单。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).playlist = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const MODES = ['list', 'one', 'shuffle', 'once'];

    /** 文件路径 → 歌名：去掉目录和扩展名 */
    function trackName(filePath) {
        const base = String(filePath).split(/[\\/]/).pop();
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.slice(0, dot) : base;
    }

    /** 整理成合法的歌：有 path，有名字（没有就用文件名） */
    function toTrack(t) {
        if (!t || typeof t.path !== 'string' || !t.path) return null;
        return { path: t.path, name: typeof t.name === 'string' && t.name ? t.name : trackName(t.path) };
    }

    /** 去掉坏数据和重复的歌（同一个 path 只留第一次出现的） */
    function cleanList(list) {
        const seen = new Set();
        const out = [];
        for (const raw of list) {
            const t = toTrack(raw);
            if (!t || seen.has(t.path)) continue;
            seen.add(t.path);
            out.push(t);
        }
        return out;
    }

    /**
     * 补齐 / 修正 vinyl 里的歌单字段；旧配置的 audioPath 变成一首歌的歌单，loop: false 变成顺序播放。
     * 旧字段（audioPath、audioName、loop）去掉，免得有地方还在读它们。
     */
    function normalizeVinyl(vinyl) {
        const { audioPath, audioName, loop, ...rest } = vinyl || {};
        const hasList = Array.isArray(rest.playlist);
        const playlist = hasList
            ? cleanList(rest.playlist)
            : cleanList(audioPath ? [{ path: audioPath, name: audioName ? trackName(audioName) : '' }] : []);
        const wanted = hasList ? rest.current : audioPath;
        const current = playlist.some((t) => t.path === wanted) ? wanted : (playlist[0] ? playlist[0].path : '');
        const playMode = MODES.includes(rest.playMode) ? rest.playMode : (loop === false ? 'once' : 'list');
        return { ...rest, playlist, current, playMode };
    }

    function currentIndex(vinyl) {
        const list = (vinyl && vinyl.playlist) || [];
        return list.findIndex((t) => t.path === vinyl.current);
    }

    /** 当前这首歌 { path, name }；歌单为空时为 null */
    function currentTrack(vinyl) {
        const i = currentIndex(vinyl);
        return i >= 0 ? vinyl.playlist[i] : null;
    }

    /**
     * 往歌单末尾加歌，已经在歌单里的跳过。原来没有当前歌时，当前歌换成第一首新加的。
     * @param {{ path: string, name?: string }[]} files
     * @returns {{ playlist: object[], current: string, added: object[] }}
     */
    function addTracks(vinyl, files) {
        const list = (vinyl && vinyl.playlist) || [];
        const have = new Set(list.map((t) => t.path));
        const added = cleanList(files || []).filter((t) => !have.has(t.path));
        const playlist = [...list, ...added];
        const current = currentTrack({ playlist, current: vinyl && vinyl.current })
            ? vinyl.current
            : (added[0] ? added[0].path : (playlist[0] ? playlist[0].path : ''));
        return { playlist, current, added };
    }

    /** 删掉一首；删的是当前歌时，当前歌换成原位置上的下一首（删的是最后一首就换成新的最后一首） */
    function removeTrack(vinyl, path) {
        const list = vinyl.playlist || [];
        const i = list.findIndex((t) => t.path === path);
        if (i < 0) return { playlist: list, current: vinyl.current };
        const playlist = list.filter((_, k) => k !== i);
        if (vinyl.current !== path) return { playlist, current: vinyl.current };
        const next = playlist[Math.min(i, playlist.length - 1)];
        return { playlist, current: next ? next.path : '' };
    }

    /** 把第 from 首挪到原来第 before 首的前面（before 等于歌单长度时挪到最后） */
    function moveTrack(list, from, before) {
        const out = list.slice();
        if (from < 0 || from >= out.length || before < 0 || before > out.length) return out;
        const [item] = out.splice(from, 1);
        out.splice(before > from ? before - 1 : before, 0, item);
        return out;
    }

    /** 随机挑一首不是第 i 首的（只有一首时就是它自己） */
    function randomOther(list, i, rand) {
        if (list.length < 2) return list[0].path;
        const k = Math.floor(rand() * (list.length - 1));
        return list[k >= i ? k + 1 : k].path;
    }

    /**
     * 手动切歌（上一首 dir = -1 / 下一首 dir = 1）：按歌单顺序循环；随机模式的下一首随机挑另一首。
     * 单曲循环时手动切歌也照样往下走。
     * @returns {string} 新的当前歌；歌单为空时为 ''
     */
    function step(vinyl, dir, rand = Math.random) {
        const list = vinyl.playlist || [];
        if (!list.length) return '';
        const i = Math.max(0, currentIndex(vinyl));
        if (dir > 0 && vinyl.playMode === 'shuffle') return randomOther(list, i, rand);
        return list[(i + dir + list.length) % list.length].path;
    }

    /**
     * 一首播完以后接哪首。
     * @returns {string | null} 新的当前歌；顺序播放放完最后一首时返回 null（停下）
     */
    function afterEnded(vinyl, rand = Math.random) {
        const list = vinyl.playlist || [];
        if (!list.length) return null;
        const i = Math.max(0, currentIndex(vinyl));
        switch (vinyl.playMode) {
            case 'one': return list[i].path;
            case 'shuffle': return randomOther(list, i, rand);
            case 'once': return i + 1 < list.length ? list[i + 1].path : null;
            default: return list[(i + 1) % list.length].path;
        }
    }

    /** 下一首还是这一首（单曲循环，或者只有一首歌且不是顺序播放）：交给 <audio loop> 自己循环 */
    function loopsCurrent(vinyl) {
        const n = (vinyl.playlist || []).length;
        return vinyl.playMode === 'one' || (n === 1 && vinyl.playMode !== 'once');
    }

    return {
        MODES, trackName, normalizeVinyl, currentIndex, currentTrack,
        addTracks, removeTrack, moveTrack, step, afterEnded, loopsCurrent,
    };
});
