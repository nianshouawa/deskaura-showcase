import type { ModelSettings } from './api'

export type SpeechProvider = 'compatible' | 'easyvoice' | 'elevenlabs' | 'azure' | 'dashscope'
export const easyVoices = ['af_aoede', 'af_heart', 'af_bella', 'af_nova', 'af_sky', 'am_adam', 'am_eric', 'am_michael', 'bf_emma', 'bm_daniel', 'ar_m1', 'ar_f1']
// Official Qwen-TTS non-realtime qwen3-tts-flash voice list, checked 2026-11-04.
// Account/region availability remains a provider decision, not a connection proof.
export const bailianVoices = ['Cherry','Serena','Ethan','Chelsie','Momo','Vivian','Moon','Maia','Kai','Nofish','Bella','Jennifer','Ryan','Katerina','Aiden','Eldric Sage','Mia','Mochi','Bellona','Vincent','Bunny','Neil','Elias','Arthur','Nini','Seren','Pip','Stella','Bodega','Sonrisa','Alek','Dolce','Sohee','Ono Anna','Lenn','Emilien','Andre','Radio Gol','Jada','Dylan','Li','Marcus','Roy','Peter','Sunny','Eric','Rocky','Kiki']
const bailianVoiceNames = ['芊悦','苏瑶','晨煦','千雪','茉兔','十三','月白','四月','凯','不吃鱼','萌宝','詹妮弗','甜茶','卡捷琳娜','艾登','沧明子','乖小妹','沙小弥','燕铮莺','田叔','萌小姬','阿闻','墨讲师','徐大爷','邻家妹妹','小婉','顽屁小孩','少女阿月','博德加','索尼莎','阿列克','多尔切','素熙','小野杏','莱恩','埃米尔安','安德雷','拉迪奥·戈尔','上海·阿珍','北京·晓东','南京·老李','陕西·秦川','闽南·阿杰','天津·李彼得','四川·晴儿','四川·程川','粤语·阿强','粤语·阿清']
export function speechVoiceOptions(provider: SpeechProvider, model: string) {
  if (provider === 'dashscope' && /^qwen3-tts-flash(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return bailianVoices.map((value,index) => ({ value, label: bailianVoiceNames[index] || value, group: 'Qwen3-TTS 预置音色' }))
  if (provider === 'easyvoice') return easyVoices.map(value => ({ value, label: value, group: '预置音色' }))
  return []
}
export const bailianSpeechRegions = {
  beijing: 'https://dashscope.aliyuncs.com/api/v1',
  singapore: 'https://dashscope-intl.aliyuncs.com/api/v1',
}
export const speechPresets: Record<SpeechProvider, { label: string; url: string; model: string; voice: string; formats: NonNullable<ModelSettings['audio_format']>[]; note: string }> = {
  compatible: { label: '兼容语音接口', url: 'https://api.openai.com/v1', model: 'gpt-4o-mini-tts', voice: 'alloy', formats: ['mp3', 'wav', 'pcm', 'opus', 'aac', 'flac'], note: '适合 POST /audio/speech + Bearer 密钥的服务。模型与音色须由服务商提供，不同平台不能混用。' },
  easyvoice: { label: 'EasyVoice', url: 'https://easyvoice.ae/api/v1', model: 'kokoro-82m', voice: 'af_aoede', formats: ['mp3', 'wav', 'pcm'], note: '免费音色建议 af_aoede；alloy 需要付费套餐。当前未提供中文音色：请用英文测试；中文对话请选择支持中文的平台。' },
  elevenlabs: { label: 'ElevenLabs', url: 'https://api.elevenlabs.io/v1', model: 'eleven_multilingual_v2', voice: '', formats: ['mp3', 'pcm'], note: '使用 xi-api-key 认证。填写账户可用的 Voice ID；多语言模型支持中文。语速按平台要求限制在 0.7–1.2。' },
  azure: { label: 'Azure Speech', url: 'https://YOUR-REGION.tts.speech.microsoft.com', model: 'azure-speech', voice: 'zh-CN-XiaoxiaoNeural', formats: ['mp3', 'wav', 'pcm'], note: '替换 YOUR-REGION 为资源所在区域；使用 Speech 资源密钥，按 SSML 协议调用。中文音色示例 zh-CN-XiaoxiaoNeural。' },
  dashscope: { label: '百炼 / DashScope', url: bailianSpeechRegions.beijing, model: 'qwen3-tts-flash', voice: 'Cherry', formats: ['wav'], note: '使用百炼原生 Qwen TTS，中文推荐 Cherry；API Key 须与北京 / 新加坡地域一致。输出 WAV，不使用兼容 /audio/speech。' },
}
export function selectedSpeechProvider(settings: ModelSettings): SpeechProvider {
  const model = (settings.audio_model || '').trim().toLowerCase()
  let host = '', path = ''
  try {
    const address = new URL(settings.audio_base_url || '')
    host = address.hostname.toLowerCase().replace(/\.$/, '')
    path = address.pathname.replace(/\/+$/, '').toLowerCase()
  } catch { /* The form can contain an incomplete address while editing. */ }
  if (host === 'easyvoice.ae' || host.endsWith('.easyvoice.ae')) return 'easyvoice'
  if (host === 'elevenlabs.io' || host.endsWith('.elevenlabs.io')) return 'elevenlabs'
  if (host.endsWith('.tts.speech.microsoft.com') || host.endsWith('.tts.speech.azure.cn') ||
      path.endsWith('/cognitiveservices/v1')) return 'azure'
  if (['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com'].includes(host) ||
      host.endsWith('.maas.aliyuncs.com') || path.endsWith('/services/aigc/multimodal-generation/generation')) return 'dashscope'
  if (path.endsWith('/audio/speech')) return 'compatible'
  if (/\/text-to-speech(?:\/[^/]+)?$/.test(path) || model.startsWith('eleven_')) return 'elevenlabs'
  if (['azure', 'azure-speech', 'azure-tts'].includes(model)) return 'azure'
  if (model.startsWith('qwen3-tts-') || model.startsWith('qwen-tts')) return 'dashscope'
  return 'compatible'
}

export function speechPresetPatch(provider: SpeechProvider): Partial<ModelSettings> {
  const preset = speechPresets[provider]
  // Platform defaults never enable speech, replace credentials or touch ASR.
  return { audio_provider: provider, audio_base_url: preset.url, audio_model: preset.model,
    audio_voice: preset.voice, audio_format: preset.formats[0], audio_speed: 1, audio_sample_rate: 24000 }
}

export function selectedBailianSpeechRegion(base: string): keyof typeof bailianSpeechRegions | 'custom' {
  const normalized = base.trim().replace(/\/+$/, '')
  return (Object.keys(bailianSpeechRegions) as Array<keyof typeof bailianSpeechRegions>)
    .find(region => bailianSpeechRegions[region] === normalized) || 'custom'
}
