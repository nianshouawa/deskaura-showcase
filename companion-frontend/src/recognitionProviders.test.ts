import { describe, expect, it } from 'vitest'
import { dashscopeRegions, recognitionPresetPatch, selectedDashscopeRegion } from './recognitionProviders'

describe('independent ASR provider settings', () => {
  it('fills Bailian audio-chat defaults without enabling or replacing credentials', () => {
    const patch = recognitionPresetPatch('dashscope')
    expect(patch).toEqual({ asr_provider: 'dashscope', asr_base_url: dashscopeRegions.beijing.url, asr_model: 'qwen3-asr-flash', asr_language: '' })
    expect(Object.keys(patch).some(key => key.includes('key') || key.includes('enabled') || !key.startsWith('asr_'))).toBe(false)
  })
  it('retains the multipart choice for existing providers', () => {
    expect(recognitionPresetPatch('compatible').asr_model).toBe('FunAudioLLM/SenseVoiceSmall')
  })
  it('distinguishes public regions without mislabeling workspace domains', () => {
    expect(selectedDashscopeRegion(dashscopeRegions.beijing.url + '/chat/completions')).toBe('beijing')
    expect(selectedDashscopeRegion(dashscopeRegions.singapore.url)).toBe('singapore')
    expect(selectedDashscopeRegion('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1')).toBe('custom')
    expect(selectedDashscopeRegion('https://dashscope.aliyuncs.com.evil.invalid/v1')).toBe('custom')
    expect(selectedDashscopeRegion('not a url')).toBe('custom')
  })
})
