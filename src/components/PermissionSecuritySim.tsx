import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Lock, 
  FileText, 
  Check, 
  X, 
  AlertTriangle, 
  RefreshCw, 
  FolderLock 
} from 'lucide-react';

export const PermissionSecuritySim: React.FC = () => {
  // 2D Matrix Selection: [AccessLevel, ApprovalPolicy]
  const [accessLevel, setAccessLevel] = useState<'readonly' | 'workspace_write' | 'full_access'>('workspace_write');
  const [approvalPolicy, setApprovalPolicy] = useState<'require_approval' | 'auto_approve' | 'full_approval'>('require_approval');

  // Approval card state
  const [approvalStatus, setApprovalStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [processTreeKilled, setProcessTreeKilled] = useState<boolean>(false);

  // AbortController anti-race demo state
  const [currentRole, setCurrentRole] = useState<'Role_A_Furina' | 'Role_B_Momo'>('Role_A_Furina');
  const [abortTriggered, setAbortTriggered] = useState<boolean>(false);

  const handleApprove = () => {
    setApprovalStatus('approved');
    setProcessTreeKilled(false);
    setTimeout(() => {
      setProcessTreeKilled(true);
    }, 1200);
  };

  const handleReject = () => {
    setApprovalStatus('rejected');
    setProcessTreeKilled(false);
  };

  const resetApprovalDemo = () => {
    setApprovalStatus('pending');
    setProcessTreeKilled(false);
  };

  const handleRoleSwitch = (newRole: 'Role_A_Furina' | 'Role_B_Momo') => {
    setCurrentRole(newRole);
    setAbortTriggered(true);
    setTimeout(() => setAbortTriggered(false), 2000);
  };

  return (
    <section id="security" className="py-20 md:py-28 relative border-t border-[#1E293B] bg-[#07090E]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Section Heading */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-mono-code text-[#2DD4BF] px-3 py-1 rounded-full bg-[#151D2E] border border-[#2DD4BF]/30">
            04 / 隐私与安全边界
          </span>
          <h2 className="font-display font-bold text-2xl sm:text-3xl md:text-4xl text-[#F1F5F9] mt-4 mb-4 tracking-tight">
            二维独立控制模型与 Windows 原生凭据保护
          </h2>
          <p className="text-base text-[#94A3B8] leading-relaxed">
            AI 桌面伴侣不能是不受约束的黑盒。DeskAura 设计了访问权限与批准策略二维正交矩阵、Windows Job Object 子进程树清理以及系统级密钥隔离。
          </p>
        </div>

        {/* 2D Permissions Matrix & Interactive Approval Simulator */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-16">
          
          {/* Left Column: 2D Matrix Selection */}
          <div className="lg:col-span-6 p-6 sm:p-7 rounded-2xl bg-[#0E131F] border border-[#1E293B] shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B]">
                <h3 className="font-display font-bold text-lg text-[#F1F5F9] flex items-center gap-2">
                  <FolderLock className="w-5 h-5 text-[#2DD4BF]" />
                  <span>二维独立权限控制矩阵</span>
                </h3>
                <span className="text-xs font-mono-code text-[#2DD4BF]">正交模型</span>
              </div>

              <p className="text-xs sm:text-sm text-[#94A3B8] leading-relaxed mb-6">
                <strong>访问权限</strong>（决定能接触哪些物理资源）与<strong>批准策略</strong>（决定执行操作时是否需要弹窗确认）完全独立解耦，杜绝权限越界。
              </p>

              {/* Dimension 1: Access Level */}
              <div className="mb-5">
                <span className="text-xs font-mono-code text-[#CBD5E1] block mb-2">
                  维度 1 · 访问权限 (Access Level):
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setAccessLevel('readonly')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      accessLevel === 'readonly'
                        ? 'bg-[#151D2E] border-[#2DD4BF] text-[#2DD4BF] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    只读 (Read Only)
                  </button>
                  <button
                    onClick={() => setAccessLevel('workspace_write')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      accessLevel === 'workspace_write'
                        ? 'bg-[#151D2E] border-[#2DD4BF] text-[#2DD4BF] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    工作空间写入
                  </button>
                  <button
                    onClick={() => setAccessLevel('full_access')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      accessLevel === 'full_access'
                        ? 'bg-[#151D2E] border-[#F59E0B] text-[#F59E0B] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    完全访问 (Full)
                  </button>
                </div>
              </div>

              {/* Dimension 2: Approval Policy */}
              <div className="mb-6">
                <span className="text-xs font-mono-code text-[#CBD5E1] block mb-2">
                  维度 2 · 批准策略 (Approval Policy):
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setApprovalPolicy('require_approval')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      approvalPolicy === 'require_approval'
                        ? 'bg-[#151D2E] border-[#2DD4BF] text-[#2DD4BF] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    请求批准 (弹卡)
                  </button>
                  <button
                    onClick={() => setApprovalPolicy('auto_approve')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      approvalPolicy === 'auto_approve'
                        ? 'bg-[#151D2E] border-[#2DD4BF] text-[#2DD4BF] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    帮我批准 (静默)
                  </button>
                  <button
                    onClick={() => setApprovalPolicy('full_approval')}
                    className={`p-2.5 rounded-lg border text-xs font-mono-code transition-all cursor-pointer ${
                      approvalPolicy === 'full_approval'
                        ? 'bg-[#151D2E] border-[#EF4444] text-[#EF4444] font-semibold'
                        : 'bg-[#07090E] border-[#1E293B] text-[#94A3B8] hover:text-[#F1F5F9]'
                    }`}
                  >
                    完全批准 (危险)
                  </button>
                </div>
              </div>
            </div>

            {/* Resolved Decision Output */}
            <div className="p-3.5 rounded-xl bg-[#07090E] border border-[#1E293B] text-xs font-mono-code space-y-1">
              <div className="flex items-center justify-between text-[#94A3B8]">
                <span>当前组合执行行为:</span>
                <span className="text-[#2DD4BF]">
                  {accessLevel} × {approvalPolicy}
                </span>
              </div>
              <p className="text-[11px] text-[#CBD5E1] leading-relaxed">
                {accessLevel === 'readonly'
                  ? '所有写入与执行命令均被硬件拦截；只允许读取已公开的角色人设与工作区只读文件。'
                  : accessLevel === 'workspace_write' && approvalPolicy === 'require_approval'
                  ? '允许对工作区写入文件，但在每次落盘前必须弹出下方所示的独立审批卡，获得用户确认。'
                  : accessLevel === 'full_access' && approvalPolicy === 'require_approval'
                  ? '允许运行系统命令或外部工具，但每次运行必须明确弹窗审批并记录命令参数指纹。'
                  : '在放行策略下自动执行，受单轮最多 16 步断路器保护。'}
              </p>
            </div>
          </div>

          {/* Right Column: Interactive Approval Card Simulator */}
          <div className="lg:col-span-6 p-6 sm:p-7 rounded-2xl bg-[#0E131F] border border-[#1E293B] shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-[#1E293B]">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-5 h-5 text-[#F59E0B]" />
                  <h3 className="font-display font-bold text-lg text-[#F1F5F9]">
                    模拟真实文件操作审批卡
                  </h3>
                </div>
                <span className="text-xs font-mono-code px-2 py-0.5 rounded bg-[#F59E0B]/20 text-[#F59E0B]">
                  POST /api/files/approval
                </span>
              </div>

              {/* The Actual Approval Card Preview */}
              <div className="p-4 rounded-xl bg-[#07090E] border border-[#2DD4BF]/40 space-y-3 font-mono-code text-xs">
                <div className="flex items-center justify-between text-[#94A3B8]">
                  <span className="flex items-center gap-1.5 text-[#2DD4BF]">
                    <FileText className="w-4 h-4" />
                    <span>请求执行: FileTools.write_file</span>
                  </span>
                  <span className="text-[10px] text-[#64748B]">Token: tok_sec_78fa</span>
                </div>

                <div className="p-2.5 rounded bg-[#0E131F] border border-[#1E293B] text-[11px] space-y-1">
                  <div className="text-[#CBD5E1]">
                    目标路径: <span className="text-[#2DD4BF]">workspace/analysis_summary.md</span>
                  </div>
                  <div className="text-[#64748B]">
                    所属角色: <span className="text-[#F1F5F9]">Furina (Hash: 9e3f...20)</span>
                  </div>
                  <div className="text-[#64748B]">
                    子进程管理: <span className="text-[#10B981]">Windows Job Object 跟踪生效中</span>
                  </div>
                </div>

                {/* Status Feedback in Demo */}
                {approvalStatus === 'pending' && (
                  <div className="pt-2 flex items-center justify-between">
                    <span className="text-xs text-[#94A3B8]">请裁判或用户选择策略:</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleReject}
                        className="px-3 py-1.5 rounded-lg bg-[#EF4444]/20 hover:bg-[#EF4444] text-[#EF4444] hover:text-white border border-[#EF4444]/40 text-xs font-semibold transition-colors cursor-pointer"
                      >
                        拒绝 (Reject)
                      </button>
                      <button
                        onClick={handleApprove}
                        className="px-4 py-1.5 rounded-lg bg-[#2DD4BF] hover:bg-[#14B8A6] text-[#07090E] text-xs font-bold transition-all shadow-[0_0_15px_rgba(45,212,191,0.3)] cursor-pointer"
                      >
                        批准 (Approve)
                      </button>
                    </div>
                  </div>
                )}

                {approvalStatus === 'approved' && (
                  <div className="p-3 rounded-lg bg-[#10B981]/15 border border-[#10B981]/40 text-xs text-[#10B981] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5">
                        <Check className="w-4 h-4" />
                        <span>已批准！文件写入已安全完成</span>
                      </span>
                      <button onClick={resetApprovalDemo} className="text-[#64748B] hover:text-[#CBD5E1] text-[10px]">
                        重置测试
                      </button>
                    </div>
                    <p className="text-[11px] text-[#CBD5E1] leading-relaxed">
                      {processTreeKilled 
                        ? '✓ Windows Job Object: 子进程句柄已自动清理闭环，无后代进程残留。'
                        : '正在写入文件流并同步 MemU 会话分片...'}
                    </p>
                  </div>
                )}

                {approvalStatus === 'rejected' && (
                  <div className="p-3 rounded-lg bg-[#EF4444]/15 border border-[#EF4444]/40 text-xs text-[#EF4444] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5">
                        <X className="w-4 h-4" />
                        <span>已拒绝操作！阻断未经授权写入</span>
                      </span>
                      <button onClick={resetApprovalDemo} className="text-[#64748B] hover:text-[#CBD5E1] text-[10px]">
                        重置测试
                      </button>
                    </div>
                    <p className="text-[11px] text-[#CBD5E1] leading-relaxed">
                      向 LangGraph 大脑节点返回「用户拒绝执行该文件写入」，状态机安全进入下一轮待命。
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Note about credentials */}
            <div className="mt-4 pt-3 border-t border-[#1E293B] text-[11px] font-mono-code text-[#64748B] flex items-center gap-2">
              <Lock className="w-3.5 h-3.5 text-[#2DD4BF] flex-shrink-0" />
              <span>所有 API Key 均存储于 Windows 凭据管理器，配置文件导出不包含任何密钥。</span>
            </div>
          </div>

        </div>

        {/* Anti-Race Condition & Truthful State Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          
          {/* Card 1: 防竞态机制 */}
          <div className="p-6 rounded-xl bg-[#0E131F] border border-[#1E293B] space-y-3">
            <div className="flex items-center justify-between text-xs font-mono-code">
              <span className="text-[#2DD4BF] flex items-center gap-1.5 font-bold">
                <RefreshCw className="w-4 h-4" />
                <span>异步防竞态：AbortController + 角色 ID 强校验</span>
              </span>
              <span className="text-[#10B981]">防止数据污染</span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#94A3B8] leading-relaxed">
              用户在快速切换不同角色时，旧角色的 LLM 流式请求可能迟到返回。DeskAura 在切换瞬间自动触发 <code className="text-[#2DD4BF] font-mono-code">AbortController.abort()</code>，并在响应回执中校验 <code className="text-[#2DD4BF] font-mono-code">X-DeskAura-Role</code>。一旦发现角色哈希不匹配，即刻物理丢弃，防止对话跨角色穿透污染。
            </p>

            <div className="pt-2 flex items-center justify-between text-xs font-mono-code">
              <div className="flex items-center gap-2">
                <span className="text-[#64748B]">模拟快速切换:</span>
                <button
                  onClick={() => handleRoleSwitch(currentRole === 'Role_A_Furina' ? 'Role_B_Momo' : 'Role_A_Furina')}
                  className="px-2.5 py-1 rounded bg-[#151D2E] hover:bg-[#1E293B] text-[#F1F5F9] border border-[#1E293B] cursor-pointer"
                >
                  当前: {currentRole} (点击切换)
                </button>
              </div>
              {abortTriggered && (
                <span className="text-[#F59E0B] animate-pulse">
                  ✓ AbortController 拦截生效
                </span>
              )}
            </div>
          </div>

          {/* Card 2: 真实状态工程原则 */}
          <div className="p-6 rounded-xl bg-[#0E131F] border border-[#1E293B] space-y-3">
            <div className="flex items-center justify-between text-xs font-mono-code">
              <span className="text-[#F59E0B] flex items-center gap-1.5 font-bold">
                <AlertTriangle className="w-4 h-4" />
                <span>工程诚实度：配置已保存 ≠ 真实检测连通</span>
              </span>
              <span className="text-[#64748B]">不搞虚假绿灯</span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#94A3B8] leading-relaxed">
              严格区分“用户修改已持久化存储”与“后端/外设网络实际可用”。保存配置时绝不自动调用外部收费模型进行虚假探测；界面上的状态指示灯忠实呈现上一次显式检测的实际网络证明，健康检查接口（/health）不可用时如实报错。
            </p>

            <div className="pt-2 flex items-center justify-between text-xs font-mono-code text-[#64748B]">
              <span>GET /health 仅代表本地进程存活</span>
              <span className="text-[#2DD4BF]">主动 POST /modules/test 才更新连通记录</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
