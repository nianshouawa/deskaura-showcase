import React, { useState } from 'react';
import { CornerBrackets } from './CornerBrackets';
import { 
  UserCheck, 
  Database, 
  Brain, 
  Wrench, 
  Eye, 
  Mic, 
  Volume2, 
  Activity, 
  Fingerprint,
  Shield,
  Sparkles,
  Play,
  FolderGit2,
  VolumeX,
  RefreshCw
} from 'lucide-react';

interface RoleProfile {
  name: string;
  filename: string;
  avatarLabel: string;
  dataPath: string;
  hash: string;
  credentialScope: string;
  moduleStatus: string;
  moduleRatio: string;
  approvalPolicy: string;
  engine: string;
  statusText: string;
  isApplied: boolean;
}

const roleProfiles: Record<'Furina' | 'Momo', RoleProfile> = {
  Furina: {
    name: 'Furina V1',
    filename: 'Furina V1.vrm',
    avatarLabel: '芙宁娜 · 枫丹正义之舞',
    dataPath: 'DeskAura-Data/roles/e9a1ff02',
    hash: 'e9a1ff02',
    credentialScope: 'Windows 凭据管理器 · 独立 API Key',
    moduleStatus: '8/8 模块全功能已就绪',
    moduleRatio: '8/8',
    approvalPolicy: '只读 · 敏感写入需请求批准',
    engine: 'Pixiv Three-VRM · 52-Joint SMPL-H',
    statusText: '✓ 已应用到桌面',
    isApplied: true,
  },
  Momo: {
    name: 'Momo',
    filename: 'Momo.vrm',
    avatarLabel: '莫莫 · 极简陪伴',
    dataPath: 'DeskAura-Data/roles/c40ba781',
    hash: 'c40ba781',
    credentialScope: 'Windows 凭据管理器 · 独立 API Key',
    moduleStatus: '4/8 轻量陪伴模式',
    moduleRatio: '4/8',
    approvalPolicy: '工作空间写入 · 帮我自动批准',
    engine: 'Standard VRM · 32-Joint Basic',
    statusText: '切换并应用',
    isApplied: false,
  },
};

