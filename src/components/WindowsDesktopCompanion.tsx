import React, { useState, useRef, useCallback } from 'react';
import { 
  Sparkles, 
  MessageSquare, 
  Eye, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  CheckCircle2, 
  X, 
  Maximize2, 
  Minus, 
  Activity, 
  Shield, 
  Hand
} from 'lucide-react';

interface CompanionState {
  currentMotion: string;
  isTalking: boolean;
  dialogueText: string;
  emotion: string;
  zoomLevel: number;
  isGazeActive: boolean;
  statusMessage: string;
  standbyCountdown: number;
}

export const WindowsDesktopCompanion: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 }); // normalized -1 to 1
  const [clickCount, setClickCount] = useState(0);
  const [characterPos, setCharacterPos] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, startCharX: 0, startCharY: 0 });

  const [state, setState] = useState<CompanionState>({
    currentMotion: 'idle_natural',
    isTalking: false,
    dialogueText: '',
    emotion: '开心',
    zoomLevel: 1.0,
    isGazeActive: true,
    statusMessage: '自然待机 · 视线注视屏幕中心',
    standbyCountdown: 10,
  });

  const [lastActionToast, setLastActionToast] = useState<{
    id: number;
    title: string;
    detail: string;
  } | null>(null);

  // Typewriter effect for dialogue
  const fullSentence = "你好！我是你的 DeskAura 伴侣。所有语音识别与视线追踪均在你的电脑本地完成，隐私完全属于你。双击我可以唤起实时对话，或者试试下方的动作控制！";
  const timerRef = useRef<number | null>(null);

  const triggerDialogue = useCallback((customText?: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setState(prev => ({ 
      ...prev, 
      isTalking: true, 
      dialogueText: '', 
      emotion: '亲切',
      currentMotion: 'talk_greeting' 
    }));

    const textToType = customText || fullSentence;
    let index = 0;
    timerRef.current = window.setInterval(() => {
      index++;
      setState(prev => ({
        ...prev,
        dialogueText: textToType.slice(0, index)
      }));
      if (index >= textToType.length) {
        if (timerRef.current) clearInterval(timerRef.current);
      }
    }, 35);
  }, []);

  // Motion trigger helper
  const playMotion = (motionName: string, labelZh: string, duration: number) => {
    setState(prev => ({
      ...prev,
      currentMotion: motionName,
      statusMessage: `正在执行动作: ${labelZh}`
    }));

    setLastActionToast({
      id: Date.now(),
      title: `动作回执: [${motionName}]`,
      detail: `52 关节骨骼重定向完成 · 耗时 ${duration}s · 端口 8002`
    });

    setTimeout(() => {
      setState(prev => ({
        ...prev,
        currentMotion: 'idle_natural',
        statusMessage: '自然待机 · 视线注视屏幕中心'
      }));
    }, duration * 1000);
  };

  // Mouse move handler for BlazeFace gaze simulation
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    setMousePos({ 
      x: Math.max(-1, Math.min(1, x)), 
      y: Math.max(-1, Math.min(1, y)) 
    });

    if (isDragging) {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setCharacterPos({
        x: dragStartRef.current.startCharX + dx,
        y: dragStartRef.current.startCharY + dy
      });
    }
  };

  const handleMouseLeave = () => {
    setMousePos({ x: 0, y: 0 }); // return to screen center
    setIsDragging(false);
  };

  // Character Click: Physical feedback
  const handleCharacterClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setClickCount(c => c + 1);
    const motions = [
      { name: 'motion_wave_01', label: '挥手打招呼', dur: 2.2 },
      { name: 'motion_nod_02', label: '轻快点头', dur: 1.8 },
      { name: 'motion_tilt_03', label: '歪头聆听', dur: 2.0 },
      { name: 'motion_cheer_04', label: '开心鼓掌', dur: 2.5 }
    ];
    const picked = motions[clickCount % motions.length];
    playMotion(picked.name, picked.label, picked.dur);
  };

  // Character Double Click: Open Dialogue
  const handleCharacterDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    triggerDialogue();
  };

  // Drag start
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startCharX: characterPos.x,
      startCharY: characterPos.y
    };
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Smooth zoom with limits (cameraBounds.ts simulation)
  const handleZoom = (delta: number) => {
    setState(prev => {
      const nextZoom = Math.max(0.75, Math.min(1.4, prev.zoomLevel + delta));
      return { ...prev, zoomLevel: Number(nextZoom.toFixed(2)) };
    });
  };

  const resetPositionAndZoom = () => {
    setCharacterPos({ x: 0, y: 0 });
    setState(prev => ({ ...prev, zoomLevel: 1.0 }));
  };

  // Eye and head calculation
  const headRotateX = mousePos.y * 12;
  const headRotateY = mousePos.x * 16;
  const pupilOffsetX = mousePos.x * 6;
  const pupilOffsetY = mousePos.y * 4;

  return (
    <div className="relative w-full max-w-xl mx-auto rounded-2xl overflow-hidden shadow-[0_20px_50px_rgba(0,0,0,0.8)] border border-[#1E293B] bg-[#0E131F]/90 backdrop-blur-xl">
      {/* Windows 11 Title Bar */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-[#090D15] border-b border-[#1E293B] select-none text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-md bg-[#2DD4BF]/20 border border-[#2DD4BF]/40 flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-[#2DD4BF]" />
          </div>
          <span className="font-mono-code font-medium text-[#F1F5F9] tracking-tight">
            DeskAura Main Window (Win32 Transparent Frame)
          </span>
          <span className="px-1.5 py-0.2 rounded text-[10px] font-mono-code bg-[#151D2E] text-[#10B981] border border-[#10B981]/30">
            Tao/Win32 Sync
          </span>
        </div>

        {/* Windows Standard Controls */}
        <div className="flex items-center gap-1.5 text-[#64748B]">
          <button 
            className="w-5 h-5 flex items-center justify-center hover:bg-[#1E293B] hover:text-[#F1F5F9] rounded transition-colors"
            title="最小化到托盘"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button 
            className="w-5 h-5 flex items-center justify-center hover:bg-[#1E293B] hover:text-[#F1F5F9] rounded transition-colors"
            title="最大化"
          >
            <Maximize2 className="w-3 h-3" />
          </button>
          <button 
            className="w-5 h-5 flex items-center justify-center hover:bg-[#EF4444] hover:text-white rounded transition-colors"
            title="win_frame::hide 安全隐藏 (不阻断后台微服务)"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Interactive Desktop Preview Stage */}
      <div 
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onMouseUp={handleMouseUp}
        className="relative h-[430px] sm:h-[460px] w-full overflow-hidden cursor-crosshair select-none bg-gradient-to-b from-[#07090E] via-[#0C121D] to-[#090E17]"
        style={{
          backgroundImage: `
            radial-gradient(circle at 50% 30%, rgba(45, 212, 191, 0.08) 0%, transparent 70%),
            linear-gradient(to right, rgba(30, 41, 59, 0.15) 1px, transparent 1px),
            linear-gradient(to bottom, rgba(30, 41, 59, 0.15) 1px, transparent 1px)
          `,
          backgroundSize: '100% 100%, 32px 32px, 32px 32px'
        }}
      >
        {/* Transparent Desktop Wallpaper Cue */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 pointer-events-none">
          <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-[#07090E]/80 backdrop-blur-md border border-[#1E293B]/70 text-[11px] font-mono-code text-[#94A3B8]">
            <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse" />
            <span>BlazeFace WASM: 屏幕中心注视中</span>
          </div>
          <div className="flex items-center gap-2 px-2 py-0.5 rounded text-[10px] font-mono-code text-[#64748B]">
            <span>X: {mousePos.x.toFixed(2)} | Y: {mousePos.y.toFixed(2)}</span>
            <span>· 缩放: {state.zoomLevel}x</span>
          </div>
        </div>

        {/* Top Right Tooltips */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-[#07090E]/80 backdrop-blur-md border border-[#1E293B] p-1 rounded-lg">
          <button 
            onClick={() => handleZoom(0.1)}
            className="p-1 hover:bg-[#1E293B] text-[#94A3B8] hover:text-[#2DD4BF] rounded transition-colors"
            title="滚轮或点击放大 (基于 cameraBounds.ts 包围球)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button 
            onClick={() => handleZoom(-0.1)}
            className="p-1 hover:bg-[#1E293B] text-[#94A3B8] hover:text-[#2DD4BF] rounded transition-colors"
            title="滚轮或点击缩小"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button 
            onClick={resetPositionAndZoom}
            className="p-1 hover:bg-[#1E293B] text-[#94A3B8] hover:text-[#2DD4BF] rounded transition-colors"
            title="重置位置与视角"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Action Toast Feedback */}
        {lastActionToast && (
          <div className="absolute top-14 right-3 max-w-[260px] p-2.5 rounded-lg bg-[#0E131F]/95 border border-[#2DD4BF]/40 shadow-[0_8px_20px_rgba(0,0,0,0.6)] backdrop-blur-md text-xs z-30 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-1.5 text-[#2DD4BF] font-mono-code font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{lastActionToast.title}</span>
            </div>
            <p className="text-[11px] text-[#94A3B8] mt-1 font-mono-code leading-relaxed">
              {lastActionToast.detail}
            </p>
          </div>
        )}

        {/* Floating Dialogue Speech Bubble (Typewriter Streaming) */}
        {state.isTalking && (
          <div 
            className="absolute top-16 left-1/2 -translate-x-1/2 w-[85%] sm:w-[78%] p-3.5 rounded-xl bg-[#090D15]/95 border border-[#2DD4BF]/40 backdrop-blur-xl shadow-[0_12px_32px_rgba(0,0,0,0.7)] z-20 transition-all duration-300"
            style={{
              transform: `translateX(calc(-50% + ${characterPos.x * 0.4}px))`
            }}
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1E293B] text-xs font-mono-code">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#2DD4BF] animate-ping" />
                <span className="text-[#2DD4BF] font-semibold">SpeechSentenceBuffer: 流式分句朗读</span>
                <span className="px-1.5 py-0.5 rounded bg-[#151D2E] text-[#F59E0B] text-[10px]">
                  情绪: {state.emotion}
                </span>
              </div>
              <button 
                onClick={() => setState(prev => ({ ...prev, isTalking: false }))}
                className="text-[#64748B] hover:text-[#F1F5F9] p-0.5"
                title="关闭对话气泡 (模拟音频立即 stop 并释放 URL)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <p className="text-xs sm:text-[13px] text-[#F1F5F9] leading-relaxed min-h-[42px]">
              {state.dialogueText}
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-[#2DD4BF] animate-pulse align-middle" />
            </p>
            <div className="flex items-center justify-between mt-2 pt-1 text-[10px] text-[#64748B] font-mono-code">
              <span>无需等待完整回复 · 遇标点流式分段</span>
              <span className="text-[#2DD4BF]">双击随时重新打断</span>
            </div>
          </div>
        )}

        {/* Interactive 3D Digital Companion Body */}
        <div 
          onMouseDown={handleMouseDown}
          onClick={handleCharacterClick}
          onDoubleClick={handleCharacterDoubleClick}
          className={`absolute left-1/2 bottom-8 -translate-x-1/2 transition-transform select-none cursor-grab active:cursor-grabbing ${
            isDragging ? 'transition-none' : 'duration-200 ease-out'
          }`}
          style={{
            transform: `
              translate(calc(-50% + ${characterPos.x}px), ${characterPos.y}px) 
              scale(${state.zoomLevel})
            `,
            transformOrigin: 'bottom center'
          }}
          title="点击触发动作反馈 · 双击开启流式对话 · 拖拽移动"
        >
          {/* Spatial Ground Shadow & Ambient Aura Ring */}
          <div className="relative flex flex-col items-center">
            <div 
              className="absolute -bottom-4 w-44 h-10 rounded-full bg-[#2DD4BF]/15 blur-xl pointer-events-none transition-all duration-300"
              style={{
                transform: `scale(${state.zoomLevel * (1 + mousePos.y * 0.1)})`
              }}
            />
            <div className="absolute -bottom-1 w-32 h-4 rounded-full bg-black/60 blur-sm pointer-events-none" />

            {/* Rendered Stylized 3D Digital Avatar */}
            <div 
              className="relative w-52 h-64 flex items-center justify-center"
              style={{
                perspective: '800px',
              }}
            >
              {/* Dynamic Aura Glow behind avatar */}
              <div className="absolute inset-0 rounded-full bg-gradient-to-t from-[#2DD4BF]/20 via-[#0D9488]/10 to-transparent blur-2xl animate-pulse-glow pointer-events-none" />

              {/* SVG High-Fidelity Vector 3D-Like Avatar with Head/Eye Movement */}
              <svg 
                viewBox="0 0 200 240" 
                className="w-full h-full drop-shadow-[0_15px_30px_rgba(0,0,0,0.6)]"
                style={{
                  transform: `
                    rotateX(${-headRotateX * 0.5}deg) 
                    rotateY(${headRotateY * 0.5}deg)
                  `,
                  transformOrigin: '50% 80%',
                  transition: isDragging ? 'none' : 'transform 0.15s cubic-bezier(0.2, 0.8, 0.2, 1)'
                }}
              >
                <defs>
                  {/* Gradients for hair & dress */}
                  <linearGradient id="hairGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#2DD4BF" />
                    <stop offset="50%" stopColor="#14B8A6" />
                    <stop offset="100%" stopColor="#0F766E" />
                  </linearGradient>

                  <linearGradient id="bodyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#1E293B" />
                    <stop offset="100%" stopColor="#0F172A" />
                  </linearGradient>

                  <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#2DD4BF" />
                    <stop offset="100%" stopColor="#F59E0B" />
                  </linearGradient>

                  <filter id="softGlow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>

                {/* Companion Body / Robe */}
                <g className="companion-torso">
                  {/* Cybernetic Cape / Wings */}
                  <path 
                    d="M 50 160 C 20 180, 25 225, 45 235 C 65 240, 75 200, 75 180 Z" 
                    fill="url(#hairGrad)" 
                    opacity="0.35"
                  />
                  <path 
                    d="M 150 160 C 180 180, 175 225, 155 235 C 135 240, 125 200, 125 180 Z" 
                    fill="url(#hairGrad)" 
                    opacity="0.35"
                  />

                  {/* Main Outfit */}
                  <path 
                    d="M 72 145 L 60 230 C 85 235, 115 235, 140 230 L 128 145 C 118 152, 82 152, 72 145 Z" 
                    fill="url(#bodyGrad)" 
                    stroke="#334155" 
                    strokeWidth="1.5"
                  />

                  {/* Chest Aura Core Badge */}
                  <circle cx="100" cy="170" r="8" fill="#0E131F" stroke="#2DD4BF" strokeWidth="1.5" />
                  <circle cx="100" cy="170" r="4" fill="#2DD4BF" className="animate-pulse" />
                  <path d="M 85 185 L 115 185" stroke="#2DD4BF" strokeWidth="1" strokeDasharray="2 2" opacity="0.6" />

                  {/* Arms (Dynamic posing on motion) */}
                  {state.currentMotion.includes('wave') ? (
                    // Waving Arm Up
                    <g className="animate-bounce">
                      <path d="M 65 150 C 45 130, 30 100, 42 85 C 48 80, 58 92, 60 110" fill="none" stroke="#CBD5E1" strokeWidth="9" strokeLinecap="round" />
                      <circle cx="42" cy="85" r="7" fill="#FDE68A" />
                      <path d="M 135 150 C 145 170, 150 195, 142 205" fill="none" stroke="#CBD5E1" strokeWidth="8" strokeLinecap="round" />
                    </g>
                  ) : state.currentMotion.includes('cheer') ? (
                    // Both Arms Up
                    <g>
                      <path d="M 68 150 C 50 125, 42 105, 50 90" fill="none" stroke="#CBD5E1" strokeWidth="8" strokeLinecap="round" />
                      <circle cx="50" cy="88" r="6" fill="#FDE68A" />
                      <path d="M 132 150 C 150 125, 158 105, 150 90" fill="none" stroke="#CBD5E1" strokeWidth="8" strokeLinecap="round" />
                      <circle cx="150" cy="88" r="6" fill="#FDE68A" />
                    </g>
                  ) : (
                    // Natural Resting Arms
                    <g>
                      <path d="M 68 150 C 55 170, 52 195, 58 210" fill="none" stroke="#CBD5E1" strokeWidth="8" strokeLinecap="round" />
                      <circle cx="58" cy="210" r="6" fill="#FDE68A" />
                      <path d="M 132 150 C 145 170, 148 195, 142 210" fill="none" stroke="#CBD5E1" strokeWidth="8" strokeLinecap="round" />
                      <circle cx="142" cy="210" r="6" fill="#FDE68A" />
                    </g>
                  )}
                </g>

                {/* Head Group (Tilted by Gaze) */}
                <g 
                  className="companion-head"
                  style={{
                    transform: `
                      translate(${mousePos.x * 4}px, ${mousePos.y * 3}px)
                    `,
                    transition: isDragging ? 'none' : 'transform 0.12s ease-out'
                  }}
                >
                  {/* Back Hair */}
                  <path 
                    d="M 52 90 C 45 40, 155 40, 148 90 C 155 130, 160 160, 140 170 C 130 145, 128 115, 125 110 C 120 115, 80 115, 75 110 C 72 115, 70 145, 60 170 C 40 160, 45 130, 52 90 Z" 
                    fill="url(#hairGrad)" 
                  />

                  {/* Headset / Cat-ear Aura Sensors */}
                  <path d="M 60 48 L 48 20 L 72 36 Z" fill="#14B8A6" stroke="#0D9488" strokeWidth="1" />
                  <path d="M 140 48 L 152 20 L 128 36 Z" fill="#14B8A6" stroke="#0D9488" strokeWidth="1" />
                  <path d="M 58 55 C 58 35, 142 35, 142 55" fill="none" stroke="#475569" strokeWidth="3" strokeLinecap="round" />

                  {/* Face base */}
                  <path 
                    d="M 68 85 C 68 62, 132 62, 132 85 C 132 112, 118 128, 100 130 C 82 128, 68 112, 68 85 Z" 
                    fill="#FFF7ED" 
                  />

                  {/* Cheeks Blush */}
                  <ellipse cx="78" cy="98" rx="6" ry="3.5" fill="#FDA4AF" opacity="0.6" />
                  <ellipse cx="122" cy="98" rx="6" ry="3.5" fill="#FDA4AF" opacity="0.6" />

                  {/* Eyes (BlazeFace Screen-Center Gaze Tracking) */}
                  <g className="eyes-group">
                    {/* Left Eye Sclera */}
                    <ellipse cx="84" cy="86" rx="9" ry="11" fill="#0E131F" />
                    {/* Left Pupil (Moves with cursor) */}
                    <ellipse 
                      cx={84 + pupilOffsetX} 
                      cy={86 + pupilOffsetY} 
                      rx="5" 
                      ry="7" 
                      fill="#2DD4BF" 
                    />
                    {/* Left Eye Specular Reflection */}
                    <circle cx={82 + pupilOffsetX * 0.7} cy={82 + pupilOffsetY * 0.7} r="2.2" fill="#FFFFFF" />
                    <circle cx={86 + pupilOffsetX * 0.7} cy={88 + pupilOffsetY * 0.7} r="1.1" fill="#FFFFFF" />

                    {/* Right Eye Sclera */}
                    <ellipse cx="116" cy="86" rx="9" ry="11" fill="#0E131F" />
                    {/* Right Pupil (Moves with cursor) */}
                    <ellipse 
                      cx={116 + pupilOffsetX} 
                      cy={86 + pupilOffsetY} 
                      rx="5" 
                      ry="7" 
                      fill="#2DD4BF" 
                    />
                    {/* Right Eye Specular Reflection */}
                    <circle cx={114 + pupilOffsetX * 0.7} cy={82 + pupilOffsetY * 0.7} r="2.2" fill="#FFFFFF" />
                    <circle cx={118 + pupilOffsetX * 0.7} cy={88 + pupilOffsetY * 0.7} r="1.1" fill="#FFFFFF" />
                  </g>

                  {/* Eyebrows */}
                  <path d="M 75 72 Q 84 68 93 72" fill="none" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" />
                  <path d="M 107 72 Q 116 68 125 72" fill="none" stroke="#0F766E" strokeWidth="2.2" strokeLinecap="round" />

                  {/* Mouth (Talk animation or smile) */}
                  {state.isTalking ? (
                    <ellipse cx="100" cy="106" rx="4" ry="4" fill="#E11D48" className="animate-ping" />
                  ) : (
                    <path d="M 95 105 Q 100 109 105 105" fill="none" stroke="#EA580C" strokeWidth="2" strokeLinecap="round" />
                  )}

                  {/* Front Bangs Hair */}
                  <path 
                    d="M 66 70 C 72 55, 95 52, 100 68 C 105 52, 128 55, 134 70 C 132 82, 124 90, 116 80 C 112 92, 98 94, 96 80 C 90 92, 74 88, 66 70 Z" 
                    fill="url(#hairGrad)" 
                  />

                  {/* Side Hair Strands */}
                  <path d="M 64 78 Q 58 115 62 135 Q 67 115 70 85 Z" fill="url(#hairGrad)" />
                  <path d="M 136 78 Q 142 115 138 135 Q 133 115 130 85 Z" fill="url(#hairGrad)" />
                </g>
              </svg>
            </div>

            {/* Click/Action Interaction Pill */}
            <div className="mt-1 flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0E131F]/90 border border-[#2DD4BF]/40 backdrop-blur-md text-[11px] font-mono-code text-[#2DD4BF] shadow-lg">
              <Sparkles className="w-3 h-3 text-[#F59E0B]" />
              <span>单击互动 · 双击对话</span>
            </div>
          </div>
        </div>

        {/* Bottom Taskbar-like Status Overlay */}
        <div className="absolute bottom-2 left-3 right-3 flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#07090E]/85 backdrop-blur-md border border-[#1E293B] text-[11px] font-mono-code text-[#94A3B8]">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span className="text-[#F1F5F9]">状态: {state.statusMessage}</span>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-3 text-[#64748B]">
            <span>端口: 8000·8001·8002</span>
            <span>· 动作库: 25组离线</span>
          </div>
        </div>
      </div>

      {/* Interactive Control Console Underneath */}
      <div className="p-4 bg-[#0B0F17] border-t border-[#1E293B]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-mono-code text-[#94A3B8] flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span>实时动作调度与微服务测试 (8002 /api/motion/generate)</span>
          </span>
          <span className="text-[11px] font-mono-code text-[#64748B]">
            SMPL-H 52 关节
          </span>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <button
            onClick={() => playMotion('motion_wave_01', '挥手问候', 2.2)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#151D2E] hover:bg-[#1E293B] text-[#F1F5F9] hover:text-[#2DD4BF] border border-[#1E293B] hover:border-[#2DD4BF]/40 text-xs font-mono-code transition-all focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <Hand className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span>挥手问候</span>
          </button>

          <button
            onClick={() => playMotion('motion_think_03', '歪头思考', 2.5)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#151D2E] hover:bg-[#1E293B] text-[#F1F5F9] hover:text-[#2DD4BF] border border-[#1E293B] hover:border-[#2DD4BF]/40 text-xs font-mono-code transition-all focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <Eye className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>歪头思考</span>
          </button>

          <button
            onClick={() => triggerDialogue("这是来自 SenseVoice 离线听觉与 SpeechSentenceBuffer 的测试语句，分句流式输出无等待！")}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#151D2E] hover:bg-[#1E293B] text-[#F1F5F9] hover:text-[#2DD4BF] border border-[#1E293B] hover:border-[#2DD4BF]/40 text-xs font-mono-code transition-all focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <MessageSquare className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span>双击对话测试</span>
          </button>

          <button
            onClick={() => playMotion('motion_bow_02', '礼貌鞠躬', 2.0)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#151D2E] hover:bg-[#1E293B] text-[#F1F5F9] hover:text-[#2DD4BF] border border-[#1E293B] hover:border-[#2DD4BF]/40 text-xs font-mono-code transition-all focus:outline-none focus:ring-1 focus:ring-[#2DD4BF]"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#A855F7]" />
            <span>礼貌鞠躬</span>
          </button>
        </div>

        {/* Feature Highlights Footnote */}
        <div className="mt-3 pt-3 border-t border-[#1E293B]/60 flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#64748B] font-mono-code">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3 h-3 text-[#10B981]" />
            <span>MediaPipe BlazeFace WASM 本地人脸追踪，零图像云端外传</span>
          </div>
          <span className="text-[#94A3B8]">cameraBounds.ts: 缩放上限不受视角旋转影响</span>
        </div>
      </div>
    </div>
  );
};
