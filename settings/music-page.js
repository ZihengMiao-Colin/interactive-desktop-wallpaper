/**
 * music-page.js — 设置窗口"唱片机"页：开关、播放控制和进度条、歌单（每首歌的封面）、播放顺序、音量、位置、大小
 *
 * 歌单的增删、排序、换歌、换封面都用 Shared.playlist 算好再存进配置；壁纸那边一首播完自己换下一首，
 * 也是存进配置，这里跟着配置广播刷新播放器和歌单。
 * 封面：每首歌按 自选图 → 文件自带 → 同名图片 的顺序找（主进程 src/audio-cover.js），这里只记结果。
 * 进度条：音乐在壁纸窗口里放，进度经主进程发过来；拖完把"跳到第几秒"发回去，进度不存进配置。
 */

'use strict';

/** 播放顺序的说明 */
const PLAY_MODE_DESC = {
    list: '放完最后一首回到第一首',
    one: '一直重复当前这首',
    shuffle: '每首放完随机挑下一首',
    once: '往下放到最后一首就停，再按播放从第一首开始',
};

/** 封面是从哪来的（"唱片封面"一行的说明） */
const COVER_SOURCE_DESC = {
    manual: '用的是你选的图',
    embedded: '用的是歌曲文件自带的封面',
    sidecar: '用的是同一个文件夹里的同名图片',
    none: '没有封面，唱片中间是纯色标签',
};

/**
 * @param {{
 *   api: object,
 *   saver: { save: (partial: object) => void },
 *   setStatus: (msg: string, cls?: string) => void,
 *   onPageChange: (cb: (name: string) => void) => void,
 * }} deps
 * @returns {{ load: (config: object) => void }}
 */
