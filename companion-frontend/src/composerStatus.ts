/** Keep actionable errors until the corresponding operation recovers. */
export function composerStatus(chatError: string, voiceStatus: string, audioStatus: string): string {
  return chatError || voiceStatus || audioStatus
}
export function voiceStatusAfterEdit(status: string): string {
  // Manual typing supersedes recording configuration errors, not an active request.
  return /正在听|正在交给模型/.test(status) ? status : ''
}
