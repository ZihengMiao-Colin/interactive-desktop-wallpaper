/**
 * music-page.js — 设置窗口"唱片机"页：开关、播放控制、歌单、播放顺序、音量、位置、大小、封面
 *
 * 歌单的增删、排序、换歌都用 Shared.playlist 算好再存进配置；壁纸那边一首播完自己换下一首，
 * 也是存进配置，这里跟着配置广播刷新播放器和歌单。
 */

'use strict';

/** 播放顺序的说明 */
const PLAY_MODE_DESC = {
    list: '放完最后一首回到第一首',
    one: '一直重复当前这首',
    shuffle: '每首放完随机挑下一首',
    once: '往下放到最后一首就停，再按播放从第一首开始',
};

/**
 * @param {{ api: object, saver: { save: (partial: object) => void }, setStatus: (msg: string, cls?: string) => void }} deps
 * @returns {{ load: (config: object) => void }}
 */
function initMusicPage({ api, saver, setStatus }) {
    const { el, setRange, bindRange, segmented, button } = Controls;
    const PL = Shared.playlist;
    const enabled = document.getElementById('vinyl-enabled');
    const musicName = document.getElementById('vinyl-current-music-name');
    const playState = document.getElementById('vinyl-play-state');
    const disc = document.querySelector('#page-music .disc');
    const discCover = document.getElementById('vinyl-disc-cover');
    const btnPlayPause = document.getElementById('btn-play-pause-toggle');
    const btnPrev = document.getElementById('btn-prev-track');
    const btnNext = document.getElementById('btn-next-track');
    const playIcon = btnPlayPause.querySelector('use');
    const listEl = document.getElementById('vinyl-playlist');
    const countEl = document.getElementById('playlist-count');
    const modeDesc = document.getElementById('vinyl-play-mode-desc');
    const volume = document.getElementById('vinyl-volume');
    const volumeVal = document.getElementById('vinyl-volume-val');
    const scale = document.getElementById('vinyl-scale');
    const scaleVal = document.getElementById('vinyl-scale-val');
    const coverThumb = document.getElementById('vinyl-cover-thumb');

    /** 最近一次的唱片机配置（歌单、当前歌、播放模式、在不在放） */
    let vinyl = PL.normalizeVinyl({});
    let coverPath = '';

    /** 改唱片机配置：先改本地再保存，界面立刻跟着变 */
    function update(partial) {
        vinyl = { ...vinyl, ...partial };
        saver.save({ vinyl: partial });
        render();
    }

    // ---------- 播放器 ----------

    /** 曲名、播放状态、唱片转不转、按钮 */
    function renderPlayer() {
        const track = PL.currentTrack(vinyl);
        const n = vinyl.playlist.length;
        const playing = !!vinyl.playing && !!track;
        musicName.textContent = track ? track.name : '歌单是空的';
        playState.textContent = !track
            ? '添加本地音乐后就会开始播放'
            : `${playing ? '正在播放' : '已暂停'} · 第 ${PL.currentIndex(vinyl) + 1} / ${n} 首`;
        disc.classList.toggle('spinning', playing);
        playIcon.setAttribute('href', playing ? '#i-pause' : '#i-play');
        btnPlayPause.title = playing ? '暂停' : '播放';
        btnPlayPause.setAttribute('aria-label', btnPlayPause.title);
        btnPlayPause.disabled = !track;
        btnPrev.disabled = btnNext.disabled = n < 2;
    }

    btnPlayPause.addEventListener('click', () => {
        if (!PL.currentTrack(vinyl)) return;
        update({ playing: !vinyl.playing });
        setStatus(vinyl.playing ? '开始播放' : '已暂停');
    });
    btnPrev.addEventListener('click', () => update({ current: PL.step(vinyl, -1) }));
    btnNext.addEventListener('click', () => update({ current: PL.step(vinyl, 1) }));

    // ---------- 歌单 ----------

    /** 拖动排序：正在拖的是第几首（-1 表示没在拖） */
    let dragFrom = -1;

    function renderTrack(track, i) {
        const isCurrent = track.path === vinyl.current;
        const missing = !api.fileExists(track.path);
        const row = el('div', 'track' + (isCurrent ? ' on' : '') + (isCurrent && vinyl.playing ? ' playing' : '') + (missing ? ' missing' : ''));
        row.draggable = true;
        row.title = track.path;

        const grip = el('span', 'grip');
        grip.appendChild(Icons.svg('grip-vertical'));
        const no = el('span', 'no');
        if (isCurrent && vinyl.playing) {
            no.append(el('i'), el('i'), el('i'));   // 正在放：跳动的小波形
        } else {
            no.textContent = String(i + 1);
        }
        const tx = el('span', 'tx');
        tx.appendChild(el('b', '', track.name));
        if (missing) tx.appendChild(el('small', '', '文件找不到了'));
        const del = button('btn sm icon ghost del', 'x', '', `从歌单移除「${track.name}」`);
        del.draggable = false;
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTrack(track);
        });
        row.append(grip, no, tx, del);

        // 点一首直接放（已经在放的就不打断）
        row.addEventListener('click', () => {
            if (isCurrent && vinyl.playing) return;
            update({ current: track.path, playing: true });
        });
        row.addEventListener('dragstart', (e) => {
            dragFrom = i;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', track.path);
        });
        row.addEventListener('dragend', () => {
            dragFrom = -1;
            row.classList.remove('dragging');
            markDrop(-1);
        });
        return row;
    }

    /** 鼠标在第几首的上半截之前：拖放后插到那一首前面（在最后一首下半截时是歌单长度） */
    function dropSlot(clientY) {
        const rows = [...listEl.querySelectorAll('.track')];
        const i = rows.findIndex((r) => {
            const b = r.getBoundingClientRect();
            return clientY < b.top + b.height / 2;
        });
        return i < 0 ? rows.length : i;
    }

    /** 插入位置画一条线：slot 那一首的上边，或者最后一首的下边 */
    function markDrop(slot) {
        const rows = [...listEl.querySelectorAll('.track')];
        rows.forEach((r, k) => {
            r.classList.toggle('drop-before', k === slot);
            r.classList.toggle('drop-after', slot === rows.length && k === rows.length - 1);
        });
    }

    listEl.addEventListener('dragover', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        markDrop(dropSlot(e.clientY));
    });
    listEl.addEventListener('drop', (e) => {
        if (dragFrom < 0) return;
        e.preventDefault();
        const slot = dropSlot(e.clientY);
        const from = dragFrom;
        markDrop(-1);
        // 放回原处（自己前面或后面）不用保存
        if (slot !== from && slot !== from + 1) update({ playlist: PL.moveTrack(vinyl.playlist, from, slot) });
    });

    function renderPlaylist() {
        const n = vinyl.playlist.length;
        countEl.textContent = n ? `${n} 首` : '';
        if (!n) {
            listEl.replaceChildren(el('div', 'playlist-empty', '歌单是空的。点"添加歌曲…"导入本地音乐，可以一次选好几首。'));
            return;
        }
        listEl.replaceChildren(...vinyl.playlist.map(renderTrack));
    }

    document.getElementById('btn-add-tracks').addEventListener('click', async () => {
        try {
            const paths = await api.selectAudioFiles();
            if (!paths || !paths.length) return;
            const r = PL.addTracks(vinyl, paths.map((path) => ({ path })));
            if (!r.added.length) {
                setStatus('选的歌都已经在歌单里了');
                return;
            }
            // 歌单原来是空的：显示唱片机并开始放第一首新歌；否则只加到末尾，不打断正在放的
            const wasEmpty = vinyl.playlist.length === 0;
            const partial = { playlist: r.playlist, current: r.current };
            if (wasEmpty) Object.assign(partial, { enabled: true, playing: true });
            if (wasEmpty) enabled.checked = true;
            update(partial);
            setStatus(`已添加 ${r.added.length} 首${wasEmpty ? '，开始播放' : ''}`, 'success');
        } catch (err) {
            setStatus('添加歌曲失败：' + err.message, 'error');
        }
    });

    function removeTrack(track) {
        const r = PL.removeTrack(vinyl, track.path);
        const partial = { playlist: r.playlist, current: r.current };
        if (!r.playlist.length) partial.playing = false;
        update(partial);
        setStatus(`已从歌单移除「${track.name}」`);
    }

    // ---------- 播放顺序 ----------

    const playMode = segmented(document.getElementById('vinyl-play-mode'), (value) => {
        modeDesc.textContent = PLAY_MODE_DESC[value];
        update({ playMode: value });
    });

    function render() {
        renderPlayer();
        renderPlaylist();
        playMode.set(vinyl.playMode);
        modeDesc.textContent = PLAY_MODE_DESC[vinyl.playMode] || '';
    }

    // ---------- 外观 ----------

    function renderCover() {
        const url = coverPath && api.fileExists(coverPath) ? `url("${api.toFileUrl(coverPath)}")` : '';
        coverThumb.style.backgroundImage = url;
        discCover.style.backgroundImage = url;
    }

    enabled.addEventListener('change', () => {
        saver.save({ vinyl: { enabled: enabled.checked } });
        setStatus(enabled.checked ? '已显示唱片机' : '已隐藏唱片机');
    });

    bindRange(volume, volumeVal, (v) => v + '%', (v) => saver.save({ vinyl: { volume: v / 100 } }));
    bindRange(scale, scaleVal, (v) => v + '%', (v) => saver.save({ vinyl: { scale: v / 100 } }));
    const positionDesc = document.getElementById('vinyl-position-desc');
    const position = segmented(document.getElementById('vinyl-position'), (value) => {
        showPosition(value);
        saver.save({ vinyl: { position: value } });
    });

    /** 四个角之一时高亮那个角；拖到别处（custom）时一个都不亮 */
    function showPosition(value) {
        position.set(value);
        positionDesc.textContent = value === 'custom'
            ? '在你拖到的位置，点右边的角可以放回角上'
            : '停在屏幕的哪个角，或者拖到任意位置';
    }

    function showScale(value) {
        const sc = Math.round((value !== undefined ? value : 1) * 100);
        setRange(scale, sc);
        scaleVal.textContent = sc + '%';
    }

    document.getElementById('btn-place-vinyl').addEventListener('click', async () => {
        try {
            await api.startVinylPlacement();
            setStatus('在桌面上拖动唱片机，拖角点调大小，Enter 确认，Esc 取消');
        } catch (err) {
            setStatus('打开摆放失败：' + err.message, 'error');
        }
    });

    document.getElementById('btn-import-cover').addEventListener('click', async () => {
        try {
            const path = await api.selectCover();
            if (!path) return;
            coverPath = path;
            renderCover();
            saver.save({ vinyl: { coverPath: path } });
            setStatus('已更换唱片封面', 'success');
        } catch (err) {
            setStatus('更换封面失败：' + err.message, 'error');
        }
    });

    document.getElementById('btn-reset-cover').addEventListener('click', () => {
        coverPath = '';
        renderCover();
        saver.save({ vinyl: { coverPath: '' } });
        setStatus('封面已换回默认');
    });

    // 配置广播：桌面上点唱片机会改播放状态，壁纸放完一首会换歌，摆放窗口里会改位置和大小。
    // 音量和正在拖的大小滑块不跟着改，免得和自己刚发出去、还在节流的值打架
    api.onLoadConfig((config) => {
        const next = (config && config.vinyl) || {};
        enabled.checked = !!next.enabled;
        showPosition(next.position || 'bottom-right');
        if (document.activeElement !== scale) showScale(next.scale);
        const before = JSON.stringify([vinyl.playlist, vinyl.current, vinyl.playMode, !!vinyl.playing]);
        vinyl = PL.normalizeVinyl(next);
        // 拖动排序时不重画，不然正在拖的那一行会被换掉
        if (dragFrom < 0 && JSON.stringify([vinyl.playlist, vinyl.current, vinyl.playMode, !!vinyl.playing]) !== before) render();
    });

    return {
        load(config) {
            const v = config.vinyl || {};
            vinyl = PL.normalizeVinyl(v);
            enabled.checked = !!v.enabled;
            render();

            const vol = Math.round((v.volume !== undefined ? v.volume : 0.6) * 100);
            setRange(volume, vol);
            volumeVal.textContent = vol + '%';
            showScale(v.scale);
            showPosition(v.position || 'bottom-right');

            coverPath = v.coverPath || '';
            renderCover();
        },
    };
}