function initMusicPage({ api, saver, setStatus, onPageChange }) {
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
    const seekBar = document.getElementById('vinyl-seek');
    const timeCur = document.getElementById('vinyl-time-cur');
    const timeTotal = document.getElementById('vinyl-time-total');
    const listEl = document.getElementById('vinyl-playlist');
    const countEl = document.getElementById('playlist-count');
    const modeDesc = document.getElementById('vinyl-play-mode-desc');
    const volume = document.getElementById('vinyl-volume');
    const volumeVal = document.getElementById('vinyl-volume-val');
    const scale = document.getElementById('vinyl-scale');
    const scaleVal = document.getElementById('vinyl-scale-val');
    const coverThumb = document.getElementById('vinyl-cover-thumb');
    const coverDesc = document.getElementById('vinyl-cover-desc');
    const btnPickCover = document.getElementById('btn-import-cover');
    const btnClearCover = document.getElementById('btn-reset-cover');

    /** 最近一次的唱片机配置（歌单、当前歌、播放模式、在不在放） */
    let vinyl = PL.normalizeVinyl({});

    /** 改唱片机配置：先改本地再保存，界面立刻跟着变 */
    function update(partial) {
        vinyl = { ...vinyl, ...partial };
        saver.save({ vinyl: partial });
        render();
    }

    // ---------- 封面 ----------

    const coverKey = (track) => (track ? `${track.path}|${track.cover || ''}` : '');
    /** 每首歌的封面结果：coverKey → { track, result: Promise<{ file, source }> } */
    const covers = new Map();

    function askCover(track) {
        return api.vinyl.resolveCover({ path: track.path, cover: track.cover || '' })
            .catch(() => ({ file: '', source: 'none' }));
    }

    function coverOf(track) {
        const key = coverKey(track);
        if (!covers.has(key)) covers.set(key, { track, result: askCover(track) });
        return covers.get(key).result;
    }

    const coverUrl = (file) => (file ? `url("${api.toFileUrl(file)}")` : '');

    /**
     * 窗口重新获得焦点时重新问一遍（可能刚往歌所在的文件夹里放了同名图片），有变化才重画，
     * 不直接清掉记下的结果：那样每次切回窗口小封面都会闪一下。
     */
    async function refreshCovers() {
        const known = [...covers.entries()];
        const fresh = await Promise.all(known.map(([, c]) => askCover(c.track)));
        const old = await Promise.all(known.map(([, c]) => c.result));
        const changed = fresh.some((r, i) => r.file !== old[i].file || r.source !== old[i].source);
        if (!changed) return;
        known.forEach(([key, c], i) => covers.set(key, { track: c.track, result: Promise.resolve(fresh[i]) }));
        if (dragFrom < 0) render();
    }

    /** 卡片里转的唱片、"唱片封面"一行：都是当前这首的 */
    function renderCurrentCover() {
        const track = PL.currentTrack(vinyl);
        btnPickCover.disabled = !track;
        btnClearCover.hidden = !(track && track.cover);
        if (!track) {
            discCover.style.backgroundImage = coverThumb.style.backgroundImage = '';
            coverDesc.textContent = '添加歌曲后，每首歌可以有自己的封面';
            return;
        }
        const key = coverKey(track);
        coverOf(track).then((r) => {
            if (coverKey(PL.currentTrack(vinyl)) !== key) return;
            discCover.style.backgroundImage = coverThumb.style.backgroundImage = coverUrl(r.file);
            const lost = track.cover && r.source !== 'manual' ? '你选的图找不到了，现在' : '';
            coverDesc.textContent = `「${track.name}」${lost}${COVER_SOURCE_DESC[r.source] || ''}`;
        });
    }

    async function pickCover(track) {
        try {
            const file = await api.selectCover();
            if (!file) return;
            update({ playlist: PL.setTrackCover(vinyl.playlist, track.path, file) });
            setStatus(`已给「${track.name}」换上封面`, 'success');
        } catch (err) {
            setStatus('更换封面失败：' + err.message, 'error');
        }
    }

    btnPickCover.addEventListener('click', () => {
        const track = PL.currentTrack(vinyl);
        if (track) pickCover(track);
    });
    btnClearCover.addEventListener('click', () => {
        const track = PL.currentTrack(vinyl);
        if (!track || !track.cover) return;
        update({ playlist: PL.setTrackCover(vinyl.playlist, track.path, '') });
        setStatus(`「${track.name}」不再用你选的图`);
    });

    // ---------- 播放器 ----------

    /** 曲名、播放状态、唱片转不转、按钮、封面、进度条 */
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
        renderCurrentCover();
        renderProgress();
    }

    btnPlayPause.addEventListener('click', () => {
        if (!PL.currentTrack(vinyl)) return;
        update({ playing: !vinyl.playing });
        setStatus(vinyl.playing ? '开始播放' : '已暂停');
    });
    btnPrev.addEventListener('click', () => update({ current: PL.step(vinyl, -1) }));
    btnNext.addEventListener('click', () => update({ current: PL.step(vinyl, 1) }));

    // ---------- 进度条 ----------

    const formatTime = (seconds) => Shared.myWallpapers.formatDuration(seconds) || '0:00';
    /** 壁纸最近发来的进度（path 是壁纸正在放的那首） */
    let progress = { path: '', currentTime: 0, duration: 0, playing: false };
    /** 正在拖进度条：拖的时候不吃壁纸发来的进度，松手才跳 */
    let seeking = false;

    /** 进度是当前这首的、而且知道时长才能拖；否则灰掉，两边显示 --:-- */
    function renderProgress() {
        const track = PL.currentTrack(vinyl);
        const known = !!track && progress.path === track.path && progress.duration > 0;
        seekBar.disabled = !known;
        if (!known) {
            seeking = false;
            seekBar.max = 1;
            setRange(seekBar, 0);
            timeCur.textContent = timeTotal.textContent = '--:--';
            return;
        }
        if (seeking) return;
        seekBar.max = progress.duration;
        setRange(seekBar, progress.currentTime);
        timeCur.textContent = formatTime(progress.currentTime);
        timeTotal.textContent = formatTime(progress.duration);
    }

    seekBar.addEventListener('input', () => {
        seeking = true;
        timeCur.textContent = formatTime(Number(seekBar.value));
    });
    seekBar.addEventListener('change', () => {
        seeking = false;
        const track = PL.currentTrack(vinyl);
        if (!track || progress.path !== track.path) return;
        const time = Number(seekBar.value);
        progress = { ...progress, currentTime: time };
        api.vinyl.seek({ path: track.path, time });
        renderProgress();
    });
    api.vinyl.onProgress((next) => {
        if (!next) return;
        progress = next;
        renderProgress();
    });

    // 设置窗口隐藏 / 最小化时主进程不转发进度，回来时要一次
    onPageChange((page) => {
        if (page === 'music') api.vinyl.requestProgress();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) api.vinyl.requestProgress();
    });
    window.addEventListener('focus', () => {
        api.vinyl.requestProgress();
        refreshCovers();
    });

    // ---------- 歌单 ----------

    /** 拖动排序：正在拖的是第几首（-1 表示没在拖） */
    let dragFrom = -1;
    /** 上次画歌单的时候每首歌的文件在不在（主进程检查完文件后和它比） */
    const shownTracks = new Map();

    /** 每行的小封面：点它给这首换图（不会顺带播放这首） */
    function trackCover(track) {
        const thumb = button('tcover', 'disc-3', '', `给「${track.name}」换封面`);
        thumb.title = '给这首歌换封面';
        thumb.draggable = false;
        thumb.addEventListener('click', (e) => {
            e.stopPropagation();
            pickCover(track);
        });
        coverOf(track).then((r) => {
            thumb.style.backgroundImage = coverUrl(r.file);
            thumb.classList.toggle('has', !!r.file);
        });
        return thumb;
    }

    function renderTrack(track, i) {
        const isCurrent = track.path === vinyl.current;
        const missing = !api.fileExists(track.path);
        shownTracks.set(Controls.fileKey(track.path), !missing);
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
        if (missing) tx.appendChild(el('small', '', '文件找不到了，点一下重新找'));
        const del = button('btn sm icon ghost del', 'x', '', `从歌单移除「${track.name}」`);
        del.draggable = false;
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeTrack(track);
        });
        row.append(grip, no, trackCover(track), tx, del);

        // 点一首直接放（已经在放的就不打断）；文件找不到的先让用户选它现在的位置
        row.addEventListener('click', () => {
            if (!api.fileExists(track.path)) {
                relinkTrack(track);
                return;
            }
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

    /** 找不到的歌：选它现在的位置，同一个旧文件夹里别的歌顺带接上（主进程换好配置后广播回来重画歌单） */
    async function relinkTrack(track) {
        try {
            const result = await api.files.relink(track.path);
            if (!result || result.canceled) return;
            if (result.error) setStatus(result.error, 'error');
            else setStatus(Controls.relinkMessage(result), 'success');
        } catch (err) {
            setStatus('重新找文件失败：' + err.message, 'error');
        }
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

    // 主进程检查完文件：有歌找不到了（或者又找到了）才重画歌单
    api.files.onChecked((status) => {
        if (dragFrom < 0 && Controls.fileStatusChanged(shownTracks, status)) renderPlaylist();
    });

    function renderPlaylist() {
        shownTracks.clear();
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
            api.vinyl.requestProgress();
        },
    };
}
