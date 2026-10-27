/**
 * ps-helper.js — 常驻 PowerShell 助手进程（全屏检测、桌面点击检测共用）
 *
 * 为什么常驻而不是每次起一个：
 *   每次 spawn powershell.exe 并现场 Add-Type 编译 C#，实测单次要 1.5 秒（首次 3.4 秒），
 *   同步调用还会卡住 Electron 主进程。所以只 spawn 一次，C# 在里面编译一次后进程内循环，
 *   结果按行写到 stdout，主进程按行读取。
 *
 * 为什么用 -EncodedCommand：
 *   Windows 命令行会对参数做二次解析，脚本里的引号和 here-string（@"..."@）很容易被吃掉一半，
 *   Base64(UTF-16LE) 只含 [A-Za-z0-9+/=]，不受任何引号规则影响。
 *
 * 助手启动成功后先输出一行 READY；异常退出会自动重启，连续失败太多次后放弃。stop() 时杀掉，不留孤儿进程。
 */

const { spawn } = require('child_process');

/** 助手进程连续异常退出多少次后放弃 */
const MAX_RESTARTS = 5;

/** 助手异常退出后的重启延迟（毫秒） */
const RESTART_DELAY = 3000;

/**
 * 把脚本编码成 -EncodedCommand 需要的 Base64(UTF-16LE)。
 * @param {string} script
 */
function toEncodedCommand(script) {
    return Buffer.from(script, 'utf16le').toString('base64');
}

class PowerShellHelper {
    /**
     * @param {object} options
     * @param {string} options.name - 日志前缀
     * @param {string} options.script - PowerShell 脚本，成功启动后应先输出 READY
     * @param {(line: string) => void} options.onLine - 收到除 READY 外的每一行（已去掉首尾空白，不含空行）
     */
    constructor({ name, script, onLine }) {
        this.name = name;
        this.script = script;
        this.onLine = onLine;
        this._proc = null;
        this._buffer = '';
        this._stopped = true;
        this._restarts = 0;
        this._restartTimer = null;
    }

    get running() {
        return !this._stopped;
    }

    /** 启动（异步，立即返回，不阻塞主进程） */
    start() {
        if (!this._stopped) return;
        this._stopped = false;
        this._restarts = 0;
        console.log(`[${this.name}] Starting helper`);
        this._spawn();
    }

    /** 停止并杀掉助手进程 */
    stop() {
        this._stopped = true;
        if (this._restartTimer) {
            clearTimeout(this._restartTimer);
            this._restartTimer = null;
        }
        if (this._proc) {
            const proc = this._proc;
            this._proc = null;
            try { proc.kill(); } catch (_) { /* 退出阶段忽略 */ }
            console.log(`[${this.name}] Helper stopped`);
        }
    }

    /**
     * 处理一段 stdout 输出：按行切分，READY 重置重启计数，其余交给 onLine。
     * @param {string} chunk
     */
    feed(chunk) {
        this._buffer += chunk;
        let index;
        while ((index = this._buffer.indexOf('\n')) >= 0) {
            const line = this._buffer.slice(0, index).trim();
            this._buffer = this._buffer.slice(index + 1);
            if (!line) continue;
            if (line === 'READY') {
                this._restarts = 0;   // 正常跑起来了，重置重启计数
                console.log(`[${this.name}] Helper ready`);
            } else {
                this.onLine(line);
            }
        }
    }

    _spawn() {
        if (this._stopped) return;

        let proc;
        try {
            proc = spawn('powershell.exe', [
                '-NoProfile',
                '-ExecutionPolicy', 'Bypass',
                '-WindowStyle', 'Hidden',
                '-EncodedCommand', toEncodedCommand(this.script),
            ], {
                windowsHide: true,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
        } catch (err) {
            console.error(`[${this.name}] Failed to spawn helper:`, err.message);
            return;
        }

        this._proc = proc;
        this._buffer = '';

        proc.stdout.setEncoding('utf8');
        proc.stdout.on('data', (chunk) => this.feed(chunk));

        proc.stderr.setEncoding('utf8');
        proc.stderr.on('data', (chunk) => {
            const text = String(chunk).trim();
            if (text) console.error(`[${this.name}:helper]`, text);
        });

        proc.on('error', (err) => {
            console.error(`[${this.name}] Helper error:`, err.message);
        });

        proc.on('exit', (code) => {
            if (this._proc === proc) this._proc = null;
            if (this._stopped) return;

            this._restarts += 1;
            if (this._restarts > MAX_RESTARTS) {
                console.error(`[${this.name}] Helper keeps dying, giving up`);
                return;
            }
            console.warn(`[${this.name}] Helper exited (code ${code}), restarting in ${RESTART_DELAY}ms`);
            this._restartTimer = setTimeout(() => {
                this._restartTimer = null;
                this._spawn();
            }, RESTART_DELAY);
        });
    }
}

module.exports = { PowerShellHelper, toEncodedCommand };
