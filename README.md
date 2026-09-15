# 智能截图 (Smart Capture)

[English](README_en.md)

跨平台（Windows / macOS）AI 截图分析桌面应用：截图后在选区旁的工具条上一键选择智能体，自动调用大模型分析图片内容（答题、数学、翻译、OCR 等）。

## ✨ 功能

- ** 区域截图**：全局快捷键（默认 `Ctrl/Cmd+Shift+A`）或托盘触发，拖拽框选，Enter/双击复制，ESC 重新选区
- ** 智能体工具条**：选区确认后，工具条贴选区显示——`完成` / `下载` 与各智能体按钮并排，点击即分析
- ** 内置 5 个智能体**：🔍 通用分析、📝 解题助手、📐 数学解题（LaTeX 公式渲染）、🌐 翻译、 文字提取
- **✏️ 自定义智能体**：任意 Emoji 图标 + 名称 + 系统提示词 + 可指定模型
- **🆓 内置免费模型**：AI Tools 平台（platform.aitools.cfd），已内置免费密钥，默认 `zhipu/glm-4v-flash`；限流 3 秒 1 次，客户端自动重试
- **🔌 自定义模型服务**：任意 OpenAI 兼容 API（Base URL + 密钥 + 模型列表）
- **⚡ 默认智能体 + 自动分析**：开启后选区确认即自动分析，无需点击
- ** 取色器**：Shift 切换 HEX / RGB / HSL，放大镜 + 十字辅助线
- **🌐 中英双语**：设置中一键切换界面语言
- **📊 结果窗口**：流式 Markdown 输出、思考过程折叠、KaTeX 公式、追问对话、复制/保存图片、切换智能体重新分析
- 托盘常驻、开机自启、快捷键可修改、多显示器与高 DPI 适配、无边框自定义标题栏

##  截图

![工具条](docs/toolbar.png)
![结果窗口](docs/result.png)
![取色器](docs/picker.png)
![设置](docs/settings.png)

## 🚀 安装

### Windows
1. 从 [Releases](https://github.com/ahnuchen/smart-capture/releases) 下载 `SmartCapture-Setup-1.0.0.exe`
2. 双击安装，桌面创建快捷方式
3. 首次启动后托盘常驻，按 `Ctrl+Shift+A` 开始截图

### macOS
```bash
npm run dist-mac  # 需在 Mac 上执行
```
首次运行需在 系统设置 → 隐私与安全性 → 屏幕录制 中授权。

## 🛠️ 开发

```bash
git clone https://github.com/ahnuchen/smart-capture.git
cd smart-capture
npm install          # 国内网络建议：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start            # 开发运行（托盘常驻，按 Ctrl+Shift+A 截图）
npm run dev          # 打开 DevTools 的调试模式
```

### 自测
```bash
node scripts/gen-testscreen.js   # 生成自测用伪造屏幕图
npx electron . --selftest --fake-screen   # 端到端自测（产物在 test-artifacts/）
```

## 📦 打包

```bash
npm run dist-win     # Windows NSIS 安装包 → dist/
npm run dist-mac     # macOS dmg（需在 Mac 上执行）
```

国内网络建议追加镜像环境变量：
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist-win
```

## ️ 注意事项

- macOS 首次使用需在 系统设置 → 隐私与安全性 → 屏幕录制 中授权
- 内置免费密钥随安装包分发（任何人可见）；若被限流可在 设置 → 模型服务 中更换密钥或接入自己的服务
- 若截图失败并提示被安全软件阻止，通常是企业 DLP / 屏幕保护策略拦截了系统屏幕捕获，需在终端放行

##  项目结构

```
src/
── main/          # 主进程：截图编排 / 分析会话 / AI 客户端 / 设置存储 / 托盘
├── preload/       # contextIsolation 安全桥
├── renderer/
│   ├── overlay/   # 全屏覆盖窗（拖拽选区、DPI 裁剪、取色器）
│   ├── toolbar/   # 贴选区浮动工具条（完成/下载/智能体按钮）
│   ├── result/    # 结果窗口（流式 Markdown + KaTeX + 追问）
│   └── settings/  # 设置（模型服务/智能体 CRUD/行为/语言）
└── shared/        # 内置智能体与免费模型定义、i18n 字典
```

##  License

MIT

##  致谢

- 免费模型由 [AI Tools 平台](https://platform.aitools.cfd/) 提供
- 基于 Electron 构建
