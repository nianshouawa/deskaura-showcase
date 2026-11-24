# DeskAura 项目构建与开发上下文交接文档 (CONTEXT_HANDOFF)

本文档记录了 DeskAura 比赛用桌面宠物项目的完整编译构建流程、关键技术方案、已解决报错与已知陷阱，以及下一步待办事项，供后续会话或开发者无缝接续。

---

## 1. 核心目标与已确定的方案

### 1.1 核心目标
将 `DeskAura`（一个集成了 3D 角色渲染、离线大模型 Agent、本地向量记忆与 25 组离线动作的桌面宠物系统）从源代码完整编译为**Windows 平台下可双击直接运行的独立桌面应用程序**，包括：
1. **免安装便携版**：`deskaura.exe` 及相关微服务依赖。
2. **NSIS 一键安装包**：`DeskAura_0.1.0_x64-setup.exe`。

### 1.2 系统架构与技术栈
- **桌面外壳与前端**：
  - **框架**：Tauri 2.x（Rust 宿主外壳）+ Vue 3 + TypeScript + Vite。
  - **渲染引擎**：Three.js + Pixiv Three-VRM（支持 VRM / FBX / GLB / GLTF 格式 3D 模型渲染，支持透明背景与点击穿透）。
  - **视觉追踪**：MediaPipe BlazeFace WASM 本地人脸检测，驱动视线注视与互动。
- **后端微服务架构**（Python 3.12，三服务单体打包）：
  - `agent-backend`（端口 8000）：FastAPI 架构，负责对话生成、角色人设管理、MCP 协议工具调度、会话与任务分发。
  - `memory-service`（端口 8001）：MemU 记忆引擎，基于 SQLite 与 BGE Embedding 中文轻量级嵌入模型实现本地长期记忆检索。
  - `motion-service`（端口 8002）：本地 25 组离线动作库（无需云端 GPU 依赖）、骨骼映射与动作调度。
  - `audio-recognition`：内置 SenseVoice ONNX 离线语音听觉模型（无需网络）。
- **打包集成方案**：
  - **Python 后端**：通过 `scripts/build_backend.ps1` 驱动 PyInstaller Onedir 模式，将三个微服务及其模型统一打包至 `companion-frontend/src-tauri/binaries/deskaura-backend/`。
  - **Tauri 主程序**：由 `npx tauri build` 驱动，自动将后端二进制与 `local-models` 打包为 Tauri 资源，并通过 makensis 产出安装包。

### 1.3 窗口生命周期管理设计（已修复落地）
- **多窗口体系**：包含 `home`（角色工作室）、`settings`（详细设置）、`main`（全屏透明桌宠）、`dialog`（对话气泡）与 `tutorial`（使用指南）。
- **设置窗口关闭修复**：通过前端与 Rust 后端双重同步（`unminimize` / `show`）使 Tao 内部状态与 Win32 原生状态一致，并在关闭时调用 Win32 原生 `win_frame::hide` 双重兜底，彻底解决“点 X 关不掉”问题。
- **主窗口关闭与退避逻辑**：关闭 `home` 窗口时，检测操作系统当前是否有桌面宠物、设置面板、对话框等正在运行。若存在，则仅隐藏 `home` 窗口，保证桌宠与服务继续在桌面工作；若所有窗口均未激活，才安全退出整个程序。托盘图标支持随时重新打开工作室或彻底退出。

---

## 2. 已修改 / 新建的关键文件清单

### 2.1 新建产物文件
- [release/DeskAura_0.1.0_x64-setup.exe](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/release/DeskAura_0.1.0_x64-setup.exe)：最新编译的 Windows x64 一键安装包（约 239.76 MB）。
- [release/SHA256SUMS.txt](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/release/SHA256SUMS.txt)：安装包 SHA-256 校验和记录文件。
- [companion-frontend/src-tauri/target/release/deskaura.exe](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/companion-frontend/src-tauri/target/release/deskaura.exe)：最新编译的便携独立可执行程序（约 17.14 MB）。
- [companion-frontend/src-tauri/binaries/deskaura-backend/](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/companion-frontend/src-tauri/binaries/deskaura-backend/)：PyInstaller 打包生成的完整 Python 微服务运行时环境。
- `.venv/`：基于独立 CPython 3.12.10 构建的 Python 虚拟环境。

### 2.2 核心修改文件
- [companion-frontend/src-tauri/src/main.rs](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/companion-frontend/src-tauri/src/main.rs)：
  - **`win_frame` 模块**：增加了 `SW_HIDE`、Win32 `IsWindowVisible` 导出绑定，新增 `win_frame::hide(hwnd)` 与 `win_frame::is_visible(hwnd)` 原生操作函数。
  - **`is_window_really_visible`**：实现了穿透 Tao 状态机、直查 Windows 窗口管理器的真实可见性判定函数。
  - **`raise_owned_window`**：在调用 Windows 原生 `win_frame::raise` 的同时，同步执行 `window.unminimize()`、`window.show()` 和 `window.set_focus()`，使 Tauri/Tao 内部状态标记与操作系统完全同步。
  - **`restore_app`**：托盘唤醒逻辑补充了 `win_frame::raise`，确保主窗口在被隐藏后能从后台可靠恢复至最前台。
  - **`on_window_event`**：
    - `home` 窗口关闭时，综合检测 `main`（桌宠运行状态 / 托盘隐藏状态）、`settings`、`tutorial`、`dialog` 等活跃状态。若存在运行界面则拦截关闭并隐藏工作室；仅在没有任何活跃界面时触发退出。
    - `settings` 窗口关闭时，调用 `win_frame::hide` 原生兜底，确保点击右上角 X 即刻关闭。
