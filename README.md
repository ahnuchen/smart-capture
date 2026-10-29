# 智能截图 (Smart Capture)

[English](README_en.md)

跨平台（Windows / macOS）AI 截图分析桌面应用：截图 → 标注 → 一键调用大模型分析图片内容（答题、数学、翻译、OCR 等），也可以把截图钉在屏幕上。

## ✨ 功能

### 截图与选区
- **区域截图**：全局快捷键（默认 `Ctrl/Cmd+Alt+X`，可改）或托盘触发，拖拽框选
- **选区二次调整**：确认后可拖动 8 个缩放手柄缩放、拖边带移动，无需重新截图
- **取色器**：Shift 切换 HEX / RGB / HSL，放大镜 + 十字辅助线
- **多显示器与高 DPI 适配**：按物理像素裁剪，高分屏不糊

### 标注工具（Fabric.js）
- **矩形 / 椭圆 / 直线 / 箭头 / 画笔 / 荧光笔 / 马赛克 / 文字**
- 每种工具各自记住颜色与线宽；**马赛克实时跟随**拖拽区域，文字用独立**字号下拉（10–96）**
- 撤销 / 重做 / 清除；标注对象落笔即定稿，不会误拖动

### 工具条
- 单行布局：`拖动柄 | 标注工具 | 颜色/线宽 | 撤销·重做·清除 | ✕ 保存 📌 ✔`，智能体单独一行
- 左侧手柄可拖动工具条到任意位置；位置有锚点记忆，展开/收起样式行不会跳
- 工具点选/取消：未选中时隐藏样式行；支持跟随系统/深色/浅色主题

### 钉图
- **📌 钉在屏幕上**：把带标注的截图钉成置顶小窗，可拖动、可同时钉多张
- 边框默认浅蓝、悬浮加亮，方便和原屏幕区域区分；✕ / 双击 / 右键 / ESC 关闭

### 录屏
- **选区录屏**：全局快捷键（默认 `Ctrl/Cmd+Alt+R`，可改）或托盘触发，框选后在选区内选 `MP4` / `GIF`，开始后**3 秒倒计时**再录（无声）
- **时长上限**：`MP4` 最长 **60 分钟**、`GIF` 最长 **60 秒**，到点自动停止并直接进预览
- **选区始终可见**：录制中选区外侧一圈蓝色边框（点击穿透，不挡下面的操作；与选区边框同款，画在裁剪区外所以不会录进成片）
- **录制控制条**：贴在选区外，可拖动、实时计时，`停止` / `取消`；点 `停止` 后控制条与边框立即收起
- **先预览再决定**：停止后弹出预览窗（可拖动、最小化、最大化、关闭），底部 `复制到剪切板` / `保存`；保存成功或复制成功后预览窗自动关闭，`✕` 关闭则直接丢弃
- **复制到剪切板**是以「文件」形式写入（可直接粘到飞书/微信聊天框、资源管理器）；保存后自动打开文件所在文件夹
- 录的是整屏流、保存时按选区裁剪（高 DPI 按物理像素裁剪），不依赖屏幕合成帧，静止画面也能正常出帧；录制中分片写临时文件，内存不随时长增长

### AI 分析
- **内置 5 个智能体**：🔍 通用分析、📝 解题助手、📐 数学解题（LaTeX）、🌐 翻译、📄 文字提取
- **✏️ 自定义智能体**：图标与名称二选一即可 + 系统提示词 + 可指定模型
- **🆓 内置免费模型**：AI Tools 平台（platform.aitools.cfd），已内置免费密钥，默认 `zhipu/glm-4v-flash`；限流 3 秒 1 次，客户端自动重试
- **🔌 自定义模型服务**：任意 OpenAI 兼容 API（Base URL + 密钥 + 模型列表），支持视觉标记、**思考模式开关（默认关闭）**、连通性检测
- **⚡ 默认智能体 + 自动分析**：开启后选区确认即自动分析

### 其它
- **结果窗口**：流式 Markdown、思考过程折叠、KaTeX 公式、追问对话、复制/保存图片、切换智能体重新分析
- **🌐 中英双语**、托盘常驻、开机自启、快捷键可改、无边框自定义标题栏
- **保存后定位文件**：截图 / 录屏保存完自动打开所在文件夹并选中文件（设置 → 通用 可关）

## 📸 截图

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
npm run dev          # 调试模式（渲染层日志转发到终端）
npm run dev:tools    # 调试模式 + 自动打开覆盖窗/工具条 DevTools（注意：分离式 DevTools 会改变置顶顺序）
```

技术栈：Electron 33 + **Vue 2.7（UMD `<script>` + `<script type="text/x-template">`，零构建）**、Fabric.js 5（标注）、marked + DOMPurify + KaTeX（结果渲染）。渲染层各窗口统一为 `index.html`（`#tpl-*` 模板）+ `*-app.js`（组件）+ 启动脚本，状态不写在 `window.api` 上（contextBridge 对象是冻结的）。

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

## ⚠️ 注意事项

- macOS 首次使用需在 系统设置 → 隐私与安全性 → 屏幕录制 中授权
- 内置免费密钥随安装包分发（任何人可见）；若被限流可在 设置 → 模型服务 中更换密钥或接入自己的服务
- 自定义服务的「思考模式」按模型开启，请求体下发 `thinking.type`；若你的服务用别的字段（如 `reasoning_effort`）需自行适配
- 若截图失败并提示被安全软件阻止，通常是企业 DLP / 屏幕保护策略拦截了系统屏幕捕获，需在终端放行

## 📁 项目结构

```
src/
├── main/          # 主进程：截图编排 / 分析会话 / AI 客户端 / 设置存储 / 托盘
├── preload/       # contextIsolation 安全桥
├── renderer/
│   ├── shared/    # vue-i18n.js：Vue 窗口的 $t（启动时一次取词典）
│   ├── overlay/   # 全屏覆盖窗：选区、二次调整、Fabric 标注、取色器
│   ├── toolbar/   # 浮动工具条：标注工具 / 样式 / 输出动作 / 智能体
│   ├── pin/       # 钉图窗口（Vue）：显示图片 + 拖动 + 关闭
│   ├── recorder/  # 隐藏录制页：桌面流 → MediaRecorder(WebM)，分片回传主进程
│   ├── recbar/    # 录制控制条（Vue）：计时 / 停止 / 取消 / 拖动
│   ├── recframe/  # 录制区域边框（点击穿透的透明窗）
│   ├── preview/   # 录制预览窗（Vue）：播放 + 复制到剪切板 / 保存
│   ├── result/    # 结果窗口（流式 Markdown + KaTeX + 追问）
│   └── settings/  # 设置（模型服务/智能体 CRUD/行为/语言/主题）
└── shared/        # 内置智能体与免费模型定义、i18n 字典
```

## 📄 License

MIT

## 🙏 致谢

- 免费模型由 [AI Tools 平台](https://platform.aitools.cfd/) 提供
- 基于 [Electron](https://www.electronjs.org/)、[Vue 2](https://v2.vuejs.org/)、[Fabric.js](http://fabricjs.com/) 构建
