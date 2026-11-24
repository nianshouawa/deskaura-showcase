/** Device failures are not provider authentication failures. */
export function microphoneError(error: unknown) {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError' || /permission denied/i.test(error.message)) return '麦克风权限被拒绝。请允许 DeskAura 使用麦克风；若仍失败，检查 Windows 设置 → 隐私和安全性 → 麦克风中的桌面应用权限，再重试。'
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return '没有找到麦克风。请连接输入设备，并在 Windows 声音设置中选择可用麦克风。'
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return '麦克风无法读取，可能被其他程序独占。请关闭占用录音的程序后重试。'
    if (error.name === 'SecurityError') return '当前窗口无法安全访问麦克风，请重新打开 DeskAura 后重试。'
    return error.message
  }
  return '麦克风启动失败，请检查输入设备和权限。'
}
