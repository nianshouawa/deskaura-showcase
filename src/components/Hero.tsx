import React, { useState, useRef } from 'react';
import { CornerBrackets } from './CornerBrackets';
import { Download, FileText, Maximize2, X } from 'lucide-react';

export const Hero: React.FC = () => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [gaze, setGaze] = useState({ x: 0.12, y: -0.04 });
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!viewportRef.current) return;
    const rect = viewportRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    setGaze({
      x: Number(Math.max(-1, Math.min(1, x)).toFixed(2)),
      y: Number(Math.max(-1, Math.min(1, y)).toFixed(2)),
    });
  };

  const handleMouseLeave = () => {
    setGaze({ x: 0.0, y: 0.0 });
  };

  return (
    <section className="relative pt-24 pb-16 md:pt-32 md:pb-24 border-b border-[var(--border-hairline)] overflow-hidden bg-[var(--bg-canvas)] transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column (5 cols, left-aligned, big whitespace) */}
          <div className="lg:col-span-5 flex flex-col justify-center text-left">
            {/* Structure label (monospaced gray) */}
            <div className="font-mono-code text-[11px] text-[var(--text-muted)] tracking-widest uppercase mb-4">
              DESKAURA // WINDOWS 3D COMPANION
            </div>

            {/* Direct software title */}
            <h1 className="hero-headline text-[clamp(2.1rem,8.5vw,3.25rem)] leading-[1.15] text-[var(--text-primary)] mb-6 tracking-tight">
              让陪伴，<br />出现在桌面。
            </h1>

            {/* Direct, calm subtitle */}
            <p className="body-reading text-sm sm:text-base text-[var(--text-secondary)] mb-8 max-w-lg leading-relaxed">
              本地优先的 Windows 3D 桌面伴侣。导入你的 VRM 模型，独立配置人设、记忆与本地听觉，在桌面一角安静待命。
            </p>

            {/* Dual Action Buttons (Touch-friendly >= 44px, Full Width Stack or 2-Col) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-10 w-full sm:w-auto">
              <a
                href="#downloads"
                className="cut-corner-tr min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 bg-[var(--accent-solid)] hover:bg-[var(--accent-solid-hover)] text-white font-sans-ui font-medium text-xs tracking-[0.02em] transition-colors focus:outline-none shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>下载安装包 (x64)</span>
              </a>

              <a
                href="#architecture"
                className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-3 border border-[var(--border-hairline)] hover:border-[var(--accent-signal)] bg-[var(--bg-surface)] text-[var(--text-primary)] font-sans-ui font-medium text-xs tracking-[0.02em] transition-colors focus:outline-none shadow-xs"
              >
                <FileText className="w-4 h-4 text-[var(--accent-signal)]" />
                <span>查看架构文档</span>
              </a>
            </div>

            {/* Minimalist monospaced metadata strip (pure English telemetry) */}
            <div className="pt-6 border-t border-[var(--border-hairline)] font-mono-code text-[10px] sm:text-[11px] text-[var(--text-muted)] flex flex-wrap items-center gap-x-2 sm:gap-x-3 gap-y-1">
              <span>TAURI 2.x (RUST)</span>
              <span>|</span>
              <span>THREE-VRM</span>
              <span>|</span>
              <span>LANGGRAPH</span>
              <span>|</span>
              <span>MEMU 0.10.0</span>
              <span>|</span>
              <span>SENSEVOICE ONNX</span>
            </div>
          </div>

          {/* Right Column (7 cols, corner brackets, dot grid, gaze telemetry) */}
          <div className="lg:col-span-7">
            <div
              ref={viewportRef}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
              className="relative w-full bg-[var(--bg-surface)] border border-[var(--border-hairline)] dot-grid shadow-[var(--shadow-viewport)] flex flex-col justify-between p-4 sm:p-5 overflow-hidden select-none transition-all duration-200"
            >
              {/* Endfield Corner Brackets */}
              <CornerBrackets color="var(--accent-signal)" size={14} strokeWidth={2} />

              {/* Viewport Top Header Telemetry */}
              <div className="flex items-center justify-between font-mono-code text-[11px] text-[var(--text-muted)] pb-2 z-20">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7ed4ac]" />
                  <span className="text-[var(--text-secondary)]">DESKTOP_VIEWPORT // WIN32_TRANSPARENT</span>
                </div>
                <div>
                  <span className="text-[var(--accent-signal)] font-medium">
                    GAZE // X:{gaze.x >= 0 ? `+${gaze.x}` : gaze.x} Y:{gaze.y >= 0 ? `+${gaze.y}` : gaze.y}
                  </span>
                </div>
              </div>

              {/* Real Software Showcase Area (16:9 Aspect Ratio, Zero Crop) */}
              <div
                onClick={() => setLightboxOpen(true)}
                className="relative my-2 w-full aspect-[16/9] overflow-hidden border border-[var(--border-hairline)] bg-[#0B0C10] flex items-center justify-center cursor-pointer group shadow-inner"
                title="点击放大查看高清实机截图"
              >
                {/* Real DeskAura Studio + Desktop Companion Screenshot */}
                <img
                  src="/images/hero-real.png"
                  alt="DeskAura 实机运行截图"
                  className="w-full h-full object-contain object-center transition-transform duration-300 ease-out group-hover:scale-[1.01]"
                />

                {/* Subtle Hover Pill */}
                <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-black/75 backdrop-blur-sm border border-white/10 px-2 py-1 text-[11px] text-[#CBD0E4] font-sans-ui flex items-center gap-1.5 pointer-events-none">
                  <Maximize2 className="w-3 h-3 text-[#8B7FE8]" />
                  <span>点击放大</span>
                </div>
              </div>

              {/* Viewport Bottom Controls & Coordinates */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--border-hairline)] font-mono-code text-[11px] z-20">
                <div className="flex items-center gap-3 text-[var(--text-muted)]">
                  <span className="flex items-center gap-1.5 text-[#7ed4ac]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#7ed4ac] animate-pulse" />
                    LIVE PRODUCTION CAPTURE
                  </span>
                  <span>|</span>
                  <span>SCALE: 1.0x</span>
                  <span>|</span>
                  <span>FPS: 60</span>
                </div>

                {/* Right Bottom Label + Lightbox button in font-sans-ui */}
                <div className="flex items-center gap-3 font-sans-ui text-xs">
                  <span className="text-[var(--text-secondary)] text-[11px] hidden sm:inline">
                    双窗口透明渲染 · Win32 穿透
                  </span>
                  <button
                    onClick={() => setLightboxOpen(true)}
                    className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-hairline)] hover:border-[var(--accent-signal)] text-[var(--text-primary)] hover:text-[var(--accent-signal)] transition-colors cursor-pointer text-xs"
                  >
                    <Maximize2 className="w-3.5 h-3.5 text-[var(--accent-signal)]" />
                    <span>查看高清实机图</span>
                  </button>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Lightbox Modal for High-Res Screenshot */}
      {lightboxOpen && (
        <div
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 animate-in fade-in duration-200"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-6xl w-full bg-[#10121B] border border-white/15 p-2 shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-white/8 font-mono-code text-xs text-[#9396AA]">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#7ed4ac]" />
                <span className="text-[#F4F5F8] font-bold">DeskAura 实机运行原图 (1917 × 1020)</span>
                <span className="text-[10px] text-[#63667A] hidden sm:inline">// NO TASKBAR · CLEAN WORKSPACE</span>
              </div>
              <button
                onClick={() => setLightboxOpen(false)}
                className="text-[#9396AA] hover:text-white min-h-[44px] min-w-[44px] flex items-center justify-center p-2 hover:bg-white/10 transition-colors cursor-pointer rounded"
                title="关闭"
                aria-label="关闭灯箱"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-2 overflow-auto max-h-[85vh] flex items-center justify-center bg-[#0B0C10]">
              <img
                src="/images/hero-real.png"
                alt="DeskAura 实机运行原图"
                className="w-full h-auto max-h-[80vh] object-contain rounded"
              />
            </div>
            <div className="px-4 py-2 border-t border-white/8 font-sans-ui text-xs text-[#63667A] flex items-center justify-between">
              <span>点击空白处或右上角关闭</span>
              <span className="font-mono-code text-[#8B7FE8]">STATUS: VERIFIED PRODUCTION RUNTIME</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
