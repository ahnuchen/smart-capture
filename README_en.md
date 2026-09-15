# Smart Capture

[中文](README.md)

Cross-platform (Windows / macOS) AI screenshot analysis desktop app: After capturing a screenshot, click an agent button on the toolbar next to the selection to automatically analyze the image content (homework, math, translation, OCR, etc.) using a large language model.

## ✨ Features

- **🎯 Area Capture**: Global shortcut (default `Ctrl/Cmd+Shift+A`) or tray trigger, drag to select, Enter/double-click to copy, ESC to reselect
- **🤖 Agent Toolbar**: After selection, toolbar appears next to the selection — `Done` / `Save` alongside agent buttons, click to analyze
- **📦 5 Built-in Agents**: 🔍 General Analysis, 📝 Homework Solver, 📐 Math Solver (LaTeX rendering), 🌐 Translate, 📄 Text Extraction
- **✏️ Custom Agents**: Any emoji icon + name + system prompt + optional model override
- **🆓 Free Built-in Models**: AI Tools platform (platform.aitools.cfd), free key included, default `zhipu/glm-4v-flash`; rate-limited to 1 req/3s with automatic retry
- **🔌 Custom Model Services**: Any OpenAI-compatible API (Base URL + key + model list)
- **⚡ Default Agent + Auto-analyze**: When enabled, analysis starts immediately after selection
- ** Color Picker**: Shift to cycle HEX / RGB / HSL, magnifier + crosshair
- ** Bilingual (Chinese/English)**: One-click language switch in settings
- ** Result Window**: Streaming Markdown output, collapsible thinking process, KaTeX formulas, follow-up questions, copy/save image, switch agent to re-analyze
- Tray常驻, launch at login, customizable shortcut, multi-monitor & HiDPI support, frameless custom title bar

## 📸 Screenshots

![Toolbar](docs/toolbar.png)
![Result Window](docs/result.png)
![Color Picker](docs/picker.png)
![Settings](docs/settings.png)

## 🚀 Installation

### Windows
1. Download `SmartCapture-Setup-1.0.0.exe` from [Releases](https://github.com/ahnuchen/smart-capture/releases)
2. Double-click to install, desktop shortcut created
3. After first launch, app stays in tray; press `Ctrl+Shift+A` to capture

### macOS
```bash
npm run dist-mac  # Must run on Mac
```
First run requires permission in System Settings → Privacy & Security → Screen Recording.

## 🛠️ Development

```bash
git clone https://github.com/ahnuchen/smart-capture.git
cd smart-capture
npm install          # For China network: ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm install
npm start            # Dev run (tray常驻, press Ctrl+Shift+A to capture)
npm run dev          # Open DevTools debug mode
```

### Self-test
```bash
node scripts/gen-testscreen.js   # Generate fake screen for self-test
npx electron . --selftest --fake-screen   # End-to-end self-test (artifacts in test-artifacts/)
```

##  Build

```bash
npm run dist-win     # Windows NSIS installer → dist/
npm run dist-mac     # macOS dmg (must run on Mac)
```

For China network, add mirror env vars:
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npm run dist-win
```

## ️ Notes

- macOS first use requires Screen Recording permission in System Settings → Privacy & Security → Screen Recording
- Built-in free key is distributed with the installer (visible to anyone); if rate-limited, change key in Settings → Model Services or connect your own service
- If capture fails with a security software warning, it's usually enterprise DLP / screen protection policies blocking system screen capture; whitelist the app

## 📁 Project Structure

```
src/
├── main/          # Main process: capture orchestration / analysis session / AI client / settings storage / tray
├── preload/       # contextIsolation security bridge
├── renderer/
│   ├── overlay/   # Fullscreen overlay (drag selection, DPI crop, color picker)
│   ├── toolbar/   # Floating toolbar next to selection (Done/Save/agent buttons)
│   ├── result/    # Result window (streaming Markdown + KaTeX + follow-up)
│   └── settings/  # Settings (model services / agent CRUD / behavior / language)
└── shared/        # Built-in agents & free model definitions, i18n dictionary
```

## 📄 License

MIT

## 🙏 Acknowledgments

- Free models provided by [AI Tools Platform](https://platform.aitools.cfd/)
- Built with Electron