export const CompanionStudioWindow: React.FC = () => {
  const [selectedRole, setSelectedRole] = useState<'Furina' | 'Momo'>('Furina');
  const [activeModule, setActiveModule] = useState<string>('brain');
  const [viewMode, setViewMode] = useState<'module' | 'overview'>('module');
  const [mobileArchiveOpen, setMobileArchiveOpen] = useState(false);

  // Interactive states for dedicated module views
  const [personaPreset, setPersonaPreset] = useState<'none' | 'gentle' | 'energetic' | 'focused'>('none');
  const [brainStep, setBrainStep] = useState<number>(1);
  const [ttsInterrupted, setTtsInterrupted] = useState<boolean>(false);
  const [motionMode, setMotionMode] = useState<'hybrid' | 'tokenhub' | 'offline'>('hybrid');

  const currentRoleProfile = roleProfiles[selectedRole];

  const moduleSpecs: Record<string, { title: string; subtitle: string; spec: string; endpoint: string }> = {
    persona: {
      title: '人设设定 (Persona)',
      subtitle: '预设模板默认“无” · 文档导入导出 · 人设 RAG',
      spec: '人设模板默认选择“无”，防止意外覆盖已有设定。支持外部 Markdown/TXT 设定文档导入导出。结合轻量级 Embedding 实现长文档设定召回。历史角色配置独立固化。',
      endpoint: 'GET/PUT /api/settings/model (X-DeskAura-Role 角色隔离)'
    },
    memory: {
      title: '长期记忆 (Memory)',
      subtitle: 'memu-cli==0.10.0 + SQLite + BGE Embedding',
      spec: '集成官方 MemU 记忆引擎，将历史原始聊天归档（SQLite）与语义向量记忆索引分层存储。主动检索用户偏好、项目上下文与对话摘要，不依赖外部付费向量云服务。',
      endpoint: 'GET /api/memory/search · 本机 8001 端口'
    },
    brain: {
      title: '认知大脑 (Brain)',
      subtitle: 'LangGraph 四节点编排 · 兼容 OpenAI 协议',
      spec: '对话执行链路：load_context → generate_reply → plan_motion → persist_turn。支持云端兼容模型与本地 Ollama/vLLM 服务。单轮对话严格设置上限 16 步工具执行与 2 次自动恢复。',
      endpoint: 'POST /api/chat/stream · 本机 8000 端口'
    },
    tools: {
      title: '执行手脚 (Tools & MCP)',
      subtitle: '内置 FileTools + stdio / Streamable HTTP MCP',
      spec: '内置受限文件工具（列目录、搜索、读写、移动）；无缝挂接外部 Model Context Protocol (MCP) 服务。通过 Windows Job Object 严密管理子进程树，结束时彻底清理后代句柄。',
      endpoint: 'POST /api/files/approval/{token} 审批机制'
    },
    vision: {
      title: '视线视觉 (Vision)',
      subtitle: 'MediaPipe BlazeFace WASM',
      spec: '纯本地视线追踪，驱动 3D 头部与眼骨注视屏幕中心。通过 CameraLease 进行设备生命周期隔离，关闭即调用 tracks.stop()。零摄像头数据外传。',
      endpoint: 'GET /api/modules/vision/status'
    },
    asr: {
      title: '离线听觉 (ASR)',
      subtitle: 'SenseVoice ONNX 离线模型',
      spec: '内置 SenseVoice 语音识别模型，纯 CPU 毫秒级推理。支持 CallVoiceControl 连续双向通话模式，离线无网环境下正常响应。',
      endpoint: 'POST /api/audio/transcribe · 本机 8000 端口'
    },
    tts: {
      title: '流式语音 (TTS)',
      subtitle: 'SpeechSentenceBuffer 标点分句',
      spec: '在 LLM 流式输出期间，按中英文逗号与句号实时分句合成并即时开播。自动过滤代码块语法符号；支持用户随时插话打断并释放音频内存。',
      endpoint: 'POST /api/audio/speech'
    },
    motion: {
      title: '动作调度 (Motion)',
      subtitle: '25 组离线库 + 腾讯 TokenHub FBX',
      spec: '支持在线生成、离线库与混合三种模式；兼容本地部署的 HY-Motion Worker。52 关节 SMPL-H 骨骼重定向，自动时长预测，严密防死循环。',
      endpoint: 'POST /api/motion/generate · 本机 8002 端口'
    }
  };

  const moduleList = [
    { id: 'persona', name: '人设', icon: UserCheck },
    { id: 'memory', name: '记忆', icon: Database },
    { id: 'brain', name: '大脑', icon: Brain },
    { id: 'tools', name: '手脚', icon: Wrench },
    { id: 'vision', name: '视觉', icon: Eye },
    { id: 'asr', name: '听觉', icon: Mic },
    { id: 'tts', name: '语音', icon: Volume2 },
    { id: 'motion', name: '动作', icon: Activity },
  ];

  const currentSpec = moduleSpecs[activeModule];

  // Switch module and force module view
  const handleSelectModule = (id: string) => {
    setActiveModule(id);
    setViewMode('module');
  };

  return (
    <section id="companion-studio" className="py-20 md:py-28 bg-[#0B0C10] border-b border-white/8 select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 pb-6 border-b border-white/8 gap-4">
          <div>
            <div className="font-mono-code text-[11px] text-[#63667A] tracking-widest uppercase mb-2">
              SECTION // 02 · HIGH-FIDELITY STUDIO REPLICA
            </div>
            <h2 className="font-sans-ui font-bold text-3xl sm:text-4xl text-[#F4F5F8] tracking-tight">
              角色工作室与八大模块
            </h2>
          </div>
          <div className="font-mono-code text-xs text-[#9396AA]">
            DESKAURA / COMPANION STUDIO // 3-COLUMN WORKSPACE
          </div>
        </div>

        {/* Studio Window */}
        <div className="border border-white/10 bg-[#10121B] shadow-2xl overflow-hidden relative">
          <CornerBrackets color="#8B7FE8" size={12} strokeWidth={2} />

          {/* Studio Top Navigation Bar */}
          <div className="h-12 bg-[#151722] border-b border-white/8 px-4 flex items-center justify-between font-mono-code text-xs select-none">
            <div className="flex items-center gap-3">
              <span className="font-display font-bold text-[#F4F5F8] tracking-wider">
                DeskAura / COMPANION STUDIO
              </span>
              <span className="text-[10px] text-[#63667A] tracking-widest hidden sm:inline">
                // ROLE_HASH_ISOLATION
              </span>
            </div>
            <div className="flex items-center gap-3 text-[#9396AA]">
              <span className="text-[11px] text-[#7ed4ac] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[#7ed4ac] animate-pulse" />
                <span>MICROSERVICES: 8000:8001:8002 READY</span>
              </span>
            </div>
          </div>

          {/* 3-Column Studio Body */}
          <div className="grid grid-cols-1 md:grid-cols-12 min-h-[540px]">
            
            {/* Left Column: Model Library & Role Isolation Profile (3 cols, hidden on < md) */}
            <div className="hidden md:flex md:col-span-3 border-r border-white/8 p-4 bg-[#10121B] flex-col justify-between gap-4">
              <div>
                {/* 1. Model Library List */}
                <div className="font-mono-code text-[10px] font-bold text-[#7C85A6] tracking-widest uppercase mb-2.5 flex items-center justify-between">
                  <span>// MODEL LIBRARY</span>
                  <span className="text-[#8B7FE8]">2 LOADED</span>
                </div>

                <div className="space-y-1.5 mb-5">
                  {/* Furina V1 */}
                  <button
                    onClick={() => setSelectedRole('Furina')}
                    className={`w-full text-left p-2.5 rounded text-xs flex items-center justify-between transition-colors cursor-pointer border ${
                      selectedRole === 'Furina'
                        ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                        : 'border-white/5 text-[#9396AA] hover:bg-white/5'
                    }`}
                  >
                    <div className="truncate">
                      <span className="truncate font-mono-code font-medium">Furina V1.vrm</span>
                      <span className="text-[10px] block text-[#63667A]">52-Joint SMPL-H</span>
                    </div>
                    <span className="font-sans-ui text-[10px] text-[#7ed4ac] px-1.5 py-0.5 bg-[#7ed4ac]/15 border border-[#7ed4ac]/30 rounded">
                      已激活
                    </span>
                  </button>

                  {/* Momo */}
                  <button
                    onClick={() => setSelectedRole('Momo')}
                    className={`w-full text-left p-2.5 rounded text-xs flex items-center justify-between transition-colors cursor-pointer border ${
                      selectedRole === 'Momo'
                        ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                        : 'border-white/5 text-[#9396AA] hover:bg-white/5'
                    }`}
                  >
                    <div className="truncate">
                      <span className="truncate font-mono-code font-medium">Momo.vrm</span>
                      <span className="text-[10px] block text-[#63667A]">32-Joint Basic</span>
                    </div>
                    <span className="font-sans-ui text-[10px] text-[#63667A] px-1.5 py-0.5 bg-white/5 border border-white/10 rounded">
                      待命
                    </span>
                  </button>
                </div>

                {/* 2. Role Isolation Card (角色隔离档案 - Eliminates Whitespace) */}
                <div className="border border-white/8 bg-[#0D0E15] p-3 rounded space-y-3">
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/8 text-[11px]">
                    <span className="font-mono-code text-[#8B7FE8] font-bold tracking-wider uppercase flex items-center gap-1.5">
                      <Shield className="w-3.5 h-3.5" />
                      ROLE ISOLATION
                    </span>
                    <span className="font-mono-code text-[10px] text-[#7ed4ac] bg-[#7ed4ac]/10 px-1 rounded">
                      {currentRoleProfile.moduleRatio}
                    </span>
                  </div>

                  {/* Data Path */}
                  <div>
                    <div className="font-sans-ui text-[10px] text-[#63667A]">独立数据目录</div>
                    <div className="font-mono-code text-[11px] text-[#C4C7D4] truncate mt-0.5" title={currentRoleProfile.dataPath}>
                      {currentRoleProfile.dataPath}
                    </div>
                  </div>

                  {/* Credential Scope */}
                  <div>
                    <div className="font-sans-ui text-[10px] text-[#63667A]">凭据隔离作用域</div>
                    <div className="font-sans-ui text-[11px] text-[#C4C7D4] mt-0.5">
                      {currentRoleProfile.credentialScope}
                    </div>
                  </div>

                  {/* Module Status */}
                  <div>
                    <div className="font-sans-ui text-[10px] text-[#63667A]">模块启用状态</div>
                    <div className="font-sans-ui text-[11px] text-[#7ed4ac] mt-0.5 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7ed4ac]" />
                      <span>{currentRoleProfile.moduleStatus}</span>
                    </div>
                  </div>

                  {/* Approval Policy */}
                  <div>
                    <div className="font-sans-ui text-[10px] text-[#63667A]">权限与审批策略</div>
                    <div className="font-sans-ui text-[11px] text-[#D8B4E2] mt-0.5">
                      {currentRoleProfile.approvalPolicy}
                    </div>
                  </div>

                  {/* Engine Specification */}
                  <div>
                    <div className="font-sans-ui text-[10px] text-[#63667A]">骨骼重定向规格</div>
                    <div className="font-mono-code text-[10px] text-[#9396AA] mt-0.5">
                      {currentRoleProfile.engine}
                    </div>
                  </div>
                </div>
              </div>

              {/* Left Footnote: Cryptographic Scope */}
              <div className="pt-3 border-t border-white/8 text-[10px] space-y-1">
                <div className="flex items-center gap-1.5 text-[#8B7FE8] font-mono-code font-semibold">
                  <Fingerprint className="w-3.5 h-3.5" />
                  <span>X-DeskAura-Role 物理隔离</span>
                </div>
                <div className="font-mono-code text-[#63667A]">Hash: {currentRoleProfile.hash}</div>
                <div className="font-sans-ui text-[#9396AA] text-[10px]">配置 / 记忆 / 凭据进程互斥</div>
              </div>
            </div>

            {/* Middle Column: Dynamic Module Inspector Canvas (5 cols on md, full width on mobile) */}
            <div className="md:col-span-5 p-3 sm:p-4 bg-gradient-to-b from-[#141620] to-[#0D0F17] flex flex-col justify-between border-r border-white/8 relative">
              
              {/* Mobile-Only Top Control Bar: Horizontal Role Switcher + Collapsible Isolation Archive */}
              <div className="md:hidden mb-3 p-2.5 bg-[#10121B] border border-white/10 rounded space-y-2">
                <div className="flex items-center justify-between gap-2">
                  {/* 2 Role Switcher Pills (min-height >= 44px) */}
                  <div className="flex items-center gap-1.5 flex-1">
                    <button
                      onClick={() => setSelectedRole('Furina')}
                      className={`min-h-[44px] flex-1 px-2.5 py-1.5 rounded text-xs font-mono-code flex items-center justify-between border transition-colors cursor-pointer ${
                        selectedRole === 'Furina'
                          ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                          : 'bg-[#151722] border-white/5 text-[#9396AA]'
                      }`}
                    >
                      <span className="font-medium truncate">Furina V1</span>
                      <span className="text-[9px] text-[#7ed4ac] px-1 py-0.5 bg-[#7ed4ac]/15 rounded ml-1 flex-shrink-0">已激活</span>
                    </button>

                    <button
                      onClick={() => setSelectedRole('Momo')}
                      className={`min-h-[44px] flex-1 px-2.5 py-1.5 rounded text-xs font-mono-code flex items-center justify-between border transition-colors cursor-pointer ${
                        selectedRole === 'Momo'
                          ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                          : 'bg-[#151722] border-white/5 text-[#9396AA]'
                      }`}
                    >
                      <span className="font-medium truncate">Momo</span>
                      <span className="text-[9px] text-[#63667A] px-1 py-0.5 bg-white/5 rounded ml-1 flex-shrink-0">待命</span>
                    </button>
                  </div>

                  {/* Collapsible Archive Toggle Button */}
                  <button
                    onClick={() => setMobileArchiveOpen(!mobileArchiveOpen)}
                    className="min-h-[44px] px-2.5 py-1.5 bg-[#1B1D2A] border border-white/10 rounded text-[11px] font-sans-ui text-[#C4C7D4] hover:text-white flex items-center gap-1 transition-colors cursor-pointer flex-shrink-0"
                    title="展开/收起角色隔离档案"
                  >
                    <Shield className="w-3.5 h-3.5 text-[#8B7FE8]" />
                    <span>档案 {mobileArchiveOpen ? '▲' : '▼'}</span>
                  </button>
                </div>

                {/* Collapsible Role Isolation Drawer */}
                {mobileArchiveOpen && (
                  <div className="p-2.5 bg-[#0D0E15] border border-white/10 rounded space-y-1.5 text-xs animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-[11px] font-mono-code text-[#8B7FE8] pb-1 border-b border-white/8">
                      <span>ROLE_ISOLATION // {currentRoleProfile.hash}</span>
                      <span className="text-[#7ed4ac]">{currentRoleProfile.moduleRatio}</span>
                    </div>
                    <div className="text-[11px] text-[#C4C7D4]">
                      <span className="text-[10px] text-[#63667A] block">独立数据目录:</span>
                      <span className="font-mono-code truncate block">{currentRoleProfile.dataPath}</span>
                    </div>
                    <div className="text-[11px] text-[#C4C7D4]">
                      <span className="text-[10px] text-[#63667A] block">凭据与权限:</span>
                      <span>{currentRoleProfile.credentialScope} · {currentRoleProfile.approvalPolicy}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Header with Switcher Button */}
              <div className="flex items-center justify-between font-mono-code text-[11px] pb-2 border-b border-white/8">
                <span className="text-[#7C85A6] flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#8B7FE8]" />
                  <span>
                    STAGE // {viewMode === 'overview' ? 'STUDIO_OVERVIEW' : `${activeModule.toUpperCase()}_INSPECTOR`}
                  </span>
                </span>
                
                {/* Mode Toggle Switch [模块专属视图 / 实机总览] */}
                <button
                  onClick={() => setViewMode(viewMode === 'module' ? 'overview' : 'module')}
                  className="px-2 py-0.5 bg-[#1B1D2A] hover:bg-[#25283A] text-[#C4C7D4] border border-white/10 rounded text-[10px] font-sans-ui transition-colors cursor-pointer flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3 text-[#8B7FE8]" />
                  <span>{viewMode === 'module' ? '切至实机总览' : '切至模块视图'}</span>
                </button>
              </div>

              {/* Viewport Center Graphic / Dynamic Module Canvas */}
              <div className="relative my-3 flex-1 flex flex-col min-h-[320px] overflow-hidden border border-white/8 bg-[#090A0E] rounded">
                
                {viewMode === 'overview' ? (
                  /* 1. Full Studio Overview Mode */
                  <div className="relative w-full h-full min-h-[320px] flex items-center justify-center p-2 bg-[#08090D]">
                    <img
                      src="/images/hero-real.png"
                      alt="DeskAura Studio Real View"
                      className="w-full h-full max-h-[300px] object-contain object-center filter brightness-95 rounded shadow-lg"
                    />
                    <div className="absolute bottom-2 left-2 right-2 p-1.5 bg-[#0E1017]/90 border border-white/10 rounded text-[10px] font-sans-ui text-[#C4C7D4] backdrop-blur-sm flex items-center justify-between">
                      <span className="font-mono-code text-[9px] text-[#8B7FE8]">DESKAURA // STUDIO FULL REPLICA</span>
                      <span>双窗口渲染 · Win32 穿透 · 多角色独立沙盒</span>
                    </div>
                  </div>
                ) : (
                  /* 2. Dedicated Interactive Module Inspectors (200ms transition) */
                  <div className="w-full h-full p-3.5 flex flex-col justify-between transition-opacity duration-200">
                    
                    {/* Module 1: Persona (人设) */}
                    {activeModule === 'persona' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">预设模板选择器</span>
                          <span className="font-mono-code text-[10px] text-[#8B7FE8]">默认“无”防覆盖</span>
                        </div>

                        {/* 4 Preset Options */}
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                          {[
                            { id: 'none', label: '无 (自定义独立)', desc: '不覆盖已有记忆' },
                            { id: 'gentle', label: '温柔陪伴', desc: '温和细腻情感支持' },
                            { id: 'energetic', label: '元气伙伴', desc: '积极活泼督促进度' },
                            { id: 'focused', label: '专注助手', desc: '极简问答屏蔽闲聊' },
                          ].map((p) => (
                            <button
                              key={p.id}
                              onClick={() => setPersonaPreset(p.id as any)}
                              className={`p-2 text-left rounded border transition-colors cursor-pointer ${
                                personaPreset === p.id
                                  ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                                  : 'bg-[#12141D] border-white/5 text-[#9396AA] hover:bg-white/5'
                              }`}
                            >
                              <div className="font-medium text-[11px]">{p.label}</div>
                              <div className="text-[9px] text-[#63667A]">{p.desc}</div>
                            </button>
                          ))}
                        </div>

                        {/* Persona RAG Snippet Preview */}
                        <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1.5 text-[11px]">
                          <div className="font-mono-code text-[10px] text-[#8B7FE8] flex items-center justify-between">
                            <span>// PERSONA RAG RECALL PREVIEW</span>
                            <span className="text-[#7ed4ac]">SIM: 0.94</span>
                          </div>
                          <p className="text-[#C4C7D4] leading-relaxed line-clamp-2">
                            {selectedRole === 'Furina'
                              ? '“我即是芙宁娜，即便在凡人面前，正义与歌剧的帷幕也永不落下...主人，今天的代码准备好接受检阅了吗？”'
                              : '“我是桌面助手莫莫，已为您锁定任务上下文，随时执行文件检索与代码编译。”'}
                          </p>
                        </div>

                        {/* Document Export/Import Status */}
                        <div className="flex items-center justify-between pt-1 text-[10px] font-mono-code text-[#63667A]">
                          <span>支持外部 Markdown / TXT 设定导入</span>
                          <span className="text-[#7ed4ac]">RAG 向量索引已固化</span>
                        </div>
                      </div>
                    )}

                    {/* Module 2: Memory (记忆) */}
                    {activeModule === 'memory' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">双层分层记忆架构</span>
                          <span className="font-mono-code text-[10px] text-[#7ed4ac]">memu-cli==0.10.0</span>
                        </div>

                        {/* Dual Tier Grid: SQLite vs BGE Embedding */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {/* SQLite Raw Log */}
                          <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1.5">
                            <div className="font-mono-code text-[10px] text-[#8B7FE8] flex items-center gap-1">
                              <Database className="w-3 h-3" />
                              <span>SQLite 原始会话</span>
                            </div>
                            <div className="font-mono-code text-[10px] text-[#9396AA] space-y-1">
                              <div className="truncate text-[#C4C7D4]">[14:21] U: 检查骨骼</div>
                              <div className="truncate text-[#63667A]">[14:21] A: 52-Joint 已对齐</div>
                              <div className="truncate text-[#C4C7D4]">[14:23] U: 记住我喜好</div>
                            </div>
                            <div className="text-[9px] text-[#63667A] pt-1 border-t border-white/5">
                              ACID 事务 · 本地无上传
                            </div>
                          </div>

                          {/* BGE Semantic Hit */}
                          <div className="p-2.5 bg-[#12141D] border border-[#8B7FE8]/30 rounded space-y-1.5">
                            <div className="font-mono-code text-[10px] text-[#7ed4ac] flex items-center gap-1">
                              <Sparkles className="w-3 h-3" />
                              <span>BGE 语义向量命中</span>
                            </div>
                            <div className="text-[10px] text-[#C4C7D4] space-y-1">
                              <div className="bg-[#7660db15] p-1 rounded border border-[#8B7FE8]/20">
                                <span className="font-mono-code text-[#8B7FE8] text-[9px] block">Cosine: 0.92</span>
                                偏好: 专注编码时保持静音
                              </div>
                            </div>
                            <div className="text-[9px] text-[#63667A] pt-1 border-t border-white/5">
                              本地轻量嵌入 · 零 API 费用
                            </div>
                          </div>
                        </div>

                        {/* Memory Engine Footer */}
                        <div className="p-2 bg-[#0E1017] border border-white/8 rounded flex items-center justify-between text-[10px] font-mono-code text-[#9396AA]">
                          <span>STORE: DeskAura-Data/roles/{currentRoleProfile.hash}/memory.db</span>
                          <span className="text-[#7ed4ac]">OK</span>
                        </div>
                      </div>
                    )}

                    {/* Module 3: Brain (大脑) */}
                    {activeModule === 'brain' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">LangGraph 四节点认知执行链路</span>
                          <button
                            onClick={() => setBrainStep((prev) => (prev + 1) % 4)}
                            className="px-2 py-0.5 bg-[#7660db25] hover:bg-[#7660db40] text-[#D8B4E2] border border-[#8B7FE8]/40 rounded text-[10px] font-mono-code transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <Play className="w-2.5 h-2.5 fill-current" />
                            <span>单步步进: {brainStep + 1}/4</span>
                          </button>
                        </div>

                        {/* 4 Execution Nodes */}
                        <div className="grid grid-cols-4 gap-1.5 text-center">
                          {[
                            { name: 'load_context', label: '加载上下文' },
                            { name: 'generate_reply', label: '流式生成' },
                            { name: 'plan_motion', label: '规划动作' },
                            { name: 'persist_turn', label: '固化轮次' },
                          ].map((node, idx) => {
                            const isCur = brainStep === idx;
                            return (
                              <div
                                key={node.name}
                                onClick={() => setBrainStep(idx)}
                                className={`p-2 rounded border transition-all cursor-pointer ${
                                  isCur
                                    ? 'bg-[#7660db30] border-[#8B7FE8] text-[#F4F5F8] shadow-[0_0_10px_rgba(139,127,232,0.3)]'
                                    : 'bg-[#12141D] border-white/5 text-[#63667A]'
                                }`}
                              >
                                <div className="font-mono-code text-[9px] font-bold text-[#8B7FE8]">0{idx + 1}</div>
                                <div className="font-sans-ui text-[10px] truncate mt-0.5">{node.label}</div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Active Step Real-Time Inspector */}
                        <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1 text-xs">
                          <div className="font-mono-code text-[10px] text-[#8B7FE8] flex items-center justify-between">
                            <span>
                              CURRENT // {[
                                'load_context (召回记忆与 RAG)',
                                'generate_reply (OpenAI 协议流式输出)',
                                'plan_motion (SMPL-H 动作映射)',
                                'persist_turn (写入 SQLite 归档)',
                              ][brainStep]}
                            </span>
                            <span className="text-[#7ed4ac]">RUNNING</span>
                          </div>
                          <p className="text-[11px] text-[#C4C7D4] leading-relaxed">
                            {[
                              '根据用户当前输入，并行检索 Top-3 SQLite 原始对话历史与 MemU 向量记忆，注入系统提示词。',
                              '调用本地 Ollama/vLLM 或云端模型流式返回 Token，首字延迟 142ms，单轮严格限制 16 步工具执行。',
                              '分析对话回复情感意图（如喜悦、沉思），向动作管道派发 52 关节骨骼重定向指令。',
                              '将本轮对话上下文写入独立数据目录 roles/' + currentRoleProfile.hash + '，完成状态机闭环。',
                            ][brainStep]}
                          </p>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono-code text-[#63667A]">
                          <span>MAX_STEPS: 16 · AUTO_RECOVERY: 2</span>
                          <span className="text-[#7ed4ac]">GUARDRAILS_ACTIVE</span>
                        </div>
                      </div>
                    )}

                    {/* Module 4: Tools (手脚) */}
                    {activeModule === 'tools' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">内置受限工具与 MCP 挂接</span>
                          <span className="font-mono-code text-[10px] text-[#8B7FE8]">Job Object 隔离</span>
                        </div>

                        {/* Tools Grid */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {/* FileTools */}
                          <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1.5">
                            <div className="font-mono-code text-[10px] text-[#7ed4ac] flex items-center gap-1">
                              <FolderGit2 className="w-3 h-3" />
                              <span>内置 FileTools (只读受限)</span>
                            </div>
                            <div className="text-[10px] space-y-1 text-[#C4C7D4]">
                              <div className="flex items-center justify-between">
                                <span>list_dir · 目录列表</span>
                                <span className="text-[#7ed4ac]">OK</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>read_file · 代码查阅</span>
                                <span className="text-[#7ed4ac]">OK</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>write_patch · 补丁写入</span>
                                <span className="text-[#D8B4E2]">需二次审批</span>
                              </div>
                            </div>
                          </div>

                          {/* MCP Hub */}
                          <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1.5">
                            <div className="font-mono-code text-[10px] text-[#8B7FE8] flex items-center gap-1">
                              <Wrench className="w-3 h-3" />
                              <span>MCP 挂接服务</span>
                            </div>
                            <div className="text-[10px] space-y-1 text-[#C4C7D4]">
                              <div className="flex items-center justify-between">
                                <span>desktop-mcp</span>
                                <span className="font-mono-code text-[9px] text-[#7ed4ac]">:9100 HTTP</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>system-stat-mcp</span>
                                <span className="font-mono-code text-[9px] text-[#7ed4ac]">stdio</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <span>browser-bridge</span>
                                <span className="font-mono-code text-[9px] text-[#63667A]">挂起中</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Job Object Cleanup */}
                        <div className="p-2 bg-[#0E1017] border border-white/8 rounded flex items-center justify-between text-[10px] font-mono-code text-[#9396AA]">
                          <span>APPROVAL: POST /api/files/approval/{'{token}'}</span>
                          <span className="text-[#7ed4ac]">KILL_ON_JOB_CLOSE: ON</span>
                        </div>
                      </div>
                    )}

                    {/* Module 5: Vision (视觉) */}
                    {activeModule === 'vision' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">MediaPipe BlazeFace WASM 本地追踪</span>
                          <span className="font-mono-code text-[10px] text-[#7ed4ac]">100% 纯端侧零上传</span>
                        </div>

                        {/* Wireframe Face Landmark Demo */}
                        <div className="p-3 bg-[#12141D] border border-white/8 rounded flex items-center justify-between">
                          <div className="relative w-28 h-24 border border-[#8B7FE8]/30 rounded bg-[#090A0E] flex items-center justify-center">
                            {/* Landmarks Dots */}
                            <div className="absolute w-1.5 h-1.5 rounded-full bg-[#8B7FE8] top-6 left-8" title="Left Eye" />
                            <div className="absolute w-1.5 h-1.5 rounded-full bg-[#8B7FE8] top-6 right-8" title="Right Eye" />
                            <div className="absolute w-1.5 h-1.5 rounded-full bg-[#7ed4ac] top-11 left-1/2 -translate-x-1/2" title="Nose Tip" />
                            <div className="absolute w-2 h-1 rounded-full bg-[#8B7FE8] bottom-6 left-1/2 -translate-x-1/2" title="Mouth" />
                            <div className="absolute w-1 h-1 rounded-full bg-[#63667A] top-8 left-3" title="Left Ear" />
                            <div className="absolute w-1 h-1 rounded-full bg-[#63667A] top-8 right-3" title="Right Ear" />
                            
                            {/* Reticle */}
                            <div className="w-16 h-16 border border-dashed border-[#8B7FE8]/40 rounded-full animate-pulse flex items-center justify-center">
                              <div className="w-1 h-1 bg-[#8B7FE8] rounded-full" />
                            </div>
                          </div>

                          {/* Tracking Metrics */}
                          <div className="space-y-1.5 text-[11px] font-mono-code text-[#C4C7D4]">
                            <div>LANDMARKS: 6 KEYPOINTS</div>
                            <div>YAW: -2.4° | PITCH: +1.1°</div>
                            <div>CAMERA_LEASE: ACTIVE</div>
                            <div className="text-[10px] text-[#7ed4ac]">TRACKS.STOP() ON LEASE END</div>
                          </div>
                        </div>

                        <div className="text-[10px] font-mono-code text-[#63667A] flex items-center justify-between">
                          <span>API: GET /api/modules/vision/status</span>
                          <span className="text-[#7ed4ac]">LATENCY: 12ms</span>
                        </div>
                      </div>
                    )}

                    {/* Module 6: ASR (听觉) */}
                    {activeModule === 'asr' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">SenseVoice ONNX 离线语音识别</span>
                          <span className="font-mono-code text-[10px] text-[#7ed4ac]">CPU 毫秒级推理</span>
                        </div>

                        {/* Animated Waveform & Transcription Ticker */}
                        <div className="p-3 bg-[#12141D] border border-white/8 rounded space-y-2">
                          <div className="flex items-center justify-between font-mono-code text-[10px] text-[#63667A]">
                            <span>AUDIO_STREAM // MIC_BUFFER_16KHZ</span>
                            <span className="text-[#8B7FE8]">CallVoiceControl: ON</span>
                          </div>

                          {/* Sound wave bars */}
                          <div className="h-8 flex items-center justify-center gap-1">
                            {[18, 36, 60, 85, 45, 95, 70, 40, 65, 80, 50, 25, 60, 40, 20].map((h, i) => (
                              <div
                                key={i}
                                className="w-1 bg-[#8B7FE8] rounded-full transition-all duration-150"
                                style={{ height: `${h}%` }}
                              />
                            ))}
                          </div>

                          {/* Subtitle stream */}
                          <div className="p-2 bg-[#090A0E] rounded border border-white/5 font-sans-ui text-xs text-[#F4F5F8]">
                            <span className="text-[#7ed4ac] font-mono-code text-[10px] mr-2">[转写实况]</span>
                            “请帮我测试一下 3D 骨骼重定向的边界约束。”
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono-code text-[#63667A]">
                          <span>MODEL: SenseVoice-Small.onnx</span>
                          <span className="text-[#7ed4ac]">OFFLINE READY (零云端外传)</span>
                        </div>
                      </div>
                    )}

                    {/* Module 7: TTS (语音) */}
                    {activeModule === 'tts' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">SpeechSentenceBuffer 流式标点分句</span>
                          <button
                            onClick={() => {
                              setTtsInterrupted(true);
                              setTimeout(() => setTtsInterrupted(false), 2000);
                            }}
                            className="px-2 py-0.5 bg-[#f6ad55]/20 hover:bg-[#f6ad55]/30 text-[#f6ad55] border border-[#f6ad55]/40 rounded text-[10px] font-sans-ui transition-colors cursor-pointer flex items-center gap-1"
                          >
                            <VolumeX className="w-3 h-3" />
                            <span>模拟用户插话打断</span>
                          </button>
                        </div>

                        {/* Queue Items */}
                        <div className="space-y-1.5 text-xs">
                          <div className="p-2 bg-[#12141D] border border-[#8B7FE8]/30 rounded flex items-center justify-between">
                            <div className="truncate text-[#C4C7D4]">
                              <span className="text-[#8B7FE8] font-mono-code text-[10px] mr-1.5">[PLAYING]</span>
                              “已经为你准备好所有开发环境配置了，”
                            </div>
                            <span className="text-[10px] font-mono-code text-[#7ed4ac]">标点触发</span>
                          </div>

                          <div className="p-2 bg-[#12141D] border border-white/5 rounded flex items-center justify-between">
                            <div className="truncate text-[#9396AA]">
                              <span className="text-[#7ed4ac] font-mono-code text-[10px] mr-1.5">[BUFFER]</span>
                              “接下来我们来测试第三个交互沙盒模块。”
                            </div>
                            <span className="text-[10px] font-mono-code text-[#63667A]">等待开播</span>
                          </div>

                          <div className="p-1.5 bg-[#0E1017] border border-dashed border-white/10 rounded flex items-center justify-between text-[10px] text-[#63667A]">
                            <span className="truncate">FILTER: ```const maxZoom = 1.4;``` (代码块已自动跳过合成)</span>
                            <span className="text-[#8B7FE8]">CODE_SKIPPED</span>
                          </div>
                        </div>

                        {/* Interrupted Alert */}
                        {ttsInterrupted && (
                          <div className="p-1.5 bg-[#f6ad55]/15 border border-[#f6ad55]/40 text-[#f6ad55] rounded text-[10px] font-mono-code text-center">
                            ! 用户插话打断触发 · 即刻清空音频缓存 (8ms 释放)
                          </div>
                        )}

                        <div className="flex items-center justify-between text-[10px] font-mono-code text-[#63667A]">
                          <span>STREAM_PIPELINE: ACTIVE</span>
                          <span className="text-[#7ed4ac]">LATENCY: 110ms</span>
                        </div>
                      </div>
                    )}

                    {/* Module 8: Motion (动作) */}
                    {activeModule === 'motion' && (
                      <div className="space-y-3 font-sans-ui">
                        <div className="flex items-center justify-between border-b border-white/8 pb-2">
                          <span className="text-xs font-semibold text-[#F4F5F8]">SMPL-H 52-Joint 动作调度管线</span>
                          <span className="font-mono-code text-[10px] text-[#8B7FE8]">防死循环看门狗</span>
                        </div>

                        {/* 3 Modes Switch */}
                        <div className="grid grid-cols-3 gap-1 text-[11px] font-mono-code">
                          {[
                            { id: 'hybrid', label: '混合模式 (默认)' },
                            { id: 'offline', label: '离线库 (25组)' },
                            { id: 'tokenhub', label: 'TokenHub FBX' },
                          ].map((mode) => (
                            <button
                              key={mode.id}
                              onClick={() => setMotionMode(mode.id as any)}
                              className={`p-1.5 rounded border text-center transition-colors cursor-pointer ${
                                motionMode === mode.id
                                  ? 'bg-[#7660db25] border-[#8B7FE8] text-[#F4F5F8]'
                                  : 'bg-[#12141D] border-white/5 text-[#9396AA] hover:bg-white/5'
                              }`}
                            >
                              {mode.label}
                            </button>
                          ))}
                        </div>

                        {/* Motion Retargeting Specs */}
                        <div className="p-2.5 bg-[#12141D] border border-white/8 rounded space-y-1.5 text-xs">
                          <div className="flex items-center justify-between font-mono-code text-[10px] text-[#7ed4ac]">
                            <span>MOTION_QUEUE: IDLE_SWAY ➔ GREET_WAVE</span>
                            <span>WEIGHT: 0.85</span>
                          </div>
                          <div className="space-y-1 text-[11px] text-[#C4C7D4]">
                            <div>• 骨骼映射: SMPL-H 52 关键旋转关节重定向</div>
                            <div>• 约束安全: motionSafety.ts 手腕/肘关节角度钳位</div>
                            <div>• 原地防位移: Root Motion Translation 锁死防穿屏</div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between text-[10px] font-mono-code text-[#63667A]">
                          <span>TIMEOUT_WATCHDOG: 12.0s</span>
                          <span className="text-[#7ed4ac]">COLLISION_BOUNDS: R=0.45m</span>
                        </div>
                      </div>
                    )}

                  </div>
                )}
              </div>

              {/* Bottom State Bar */}
              <div className="p-2.5 bg-[#171923]/90 border border-white/8 flex items-center justify-between text-xs font-sans-ui rounded">
                <div>
                  <span className="text-[#F4F5F8] font-semibold block">{currentRoleProfile.name}</span>
                  <span className="text-[10px] font-mono-code text-[#63667A]">{currentRoleProfile.engine}</span>
                </div>
                <button
                  onClick={() => setSelectedRole(selectedRole === 'Furina' ? 'Momo' : 'Furina')}
                  className="cut-corner-tr min-h-[38px] px-3.5 py-1.5 bg-[#263B33] hover:bg-[#2e473d] text-[#B2D8BF] border border-[#4B6B58] text-[11px] font-medium tracking-[0.02em] cursor-pointer transition-colors flex items-center justify-center"
                >
                  {currentRoleProfile.statusText}
                </button>
              </div>

              {/* Mobile-Only Bottom: 4x2 Module Touch Grid + Module Detail Drawer (< md Only) */}
              <div className="md:hidden mt-3 pt-3 border-t border-white/8 space-y-3">
                <div className="font-mono-code text-[10px] font-bold text-[#7C85A6] tracking-widest uppercase flex items-center justify-between">
                  <span>// 8 MODULE SWITCHES</span>
                  <span className="text-[#8B7FE8]">原地切换</span>
                </div>

                {/* 4x2 Grid (2 rows of 4, each min-height 44px) */}
                <div className="grid grid-cols-4 gap-1.5">
                  {moduleList.map((m) => {
                    const isCur = activeModule === m.id;
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleSelectModule(m.id)}
                        className={`min-h-[44px] p-1.5 border text-center font-sans-ui text-xs font-medium flex flex-col items-center justify-center gap-1 transition-colors cursor-pointer rounded ${
                          isCur
                            ? 'bg-[#1A1C28] border-[#8B7FE8] text-[#F4F5F8] shadow-[0_0_8px_rgba(139,127,232,0.25)] font-bold'
                            : 'bg-[#10121B] border-white/5 text-[#9396AA] hover:border-white/20'
                        }`}
                      >
                        <Icon className={`w-3.5 h-3.5 ${isCur ? 'text-[#8B7FE8]' : 'text-[#63667A]'}`} />
                        <span className="text-[11px] truncate max-w-full">{m.name}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Module Spec Detail Card */}
                <div className="p-3 bg-[#10121B] border border-white/8 text-xs space-y-1.5 font-sans-ui rounded">
                  <div className="flex items-center justify-between pb-1 border-b border-white/8 text-[#F4F5F8]">
                    <span className="font-bold text-[#8B7FE8]">{currentSpec.title}</span>
                    <span className="text-[9px] font-mono-code text-[#7ed4ac] bg-[#7ed4ac]/10 px-1 rounded">OK</span>
                  </div>
                  <div className="text-[10px] text-[#9396AA] font-mono-code">{currentSpec.subtitle}</div>
                  <p className="text-[11px] text-[#7C85A6] leading-relaxed pt-0.5">{currentSpec.spec}</p>
                  <div className="pt-1.5 border-t border-white/8 font-mono-code text-[9px] text-[#63667A] truncate">
                    API: {currentSpec.endpoint}
                  </div>
                </div>
              </div>

            </div>

            {/* Right Column: 8 Modular Switches & Technical Drawer (4 cols, hidden on < md) */}
            <div className="hidden md:flex md:col-span-4 p-4 bg-[#13141C] flex-col justify-between">
              <div>
                <div className="font-mono-code text-[10px] font-bold text-[#7C85A6] tracking-widest uppercase mb-3 flex items-center justify-between">
                  <span>// 8 MODULE SWITCHES</span>
                  <span className="text-[#8B7FE8]">CLICK TO INSPECT</span>
                </div>

                {/* 8 Module Switch Grid */}
                <div className="grid grid-cols-2 gap-1.5 mb-4">
                  {moduleList.map((m) => {
                    const isCur = activeModule === m.id;
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.id}
                        onClick={() => handleSelectModule(m.id)}
                        className={`p-2 border text-left font-sans-ui text-xs font-medium flex items-center justify-between transition-colors cursor-pointer rounded ${
                          isCur
                            ? 'bg-[#1A1C28] border-[#8B7FE8] text-[#F4F5F8] shadow-[0_0_8px_rgba(139,127,232,0.2)]'
                            : 'bg-[#10121B] border-white/5 text-[#9396AA] hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <Icon className={`w-3.5 h-3.5 ${isCur ? 'text-[#8B7FE8]' : 'text-[#63667A]'}`} />
                          <span className="truncate">{m.name}</span>
                        </div>
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCur ? 'bg-[#8B7FE8] animate-ping' : 'bg-[#7ed4ac]'}`} />
                      </button>
                    );
                  })}
                </div>

                {/* Module Specification Detail Pane in HarmonyOS Sans SC */}
                <div className="p-3.5 bg-[#10121B] border border-white/8 text-xs space-y-2 font-sans-ui rounded">
                  <div className="flex items-center justify-between pb-1.5 border-b border-white/8 text-[#F4F5F8]">
                    <span className="font-bold text-[#8B7FE8]">{currentSpec.title}</span>
                    <span className="text-[10px] font-mono-code text-[#7ed4ac] bg-[#7ed4ac]/10 px-1 rounded">OK</span>
                  </div>
                  <div className="text-[11px] text-[#9396AA] leading-tight font-mono-code">
                    {currentSpec.subtitle}
                  </div>
                  <p className="text-[11px] text-[#7C85A6] leading-relaxed pt-1">
                    {currentSpec.spec}
                  </p>
                </div>
              </div>

              {/* Endpoint anchor */}
              <div className="mt-4 pt-3 border-t border-white/8 font-mono-code text-[10px] text-[#63667A] truncate">
                API: {currentSpec.endpoint}
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
