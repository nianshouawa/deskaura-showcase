import React from 'react';
import { ArrowUp } from 'lucide-react';

export const Footer: React.FC = () => {
  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-[var(--bg-canvas)] border-t border-[var(--border-hairline)] py-12 text-xs text-[var(--text-muted)] transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between pb-8 border-b border-[var(--border-hairline)] gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[var(--text-primary)] font-bold">
              <span className="font-sans-ui text-sm">DeskAura</span>
              <span className="font-mono-code text-[10px] text-[var(--text-muted)]">// BUILD 2026.11</span>
            </div>
            <p className="font-sans-ui text-xs text-[var(--text-secondary)]">
              本地优先的 Windows 3D 桌面虚拟数字人伴侣。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-[var(--text-secondary)]">
            <a href="#desktop-interaction" className="min-h-[44px] flex items-center font-sans-ui hover:text-[var(--text-primary)] transition-colors">
              <span className="font-mono-code text-[var(--text-muted)] mr-1">//</span>桌面交互
            </a>
            <a href="#companion-studio" className="min-h-[44px] flex items-center font-sans-ui hover:text-[var(--text-primary)] transition-colors">
              <span className="font-mono-code text-[var(--text-muted)] mr-1">//</span>角色工作室
            </a>
            <a href="#architecture" className="min-h-[44px] flex items-center font-sans-ui hover:text-[var(--text-primary)] transition-colors">
              <span className="font-mono-code text-[var(--text-muted)] mr-1">//</span>系统架构
            </a>
            <a href="#downloads" className="min-h-[44px] flex items-center font-sans-ui hover:text-[var(--text-primary)] transition-colors">
              <span className="font-mono-code text-[var(--text-muted)] mr-1">//</span>下载
            </a>
            <button
              onClick={scrollToTop}
              className="min-h-[44px] px-3.5 py-1.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[var(--text-primary)] hover:text-[var(--accent-signal)] font-mono-code cursor-pointer rounded-xs transition-colors shadow-xs flex items-center gap-1.5"
            >
              <span>TOP</span>
              <ArrowUp className="w-3.5 h-3.5 text-[var(--accent-signal)]" />
            </button>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-[10px] sm:text-[11px] font-mono-code text-[var(--text-muted)]">
          <div className="break-words">
            TAURI 2.x · VUE 3 · THREE-VRM · LANGGRAPH · MEMU 0.10.0 · SENSEVOICE ONNX
          </div>
          <div className="text-[var(--accent-signal)] font-medium break-words">
            PORTS: 8000 (AGENT) · 8001 (MEMORY) · 8002 (MOTION) · 1420 (FRONTEND)
          </div>
        </div>

      </div>
    </footer>
  );
};
