import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Server, 
  RefreshCw 
} from 'lucide-react';

export const ArchitectureDeepDive: React.FC = () => {
  const [selectedLayer, setSelectedLayer] = useState<'host' | 'frontend' | 'services'>('host');
  const [isPinging, setIsPinging] = useState(false);

  const triggerPing = () => {
    setIsPinging(true);
    setTimeout(() => setIsPinging(false), 800);
  };

  const layers = [
    {
      id: 'host',
      name: '桌面宿主层 (Desktop Host)',
      tech: 'Tauri 2.x (Rust) · Win32 原生 API',
      badge: 'Win32 原生集成',
      description: '穿透 Tao 状态机直查 IsWindowVisible，彻底攻克 Windows 透明窗口生命周期管控陷阱。',
      highlights: [
        'win_frame 模块增加 SW_HIDE 与 Win32 IsWindowVisible 绑定，直查系统窗口真实可见性',
        '解决设置面板点击 X 卡死：唤醒时显式刷新 Tao window_flags，关闭时调用 win_frame::hide 原生兜底',
        '主工作室防误退机制：关闭主窗口时检测桌宠与子窗口是否活跃，仅隐藏主界面以保持后台桌宠继续运作',
        '系统托盘常驻唤醒与全局单一实例互斥体保证'
      ],
      files: ['src-tauri/src/main.rs', 'src-tauri/src/win_frame.rs', 'src-tauri/Cargo.toml']
    },
    {
      id: 'frontend',
      name: '前端多窗口层 (Frontend UI)',
      tech: 'Vue 3 · TypeScript · Three.js · Pixiv Three-VRM',
      badge: '共享同一构建产物',
      description: '同一构建包驱动工作室、设置、全屏透明桌宠、对话气泡与使用指南等 5 个独立窗口。',
      highlights: [
        '5 大独立窗口：home(工作室) / settings(设置) / main(全屏透明桌宠) / dialog(对话) / tutorial(指南)',
        'ExpandableContent 组件：采用屏幕外 DOM 副本测量长文本高度，彻底根治展开时编辑器跳顶滚动抖动',
        'cameraBounds.ts 几何拟合：在模型初始化时确定恒定包围球，缩放范围不受视角旋转顺序改变',
        'WebGL 透明画布：Three.js 开启 alpha: true 与深度排序，配合 Win32 点击穿透与 WS_EX_LAYERED'
      ],
      files: ['src/Home.vue', 'src/Settings.vue', 'src/desktop/cameraBounds.ts', 'src/desktop/standby.ts']
    },
    {
      id: 'services',
      name: '本机三微服务集群 (Python 3.12 Backend)',
      tech: 'FastAPI · LangGraph · MemU 0.10.0 · SenseVoice',
      badge: '三服务进程组',
      description: '统一由 PyInstaller Onedir 离线打包分发，本机端口各司其职，无外部云端强绑定。',
      highlights: [
        'agent-backend (8000端口)：LangGraph 4 节点编排 (load_context → generate_reply → plan_motion → persist_turn)，工具循环断路保护 (最多16步，重试2次)',
        'memory-service (8001端口)：官方 MemU 记忆引擎，SQLite 历史会话归档与内置 BGE Embedding 向量索引',
        'motion-service (8002端口)：25 组离线动作库、SMPL-H 52 关节映射、腾讯 TokenHub FBX 与本地 HY-Motion Worker 适配',
        'SenseVoice ONNX：内置轻量级语音识别，0 依赖纯离线运行'
      ],
      files: ['agent-backend/app/main.py', 'memory-service/app/main.py', 'motion-service/app/main.py']
    }
  ];

  const currentLayerData = layers.find(l => l.id === selectedLayer)!;

  return (
    <section id="architecture" className="py-20 md:py-28 relative border-t border-[#1E293B] bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-mono-code text-[#2DD4BF] px-3 py-1 rounded-full bg-[#151D2E] border border-[#2DD4BF]/30">
            03 / 面向比赛评委 · 架构深度剖析
          </span>
          <h2 className="font-display font-bold text-2xl sm:text-3xl md:text-4xl text-[#F1F5F9] mt-4 mb-4 tracking-tight">
            软硬协同的跨端分层架构与生命周期工程
          </h2>
          <p className="text-base text-[#94A3B8] leading-relaxed">
            不仅是视觉层面的悬浮，更是从 Windows 窗口句柄、多窗口通信到本机独立微服务的严密工程闭环。
          </p>
        </div>

        {/* Layer Selector Interactive Navigation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {layers.map((l) => {
            const isSelected = selectedLayer === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLayer(l.id as any)}
                className={`p-5 rounded-xl border text-left transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2DD4BF] ${
                  isSelected
                    ? 'bg-[#151D2E] border-[#2DD4BF] shadow-[0_0_20px_rgba(45,212,191,0.2)]'
                    : 'bg-[#0E131F] border-[#1E293B] hover:border-[#334155]'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-mono-code px-2 py-0.5 rounded ${
                    isSelected ? 'bg-[#2DD4BF]/20 text-[#2DD4BF]' : 'bg-[#1E293B] text-[#64748B]'
                  }`}>
                    {l.badge}
                  </span>
                  <span className="text-xs font-mono-code text-[#64748B]">Layer #{l.id === 'host' ? '1' : l.id === 'frontend' ? '2' : '3'}</span>
                </div>
                <h3 className={`font-display font-bold text-base ${isSelected ? 'text-[#F1F5F9]' : 'text-[#CBD5E1]'}`}>
                  {l.name}
                </h3>
                <div className="text-xs font-mono-code text-[#2DD4BF] mt-1">
                  {l.tech}
                </div>
              </button>
            );
          })}
        </div>

        {/* Selected Layer Deep Dive Details */}
        <div className="p-6 sm:p-8 rounded-2xl bg-[#0E131F] border border-[#1E293B] shadow-2xl mb-12">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Column: Architectural Features */}
            <div className="lg:col-span-7 space-y-5">
              <div>
                <h3 className="font-display font-bold text-xl text-[#F1F5F9] mb-2">
                  {currentLayerData.name}
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  {currentLayerData.description}
                </p>
              </div>

              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-mono-code text-[#2DD4BF] uppercase tracking-wider">
                  核心工程设计与避坑沉淀:
                </h4>
                {currentLayerData.highlights.map((h, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-[#07090E]/60 border border-[#1E293B]/70">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] mt-0.5 flex-shrink-0" />
                    <span className="text-xs sm:text-[13px] text-[#CBD5E1] leading-relaxed">
                      {h}
                    </span>
                  </div>
                ))}
              </div>

              {/* Source File Anchors */}
              <div className="pt-3 border-t border-[#1E293B]">
                <span className="text-xs font-mono-code text-[#64748B] block mb-2">
                  对应真实源码文件:
                </span>
                <div className="flex flex-wrap gap-2">
                  {currentLayerData.files.map((f) => (
                    <span key={f} className="text-[11px] font-mono-code px-2 py-1 rounded bg-[#07090E] text-[#94A3B8] border border-[#1E293B]">
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Right Column: Live Port / Microservice Status Inspector */}
            <div className="lg:col-span-5 p-5 rounded-xl bg-[#07090E] border border-[#1E293B] flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B] text-xs font-mono-code">
                  <span className="text-[#94A3B8] flex items-center gap-1.5">
                    <Server className="w-3.5 h-3.5 text-[#2DD4BF]" />
                    <span>微服务端口状态拓扑</span>
                  </span>
                  <button 
                    onClick={triggerPing}
                    className="flex items-center gap-1 text-[#2DD4BF] hover:text-[#14B8A6] cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isPinging ? 'animate-spin' : ''}`} />
                    <span>测活</span>
                  </button>
                </div>

                {/* Ports list */}
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-[#0E131F] border border-[#1E293B] flex items-center justify-between text-xs font-mono-code">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                        <span className="text-[#F1F5F9] font-bold">127.0.0.1:8000</span>
                        <span className="text-[10px] px-1 rounded bg-[#151D2E] text-[#2DD4BF]">Agent</span>
                      </div>
                      <span className="text-[11px] text-[#64748B] block mt-0.5">LangGraph 编排 / MCP 调度 / 对话流</span>
                    </div>
                    <span className="text-[#10B981] text-[11px]">ACTIVE</span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0E131F] border border-[#1E293B] flex items-center justify-between text-xs font-mono-code">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                        <span className="text-[#F1F5F9] font-bold">127.0.0.1:8001</span>
                        <span className="text-[10px] px-1 rounded bg-[#151D2E] text-[#3B82F6]">Memory</span>
                      </div>
                      <span className="text-[11px] text-[#64748B] block mt-0.5">MemU 引擎 / SQLite / BGE 向量</span>
                    </div>
                    <span className="text-[#10B981] text-[11px]">ACTIVE</span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0E131F] border border-[#1E293B] flex items-center justify-between text-xs font-mono-code">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                        <span className="text-[#F1F5F9] font-bold">127.0.0.1:8002</span>
                        <span className="text-[10px] px-1 rounded bg-[#151D2E] text-[#8B5CF6]">Motion</span>
                      </div>
                      <span className="text-[11px] text-[#64748B] block mt-0.5">25 组离线库 / TokenHub FBX / Worker</span>
                    </div>
                    <span className="text-[#10B981] text-[11px]">ACTIVE</span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0E131F] border border-[#1E293B] flex items-center justify-between text-xs font-mono-code">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-[#10B981]" />
                        <span className="text-[#F1F5F9] font-bold">127.0.0.1:1420</span>
                        <span className="text-[10px] px-1 rounded bg-[#151D2E] text-[#F59E0B]">Frontend</span>
                      </div>
                      <span className="text-[11px] text-[#64748B] block mt-0.5">Tauri WebView2 前端多窗口宿主</span>
                    </div>
                    <span className="text-[#10B981] text-[11px]">ACTIVE</span>
                  </div>
                </div>
              </div>

              {/* Status Note */}
              <div className="mt-4 pt-3 border-t border-[#1E293B] text-[11px] font-mono-code text-[#64748B] flex items-center justify-between">
                <span>进程守护: PyInstaller Onedir 打包集成</span>
                <span className="text-[#2DD4BF]">零外部 Python 环境依赖</span>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
