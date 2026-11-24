import { describe, expect, it } from 'vitest'
import { bailianSpeechRegions, selectedBailianSpeechRegion, selectedSpeechProvider, speechPresetPatch, speechPresets, speechVoiceOptions } from './speechProviders'

describe('speech platform defaults', () => {
  it('lists all published flash voices without pretending account-custom voices are known', () => {
    const voices = speechVoiceOptions('dashscope','qwen3-tts-flash')
    expect(voices).toHaveLength(48)
    expect(voices.some(voice => voice.value === 'Kiki')).toBe(true)
    expect(new Set(voices.map(voice => voice.value)).size).toBe(voices.length)
    expect(speechVoiceOptions('dashscope','custom-model')).toEqual([])
    expect(speechVoiceOptions('dashscope','qwen3-tts-flash-realtime')).toEqual([])
    expect(speechVoiceOptions('elevenlabs','multilingual')).toEqual([])
  })
  it('uses WAV for native Bailian, without changing keys or other services', () => {
    const patch = speechPresetPatch('dashscope')
    expect(patch).toMatchObject({ audio_model: 'qwen3-tts-flash', audio_format: 'wav', audio_voice: 'Cherry' })
    expect(patch).not.toHaveProperty('audio_api_key')
    expect(patch).not.toHaveProperty('audio_enabled')
    expect(Object.keys(patch).every(key => key.startsWith('audio_'))).toBe(true)
  })
  it('chooses a format each preset supports', () => {
    for (const provider of Object.keys(speechPresets) as Array<keyof typeof speechPresets>) {
      expect(speechPresets[provider].formats).toContain(speechPresetPatch(provider).audio_format)
    }
  })
  it('does not replace business-space or custom addresses with public regional defaults', () => {
    expect(selectedBailianSpeechRegion(bailianSpeechRegions.beijing + '/')).toBe('beijing')
    expect(selectedBailianSpeechRegion(bailianSpeechRegions.singapore)).toBe('singapore')
    expect(selectedBailianSpeechRegion('https://space.example.com/api/v1')).toBe('custom')
    expect(selectedBailianSpeechRegion('https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe('custom')
  })
  it.each([
    ['https://dashscope.aliyuncs.com/api/v1', 'qwen3-tts-flash', 'compatible', 'dashscope'],
    ['https://workspace.cn-beijing.maas.aliyuncs.com/api/v1', 'qwen3-tts-flash', 'compatible', 'dashscope'],
    ['https://custom.example/api/v1', 'qwen3-tts-flash', 'compatible', 'dashscope'],
    ['https://api.elevenlabs.io/v1', 'eleven_multilingual_v2', 'dashscope', 'elevenlabs'],
    ['https://custom.example/v1', 'eleven_multilingual_v2', 'compatible', 'elevenlabs'],
    ['https://eastasia.tts.speech.microsoft.com', 'azure-speech', 'compatible', 'azure'],
    ['https://custom.example/cognitiveservices/v1', 'custom', 'compatible', 'azure'],
    ['https://custom.example', 'azure-speech', 'compatible', 'azure'],
    ['https://easyvoice.ae/api/v1', 'kokoro-82m', 'azure', 'easyvoice'],
    ['https://api.siliconflow.cn/v1', 'FunAudioLLM/CosyVoice2-0.5B', 'dashscope', 'compatible'],
    ['http://localhost:8004/v1', 'local-tts', 'elevenlabs', 'compatible'],
    ['https://custom.example/v1/audio/speech', 'qwen3-tts-flash', 'dashscope', 'compatible'],
  ] as const)('infers %s / %s without a platform selector', (audio_base_url, audio_model, audio_provider, expected) => {
    expect(selectedSpeechProvider({ base_url: '', model: '', audio_base_url, audio_model, audio_provider })).toBe(expected)
  })
})
