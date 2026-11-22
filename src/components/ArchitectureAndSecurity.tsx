import React, { useState } from 'react';
import { CornerBrackets } from './CornerBrackets';
import { Lock } from 'lucide-react';

export const ArchitectureAndSecurity: React.FC = () => {
  // Layer selection state
  const [selectedLayer, setSelectedLayer] = useState<number>(0);

  // 2D Permission selection
  const [accessLevel, setAccessLevel] = useState<'readonly' | 'workspace_write' | 'full_access'>('workspace_write');
  const [approvalPolicy, setApprovalPolicy] = useState<'require_approval' | 'auto_approve' | 'full_approval'>('require_approval');

  // Approval card demo state
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [processTreeKilled, setProcessTreeKilled] = useState<boolean>(false);

  // Anti-race demo
  const [activeRole, setActiveRole] = useState<'Furina' | 'Momo'>('Furina');
  const [aborted, setAborted] = useState(false);

  const handleApprove = () => {
    setApprovalStatus('approved');
    setTimeout(() => setProcessTreeKilled(true), 1000);
  };

  const handleReject = () => {
    setApprovalStatus('rejected');
    setProcessTreeKilled(false);
  };

  const resetApproval = () => {
    setApprovalStatus('pending');
    setProcessTreeKilled(false);
  };

  const handleSwitchRole = (newRole: 'Furina' | 'Momo') => {
    setActiveRole(newRole);
    setAborted(true);
    setTimeout(() => setAborted(false), 2000);
  };

  const architectureLayers = [
    {
      id: 0,
      code: 'LAYER 01 // DESKTOP HOST',
      name: '桌面宿主层',
      stack: 'Tauri 2.x (Rust) · Win32 原生 API',
      bullets: [
        'win_frame 穿透 Tao 状态机直查 IsWindowVisible，解决 Windows 透明无边框窗口可见性不同步缺陷。',
        '设置窗口右上角 X 彻底隐藏：Tao 内部 window_flags 与 Win32 ShowWindow(SW_HIDE) 双重同步，消除卡死。',
        '主工作室退出退避：检测 main 桌宠或 settings 是否在运行；有活跃窗口时仅隐藏工作室，保障后台微服务继续工作。',
        '系统托盘单一实例常驻与恢复。'
      ],
      files: 'companion-frontend/src-tauri/src/main.rs · win_frame.rs'
    },
    {
      id: 1,
      code: 'LAYER 02 // MULTI-WINDOW UI',
      name: '前端多窗口层',
      stack: 'Vue 3 · TypeScript · Three.js · Pixiv Three-VRM',
      bullets: [
        'home(工作室)、settings(设置)、main(桌宠)、dialog(对话)、tutorial(指南) 共享同一构建包。',
        'ExpandableContent 组件通过屏幕外 DOM 副本预测文字高度，避免展开时内容跳顶滚动抖动。',
        '角色切换异步防竞态：通过角色 ID 校验 + AbortController 主动丢弃迟到响应，防止跨角色记忆污染。',
        'WebGL 透明度配置：alpha: true 与深度排序，配合 Win32 点击穿透。'
      ],
      files: 'companion-frontend/src/Home.vue · Settings.vue · desktop/standby.ts'
    },
    {
      id: 2,
      code: 'LAYER 03 // LOCAL MICROSERVICES',
      name: '本机三微服务集群',
      stack: 'Python 3.12 + FastAPI · PyInstaller Onedir 打包',
      bullets: [
        'agent-backend (:8000)：LangGraph 4 节点编排 (load → reply → motion → persist)，工具执行单轮上限 16 步与 2 次恢复断路器。',
        'memory-service (:8001)：官方 MemU 引擎，SQLite 原始会话归档与内置 BGE 本地嵌入模型向量检索。',
        'motion-service (:8002)：25 组离线动作调度、SMPL-H 52 关节映射、腾讯 TokenHub FBX 与本地 HY-Motion Worker 适配。',
        'SenseVoice ONNX：内置轻量级语音识别，0 依赖纯离线运行。'
      ],
      files: 'agent-backend/app/main.py · memory-service/ · motion-service/'
    }
  ];

  return (
    <section id="architecture" className="py-20 md:py-28 bg-[var(--bg-canvas)] border-b border-[var(--border-hairline)] transition-colors duration-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 pb-6 border-b border-[var(--border-hairline)] gap-4">
          <div>
            <div className="font-mono-code text-[11px] text-[var(--text-muted)] tracking-widest uppercase mb-2">
              SECTION // 03 · VERIFIABLE SYSTEM ARCHITECTURE
            </div>
            <h2 className="font-sans-ui font-bold text-3xl sm:text-4xl text-[var(--text-primary)] tracking-tight">
              系统架构与权限模型
            </h2>
          </div>
          <div className="font-mono-code text-xs text-[var(--text-secondary)]">
            TAURI 2.x RUST HOST + 3 LOCAL PYTHON MICROSERVICES
          </div>
        </div>

        {/* TOP: 3-Layer Architecture Topology (Clickable) */}
        <div className="mb-16">
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-4">
            <span className="font-mono-code">// TOPOLOGY · </span>
            <span className="font-sans-ui">点击切换分层查看源码实现</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
            {architectureLayers.map((l) => {
              const isSelected = selectedLayer === l.id;
              return (
                <button
                  key={l.id}
                  onClick={() => setSelectedLayer(l.id)}
                  className={`p-4 border text-left transition-colors cursor-pointer rounded-xs ${
                    isSelected
                      ? 'bg-[var(--bg-elevated)] border-[var(--accent-signal)] text-[var(--text-primary)] shadow-sm'
                      : 'bg-[var(--bg-surface)] border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--accent-signal)]/40'
                  }`}
                >
                  <div className="font-mono-code text-[10px] text-[var(--accent-signal)] mb-1 font-bold">
                    {l.code}
                  </div>
                  <h3 className="font-sans-ui font-bold text-sm text-[var(--text-primary)] mb-1">
                    {l.name}
                  </h3>
                  <div className="font-sans-ui text-[11px] text-[var(--text-muted)] truncate">
                    {l.stack}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Active Layer Details Viewport */}
          <div className="p-6 sm:p-8 bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-viewport)] relative rounded-xs">
            <CornerBrackets color="var(--accent-signal)" size={10} strokeWidth={1.5} />
            <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-4 mb-4 border-b border-[var(--border-hairline)] text-xs gap-2">
              <span className="text-[var(--accent-signal)] font-bold">
                <span className="font-mono-code">{architectureLayers[selectedLayer].code} // </span>
                <span className="font-sans-ui">{architectureLayers[selectedLayer].name}</span>
              </span>
              <span className="font-mono-code text-[var(--text-muted)] text-[10px] sm:text-xs break-all">
                FILE: {architectureLayers[selectedLayer].files}
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {architectureLayers[selectedLayer].bullets.map((b, i) => (
                <div key={i} className="p-3.5 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] font-sans-ui text-xs leading-relaxed text-[var(--text-primary)] rounded-xs">
                  <span className="font-mono-code text-[var(--accent-signal)] mr-2 font-bold">[{i + 1}]</span>
                  <span>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* BOTTOM: 2D Permissions Matrix & Interactive Approval Simulator */}
        <div>
          <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-4">
            <span className="font-mono-code">// SECURITY · </span>
            <span className="font-sans-ui">二维权限独立矩阵与文件审批卡模拟器</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            
            {/* Left: 2D Matrix Controls (5 cols) */}
            <div className="lg:col-span-5 p-6 bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-viewport)] font-sans-ui text-xs space-y-5 rounded-xs">
              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-hairline)]">
                <span className="font-bold text-[var(--text-primary)]">// 访问权限 × 批准策略</span>
                <span className="text-[var(--accent-signal)] font-medium">完全解耦</span>
              </div>

              <div>
                <span className="text-[11px] text-[var(--text-muted)] block mb-2">
                  访问权限 (<span className="font-mono-code">Access Level</span>):
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['readonly', 'workspace_write', 'full_access'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      onClick={() => setAccessLevel(lvl)}
                      className={`min-h-[44px] p-2 border text-center text-xs font-sans-ui transition-colors cursor-pointer rounded-xs flex items-center justify-center ${
                        accessLevel === lvl
                          ? 'bg-[var(--bg-elevated)] border-[var(--accent-signal)] text-[var(--text-primary)] font-bold shadow-xs'
                          : 'bg-[var(--bg-surface)] border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--accent-signal)]/30'
                      }`}
                    >
                      {lvl === 'readonly' ? '只读' : lvl === 'workspace_write' ? '工作区写入' : '完全访问'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <span className="text-[11px] text-[var(--text-muted)] block mb-2">
                  批准策略 (<span className="font-mono-code">Approval Policy</span>):
                </span>
                <div className="grid grid-cols-3 gap-1.5">
                  {(['require_approval', 'auto_approve', 'full_approval'] as const).map((pol) => (
                    <button
                      key={pol}
                      onClick={() => setApprovalPolicy(pol)}
                      className={`min-h-[44px] p-2 border text-center text-xs font-sans-ui transition-colors cursor-pointer rounded-xs flex items-center justify-center ${
                        approvalPolicy === pol
                          ? 'bg-[var(--bg-elevated)] border-[var(--accent-signal)] text-[var(--text-primary)] font-bold shadow-xs'
                          : 'bg-[var(--bg-surface)] border-[var(--border-hairline)] text-[var(--text-secondary)] hover:border-[var(--accent-signal)]/30'
                      }`}
                    >
                      {pol === 'require_approval' ? '请求批准' : pol === 'auto_approve' ? '帮我批准' : '完全批准'}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] text-[11px] text-[var(--text-secondary)] leading-relaxed rounded-xs">
                当前决策：在 <strong className="font-mono-code text-[var(--text-primary)]">{accessLevel}</strong> 且 <strong className="font-mono-code text-[var(--text-primary)]">{approvalPolicy}</strong> 下，
                {accessLevel === 'readonly'
                  ? '拒绝任何写入与命令操作。'
                  : approvalPolicy === 'require_approval'
                  ? '写操作或命令执行必须触发右侧所示独立卡片批准。'
                  : '在安全步长限制内自动执行，受单轮最多 16 步断路器保护。'}
              </div>

              <div className="pt-2 text-[10px] text-[var(--text-muted)] border-t border-[var(--border-hairline)] flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-[var(--accent-signal)]" />
                <span>API Key 保存在 Windows 凭据管理器，不写入配置文件</span>
              </div>
            </div>

            {/* Right: Interactive Approval Card (7 cols) */}
            <div className="lg:col-span-7 p-4 sm:p-6 bg-[var(--bg-surface)] border border-[var(--border-hairline)] shadow-[var(--shadow-viewport)] font-sans-ui text-xs space-y-4 relative rounded-xs">
              <CornerBrackets color="var(--accent-signal)" size={10} strokeWidth={1.5} />

              <div className="flex items-center justify-between pb-3 border-b border-[var(--border-hairline)] font-mono-code">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-signal)]" />
                  <span className="font-bold text-[var(--text-primary)]">POST /api/files/approval <span className="font-sans-ui font-normal text-xs text-[var(--text-muted)]">(审批卡模拟)</span></span>
                </div>
                <span className="text-[10px] text-[var(--text-muted)]">TOKEN: tok_sec_892a</span>
              </div>

              <div className="p-3 bg-[var(--bg-elevated)] border border-[var(--border-hairline)] space-y-1.5 text-[11px] rounded-xs">
                <div className="text-[var(--text-primary)]">
                  请求操作: <span className="font-mono-code text-[var(--accent-signal)] font-bold">FileTools.write_file</span>
                </div>
                <div className="text-[var(--text-secondary)]">
                  目标路径: <span className="font-mono-code text-[var(--text-primary)] font-medium">workspace/analysis_summary.md</span>
                </div>
                <div className="text-[var(--text-muted)]">
                  会话/角色校验: <span className="text-[#2B7853] dark:text-[#7ed4ac]"><span className="font-mono-code font-bold">Furina (Hash: e9a1ff02)</span> 匹配</span>
                </div>
                <div className="text-[var(--text-muted)]">
                  子进程保护: <span className="text-[#2B7853] dark:text-[#7ed4ac]"><span className="font-mono-code font-bold">Windows Job Object</span> 跟踪生效</span>
                </div>
              </div>

              {approvalStatus === 'pending' && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                  <span className="text-[var(--text-secondary)] font-medium">是否批准该文件写入？</span>
                  <div className="grid grid-cols-2 gap-3 w-full sm:w-auto">
                    <button
                      onClick={handleReject}
                      className="min-h-[44px] px-5 py-2.5 bg-[#b3405b]/15 hover:bg-[#b3405b] text-[#b3405b] hover:text-white border border-[#b3405b]/30 font-bold transition-colors cursor-pointer rounded-xs flex items-center justify-center text-xs"
                    >
                      [拒绝]
                    </button>
                    <button
                      onClick={handleApprove}
                      className="cut-corner-tr min-h-[44px] px-6 py-2.5 bg-[var(--accent-solid)] hover:bg-[var(--accent-solid-hover)] text-white font-bold transition-colors cursor-pointer shadow-xs flex items-center justify-center text-xs"
                    >
                      [批准执行]
                    </button>
                  </div>
                </div>
              )}

              {approvalStatus === 'approved' && (
                <div className="p-3 bg-[#263B33]/15 border border-[#4B6B58] text-[#1E5638] dark:text-[#B2D8BF] dark:bg-[#263B33] space-y-1 rounded-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">✓ 操作已批准并执行成功</span>
                    <button onClick={resetApproval} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                      [重置测试]
                    </button>
                  </div>
                  <p className="text-[11px] opacity-90">
                    {processTreeKilled
                      ? '✓ Windows Job Object: 子进程句柄已自动清理闭环，无后代进程残留。'
                      : '正在写入文件流并同步 MemU 会话分片...'}
                  </p>
                </div>
              )}

              {approvalStatus === 'rejected' && (
                <div className="p-3 bg-[#b3405b]/15 border border-[#b3405b]/40 text-[#b3405b] dark:text-[#ffb3bd] dark:bg-[#33212D] space-y-1 rounded-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">✕ 操作已拒绝</span>
                    <button onClick={resetApproval} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer">
                      [重置测试]
                    </button>
                  </div>
                  <p className="text-[11px] opacity-90">
                    向 LangGraph 大脑节点返回「用户拒绝执行该文件写入」，状态机安全进入下一轮待命。
                  </p>
                </div>
              )}

              {/* Fast role switch anti-race demo */}
              <div className="pt-3 border-t border-[var(--border-hairline)] flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-2 text-[var(--text-muted)]">
                  <span>防竞态测试:</span>
                  <button
                    onClick={() => handleSwitchRole(activeRole === 'Furina' ? 'Momo' : 'Furina')}
                    className="px-2 py-0.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-surface)] border border-[var(--border-hairline)] text-[var(--text-primary)] cursor-pointer rounded-xs"
                  >
                    角色: <span className="font-mono-code font-bold">{activeRole}</span> (点击切换)
                  </button>
                </div>
                {aborted && (
                  <span className="text-[var(--accent-signal)] font-medium">
                    ✓ <span className="font-mono-code">AbortController</span> 已丢弃迟到响应
                  </span>
                )}
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
};
