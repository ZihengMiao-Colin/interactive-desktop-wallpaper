/**
 * ui.js — 壁纸页的加载提示、状态 Toast 与错误提示
 */

'use strict';

const UI = (() => {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    const statusToast = document.getElementById('status-toast');
    let toastTimer = null;

    /** 显示加载遮罩 */
    function showLoading(message) {
        if (!loadingOverlay) return;
        if (loadingText) loadingText.textContent = message || '正在加载...';
        loadingOverlay.style.display = 'flex';
    }

    /** 隐藏加载遮罩 */
    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    /** 显示短暂的状态提示，duration 毫秒后自动消失 */
    function showToast(message, duration = 2500) {
        if (!statusToast) return;
        statusToast.textContent = message;
        statusToast.classList.add('visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => statusToast.classList.remove('visible'), duration);
    }

    /** 在屏幕中央显示初始化失败的错误信息 */
    function showError(message) {
        const errorEl = document.createElement('div');
        errorEl.className = 'init-error';
        const title = document.createElement('strong');
        title.textContent = '⚠️ 初始化失败';
        const body = document.createElement('div');
        body.textContent = message;
        const hint = document.createElement('small');
        hint.textContent = '可以通过托盘菜单 → "打开设置" 重新选择壁纸。';
        errorEl.append(title, body, hint);
        document.body.appendChild(errorEl);
    }

    return { showLoading, hideLoading, showToast, showError };
})();
