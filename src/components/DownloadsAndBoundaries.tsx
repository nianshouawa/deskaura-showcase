import React, { useState } from 'react';
import { CornerBrackets } from './CornerBrackets';
import { Download, Copy, Check, FileCode2, Monitor } from 'lucide-react';

export const DownloadsAndBoundaries: React.FC = () => {
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const sha256 = "1b4aa77417a452dd82a8841cbc453e29048574b9b7feddd491f8483eab10056d";

  const handleCopy = () => {
    navigator.clipboard.writeText(sha256);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  const boundaries = [
    '安装包尚未进行代码签名，首次运行时 Windows Defender / SmartScreen 可能提示“未知发布者”，核对 SHA-256 后选择“仍要运行”即可。',
    '开箱内置两款开源合规的 VRM 角色模型（结海 Yuki、AvatarSample_1 Shibu），绝不内置未授权的商业 IP 模型与云端 Key，其他模型需自备授权。',
    '关闭系统沙箱执行本机命令时按当前 Windows 用户权限运行，不能把已授权的工作区目录当作系统级沙箱隔离。',
    'MediaPipe BlazeFace WASM 仅提取 6 个面部关键点计算头部眼骨对准屏幕中心，不具备人脸身份甄别能力。',
    '界面状态点保留上一次主动检测的结果，不保证服务实时在线，不伪造虚假绿灯。'
  ];

  return (
    <section id="downloads" className="py-20 md:py-28 bg-[var(--bg-canvas)] border-b border-[var(--border-hairline)] select-none transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 pb-6 border-b border-[var(--border-hairline)] gap-4">
          <div>
            <div className="font-mono-code text-[11px] text-[var(--text-muted)] tracking-widest uppercase mb-2">
              SECTION // 04 · DISTRIBUTION &amp; BOUNDARIES
            </div>
            <h2 className="font-sans-ui font-bold text-3xl sm:text-4xl text-[var(--text-primary)] tracking-tight">
              获取方式与工程边界
            </h2>
          </div>
          <div className="font-mono-code text-xs text-[var(--text-secondary)]">
            WINDOWS X64 DUAL-DISTRIBUTION // NO RUNTIME SETUP REQUIRED
          </div>
        </div>

        {/* Dual Distribution 2 Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-16">
          
          {/* Format 1: NSIS Setup */}
          <div className="p-7 bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-viewport)] relative flex flex-col justify-between rounded-xs">
            <CornerBrackets color="var(--accent-signal)" size={10} strokeWidth={1.5} />
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-hairline)] text-xs">
                <span className="text-[var(--accent-signal)] font-bold font-sans-ui">// 推荐形态</span>
                <span className="text-[var(--text-muted)] font-sans-ui">约 256.30 MB</span>
              </div>

              <h3 className="font-sans-ui font-bold text-xl text-[var(--text-primary)] mb-1">
                DeskAura NSIS 一键安装包
              </h3>
              <div className="font-mono-code text-xs text-[var(--text-muted)] mb-4">
                DeskAura_0.1.0_x64-setup.exe
              </div>

              <p className="body-reading text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                面向普通用户。内置两款合规开源 VRM 模型、独立 Python 3.12 微服务环境、BGE 中文嵌入模型、SenseVoice 离线听觉模型与 25 组动作库，开箱即用无需环境配置。
              </p>
            </div>

            <div className="pt-4 border-t border-[var(--border-hairline)]">
              <a
                href="https://github.com/nianshouawa/deskaura-showcase/releases/download/v0.1.0/DeskAura_0.1.0_x64-setup.exe"
                target="_blank"
                rel="noopener noreferrer"
                className="cut-corner-tr min-h-[44px] w-full py-3 bg-[var(--accent-solid)] hover:bg-[var(--accent-solid-hover)] text-white font-sans-ui font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-xs"
              >
                <Download className="w-4 h-4" />
                <span>下载完整安装包 (x64)</span>
              </a>
            </div>
          </div>

          {/* Format 2: Portable */}
          <div className="p-5 sm:p-7 bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-viewport)] relative flex flex-col justify-between rounded-xs">
            <CornerBrackets color="var(--accent-signal)" size={10} strokeWidth={1.5} />
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[var(--border-hairline)] text-xs">
                <span className="text-[var(--text-secondary)] font-bold font-sans-ui">// 便携形态</span>
                <span className="text-[var(--text-muted)] font-sans-ui">约 32.78 MB</span>
              </div>

              <h3 className="font-sans-ui font-bold text-xl text-[var(--text-primary)] mb-1">
                DeskAura 免安装便携版
              </h3>
              <div className="font-mono-code text-xs text-[var(--text-muted)] mb-4">
                deskaura.exe (Standalone)
              </div>

              <p className="body-reading text-xs sm:text-sm text-[var(--text-secondary)] leading-relaxed mb-6">
                面向开发者与现场评委演示。内置两款 VRM 角色模型，解压即可直接双击运行，配置与会话数据就近保存在同级 DeskAura-Data 目录，不污染系统环境。
              </p>
            </div>

            <div className="pt-4 border-t border-[var(--border-hairline)]">
              <a
                href="https://github.com/nianshouawa/deskaura-showcase/releases/download/v0.1.0/deskaura.exe"
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] w-full py-3 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-hairline)] hover:border-[var(--accent-signal)] text-[var(--text-primary)] font-sans-ui font-medium text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer rounded-xs shadow-xs"
              >
                <Download className="w-4 h-4 text-[var(--accent-signal)]" />
                <span>获取便携版可执行程序</span>
              </a>
            </div>
          </div>

        </div>

        {/* Mobile Guidance Banner: Phone User Bridge to PC (< md Only) */}
        <div className="md:hidden -mt-8 mb-12 p-4 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] rounded-xs space-y-2.5 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-sans-ui text-[var(--text-primary)] font-bold">
            <Monitor className="w-4 h-4 text-[var(--accent-signal)] flex-shrink-0" />
            <span>DeskAura 为 Windows x64 桌面软件</span>
          </div>
          <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
            检测到您正使用移动设备访问。点击下方按钮复制本页网址，发送到微信文件传输助手/QQ/邮箱，即可在 PC 电脑上一键下载体验 3D 桌宠与本地 AI 功能。
          </p>
          <button
            onClick={handleCopyLink}
            className="min-h-[44px] w-full px-4 py-2.5 bg-[var(--bg-surface)] hover:bg-[var(--bg-canvas)] border border-[var(--border-hairline)] hover:border-[var(--accent-signal)] text-[var(--text-primary)] font-sans-ui font-medium text-xs flex items-center justify-center gap-2 rounded-xs shadow-xs transition-colors cursor-pointer"
          >
            {copiedLink ? (
              <>
                <Check className="w-4 h-4 text-[#2B7853] dark:text-[#7ed4ac]" />
                <span className="text-[#2B7853] dark:text-[#7ed4ac] font-bold">✓ 链接已复制！可发到电脑打开</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4 text-[var(--accent-signal)]" />
                <span>复制本页链接发到电脑</span>
              </>
            )}
          </button>
        </div>

        {/* SHA-256 Verification Line */}
        <div className="p-4 bg-[var(--bg-surface)] border border-[var(--border-hairline)] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-12 sm:mb-16 text-xs rounded-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-2 text-[var(--text-secondary)] font-sans-ui max-w-full">
            <FileCode2 className="w-4 h-4 text-[var(--accent-signal)] flex-shrink-0" />
            <span className="truncate">SHA-256 (SHA256SUMS.txt):</span>
            <code className="text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 border border-[var(--border-hairline)] font-mono-code text-[11px] rounded-xs break-all">
              {sha256.slice(0, 14)}...{sha256.slice(-10)}
            </code>
          </div>
          <button
            onClick={handleCopy}
            className="min-h-[38px] flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-primary)] hover:text-[var(--accent-signal)] font-sans-ui cursor-pointer rounded-xs transition-colors w-full sm:w-auto"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-[#2B7853] dark:text-[#7ed4ac]" /> : <Copy className="w-3.5 h-3.5 text-[var(--accent-signal)]" />}
            <span>{copied ? '已复制哈希值' : '复制完整 SHA-256'}</span>
          </button>
        </div>

        {/* Plain Technical Footnotes (No slogan, no PR fluff) */}
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-4">
            <span className="font-mono-code">// ENGINEERING BOUNDARIES · </span>
            <span className="font-sans-ui">已知边界说明</span>
          </div>

          <div className="space-y-2.5">
            {boundaries.map((text, i) => (
              <div key={i} className="p-3 bg-[var(--bg-surface)] border border-[var(--border-hairline)] font-sans-ui text-xs text-[var(--text-secondary)] leading-relaxed flex items-start gap-3 rounded-xs shadow-xs">
                <span className="text-[var(--accent-signal)] font-mono-code font-bold flex-shrink-0">[{i + 1}]</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  );
};
