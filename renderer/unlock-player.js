/**
 * unlock-player.js — 解锁动画的播放页面：放视频，把进度和操作报给主进程
 *
 * 页面在锁屏时就加载好，视频停在开头，收到 onStart 才放。黑色背景上把视频从透明变成不透明，
 * 就是从黑屏淡入。淡出由主进程改窗口透明度，这样能直接露出真实桌面。
 * 这里不要跑 requestAnimationFrame 循环，否则锁屏期间也在空转。
 */

'use strict';

(function startPlayer() {
    const query = new URLSearchParams(location.search);
    const fadeInMs = Number(query.get('fadeInMs'));
    const fadeOutMs = Number(query.get('fadeOutMs'));
    const { fadeOutStartMs } = Shared.unlockAnimation;
    const video = document.getElementById('video');

    let nearEndSent = false;
    function reportNearEnd() {
        if (nearEndSent) return;
        nearEndSent = true;
        unlockPlayer.report('near-end');
    }

    video.muted = query.get('sound') !== '1';
    video.style.transition = `opacity ${fadeInMs}ms ease-out`;
    // 只显示裁剪区域，object-fit: cover 会按这个区域铺满
    const crop = Shared.crop.parseQuery(query.get('crop'));
    if (crop) video.style.objectViewBox = Shared.crop.viewBoxInset(crop);

    video.addEventListener('loadeddata', () => unlockPlayer.report('ready'));
    video.addEventListener('error', () => unlockPlayer.report('error'));
    video.addEventListener('ended', reportNearEnd);
    video.addEventListener('timeupdate', () => {
        if (video.currentTime * 1000 >= fadeOutStartMs(video.duration * 1000, fadeOutMs)) reportNearEnd();
    });
    // 用松开不用按下：窗口不能激活，锁屏后 Chromium 的子窗口隐藏时，按下会被主窗口吞掉，只收得到松开
    document.addEventListener('mouseup', () => unlockPlayer.report('skip'));

    unlockPlayer.onStart(() => {
        video.style.opacity = '1';
        video.play().catch(() => unlockPlayer.report('error'));
    });

    // 窗口淡出时声音也跟着降下去，否则按 Esc 跳过时声音会突然断掉，还会和恢复的壁纸声音叠在一起
    unlockPlayer.onFadeOut((ms) => {
        if (video.muted || ms <= 0) return;
        const from = video.volume;
        const startedAt = performance.now();
        const timer = setInterval(() => {
            const t = Math.min(1, (performance.now() - startedAt) / ms);
            video.volume = from * (1 - t);
            if (t >= 1) clearInterval(timer);
        }, 20);
    });

    video.src = query.get('video');
})();
