# DeskAura 开发交接说明

这个压缩包用于把当前 DeskAura 源码交给另一位开发者继续维护。

## 已包含

- `companion-frontend`：Vue、Tauri、三维角色与桌面窗口源码。
- `agent-backend`、`memory-service`、`motion-service`：三个本机服务源码。
- `deskaura_local`：本机 BGE、SenseVoice 推理接入代码。
- `local-models`：内置向量和听觉模型及其许可文件。
- `motion-service/data`：当前动作库配置和动作资源。
- `scripts`、`docs`、测试、依赖锁文件、演示文档和使用说明。

## 未包含

- `DeskAura-Data`、聊天、记忆、角色配置和个人模型文件。
- API Key、密码和 Windows 凭据存储内容。
- `.venv`、`node_modules`、Rust `target`、Python 打包产物和构建缓存。
- 当前电脑专用的 `local-mcp` 运行环境和浏览器缓存。
- 发布安装包。收到源码后可按文档重新构建。

## 对方首次运行

建议安装 Python 3.12、Node.js 和 Rust 构建工具，然后在项目根目录阅读
`README.md` 与 `docs/learning-guide.md`。

依赖安装脚本是 `scripts/setup.ps1`。它会联网安装依赖，执行前应检查脚本和
依赖版本。教程中已经记录三个服务当前使用的 Pydantic 版本约束差异。

常用验证命令：

```powershell
cd companion-frontend
npm.cmd test
npm.cmd run build
```

启动和打包步骤见 `README.md`、`docs/distribution.md` 与
`docs/learning-guide.md`。不要把真实密钥、用户数据或个人 MCP 配置提交到公开仓库。
