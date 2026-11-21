# 改名 Kirie 壁纸 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 软件在 Windows 里叫"Kirie 壁纸"，exe 叫 `Kirie.exe`，安装包叫 `Kirie-Setup-<版本>.exe`，界面、提示、报告、文档里的旧名字都换掉。

**Architecture:** 只改字符串和打包配置，不加功能。诊断报告的文件名和标题由 `src/diagnostics/report.js` 生成，测试按新名字改；打包配置加一个测试固定三个名字。

**Tech Stack:** Electron 28、electron-builder 24、`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-20-rename-kirie-design.md`

## Global Constraints

- 显示名 `Kirie 壁纸`；exe `Kirie`；安装包 `Kirie-Setup-${version}.${ext}`。
- 不改 `package.json` 的 `name`、`appId`，不改 GitHub 链接。
- 不做任何旧版、老用户相关的处理。
- 注释和界面文字用简体中文；不提交，改完给用户看。

## Review Focus

1. 漏改：界面上、提示框里还剩"互动3D壁纸"。Task 2 最后用 grep 查一遍（历史记录里的旧名字保留）。
2. 标题栏小字原本是给英文设计的（9.5px、大写、宽字距），换成中文可能太小或挤，截图确认（Task 2）。
3. `productName` 带中文和空格：安装包文件名不受影响（`artifactName` 是英文），exe 名由 `executableName` 决定。打包后检查（Task 2）。

---

### Task 1: 打包配置、界面、提示和报告里的名字

**Files:**
- Modify: `package.json`（`build.productName`、加 `build.executableName`、`nsis.artifactName`）
- Modify: `main.js`（设置窗口标题、报告失败提示框标题）、`settings.html`（`<title>`、标题栏、卸载说明和确认框）、`settings/settings.css`（标题栏小字）、`index.html`（`<title>`）
- Modify: `src/tray-manager.js`（提示文字、"关于"）、`src/diagnostics/error-prompt.js`（两个提示框标题）、`src/diagnostics/report.js`（文件名、报告标题）、`build/installer.nsh`（注释里的 exe 名）
- Test: `test/app-icon.test.js`（加名字测试）、`test/diagnostics-*.test.js`、`test/uninstaller.test.js`、`test/gallery.test.js`

- [ ] **Step 1: 改测试**
  - `test/app-icon.test.js` 加：`打包配置：显示名 Kirie 壁纸，exe 叫 Kirie，安装包 Kirie-Setup-<版本>`，断言 `pkg.build.productName === 'Kirie 壁纸'`、`pkg.build.executableName === 'Kirie'`、`pkg.build.nsis.artifactName === 'Kirie-Setup-${version}.${ext}'`、`pkg.name === 'interactive-desktop-wallpaper'`、`pkg.build.appId === 'com.wallpaper.interactive-3d'`。
  - 诊断测试里的期望改成 `Kirie-诊断报告-20261118-140322.txt`、报告第一行 `Kirie 壁纸 诊断报告`。
  - 示例数据里代表本软件的 exe / 卸载程序 / 安装目录换成新名字（`Kirie.exe`、`Uninstall Kirie 壁纸.exe`、`C:\Program Files\Kirie 壁纸\`）。

- [ ] **Step 2: 跑测试，确认新期望失败**
Run: `npm test`
Expected: 名字测试和诊断报告文件名 / 标题的测试失败，其余通过。

- [ ] **Step 3: 改代码** —— 按设计文档"改哪些地方"一节逐条改；标题栏小字改成中文样式（不大写、正常字距，字号和 `b` 协调）。

- [ ] **Step 4: 跑测试，确认通过**
Run: `npm test`
Expected: 全部通过。

---

### Task 2: 文档、漏改检查、真实效果

**Files:**
- Modify: `README.md`、`README.en.md`（标题、注明原名、打包产物文件名）
- Modify: `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`（"最近更新"、开头的技术栈表里的产物名、§9 发布步骤里的文件名和 Release 标题、新的阶段 25）

- [ ] **Step 1: 改文档**（历史记录里提到的旧文件名、旧名字不改）
- [ ] **Step 2: 漏改检查**
Run: `grep -rn -E "互动 ?3D ?壁纸|Interactive3DWallpaper|Interactive Wallpaper" --include=*.js --include=*.html --include=*.css --include=*.json --include=*.nsh . | grep -v node_modules`
Expected: 只剩标题栏小字"互动 3D 壁纸"和测试里有意保留的。
- [ ] **Step 3: 开发版截图**：设置窗口标题栏夜间、日间，窗口标题，托盘提示文字。
- [ ] **Step 4: 打包** `npx electron-builder --win nsis --config.directories.output=dist/test-build`
Expected: 生成 `dist/test-build/Kirie-Setup-1.4.0.exe`，`win-unpacked/Kirie.exe` 存在且图标是 K。不安装。
- [ ] **Step 5: 跑全部测试**：`npm test`、`venv/Scripts/python.exe -m unittest tools/test_make_icon.py`。
