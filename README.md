# DeskAura

DeskAura 是一个本地优先的 Windows 桌面虚拟数字人伴侣，包含 Vue 3 / Three.js 桌面角色、FastAPI + LangGraph 对话编排、官方 MemU 长期记忆、人设 RAG、本地动作库与腾讯 TokenHub 动作 API。每个角色独立保存模块配置、凭据、会话和记忆，连接状态以真实检测结果为准。

## 最简单的使用方式

1. 运行已构建的 `companion-frontend/src-tauri/target/release/deskaura.exe`，或使用安装包。
2. 应用开箱即用内置两款合规开源 VRM 角色模型「结海 (Yuika)」与「千駄ヶ谷渋 (Shibu)」，首次启动无需手动导入即可直接预览并点击「应用」；亦可在主页导入其他自定义模型。相同文件可重复导入为独立角色。
3. 打开「设置」，选择该角色，依次配置人设、记忆、大脑、手脚、视觉、听觉、语音、动作；保存会应用配置并检测。
4. 双击桌面角色打开对话，右键回到主页。详细配置和功能边界见程序内「使用指南」。

API 密钥保存在 Windows 凭据管理器，不写入配置导出或在接口中明文回显。本地已部署的兼容服务可按实际认证要求连接；没有有效服务配置时不会声称已连通。

## 角色模块

- 人设：模板（默认“无”）、文档导入导出、核心设定与 Embedding RAG；已有角色配置不受默认值影响。
- 记忆：官方 `memu-cli==0.10.0` 的 Embedding 索引与召回，原始会话归档独立保存。
- 大脑：云端或本地 OpenAI 兼容聊天服务，流式文字和逐句朗读。
- 手脚：文件工具、命令执行与 Streamable HTTP MCP。
- 视觉：摄像头选择和人脸检测，只用于视线追踪，不进行图像理解。
- 听觉 / 语音：独立 ASR / TTS 配置、真实接口检测；支持百炼等已适配协议。
- 动作：腾讯 API 或本地 HY-Motion Worker，以及回答/常用动作库。

人设与记忆可使用内置 BGE 或外部 Embedding 服务。未验证、失败或停用不会冒充正常。系统沙箱没有可用隔离执行器时拒绝命令执行；关闭沙箱的普通命令按当前用户权限运行，不能把授权目录当作系统隔离。

## 动作模式与本地部署

在线模式对回复和动作请求均现场生成；离线均调用本地库；混合模式回复使用本地库，明确动作请求优先生成，失败再使用常用动作兜底。

云端 API 在设置中填写腾讯 TokenHub 地址、模型 ID 和 Key，不再要求 AutoDL 隧道。自动时长直接调用动作模型原生预测，不随机或让对话模型估算；固定时长用数字输入和上下箭头调整。真实帧数/帧率决定生成片段长度。

本地私有化部署需要自行准备兼容 HY-Motion 环境和权重。已有部署脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install_hymotion_worker.ps1
cd hymotion-worker
pip install -r requirements.txt
python ..\scripts\hymotion_worker.py --model-path ckpts\tencent\HY-Motion-1.0-Lite
```

然后在「设置 → 动作 → 本地私有化部署」填写 Worker 地址。自动时长要求 Worker 提供原生预测器，不支持时会明确报错。Worker 轴角帧和腾讯 FBX 分别验证、转换后重定向到角色骨架。第三方模型权重不随安装包分发，部署前请阅读其许可证。

## 角色控制

桌面角色可拖动、滚轮缩放、单击身体反馈、双击对话、右键主页。人脸/自动追踪会自动开启本机检测，以屏幕中心为注视基准，头部与眼睛分别控制；模型必须有可用的眼骨蒙皮或眼动形变。预览只查看模型，应用后才在桌面互动。

主页和设置的模块开关、本地操作选项立即同步并自动保存，不自动检测；关闭再开启保留上次主动检测结果。红色“取消应用”停止当前桌宠，不删除角色资料。状态点是历史检测记录，不是实时在线保证。

角色应用期间可修改配置，结果会区分保存成功与检测失败。设置中的长文本和 MCP 列表通过右下角斜线展开或收起；主页描述最多两行，不挤压静态预览。桌宠缩放范围不随视角变化，操作顺序不会改变同一视角的最大大小。

## 开发启动

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

## 测试与构建

三个 Python 服务分别在各自目录运行 `..\.venv\Scripts\python.exe -m pytest tests -q`。前端运行 `npm.cmd run build` 和 `npm.cmd test`。

生成 Windows 安装包：

```powershell
cd companion-frontend
npm.cmd run tauri:build
```

从零学习请先阅读 [项目教学总方案](docs/learning-guide.md)，再查阅 [架构](docs/architecture.md)、[接口](docs/api-contract.md) 和 [分发说明](docs/distribution.md)。源码重建前注意：三份 requirements 的 Pydantic 版本约束目前存在冲突，应先统一并验证，不要将已有环境测试通过视为新环境安装成功。仓库内置分发了两款合规开源 VRM 模型供开箱即用（结海：作者 minto_akayama / VRoid Hub 许可，遵循强制署名要求；千駄ヶ谷渋：作者 VRoidプロジェクト / 官方示例模型许可），详情见 `companion-frontend/public/builtin-models/THIRD_PARTY_LICENSES.txt`。如需导入其他第三方 VRM/GLB 模型，请只导入您拥有使用与必要分发授权的资源。
