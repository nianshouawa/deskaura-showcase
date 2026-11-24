import { describe, expect, it } from 'vitest'
import { microphoneError } from './voiceErrors'
describe('microphone device errors', () => {
  it('explains permission denial without mislabeling it as an API failure', () => {
    expect(microphoneError(new DOMException('Permission denied', 'NotAllowedError'))).toContain('麦克风权限被拒绝')
  })
  it('distinguishes unavailable and occupied devices', () => {
    expect(microphoneError(new DOMException('', 'NotFoundError'))).toContain('没有找到麦克风')
    expect(microphoneError(new DOMException('', 'NotReadableError'))).toContain('独占')
  })
})
