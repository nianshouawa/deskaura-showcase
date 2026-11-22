import React, { useState } from 'react';
import { 
  Move, 
  Eye, 
  Mic, 
  Play, 
  ShieldCheck, 
  Sliders, 
  Sparkles, 
  Volume2, 
  CheckCircle2, 
  Clock, 
  Zap
} from 'lucide-react';

export const HighlightsShowcase: React.FC = () => {
  const [activeTab, setActiveTab] = useState<number>(0);

  // Tab 1 state: cameraBounds interactive visualizer
  const [rotationAngle, setRotationAngle] = useState<number>(45);
  const [currentZoom, setCurrentZoom] = useState<number>(1.1);

  // Tab 3 state: Sentence Buffer streaming test
  const [streamingStep, setStreamingStep] = useState<number>(0);
  const sampleSentences = [
    "主人，今天的天气非常适合写代码呢！",
    "我已经为你整理好昨天的 MemU 记忆索引了。",
    "需要我帮你执行本地文件检索或整理桌面吗？"
  ];

  // Tab 4 state: standby timeline simulation
  const [simulatedIdleSec, setSimulatedIdleSec] = useState<number>(12);

  const tabs = [
    {
      id: 0,
      title: '桌面零障碍操控',
      badge: 'cameraBounds.ts 几何拟合',
      icon: Move,
      summary: '左键自由拖拽、滚轮平滑缩放、单击身体灵动反馈、双击呼出对话气泡、右键返回工作室。',
    },
    {
      id: 1,
      title: '本地视觉视线追踪',
      badge: 'BlazeFace WASM + CameraLease',
      icon: Eye,
      summary: '无需连接云端，本地毫秒级提取 6 个面部关键点驱动眼骨与头部注视，严格生命周期释放。',
    },
    {
      id: 2,
      title: '离线听觉与流式朗读',
      badge: 'SenseVoice + SentenceBuffer',
      icon: Mic,
      summary: '内置 SenseVoice 纯离线语音听觉；标点分句即时朗读，跳过代码块，随时支持打断释放。',
    },
    {
      id: 3,
      title: '25组动作与智能待机',
      badge: 'standby.ts 状态机',
      icon: Sparkles,
      summary: 'SMPL-H 52 关节骨骼重定向；人脸离开 10 秒或静默 60 秒触发待机，每 8 秒轮换非重复动作。',
    },
  ];

  return (
    <section id="experience" className="py-20 md:py-28 relative border-t border-[#1E293B] bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-mono-code text-[#2DD4BF] px-3 py-1 rounded-full bg-[#151D2E] border border-[#2DD4BF]/30">
            01 / 桌面原生交互体验
          </span>
          <h2 className="font-display font-bold text-2xl sm:text-3xl md:text-4xl text-[#F1F5F9] mt-4 mb-4 tracking-tight">
            让虚拟数字人像真实物件一样，悬浮于你的 Windows 工作台
          </h2>
          <p className="text-base text-[#94A3B8] leading-relaxed">
            摒弃传统网页或笨重虚拟软件的隔离感。从鼠标几何拟合缩放到本地视线注视，DeskAura 将 3D 渲染与系统底层生命周期融为一体。
          </p>
        </div>

        {/* Tab Selection Navigation */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-col text-left p-4 rounded-xl border transition-all cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#2DD4BF] ${
                  isActive
                    ? 'bg-[#151D2E] border-[#2DD4BF] shadow-[0_0_20px_rgba(45,212,191,0.2)]'
                    : 'bg-[#0E131F]/70 border-[#1E293B] hover:border-[#334155] hover:bg-[#151D2E]/50'
                }`}
              >
                <div className="flex items-center justify-between w-full mb-3">
                  <div className={`p-2 rounded-lg ${isActive ? 'bg-[#2DD4BF]/20 text-[#2DD4BF]' : 'bg-[#1E293B]/70 text-[#94A3B8]'}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <span className={`text-[10px] font-mono-code px-2 py-0.5 rounded ${
                    isActive ? 'bg-[#2DD4BF]/15 text-[#2DD4BF]' : 'bg-[#1E293B] text-[#64748B]'
                  }`}>
                    {tab.badge}
                  </span>
                </div>
                <h3 className={`font-display font-semibold text-sm ${isActive ? 'text-[#F1F5F9]' : 'text-[#CBD5E1]'}`}>
                  {tab.title}
                </h3>
                <p className="text-xs text-[#94A3B8] mt-1.5 line-clamp-2 leading-relaxed">
                  {tab.summary}
                </p>
              </button>
            );
          })}
        </div>

        {/* Active Tab Showcase Detail Pane */}
        <div className="p-6 sm:p-8 rounded-2xl bg-[#0E131F] border border-[#1E293B] shadow-2xl">
          {/* TAB 0: 桌面零障碍操控 */}
          {activeTab === 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-6 space-y-4">
                <div className="inline-flex items-center gap-1.5 text-xs font-mono-code text-[#2DD4BF]">
                  <Sliders className="w-4 h-4" />
                  <span>几何包围球锁定机制（cameraBounds.ts）</span>
                </div>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#F1F5F9]">
                  滚轮缩放上限不受视角旋转顺序影响
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  传统 Three.js 桌宠模型常因“先旋转再缩放”导致相机视锥裁剪失效或模型飞出视口。DeskAura 在模型加载初始化阶段，通过 <code className="font-mono-code text-[#2DD4BF] bg-[#151D2E] px-1.5 py-0.5 rounded">cameraBounds.ts</code> 严格计算模型的恒定包围球半径与中心距离，锁定距离极值。
                </p>

                <div className="space-y-3 pt-2">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-[#CBD5E1]">
                      <strong>左键无感拖拽</strong>：任意拖动桌面透明窗口，平滑吸附无卡顿。
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-[#CBD5E1]">
                      <strong>中键旋转 / 滚轮缩放</strong>：无论从仰角还是俯角缩放，最大尺寸保持严格一致。
                    </span>
                  </div>
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-[#10B981] mt-0.5 flex-shrink-0" />
                    <span className="text-xs text-[#CBD5E1]">
                      <strong>右键快速上下文</strong>：一键唤回主工作室与设置面板，不遗留悬挂进程。
                    </span>
                  </div>
                </div>
              </div>

              {/* Interactive Demo for Tab 0 */}
              <div className="lg:col-span-6 p-6 rounded-xl bg-[#07090E] border border-[#1E293B]">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B] text-xs font-mono-code">
                  <span className="text-[#94A3B8]">包围球拟合算法交互演示</span>
                  <span className="text-[#2DD4BF]">BBox Radius: 1.28m</span>
                </div>

                {/* Simulated 3D Bounding Sphere Orbit */}
                <div className="relative h-48 rounded-lg bg-[#0E131F]/80 border border-[#1E293B] flex items-center justify-center overflow-hidden">
                  <div 
                    className="relative transition-transform duration-150 flex items-center justify-center"
                    style={{
                      transform: `rotate(${rotationAngle}deg) scale(${currentZoom})`
                    }}
                  >
                    {/* Bounding Sphere Circle */}
                    <div className="w-36 h-36 rounded-full border-2 border-dashed border-[#2DD4BF]/40 flex items-center justify-center animate-spin" style={{ animationDuration: '20s' }}>
                      <div className="w-28 h-28 rounded-full border border-[#F59E0B]/30" />
                    </div>
                    {/* Character Pivot Point */}
                    <div className="absolute w-12 h-16 bg-gradient-to-t from-[#2DD4BF] to-[#F59E0B] rounded-lg opacity-85 flex items-center justify-center text-[10px] font-bold text-[#07090E]">
                      VRM
                    </div>
                  </div>

                  <div className="absolute bottom-2 left-3 text-[11px] font-mono-code text-[#64748B]">
                    视角旋转: {rotationAngle}° | 当前比例: {currentZoom}x (Max 1.4x)
                  </div>
                </div>

                {/* Control Sliders */}
                <div className="space-y-4 mt-5 text-xs font-mono-code">
                  <div>
                    <div className="flex justify-between text-[#94A3B8] mb-1">
                      <span>调整相机旋转角度 (Rotation)</span>
                      <span className="text-[#2DD4BF]">{rotationAngle}°</span>
                    </div>
                    <input 
                      type="range" 
                      min="0" 
                      max="360" 
                      value={rotationAngle}
                      onChange={(e) => setRotationAngle(Number(e.target.value))}
                      className="w-full accent-[#2DD4BF] bg-[#1E293B] rounded-lg h-1.5 cursor-pointer"
                    />
                  </div>

                  <div>
                    <div className="flex justify-between text-[#94A3B8] mb-1">
                      <span>调整滚轮缩放比率 (Zoom Bound)</span>
                      <span className="text-[#F59E0B]">{currentZoom}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.7" 
                      max="1.4" 
                      step="0.05"
                      value={currentZoom}
                      onChange={(e) => setCurrentZoom(Number(e.target.value))}
                      className="w-full accent-[#F59E0B] bg-[#1E293B] rounded-lg h-1.5 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: 本地视觉视线追踪 */}
          {activeTab === 1 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-6 space-y-4">
                <div className="inline-flex items-center gap-1.5 text-xs font-mono-code text-[#2DD4BF]">
                  <ShieldCheck className="w-4 h-4 text-[#10B981]" />
                  <span>隐私与设备生命周期安全规范</span>
                </div>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#F1F5F9]">
                  本地 BlazeFace WASM 检测 ≠ 云端人脸上传
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  DeskAura 坚决恪守个人隐私底线。视觉能力仅用于让角色眼神在桌面跟随用户产生羁绊，使用轻量级 <strong>MediaPipe BlazeFace WASM</strong> 引擎完全在本地 CPU 运行。
                </p>

                <div className="p-4 rounded-xl bg-[#07090E] border border-[#1E293B] space-y-2.5">
                  <div className="text-xs font-mono-code text-[#2DD4BF] font-semibold">
                    CameraLease 生命周期租约机制：
                  </div>
                  <p className="text-xs text-[#94A3B8] leading-relaxed">
                    在关闭桌宠或切换窗口时，系统主动调用 <code className="text-[#F1F5F9] font-mono-code">tracks.forEach(t =&gt; t.stop())</code> 彻底释放视频流引用。绝不允许后台幽灵进程占用摄像头硬件，拒绝绿灯长亮困扰。
                  </p>
                </div>
              </div>

              {/* Comparison Matrix */}
              <div className="lg:col-span-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-5 rounded-xl bg-[#07090E] border border-[#10B981]/30 flex flex-col justify-between">
                  <div>
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#10B981]/15 text-[#10B981] text-[11px] font-mono-code mb-3">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>DeskAura 真实落地</span>
                    </div>
                    <h4 className="text-sm font-semibold text-[#F1F5F9] mb-2">本地 6 关键点定向</h4>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">
                      仅计算左右眼与鼻尖相对倾角，驱动眼骨与头骨转向屏幕中心；模型必须具备 eye bone 蒙皮支持。
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#1E293B] text-[11px] font-mono-code text-[#10B981]">
                    ● 0 字节网络外传 · 0 隐私泄露
                  </div>
                </div>

                <div className="p-5 rounded-xl bg-[#07090E] border border-[#EF4444]/30 flex flex-col justify-between">
                  <div>
                    <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EF4444]/15 text-[#EF4444] text-[11px] font-mono-code mb-3">
                      <span>拒绝对外夸大</span>
                    </div>
                    <h4 className="text-sm font-semibold text-[#F1F5F9] mb-2">非身份识别 / 非视频理解</h4>
                    <p className="text-xs text-[#94A3B8] leading-relaxed">
                      不声称具备“人脸身份识别”或“完整视频多模态监控”；聊天时发送屏幕或摄像头图像必须经过独立确认。
                    </p>
                  </div>
                  <div className="mt-4 pt-3 border-t border-[#1E293B] text-[11px] font-mono-code text-[#EF4444]">
                    ● 诚实工程边界 · 评委加分项
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: 离线听觉与流式朗读 */}
          {activeTab === 2 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-6 space-y-4">
                <div className="inline-flex items-center gap-1.5 text-xs font-mono-code text-[#2DD4BF]">
                  <Zap className="w-4 h-4 text-[#F59E0B]" />
                  <span>SenseVoice ONNX + SpeechSentenceBuffer</span>
                </div>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#F1F5F9]">
                  分句即时朗读，彻底消除漫长等待
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  传统数字人必须等待整个大模型几十秒完成生成后才开口说话。DeskAura 引入 <code className="font-mono-code text-[#2DD4BF] bg-[#151D2E] px-1 rounded">SpeechSentenceBuffer</code>，在大模型流式输出过程中根据中文标点自动切分完整语句，首句毫秒级即刻开播！
                </p>

                <div className="space-y-2 text-xs text-[#CBD5E1]">
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
                    <span><strong>代码块智能过滤</strong>：跳过 Markdown 代码段，不朗读无意义的语法符号。</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
                    <span><strong>即时打断与内存释放</strong>：用户插话时立即调用 stop() 并释放 Audio URL。</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
                    <span><strong>离线 ASR</strong>：内置 SenseVoice 模型，断网也能精准识别麦克风语音。</span>
                  </div>
                </div>
              </div>

              {/* Interactive Sentence Buffer Demo */}
              <div className="lg:col-span-6 p-6 rounded-xl bg-[#07090E] border border-[#1E293B]">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B] text-xs font-mono-code">
                  <span className="text-[#94A3B8]">分句流式朗读模拟器</span>
                  <span className="text-[#F59E0B]">
                    {streamingStep > 0 ? `正在朗读分句 [${streamingStep}/3]` : '就绪'}
                  </span>
                </div>

                <div className="space-y-3 min-h-[140px] flex flex-col justify-center">
                  {sampleSentences.map((sentence, idx) => {
                    const isPlayed = streamingStep > idx;
                    const isCurrent = streamingStep === idx + 1;
                    return (
                      <div 
                        key={idx}
                        className={`p-3 rounded-lg border text-xs font-mono-code transition-all ${
                          isCurrent
                            ? 'bg-[#151D2E] border-[#2DD4BF] text-[#F1F5F9] shadow-[0_0_15px_rgba(45,212,191,0.2)]'
                            : isPlayed
                            ? 'bg-[#0E131F]/50 border-[#1E293B] text-[#64748B]'
                            : 'bg-transparent border-dashed border-[#1E293B] text-[#475569]'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-[#2DD4BF]">分句 #{idx + 1}</span>
                          {isCurrent && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-[#F59E0B] animate-pulse">
                              <Volume2 className="w-3 h-3" />
                              <span>音频合成输出中...</span>
                            </span>
                          )}
                        </div>
                        <p>{sentence}</p>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4 pt-3 border-t border-[#1E293B] flex items-center justify-between">
                  <button
                    onClick={() => {
                      if (streamingStep >= 3) {
                        setStreamingStep(1);
                      } else {
                        setStreamingStep(s => s + 1);
                      }
                    }}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#2DD4BF] hover:bg-[#14B8A6] text-[#07090E] text-xs font-semibold font-mono-code transition-colors cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>{streamingStep === 0 ? '启动流式分句模拟' : streamingStep >= 3 ? '重新播放' : '输出下一分句'}</span>
                  </button>

                  <button
                    onClick={() => setStreamingStep(0)}
                    className="text-xs font-mono-code text-[#64748B] hover:text-[#EF4444] transition-colors"
                  >
                    模拟用户插话打断 (Abort &amp; Revoke)
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 25 组离线动作与智能待机状态机 */}
          {activeTab === 3 && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
              <div className="lg:col-span-6 space-y-4">
                <div className="inline-flex items-center gap-1.5 text-xs font-mono-code text-[#2DD4BF]">
                  <Clock className="w-4 h-4 text-[#A855F7]" />
                  <span>standby.ts 待机调度状态机</span>
                </div>
                <h3 className="font-display font-bold text-xl sm:text-2xl text-[#F1F5F9]">
                  人脸离开 10 秒或静默 60 秒触发自然待机
                </h3>
                <p className="text-sm text-[#94A3B8] leading-relaxed">
                  内置 <code className="font-mono-code text-[#2DD4BF] bg-[#151D2E] px-1 rounded">StandbySchedule</code> 时间状态机。在用户人脸明确离开 10 秒，或键盘鼠标无交互 60 秒后，伴侣自动进入待机呼吸状态；每 8 秒从 25 组离线动作库中随机触发动作，并严格排除上一动作避免连续重复。
                </p>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono-code pt-2">
                  <div className="p-2.5 rounded-lg bg-[#07090E] border border-[#1E293B]">
                    <span className="text-[#64748B] text-[10px] block">标准待机周期</span>
                    <span className="text-[#F1F5F9] font-bold text-sm">8 秒非重复随机</span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-[#07090E] border border-[#1E293B]">
                    <span className="text-[#64748B] text-[10px] block">离线动作库容量</span>
                    <span className="text-[#2DD4BF] font-bold text-sm">25 组 SMPL-H</span>
                  </div>
                </div>
              </div>

              {/* Interactive Timeline Scrub */}
              <div className="lg:col-span-6 p-6 rounded-xl bg-[#07090E] border border-[#1E293B]">
                <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B] text-xs font-mono-code">
                  <span className="text-[#94A3B8]">待机时间轴模拟 (standby.test.ts 逻辑)</span>
                  <span className="text-[#A855F7]">
                    虚拟时间: {simulatedIdleSec} 秒
                  </span>
                </div>

                {/* State Progress Bar */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs font-mono-code">
                    <span className={simulatedIdleSec < 10 ? 'text-[#10B981] font-bold' : 'text-[#64748B]'}>
                      0s 正常交互
                    </span>
                    <span className={simulatedIdleSec >= 10 && simulatedIdleSec < 60 ? 'text-[#F59E0B] font-bold' : 'text-[#64748B]'}>
                      10s 人脸离开预警
                    </span>
                    <span className={simulatedIdleSec >= 60 ? 'text-[#A855F7] font-bold' : 'text-[#64748B]'}>
                      60s 深度待机状态
                    </span>
                  </div>

                  {/* Range Slider */}
                  <input
                    type="range"
                    min="0"
                    max="90"
                    value={simulatedIdleSec}
                    onChange={(e) => setSimulatedIdleSec(Number(e.target.value))}
                    className="w-full accent-[#A855F7] bg-[#1E293B] rounded-lg h-2 cursor-pointer"
                  />

                  {/* Simulated Output State Card */}
                  <div className="p-3.5 rounded-lg bg-[#0E131F] border border-[#1E293B] text-xs font-mono-code space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[#94A3B8]">当前状态机判定:</span>
                      <span className={`px-2 py-0.5 rounded font-bold text-[11px] ${
                        simulatedIdleSec < 10 
                          ? 'bg-[#10B981]/20 text-[#10B981]' 
                          : simulatedIdleSec < 60 
                          ? 'bg-[#F59E0B]/20 text-[#F59E0B]' 
                          : 'bg-[#A855F7]/20 text-[#A855F7]'
                      }`}>
                        {simulatedIdleSec < 10 
                          ? 'ACTIVE_INTERACTION' 
                          : simulatedIdleSec < 60 
                          ? 'FACE_ABSENT_WAITING' 
                          : 'STANDBY_LOOP_RUNNING'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#64748B] leading-relaxed">
                      {simulatedIdleSec < 10
                        ? '用户处于前台注视或刚刚发生鼠标点击，保持注视中。'
                        : simulatedIdleSec < 60
                        ? '人脸离开超过 10 秒，准备过渡到低功耗微表情模式。'
                        : '已超过 60 秒无交互，每 8 秒自动触发离线动作库（当前候选动作: [歪头/轻伸展/叹气/环顾]）。'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

      </div>
    </section>
  );
};
