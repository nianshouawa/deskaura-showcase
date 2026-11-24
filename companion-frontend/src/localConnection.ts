import type { ModelSettings } from './api'
import type { ModuleId } from './roleModules'

/** Keep explicitly configured loopback/LAN services when changing tabs. */
export function privateServiceAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false
  try {
    const url = new URL(address)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
    if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true
    if (/^(?:fc|fd)[\da-f]{2}:|^fe[89ab][\da-f]:/i.test(host)) return true
    const parts = host.split('.').map(Number)
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
    return parts[0] === 127 || parts[0] === 10 || parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31 ||
      parts[0] === 192 && parts[1] === 168 || parts[0] === 169 && parts[1] === 254
  } catch { return false }
}

/** A local external connection must never keep a public cloud endpoint. */
export function localConnectionPatch(settings: ModelSettings, module: ModuleId): Partial<ModelSettings> {
  const value = settings as unknown as Record<string, unknown>
  if (['persona', 'memory', 'vision', 'hearing'].includes(module) && value[`${module}_local_provider`] === 'built_in') return {}
  const fields = {
    brain: ['base_url', 'http://127.0.0.1:11434/v1'],
    persona: ['persona_embedding_base_url', 'http://127.0.0.1:11434/v1'],
    memory: ['memory_embedding_base_url', 'http://127.0.0.1:11434/v1'],
    tools: ['tools_mcp_url', ''],
    vision: ['vision_base_url', 'http://127.0.0.1:1234/v1'],
    hearing: ['asr_base_url', 'http://127.0.0.1:8003/v1'],
    voice: ['audio_base_url', 'http://127.0.0.1:8004/v1'],
    motion: ['motion_worker_url', 'http://127.0.0.1:6006'],
  } satisfies Record<ModuleId, [keyof ModelSettings, string]>
  const [field, fallback] = fields[module]
  const patch: Partial<ModelSettings> = privateServiceAddress(value[field]) ? {} : { [field]: fallback }
  if (module === 'hearing' && settings.asr_provider === 'dashscope') {
    patch.asr_provider = 'compatible'
    if (!privateServiceAddress(settings.asr_base_url)) patch.asr_model = 'whisper-1'
  }
  if (module === 'voice' && settings.audio_provider !== 'compatible') {
    patch.audio_provider = 'compatible'
    if (!privateServiceAddress(settings.audio_base_url)) {
      patch.audio_model = ''
      patch.audio_voice = ''
    }
  }
  return patch
}
