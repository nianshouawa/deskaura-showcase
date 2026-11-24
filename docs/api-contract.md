# DeskAura 当前接口索引

更新于 2026 年 11 月 10 日。以各服务 app/main.py、Agent 的 mcp_routes.py 和
schemas.py 为实际依据；本页不是完整字段手册。启用服务后可在本机 /docs 查看接口定义。

请求通过 X-DeskAura-Role 指定角色，不应混用会话与角色。密钥输入只用于保存，
状态接口返回脱敏信息；MCP 显式导出属于私密配置操作，不要公开其文件。

| 服务 | 方法与路径 | 用途 |
| --- | --- | --- |
| Agent 8000 | POST /api/chat/sessions | 建立会话 |
| Agent 8000 | POST /api/chat/send | 完整聊天响应 |
| Agent 8000 | POST /api/chat/stream | 流式聊天事件 |
| Agent 8000 | GET 与 PUT /api/settings/model | 读取与保存角色配置 |
| Agent 8000 | GET /api/modules/{kind}/status | 模块状态 |
| Agent 8000 | POST /api/modules/{kind}/test | 主动检测 |
| Agent 8000 | POST /api/files/approval/{token} | 批准或拒绝待处理操作 |
| Agent 8000 | GET /api/tools/mcp | MCP 服务状态 |
| Agent 8000 | POST /api/tools/mcp/refresh | 刷新全部或单个服务 |
| Agent 8000 | PUT /api/tools/mcp/config | 保存 MCP JSON |
| Agent 8000 | PUT /api/tools/mcp/tool | 修改工具启用偏好 |
| Agent 8000 | POST /api/audio/transcribe | 音频识别 |
| Agent 8000 | POST /api/audio/speech | 文字合成音频 |
| Memory 8001 | POST /api/memory/conversations | 归档与记忆写入 |
| Memory 8001 | GET /api/memory/search | 角色记忆检索 |
| Memory 8001 | GET /api/memory/status | 记忆与提供方状态 |
| Motion 8002 | POST /api/motion/generate | 生成或选择动作 |
| Motion 8002 | GET /api/motion/library/{motion_id} | 读取动作库 |
| Motion 8002 | GET /api/motion/result/{task_id} | 读取轴角帧 |
| Motion 8002 | GET /api/motion/fbx/{task_id} | 读取缓存 FBX |
| Motion 8002 | POST /api/motion/receipt | 客户端回读验证 |

聊天请求主要字段为 message、session_id、user_emotion 与 attachments。
完整响应包含 text、emotion、motion、demo_mode，以及可能的批准或媒体请求。
motion.kind 当前主要为 hymotion 或 fbx，不能按旧版 preset/未来 glb 文档实现客户端。

动作请求支持 prompt、duration、local_duration、priority、mode。
轴角结果主要有 fps、poses、trans、duration；规范化 52 关节每帧为 156 个数值。
检测生成可能调用收费服务；GET /health 仅表示服务可应答。
