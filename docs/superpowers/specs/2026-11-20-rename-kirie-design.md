# 改名：互动3D壁纸 → Kirie 壁纸

日期：2026-11-20

## 为什么做

- 软件定名 Kirie（日语"切り絵"，剪纸画），图标已经换成 K 字图标（阶段 24），名字还是"互动3D壁纸"。

## 用户定的

- 在 Windows 里显示的名字（开始菜单、桌面快捷方式、系统"应用"列表、安装向导）是 **Kirie 壁纸**：用户在开始菜单搜"壁纸"也能搜到。
- exe 和安装包文件名用纯英文：`Kirie.exe`、`Kirie-Setup-<版本>.exe`。
- 软件里标题栏写 "Kirie" 大字，旁边小字"互动 3D 壁纸"（替换现在的 "Interactive Wallpaper"）。

- 不考虑旧版和老用户的任何相关事项（开机自启、快捷方式迁移、升级测试都不做）。

## 不做

- 旧版升级相关的一切（用户定的）。
- 不改 `package.json` 的 `name`（`interactive-desktop-wallpaper`）和 `appId`（`com.wallpaper.interactive-3d`）：用户看不到，只决定数据目录和安装目录的文件夹名，改了没好处还要改一串路径和文档（助手定的）。打包后的 `package.json` 没有 `productName`，所以改 `build.productName` 不会动这两个目录（已核实）。
- 不改 GitHub 仓库名和问题反馈链接；不改安卓版；版本号发布时再定。
- 宣传图、横幅不动（已经是 Kirie）。

## 做法（助手定的）

只改名字本身：打包配置里的显示名和文件名，加上界面、提示、报告、文档里出现的名字。exe 改成 `Kirie.exe`（`build.executableName`），任务管理器和开机自启项里也是新名字。

## 改哪些地方

- `package.json`：`build.productName` 改成 `Kirie 壁纸`，加 `build.executableName: "Kirie"`，`nsis.artifactName` 改成 `Kirie-Setup-${version}.${ext}`。
- 窗口标题：设置窗口 `Kirie 壁纸 - 设置`（`main.js`、`settings.html` 的 `<title>`）；壁纸窗口 `index.html` 的 `<title>` 改成 `Kirie 壁纸`。
- 设置窗口标题栏：`<b>Kirie</b>` 加小字"互动 3D 壁纸"。小字原来是给英文用的（大写、加宽字距），中文要单独调字号和字距，截图确认。
- 托盘：提示文字 `Kirie 壁纸`；"关于"标题 `关于 Kirie 壁纸`，内容 `Kirie 壁纸 v<版本>`。
- 出错提示框、诊断报告失败提示的标题：`Kirie 壁纸`。
- 诊断报告：文件名 `Kirie-诊断报告-<时间>.txt`，报告第一行 `Kirie 壁纸 诊断报告`。
- 设置页"卸载软件"的说明和确认框：`Kirie 壁纸`。
- 相关测试里的名字跟着改；加一个测试固定 `productName`、`executableName`、`artifactName`。
- 文档：README 两份（标题、开头一句说明名字的意思、打包产物文件名；不写"原名"，旧版的事一概不提），`PROJECT_NOTES` 两份（阶段 25；§9 发布步骤里的文件名和 Release 标题）。

## 验证

- `npm test`、`tools/test_make_icon.py` 全过。
- 开发版截图：设置窗口标题栏（夜间、日间）、窗口标题。
- 打包到 `dist/test-build`：exe 叫 `Kirie.exe`，安装包叫 `Kirie-Setup-<版本>.exe`，exe 图标还是 K。不装（本机装着正式版，不动它）。
- 改完先不提交，等用户看过。
