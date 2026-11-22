import React, { useState } from 'react';
import { 
  UserCheck, 
  Brain, 
  Database, 
  Wrench, 
  Eye, 
  Mic, 
  Volume2, 
  Activity, 
  ShieldCheck, 
  Check, 
  Fingerprint
} from 'lucide-react';

export const BentoModules: React.FC = () => {
  const [selectedRole, setSelectedRole] = useState<'Furina' | 'Momo'>('Furina');

  const modules = [
    {
      id: 'persona',
      title: '人设设定 (Persona)',
      subtitle: '模板默认“无” · 文档导入导出 · 人设 RAG',
      badge: 'BGE 局部 RAG',
      icon: UserCheck,
      color: '#2DD4BF',
      colSpan: 'col-span-12 md:col-span-6 lg:col-span-4',
      description: '预设模板默认“无”，防止覆盖既有设定。支持温柔陪伴、元气伙伴、专注助手等多套模板与外部 Markdown/TXT 设定文档导入，通过内置 Embedding 实现人设片段检索。',
      techDetail: 'X-DeskAura-Role 角色命名空间隔离'
    },
    {
      id: 'memory',
      title: '长期记忆 (Memory)',
      subtitle: '官方 memu-cli 0.10.0 + SQLite + BGE',
      badge: '分层持久化存储',
      icon: Database,
      color: '#3B82F6',
      colSpan: 'col-span-12 md:col-span-6 lg:col-span-4',
      description: '集成 MemU 记忆引擎，将历史原始聊天归档（SQLite）与语义向量记忆索引分离。支持主动召回用户画像、习惯与历史偏好，不依赖云端向量数据库。',
      techDetail: '8001 端口 /api/memory/search 毫秒级召回'
    },
    {
      id: 'brain',
      title: '认知大脑 (Brain)',
      subtitle: 'LangGraph 四节点编排 · 兼容 OpenAI 协议',
      badge: '防死循环断路器',
      icon: Brain,
      color: '#A855F7',
      colSpan: 'col-span-12 md:col-span-12 lg:col-span-4',
      description: '编排流：load_context → generate_reply → plan_motion → persist_turn。支持云端商业模型与本地 Ollama/vLLM，内置工具循环保护（单轮上限 16 步，重试上限 2 次）。',
      techDetail: '8000 端口流式 SSE 字符重组'
    },
    {
      id: 'tools',
      title: '执行手脚 (Tools & MCP)',
      subtitle: '内置 FileTools + stdio/HTTP MCP 协议',
      badge: 'Windows Job Object 进程树',
      icon: Wrench,
      color: '#F59E0B',
      colSpan: 'col-span-12 md:col-span-7',
      description: '提供安全的文件列表、搜索、读写与移动工具；支持无缝接入标准 Model Context Protocol (MCP) 服务。通过 Windows Job Object 管理子进程树，结束时彻底清理后代句柄。',
      techDetail: '二维权限卡批准流 · 拒绝未经审批写操作'
    },
    {
      id: 'vision',
      title: '视线视觉 (Vision)',
      subtitle: 'MediaPipe BlazeFace WASM',
      badge: 'CameraLease 设备租约',
      icon: Eye,
      color: '#10B981',
      colSpan: 'col-span-12 md:col-span-5',
      description: '纯本地视线追踪，驱动 3D 头部与眼骨微倾。独立控制开关，关闭或切出时自动调用 stop() 释放摄像头占用，绝不偷偷常驻后台。',
      techDetail: '仅 6 面部关键点计算 · 零人脸特征上传'
    },
    {
      id: 'asr',
      title: '离线听觉 (ASR)',
      subtitle: '内置 SenseVoice ONNX',
      badge: 'CPU 离线推理',
      icon: Mic,
      color: '#EC4899',
      colSpan: 'col-span-12 md:col-span-4',
      description: '无需联网，无需购买第三方语音服务。内置 SenseVoice 中英文高精度离线识别模型，支持 CallVoiceControl 连续双向通话模式。',
      techDetail: '本地麦克风流实时切片'
    },
    {
      id: 'tts',
      title: '流式语音 (TTS)',
      subtitle: 'SpeechSentenceBuffer 分句',
      badge: '标点断句流式输出',
      icon: Volume2,
      color: '#06B6D4',
      colSpan: 'col-span-12 md:col-span-4',
      description: '遇中英文逗号句号自动切分发音，首句毫秒级出声；自动跳过 Markdown 代码块朗读；用户打断时立即调用 stop() 并释放 Audio URL。',
      techDetail: '支持百炼、EdgeTTS 及兼容协议'
    },
    {
      id: 'motion',
      title: '动作调度 (Motion)',
      subtitle: '25 组离线库 + 腾讯 TokenHub FBX',
      badge: 'SMPL-H 52 关节映射',
      icon: Activity,
      color: '#8B5CF6',
      colSpan: 'col-span-12 md:col-span-4',
      description: '支持在线生成、离线库与混合三种模式；同时兼容本地部署的 HY-Motion Worker。具备自动时长预测与原生骨骼重定向。',
      techDetail: '8002 端口 /api/motion/receipt 回执校验'
    },
  ];

  return (
    <section id="modules" className="py-20 md:py-28 relative border-t border-[#1E293B] bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading & Character Hash Isolation Selector */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
          <div className="max-w-2xl text-left">
            <span className="text-xs font-mono-code text-[#2DD4BF] px-3 py-1 rounded-full bg-[#151D2E] border border-[#2DD4BF]/30">
              02 / 八大模块化能力矩阵
            </span>
            <h2 className="font-display font-bold text-2xl sm:text-3xl md:text-4xl text-[#F1F5F9] mt-4 mb-3 tracking-tight">
              多角色密码学隔离，8 大功能独立配置
            </h2>
            <p className="text-sm sm:text-base text-[#94A3B8] leading-relaxed">
              每个角色不仅是一套 3D 骨架，而是拥有完全独立的角色哈希作用域。配置、会话记录、MemU 长期记忆与 Windows 凭据管理器密钥彻底物理隔离。
            </p>
          </div>

          {/* Interactive Role Hash Switcher Demo */}
          <div className="p-3 rounded-xl bg-[#0E131F] border border-[#1E293B] flex flex-col gap-2 min-w-[280px]">
            <div className="flex items-center justify-between text-xs font-mono-code text-[#94A3B8]">
              <span className="flex items-center gap-1.5">
                <Fingerprint className="w-3.5 h-3.5 text-[#2DD4BF]" />
                <span>角色作用域哈希模拟</span>
              </span>
              <span className="text-[#10B981]">隔离生效中</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setSelectedRole('Furina')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-mono-code transition-all cursor-pointer ${
                  selectedRole === 'Furina'
                    ? 'bg-[#2DD4BF] text-[#07090E] font-bold shadow-[0_0_12px_rgba(45,212,191,0.3)]'
                    : 'bg-[#151D2E] text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                <span>Furina V1</span>
                {selectedRole === 'Furina' && <Check className="w-3 h-3" />}
              </button>

              <button
                onClick={() => setSelectedRole('Momo')}
                className={`flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-mono-code transition-all cursor-pointer ${
                  selectedRole === 'Momo'
                    ? 'bg-[#2DD4BF] text-[#07090E] font-bold shadow-[0_0_12px_rgba(45,212,191,0.3)]'
                    : 'bg-[#151D2E] text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                <span>Momo</span>
                {selectedRole === 'Momo' && <Check className="w-3 h-3" />}
              </button>
            </div>

            <div className="text-[10px] font-mono-code text-[#64748B] pt-1 border-t border-[#1E293B] flex justify-between">
              <span>Header: X-DeskAura-Role</span>
              <span className="text-[#2DD4BF]">{selectedRole === 'Furina' ? 'role_hash_e9a1' : 'role_hash_c40b'}</span>
            </div>
          </div>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-12 gap-4 sm:gap-6">
          {modules.map((m) => {
            const Icon = m.icon;
            return (
              <div
                key={m.id}
                className={`${m.colSpan} p-6 sm:p-7 rounded-2xl bg-[#0E131F]/90 border border-[#1E293B] hover:border-[#334155] transition-all duration-300 flex flex-col justify-between group shadow-lg hover:shadow-2xl hover:-translate-y-1`}
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-center justify-between mb-4">
                    <div 
                      className="p-2.5 rounded-xl border flex items-center justify-center transition-colors"
                      style={{ 
                        backgroundColor: `${m.color}15`, 
                        borderColor: `${m.color}35`,
                        color: m.color 
                      }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span 
                      className="text-[10px] font-mono-code px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: `${m.color}10`,
                        borderColor: `${m.color}30`,
                        color: m.color
                      }}
                    >
                      {m.badge}
                    </span>
                  </div>

                  {/* Title & Subtitle */}
                  <h3 className="font-display font-bold text-lg text-[#F1F5F9] group-hover:text-[#2DD4BF] transition-colors">
                    {m.title}
                  </h3>
                  <div className="text-xs font-mono-code text-[#94A3B8] mt-1 mb-3">
                    {m.subtitle}
                  </div>

                  {/* Description */}
                  <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed">
                    {m.description}
                  </p>
                </div>

                {/* Footer Technical Metadata */}
                <div className="mt-6 pt-3 border-t border-[#1E293B]/80 flex items-center justify-between text-[11px] font-mono-code text-[#64748B]">
                  <span>{m.techDetail}</span>
                  <div className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]/40 group-hover:bg-[#2DD4BF] transition-colors" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Truthful Status Verification Reminder */}
        <div className="mt-8 p-4 rounded-xl bg-[#151D2E]/60 border border-[#1E293B] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono-code text-[#94A3B8]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#2DD4BF] flex-shrink-0" />
            <span>模块状态与真实性原则：界面状态点保留上次主动检测结果，绝不以虚假绿灯冒充实时在线。</span>
          </div>
          <span className="text-[#64748B] flex-shrink-0">保存配置 ≠ 触发真实网络检测</span>
        </div>

      </div>
    </section>
  );
};
