# 元素调整面板分页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把设置窗口"元素"页右边的调整面板改成分页（位置 / 颜色 / 播放 / 抠像），压紧行高、限制最大宽度，并修好左边列表和面板的重叠。

**Architecture:** 只改设置窗口的渲染代码和样式：`settings/elements-tab.js` 的 `renderDetail` 改为"标题栏 + 标签栏 + 一个标签内容区"，当前标签存在模块状态 `activeTab` 里，重绘时沿用；"颜色是否调过"做成 `shared/elements-model.js` 的纯函数，便于测试。

**Tech Stack:** Electron 28 渲染进程原生 JS + CSS，`node --test`。

**Spec:** `docs/superpowers/specs/2026-11-20-elements-panel-tabs-design.md`

## Global Constraints

- 只动元素页的调整面板和列表重叠；素材库、页面标题、列表样子不变。
- 设置项的含义、范围、保存方式（`saveInstance` 防抖 150ms、`hold()` 推迟重绘 800ms）不变。
- 标签顺序和文字：位置 / 颜色 / 播放 / 抠像；图片元素只有位置 / 颜色。
- 面板最大宽度约 520px；行高约 30px。
- 代码注释用中文；样式沿用现有直角 + 主色色条风格，深浅两套主题都要能看。

## Review Focus

1. 拖滑块时收到配置广播 → 标签和滑块都不能被重置（`activeTab` 是模块状态，重绘时沿用）。
2. 当前在"抠像"标签时删掉元素，自动选中的下一个是图片 → 退回"位置"，不出现空白内容区。
3. 素材文件丢失的元素 → 不显示标签栏，只显示"只能删除"提示。
4. 很长的元素名 + 820×560 窗口 → 标题栏不撑破，按钮仍可见；面板不出横向滚动条。
5. 浅色主题下标签栏、小圆点看得清。

以上在 Task 2 的实测步骤里逐条检查（设置窗口没有 UI 自动化测试，用 CDP 驱动真实应用）。

---

### Task 1: `effectsAdjusted` 纯函数

**Files:**
- Modify: `shared/elements-model.js`（`effectsOf` 后面加函数，加进 return 导出）
- Test: `test/elements-model.test.js`

**Interfaces:**
- Produces: `effectsAdjusted(instance: object) -> boolean`，色相 ≠ 0、饱和度 ≠ 1、亮度 ≠ 1 或染色强度 > 0 时为 true；只改染色颜色、强度为 0 不算。

- [ ] **Step 1: 写失败的测试** `test('effectsAdjusted：只有看得出变化才算调过')`
  - `M.effectsAdjusted({})` → false；`createInstance` 出来的 → false
  - `{ effects: { hue: 30 } }`、`{ effects: { saturation: 0.5 } }`、`{ effects: { brightness: 1.2 } }`、`{ effects: { tintAmount: 0.2 } }` → true
  - `{ effects: { tint: '#00ff00', tintAmount: 0 } }` → false
- [ ] **Step 2:** `npm test` 预期 FAIL（`M.effectsAdjusted is not a function`）
- [ ] **Step 3:** 实现 `effectsAdjusted`，用 `effectsOf` 补默认值后比较
- [ ] **Step 4:** `npm test` 预期全部 PASS

### Task 2: 分页面板 + 重叠修复

**Files:**
- Modify: `settings/elements-tab.js`（`renderPositionSection` / `renderColorSection` / `renderPlaybackSection` / `renderChromaSection` / `renderDetail`）
- Modify: `settings/settings.css`（`.md`、`.inst-list`、`.dsec`、`.drow` 一带，加 `.dtabs`）

**Interfaces:**
- Consumes: `Shared.elements.effectsAdjusted(instance)`（Task 1）
- 模块状态：`let activeTab = 'position'`，取值 `'position' | 'color' | 'playback' | 'chroma'`

- [ ] **Step 1: 四个 `render*Section` 改成返回标签内容**（去掉 `section()` 标题）。"恢复原色"按钮由 `renderDetail` 放到标签栏右端；抠像内容第一行是"启用"开关行，开关打开才显示"抠像强度"行。
- [ ] **Step 2: `renderDetail` 加标签栏**：`div.dtabs[role=tablist]`，每个标签 `button[role=tab][aria-selected][aria-controls]`，内容区 `div.dpane[role=tabpanel]`。可用标签 = 图片 `['position','color']`，其余四个；`activeTab` 不在可用里就退回 `'position'`。点标签只换内容区并更新 `activeTab`，不整体重绘；左右方向键在标签间移动焦点并切换。小圆点：`effectsAdjusted` 为真时"颜色"标签加 `.dot`，`chroma.enabled` 时"抠像"标签加 `.dot`；抠像开关切换时同步更新小圆点。
- [ ] **Step 3: CSS**：`.inst-list { grid-template-columns: minmax(0, 1fr) }` 修重叠；`.md` 第二列 `minmax(0, 520px)`；`.drow` 最小高度 36 → 30；`.dpane` 内边距收紧并给最小高度（按"颜色"一组实测）；`.dtabs` 直角、选中项底部主色色条，样式参考 `ark-style-ui`。
- [ ] **Step 4: 实测**（独立 user-data-dir + CDP，测试数据含 GIF 元素、图片元素、长名字元素）：
  - 960×660：面板底边在视口内（`getBoundingClientRect().bottom ≤ 660`）
  - 820×560：无横向滚动条，标题栏按钮可见
  - 1920×1080：面板宽 ≤ 520px
  - 列表每行宽度 ≤ 列表宽度
  - 切到"颜色"后拖滑块、切换元素 → 仍在"颜色"；在"抠像"时切到图片元素 → "位置"
  - 丢失素材的元素 → 无标签栏
  - 浅色主题截图
  - `npm test` 全部 PASS

### Task 3: 文档

**Files:**
- Modify: `PROJECT_NOTES.md`、`PROJECT_NOTES.en.md`（顶部"最近更新"、阶段记录、`elements-tab.js` 说明）

- [ ] **Step 1:** 记下这次改动和实测结果，英文版同步
- [ ] **Step 2:** 等用户确认后再提交（用户说提交才 commit）
