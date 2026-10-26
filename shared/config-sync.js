/**
 * config-sync.js — 配置同步的节流与差异判断
 *
 * - createConfigSaver：设置页拖滑块时，每次 input 都保存会频繁写盘并广播完整配置。
 *   这里把改动合并起来：第一次立即发送，之后每个间隔最多发送一次，最后一个值一定会发出去。
 * - changedSections：壁纸收到完整配置后，只重新应用真正变了的那几段。
 */

(function (root, factory) {
    const mod = factory();
    if (typeof module === 'object' && module.exports) module.exports = mod;
    else (root.Shared = root.Shared || {}).configSync = mod;
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

    /** 合并两次局部配置：嵌套对象（vinyl、weather……）按字段合并，其他值直接覆盖 */
    function mergePartial(base, partial) {
        const out = { ...base };
        for (const [key, value] of Object.entries(partial)) {
            out[key] = isPlainObject(value) && isPlainObject(out[key]) ? { ...out[key], ...value } : value;
        }
        return out;
    }

    /**
     * @param {(partial: object) => void} save - 真正的保存函数
     * @param {number} intervalMs - 两次发送之间的最短间隔
     * @param {{setTimeout: Function, clearTimeout: Function, now: () => number}} [timers] - 测试时注入假时钟
     * @returns {{ save: (partial: object) => void, flush: () => void }}
     */
    function createConfigSaver(save, intervalMs, timers) {
        const t = timers || {
            setTimeout: (fn, ms) => setTimeout(fn, ms),
            clearTimeout: (h) => clearTimeout(h),
            now: () => Date.now(),
        };
        let pending = null;
        let timer = null;
        let lastSentAt = -Infinity;

        function flush() {
            if (timer !== null) {
                t.clearTimeout(timer);
                timer = null;
            }
            if (!pending) return;
            const partial = pending;
            pending = null;
            lastSentAt = t.now();
            save(partial);
        }

        return {
            save(partial) {
                pending = pending ? mergePartial(pending, partial) : { ...partial };
                const wait = lastSentAt + intervalMs - t.now();
                if (wait <= 0) flush();
                else if (timer === null) timer = t.setTimeout(flush, wait);
            },
            flush,
        };
    }

    /**
     * 比较配置里的指定几段和上一次应用时是否一样。
     * @param {Object<string, string>} snapshot - 上一次应用时各段的 JSON
     * @param {object} config - 新收到的完整配置
     * @param {string[]} keys - 要比较的段
     * @returns {{ changed: string[], snapshot: Object<string, string> }} 变了的段和新的快照（不修改入参）
     */
    function changedSections(snapshot, config, keys) {
        const next = { ...snapshot };
        const changed = [];
        for (const key of keys) {
            if (config[key] === undefined) continue;
            const json = JSON.stringify(config[key]);
            if (json !== snapshot[key]) {
                changed.push(key);
                next[key] = json;
            }
        }
        return { changed, snapshot: next };
    }

    return { createConfigSaver, changedSections };
});
