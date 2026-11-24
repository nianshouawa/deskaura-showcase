import type { ModelSettings } from './api'

export type RecognitionProvider = 'compatible' | 'dashscope'
export const recognitionPresets: Record<RecognitionProvider, { label: string; url: string; model: string; note: string }> = {
  compatible: { label: '通用语音转写 · multipart', url: 'https://api.siliconflow.cn/v1', model: 'FunAudioLLM/SenseVoiceSmall', note: '使用 POST /audio/transcriptions 和 Bearer 密钥，上传 WAV 文件。模型 ID 必须由该平台实际提供。' },
  dashscope: { label: '百炼 / DashScope', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3-asr-flash', note: '阿里云百炼：使用 Qwen3-ASR-Flash 音频消息协议，不走 /audio/transcriptions。请选择与 API Key 一致的地域；推荐粘贴百炼控制台的业务空间专属兼容模式地址。' },
}
export const dashscopeRegions = {
  beijing: { label: '北京 · 公共接入地址', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  singapore: { label: '新加坡 · 公共接入地址', url: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1' },
}
export function recognitionPresetPatch(provider: RecognitionProvider): Partial<ModelSettings> {
  const preset = recognitionPresets[provider]
  // Intentionally do not enable, replace credentials or change TTS / conversation fields.
  return { asr_provider: provider, asr_base_url: preset.url, asr_model: preset.model, asr_language: '' }
}
export function selectedDashscopeRegion(base: string): keyof typeof dashscopeRegions | 'custom' {
  try {
    const host = new URL(base).hostname
    if (host === 'dashscope.aliyuncs.com') return 'beijing'
    if (host === 'dashscope-intl.aliyuncs.com') return 'singapore'
  } catch { /* The user may still be typing an address. */ }
  return 'custom'
}
