import { describe, expect, it } from 'vitest'
import { composerStatus, voiceStatusAfterEdit } from './composerStatus'

describe('compact composer feedback', () => {
  it('prioritizes actionable input failures', () => {
    expect(composerStatus('文件过大', '正在听', '')).toBe('文件过大')
    expect(composerStatus('', '正在听', '正在播放')).toBe('正在听')
  })
  it('dismisses resolved dictation hints on text input but keeps active work', () => {
    expect(voiceStatusAfterEdit('请配置 ASR')).toBe('')
    expect(voiceStatusAfterEdit('正在交给模型识别')).toBe('正在交给模型识别')
  })
})
