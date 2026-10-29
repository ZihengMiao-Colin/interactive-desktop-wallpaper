# CLAUDE.md

## 语言规范

- 始终使用简体中文回复，包括解释、计划和总结。
- 代码、变量名、命令、报错信息保持英文原样，不要翻译。
- 代码注释使用中文。

## 项目资料

- `PROJECT_NOTES.md`：项目现状、已知问题和分阶段开发计划。动手前先看，改完后顺手更新。
- 英文版：`README.en.md`、`PROJECT_NOTES.en.md`。改了中文版要同步改英文版（以中文版为准）。
- `docs/superpowers/specs/`：各功能的设计文档。
- 开发启动：`npm run dev`（带 DevTools）。打包：`npm run build`（NSIS 安装包）。
- 应用里的深度图用 `onnxruntime-node` 生成（`src/depth/`，模型放项目根目录）；项目内的 `venv`（只装了 ONNX 依赖）只给 `tools/` 下的 Python 脚本和测试用。