- [companion-frontend/src/Home.vue](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/companion-frontend/src/Home.vue)：
  - 优化 `raiseWindow`：在通知后端前主动调用 `target.unminimize()`、`target.show()` 与 `target.setFocus()`。
  - 调整关闭按钮 tooltip 文案为“关闭”，避免误导用户。
- [motion-service/requirements.txt](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/motion-service/requirements.txt)：
  - 将原先锁死的 `pydantic==2.10.3` 统一为 `pydantic>=2.12.4,<3`，消除与 `agent-backend` 和 `memory-service` 之间的依赖版本冲突。
- `~/.cargo/config.toml`：
  - 配置 crates.io 国内镜像（`rsproxy-sparse`）以及 `[http] check-revoke = false`（解决内网/企业网环境下的 SSL 证书吊销离线阻断）。

---

## 3. 已解决的报错与避坑点

| 序号 | 错误现象 / 报错信息 | 根本原因 | 解决方案与避坑点 |
| :--- | :--- | :--- | :--- |
| **1** | `Program 'python.exe' failed to run: The file cannot be accessed by the system` | Windows Store 自动注入的 `WindowsApps\python.exe` 为 UWP 虚拟别名，跨安全上下文/沙箱调用时直接拒绝访问。 | 使用 winget 安装标准 CPython 3.12.10 到 `%LOCALAPPDATA%\Programs\Python\Python312`，彻底绕过应用商店别名。 |
| **2** | `rustc : The term 'rustc' is not recognized` | 环境中未安装 Rust 工具链。 | 通过 winget 安装 `Rustlang.Rustup`，并初始化 MSVC 1.100.0 工具链。 |
| **3** | `ERROR: Cannot install -r requirements.txt because of conflicting dependencies (pydantic)` | `agent-backend` 依赖 `pydantic>=2.12.4,<3`，而 `motion-service` 锁死 `==2.10.3`。 | 将 `motion-service/requirements.txt` 修改为 `pydantic>=2.12.4,<3`，测试验证通过。 |
| **4** | `SSL connect error (schannel: next InitializeSecurityContext failed: CRYPT_E_REVOCATION_OFFLINE (0x80092013))` | Windows Schannel 默认尝试在线验证证书吊销列表（CRL），在网络受限环境下直接抛错阻断 cargo 包下载。 | 在 `~/.cargo/config.toml` 中添加 `[http] check-revoke = false` 并配置 fast crates 镜像。 |
| **5** | **设置窗口打开后无法关闭，点“X”无效** | 设置窗口初始 `visible: false`。前端唤醒时仅调用了 Win32 `ShowWindow`，Tao 内部 `window_flags` 仍为不可见。点 X 时 Tao 认为无需隐藏，且 `prevent_close` 阻止了系统默认关闭，导致窗口卡死。 | 1. 唤醒窗口时显式调用 `window.show()` 刷新 Tao 内部标记；<br>2. `CloseRequested` 事件中增加 Win32 原生 `win_frame::hide` 直接隐藏操作系统窗口。 |
| **6** | **关闭工作室主窗口导致整个程序直接退出** | `main.rs` 原先直接将 `home` 窗口的 `CloseRequested` 事件绑定到 `app_handle().exit(0)`，完全未考虑桌宠正在前台或设置正在打开的情况。 | 重构主窗口退出逻辑：通过 `is_window_really_visible` 检测桌宠与子窗口；存在活跃界面时仅隐藏主窗口（`api.prevent_close()` + `window.hide()`），保持后台服务与桌宠运行；托盘菜单保留彻底退出入口。 |
| **7** | `error[E0515]: cannot return value referencing function parameter s` | Rust 闭包中借用了 `try_state::<HiddenWindows>()` 生成的生命周期局部变量并在 `and_then` 中返回。 | 将 `and_then` 改为 `.map(|s| s.0.lock().map(...).unwrap_or(false))`，返回直接可复制的 `bool` 值。 |

---

## 4. 下一步待办任务清单

- [ ] **1. 用户端实机交互验证**：
  - 运行最新版安装程序 [DeskAura_0.1.0_x64-setup.exe](file:///d:/AI/HWrase/DeskAura-source-developer-2026-11-17/release/DeskAura_0.1.0_x64-setup.exe) 进行安装测试。
  - 验证主工作室中点击“设置”后，点击标题栏右上角的“X”能否顺畅隐藏窗口。
  - 验证在设置窗口打开或角色已应用到桌面的情况下，关闭工作室主窗口，确认桌宠继续在桌面交互且后台服务正常。
  - 验证系统托盘图标双击或菜单“显示 DeskAura”能否重新调出主工作室。
  - 验证系统托盘菜单点击“退出”能否干净关闭所有 Python 微服务进程（无残留句柄）。
- [ ] **2. 角色模型与离线动作完整度测试**：
  - 测试导入新的 `.vrm` 或 `.fbx` 模型文件，检查角色动作预览和桌面应用。
  - 验证 25 组离线预置动作（待机、挥手、鼓掌、鞠躬等）在动作服务（8002 端口）的响应延迟与流畅度。
- [ ] **3. 硬件感知与外设权限适配**：
  - 验证 SenseVoice ONNX 离线语音听觉模型在打包发布后的麦克风调用与识别准确率。
  - 验证 MediaPipe BlazeFace 人脸检测在独立程序中的摄像头初始化与视线追踪。
