/**
 * tracker.js — 记住用户文件的编号；文件不在原来的位置时按编号找回，并确认找到的就是原来那个
 *
 * 记录存在 userData/file_ids.json：{ [规范化路径]: { path, vol, id, size } }。
 * 不放进 config.json：窗口用不到，不用跟着配置广播。
 *
 * 找到的路径要同时满足下面几条才算数（宁可显示"找不到文件"，也不能接错）：
 *   不在回收站里、还是同一类文件（图片 / 视频 / 音频）、大小没变、卷号和编号都对得上。
 */

'use strict';

const fs = require('fs');
const { fileKind } = require('./paths');

/** 记录的 key：不分大小写和斜杠方向（和 shared/my-wallpapers.js 的 samePath 一样） */
const keyOf = (p) => String(p || '').toLowerCase().replace(/\//g, '\\');

const inRecycleBin = (p) => keyOf(p).includes('\\$recycle.bin\\');

class FileTracker {
    /**
     * @param {{
     *   dataFile: string,
     *   shouldTrack: (p: string) => boolean,
     *   fileIds?: { readFileId: Function, findPathById: Function },
     *   access?: (p: string) => Promise<void>,
     * }} options
     */
    constructor({ dataFile, shouldTrack, fileIds = require('./file-id'), access = fs.promises.access }) {
        this.dataFile = dataFile;
        this.shouldTrack = shouldTrack;
        this.fileIds = fileIds;
        this.access = access;
        this.records = this._load();
    }

    _load() {
        try {
            const data = JSON.parse(fs.readFileSync(this.dataFile, 'utf8'));
            return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        } catch {
            return {};   // 没有或者坏了：当成什么都没记过
        }
    }

    _save() {
        try {
            fs.writeFileSync(this.dataFile, JSON.stringify(this.records, null, 2));
        } catch (err) {
            console.error('[FileTracker] 保存文件编号失败:', err.message);
        }
    }

    async _exists(p) {
        try {
            await this.access(p);
            return true;
        } catch {
            return false;
        }
    }

    /** 不该管的路径（网络路径、软件自己的文件）直接跳过；判断出错也当不该管 */
    _trackable(p) {
        try {
            return typeof p === 'string' && p !== '' && !!this.shouldTrack(p);
        } catch {
            return false;
        }
    }

    /**
     * 给还在的文件记编号（没记过、或者原位置换成了别的文件时更新），删掉不再用的记录。
     * @param {string[]} paths - 配置里现在引用的所有路径
     */
    async record(paths) {
        let changed = false;
        const wanted = new Set();
        for (const p of paths) {
            if (!this._trackable(p)) continue;
            const key = keyOf(p);
            wanted.add(key);
            if (!(await this._exists(p))) continue;
            const id = this.fileIds.readFileId(p);
            if (!id) continue;
            const old = this.records[key];
            if (!old || old.path !== p || old.vol !== id.vol || old.id !== id.id || old.size !== id.size) {
                this.records[key] = { path: p, ...id };
                changed = true;
            }
        }
        for (const key of Object.keys(this.records)) {
            if (!wanted.has(key)) {
                delete this.records[key];
                changed = true;
            }
        }
        if (changed) this._save();
    }

    /**
     * 找出不在原来位置、但按编号能找回的文件。
     * @param {string[]} paths
     * @returns {Promise<Array<{from: string, to: string}>>}
     */
    async findMoves(paths) {
        const moves = [];
        for (const p of paths) {
            if (!this._trackable(p) || !this.records[keyOf(p)]) continue;
            if (await this._exists(p)) continue;
            const to = this.locate(p);
            if (to) moves.push({ from: p, to });
        }
        return moves;
    }

    /**
     * 按记下的编号找这个文件现在在哪，找到的不是原来那个文件就当找不到。
     * @returns {string|null}
     */
    locate(fromPath) {
        try {
            const record = this.records[keyOf(fromPath)];
            if (!record) return null;
            const found = this.fileIds.findPathById(record, fromPath);
            if (!found || inRecycleBin(found)) return null;
            if (!fileKind(found) || fileKind(found) !== fileKind(fromPath)) return null;
            const now = this.fileIds.readFileId(found);
            if (!now || now.vol !== record.vol || now.id !== record.id || now.size !== record.size) return null;
            return found;
        } catch (err) {
            console.error('[FileTracker] 找回文件失败:', err.message);
            return null;
        }
    }

    /** 文件换了路径之后，把记录挪到新路径下 */
    rename(moves) {
        let changed = false;
        for (const { from, to } of moves) {
            const record = this.records[keyOf(from)];
            if (!record) continue;
            delete this.records[keyOf(from)];
            this.records[keyOf(to)] = { ...record, path: to };
            changed = true;
        }
        if (changed) this._save();
    }
}

module.exports = { FileTracker };
