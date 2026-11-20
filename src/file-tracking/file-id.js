/**
 * file-id.js — 按 NTFS 文件编号找文件现在在哪
 *
 * NTFS 上每个文件有一个固定编号（fs.stat 的 ino），同一个盘里移动、改名都不变；
 * dev 是这个盘的卷序列号。记下这两个数，文件找不到时用 kernel32 的 OpenFileById 按编号打开它，
 * 再用 GetFinalPathNameByHandleW 取出现在的完整路径。2026-11-20 在本机实测：普通用户权限就行。
 *
 * 找不回的情况：挪到别的盘（复制 + 删除，编号变了）、FAT32 / exFAT 的 U 盘（编号不固定）、
 * ReFS（开发驱动器，编号是 128 位的）、网络路径。这些都返回 null，由用户手动接上。
 *
 * 这里只负责"按编号找到路径"，找到的是不是原来那个文件（大小、类型、回收站）由 tracker.js 判断。
 * koffi 用到时才加载，加载失败时 findPathById 返回 null、isLocalDrivePath 返回 false。
 */

'use strict';

const fs = require('fs');
const path = require('path').win32;

const FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;   // 打开文件夹（盘符根目录）要带
const FILE_SHARE_ALL = 0x7;                      // 读 / 写 / 删除都共享，不挡住用户的操作
const OPEN_EXISTING = 3;
const FILE_READ_ATTRIBUTES = 0x80;               // 只要能取路径，不读内容
const INVALID_HANDLE_VALUE = -1;
const VOLUME_NAME_DOS = 0;
const FILE_ID_TYPE = 0;                          // 64 位编号
const DRIVE_REMOVABLE = 2;
const DRIVE_FIXED = 3;
const DRIVE_RAMDISK = 6;
const PATH_BUFFER = 32768;

let api;   // undefined：还没加载；null：加载失败

function load() {
    if (api !== undefined) return api;
    try {
        const koffi = require('koffi');
        const kernel32 = koffi.load('kernel32.dll');
        // 类型名在整个进程里共用，起一个不会和 win32.js 撞的名字
        const descriptor = koffi.struct('WP_FILE_ID_DESCRIPTOR', {
            dwSize: 'uint32',
            Type: 'uint32',
            FileId: 'int64',
            pad: 'int64',   // 联合体按最大的成员（16 字节的 GUID）算，补齐到 24 字节
        });
        api = {
            descriptor,
            CreateFileW: kernel32.func('intptr_t __stdcall CreateFileW(str16 name, uint32 access, uint32 share, void *sa, uint32 disposition, uint32 flags, intptr_t templateFile)'),
            OpenFileById: kernel32.func('intptr_t __stdcall OpenFileById(intptr_t volumeHint, WP_FILE_ID_DESCRIPTOR *id, uint32 access, uint32 share, void *sa, uint32 flags)'),
            GetFinalPathNameByHandleW: kernel32.func('uint32 __stdcall GetFinalPathNameByHandleW(intptr_t handle, _Out_ uint16 *buffer, uint32 length, uint32 flags)'),
            GetDriveTypeW: kernel32.func('uint32 __stdcall GetDriveTypeW(str16 root)'),
            CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t handle)'),
        };
    } catch (err) {
        console.error('[FileId] 加载 kernel32 失败:', err.message);
        api = null;
    }
    return api;
}

/**
 * 读文件的编号。
 * @returns {{vol: string, id: string, size: number}|null} vol 是卷序列号（十六进制），id 是文件编号（十进制，免得丢精度）
 */
function readFileId(filePath) {
    try {
        const st = fs.statSync(filePath, { bigint: true });
        if (!st.isFile()) return null;
        return { vol: st.dev.toString(16), id: st.ino.toString(), size: Number(st.size) };
    } catch {
        return null;
    }
}

/** 盘符根目录的卷序列号（十六进制），读不到返回 null */
function volumeOf(root) {
    try {
        return fs.statSync(root, { bigint: true }).dev.toString(16);
    } catch {
        return null;
    }
}

/**
 * 按编号找文件现在的路径。
 * @param {{vol: string, id: string}} record - readFileId 记下的编号
 * @param {string} hintPath - 文件原来的路径，用它的盘符找到那个盘
 * @returns {string|null}
 */
function findPathById(record, hintPath) {
    const k = load();
    if (!k || !record || !/^\d+$/.test(String(record.id))) return null;
    const root = path.parse(String(hintPath || '')).root;
    if (!/^[a-zA-Z]:\\$/.test(root) || volumeOf(root) !== record.vol) return null;

    let rootHandle = INVALID_HANDLE_VALUE;
    let fileHandle = INVALID_HANDLE_VALUE;
    try {
        rootHandle = k.CreateFileW(root, 0, FILE_SHARE_ALL, null, OPEN_EXISTING, FILE_FLAG_BACKUP_SEMANTICS, 0);
        if (rootHandle === INVALID_HANDLE_VALUE) return null;
        const id = { dwSize: 24, Type: FILE_ID_TYPE, FileId: BigInt(record.id), pad: 0n };
        fileHandle = k.OpenFileById(rootHandle, id, FILE_READ_ATTRIBUTES, FILE_SHARE_ALL, null, FILE_FLAG_BACKUP_SEMANTICS);
        if (fileHandle === INVALID_HANDLE_VALUE) return null;
        const buffer = new Uint16Array(PATH_BUFFER);
        const length = k.GetFinalPathNameByHandleW(fileHandle, buffer, PATH_BUFFER, VOLUME_NAME_DOS);
        if (!length || length >= PATH_BUFFER) return null;
        const full = Buffer.from(buffer.buffer, 0, length * 2).toString('utf16le');
        if (full.startsWith('\\\\?\\UNC\\')) return null;
        return full.startsWith('\\\\?\\') ? full.slice(4) : full;
    } catch (err) {
        console.error('[FileId] 按编号找文件失败:', err.message);
        return null;
    } finally {
        if (fileHandle !== INVALID_HANDLE_VALUE) k.CloseHandle(fileHandle);
        if (rootHandle !== INVALID_HANDLE_VALUE) k.CloseHandle(rootHandle);
    }
}

/**
 * 是不是本机硬盘、U 盘、内存盘上的路径（这些才记编号、才去检查在不在）。
 * 网络路径、网络盘、光驱都是 false：检查它们可能要等很久。
 */
function isLocalDrivePath(filePath) {
    const root = path.parse(String(filePath || '')).root;
    if (!/^[a-zA-Z]:\\$/.test(root)) return false;
    const k = load();
    if (!k) return false;
    try {
        const type = k.GetDriveTypeW(root);
        return type === DRIVE_FIXED || type === DRIVE_REMOVABLE || type === DRIVE_RAMDISK;
    } catch {
        return false;
    }
}

module.exports = { readFileId, volumeOf, findPathById, isLocalDrivePath };
