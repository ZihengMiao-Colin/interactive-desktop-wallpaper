/**
 * shell.js — 设置窗口外壳：左侧导航切页、右下角提示条、"正在使用"卡片、导航角标
 */

'use strict';

/** 提示条停留时间：普通 / 成功 3 秒，出错 6 秒 */
const TOAST_MS = { normal: 3000, error: 6000 };
const TOAST_ICON = { '': 'info', success: 'circle-check', error: 'circle-alert' };

/**
 * @returns {{
 *   setStatus: (msg: string, cls?: ''|'success'|'error') => void,
 *   showPage: (name: string) => void,
 *   setBadge: (page: string, text: string) => void,
 *   setNowUsing: (info: { name: string, thumbUrl: string } | null) => void,
 *   onPageChange: (cb: (name: string) => void) => void,
 * }}
 */
function initShell() {
    const navItems = [...document.querySelectorAll('.nav-item[data-page]')];
    const pages = [...document.querySelectorAll('.page')];
    const content = document.getElementById('content');
    const toast = document.getElementById('toast');
    const toastIcon = document.getElementById('toast-icon');
    const toastText = document.getElementById('toast-text');
    const nowUsing = document.getElementById('now-using');
    const nowUsingThumb = document.getElementById('now-using-thumb');
    const nowUsingName = document.getElementById('now-using-name');
    const pageListeners = [];
    let current = 'wallpaper';
    let toastTimer = null;

    function showPage(name) {
        if (name === current) return;
        current = name;
        for (const b of navItems) {
            const on = b.dataset.page === name;
            b.classList.toggle('on', on);
            if (on) b.setAttribute('aria-current', 'page');
            else b.removeAttribute('aria-current');
        }
        for (const p of pages) p.classList.toggle('on', p.id === 'page-' + name);
        content.scrollTop = 0;
        for (const cb of pageListeners) cb(name);
    }

    for (const b of navItems) b.addEventListener('click', () => showPage(b.dataset.page));
    nowUsing.addEventListener('click', () => showPage('wallpaper'));

    function setStatus(msg, cls = '') {
        toastText.textContent = msg;
        toastIcon.setAttribute('href', '#i-' + (TOAST_ICON[cls] || 'info'));
        toast.className = 'toast show' + (cls ? ' ' + cls : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), cls === 'error' ? TOAST_MS.error : TOAST_MS.normal);
    }

    function setBadge(page, text) {
        const badge = document.querySelector(`[data-badge="${page}"]`);
        if (badge) badge.textContent = text;
    }

    function setNowUsing(info) {
        nowUsing.hidden = !info;
        if (!info) return;
        nowUsingName.textContent = info.name;
        nowUsingThumb.src = info.thumbUrl;
    }

    return {
        setStatus,
        showPage,
        setBadge,
        setNowUsing,
        onPageChange: (cb) => pageListeners.push(cb),
    };
}
