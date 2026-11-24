import { activeConnectivityTest, getModelSettings, reportClientFailure, request, roleHeaders, verifyFaceDetection, type ModelSettings } from './api'
import { ReplyAudioPlayer } from './audio'
import { saveModuleDetection } from './moduleDetection'
import { emitTo } from '@tauri-apps/api/event'

export type ModuleId = 'persona' | 'memory' | 'brain' | 'tools' | 'vision' | 'hearing' | 'voice' | 'motion'
export const roleModules: Array<{ id: ModuleId; label: string; hint: string; enabled: keyof ModelSettings; tag: keyof ModelSettings }> = [
  { id: 'persona', label: '人设', hint: 'DIY 人物设定', enabled: 'persona_enabled', tag: 'persona_tag' },
  { id: 'memory', label: '记忆', hint: 'MemU 长期记忆', enabled: 'memory_enabled', tag: 'memory_tag' },
  { id: 'brain', label: '大脑', hint: '对话与理解', enabled: 'brain_enabled', tag: 'brain_tag' },
  { id: 'tools', label: '手脚', hint: 'MCP 与工具调用', enabled: 'tools_enabled', tag: 'tools_tag' },
  { id: 'vision', label: '视觉', hint: '摄像头与人脸检测', enabled: 'vision_enabled', tag: 'vision_tag' },
  { id: 'hearing', label: '听觉', hint: '语音识别', enabled: 'asr_enabled', tag: 'hearing_tag' },
  { id: 'voice', label: '语音', hint: '语音合成', enabled: 'audio_enabled', tag: 'voice_tag' },
  { id: 'motion', label: '动作', hint: '动作库与动作生成', enabled: 'motion_enabled', tag: 'motion_tag' },
]
export interface ModuleState {
  enabled?: boolean
  verified: boolean
  detail: string
  tag?: string
  provider_verified?: boolean
  client_verified?: boolean
  verification_stale?: boolean
  client_attempted?: boolean
  mcp_label?: string
  mcp_connected_count?: number
  mcp_configured_count?: number
}
export type ModuleStates = Partial<Record<ModuleId, ModuleState>>
const moduleFields: Record<ModuleId, Array<keyof ModelSettings>> = {
  brain: ['brain_connection_mode', 'base_url', 'model', 'api_key'],
  persona: ['persona_connection_mode', 'persona_template', 'persona_text',
    'persona_embedding_base_url', 'persona_embedding_model', 'persona_embedding_api_key', 'persona_local_provider'],
  memory: ['memory_connection_mode', 'memory_provider',
    'memory_path', 'memory_embedding_base_url', 'memory_embedding_model',
    'memory_embedding_api_key', 'memory_local_provider'],
  tools: ['tools_connection_mode', 'tools_mcp_config'],
  vision: ['vision_connection_mode', 'vision_local_provider', 'vision_camera_id',
    'vision_base_url', 'vision_model', 'vision_api_key'],
  hearing: ['hearing_connection_mode', 'hearing_local_provider', 'asr_provider', 'asr_base_url', 'asr_model', 'asr_api_key', 'asr_language'],
  voice: ['voice_connection_mode', 'audio_provider', 'audio_base_url', 'audio_model', 'audio_api_key',
    'audio_voice', 'audio_format', 'audio_speed', 'audio_sample_rate'],
  motion: ['motion_connection_mode', 'motion_mode', 'motion_duration_mode', 'motion_duration',
    'motion_provider', 'motion_worker_url', 'motion_worker_api_key', 'motion_api_base_url',
    'motion_api_model', 'motion_api_key'],
}
/** Saving one page must not silently save drafts (especially keys) from another. */
export function moduleSettingsPatch(settings: ModelSettings, id: ModuleId): Partial<ModelSettings> {
  return Object.fromEntries(moduleFields[id].filter(field => settings[field] !== undefined).map(field => [field, settings[field]]))
}
export function moduleEnabled(settings: ModelSettings, id: ModuleId): boolean {
  const value = settings[roleModules.find(item => item.id === id)!.enabled]
  return id === 'hearing' || id === 'voice' ? value === true : value !== false
}
export function moduleStatusText(state?: ModuleState): string {
  return !state ? '未检测' : state.enabled === false ? '已停用' : state.verified ? '正常'
    : moduleStatusUnknown(state) ? '待复检' : '异常'
}
export function moduleStatusUnknown(state?: ModuleState): boolean {
  return !state || state.verification_stale === true ||
    /尚未|未检测|未验证|过期|等待.*验证|配置.*改变/.test(state.detail || '')
}

/** The visible module badge is derived from the configured provider model.
 * Legacy *_tag values stay in storage for compatibility, but are no longer
 * edited by users or shown as a second source of truth. */
export function moduleModelName(settings: ModelSettings, id: ModuleId): string {
  if (id === 'tools' && settings.tools_mcp_config) {
    const count = Object.keys(settings.tools_mcp_config.mcpServers || {}).length
    return count ? `MCP(0/${count})` : '未配置服务'
  }
  if (id === 'vision' && settings.vision_local_provider === 'built_in') return 'BlazeFace'
  if (id === 'persona' && settings.persona_local_provider === 'built_in') return 'BGE'
  if (id === 'memory' && settings.memory_local_provider === 'built_in') return 'BGE'
  if (id === 'hearing' && settings.hearing_local_provider === 'built_in') return 'SenseVoice'
  const value = id === 'brain' ? settings.model
    : id === 'persona' ? settings.persona_embedding_model
      : id === 'memory' ? settings.memory_embedding_model || settings.memory_llm_model
        : id === 'tools' ? settings.tools_mcp_url
          : id === 'vision' ? settings.vision_model
            : id === 'hearing' ? settings.asr_model
              : id === 'voice' ? settings.audio_model
                : id === 'motion' ? settings.motion_api_model || settings.motion_worker_url
                  : ''
  const text = String(value || '').trim()
  if (!text) return id === 'tools' ? '未配置服务' : id === 'motion' ? 'HY-Motion' : '未配置模型'
  try {
    const parsed = new URL(text)
    return parsed.hostname + (parsed.port ? `:${parsed.port}` : '')
  } catch {
    return text.split(/[\\/]/).pop() || text
  }
}
export async function moduleStates(roleId: string): Promise<ModuleStates> {
  const pairs = await Promise.all(roleModules.map(async item => {
    try {
      const state = await request<ModuleState>(`/api/modules/${item.id}/status`, { headers: roleHeaders(roleId) })
      return [item.id, { ...state, verified: state.verified === true }] as const
    } catch (error) {
      return [item.id, { verified: false, detail: error instanceof Error ? error.message : '状态读取失败' }] as const
    }
  }))
  return Object.fromEntries(pairs)
}

function recordDetection(roleId: string, id: ModuleId, result: ModuleState, signal?: AbortSignal) {
  if (signal?.aborted) return
  saveModuleDetection(roleId, id, result)
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void Promise.all(['home', 'settings'].map(target =>
      emitTo(target, 'deskaura:module-status-changed', roleId).catch(() => {})))
  }
}

/** A role-scoped active check. Provider response alone never proves audio or FBX playback. */
export async function testRoleModule(id: ModuleId, roleId: string,
  options: { signal?: AbortSignal; visionCameraId?: string; beforeVisionVerify?: Promise<void> } = {}): Promise<ModuleState> {
  try {
    const headers = roleHeaders(roleId)
    if (id === 'brain' || id === 'hearing') {
      await activeConnectivityTest(id === 'brain' ? 'chat' : 'recognition', roleId)
    } else if (id === 'voice') {
      const player = new ReplyAudioPlayer()
      try { await player.verify(undefined, { silent: true, roleId }) }
      finally { player.dispose() }
    } else if (id === 'motion') {
      // This helper validates downloaded data before sending a client receipt.
      const { verifyRoleMotion } = await import('./roleMotionVerification')
      await verifyRoleMotion(roleId)
    } else if (id === 'vision') {
      const deviceId = options.visionCameraId ?? (await getModelSettings(roleId)).vision_camera_id ?? ''
      try {
        const { detectFaceSample } = await import('./faceTracking')
        const sample = await detectFaceSample(deviceId, options.signal)
        if (sample.faces < 1) throw new Error('摄像头已打开，但没有检测到人脸')
        await options.beforeVisionVerify
        if (options.signal?.aborted) throw new Error('视觉检测已取消')
        await verifyFaceDetection(sample, roleId, deviceId)
      } catch (error) {
        if (!options.signal?.aborted) await reportClientFailure('vision', roleId)
        throw error
      }
    } else {
      await request(`/api/modules/${id}/test`, { method: 'POST', headers, body: '{}' })
    }
    const result = await request<ModuleState>(`/api/modules/${id}/status`, { headers })
    recordDetection(roleId, id, result, options.signal)
    return result
  } catch (error) {
    recordDetection(roleId, id, {
      verified: false, detail: error instanceof Error ? error.message : '检测失败',
    }, options.signal)
    throw error
  }
}

export async function ensureRoleRecord(role: { id: string; name: string; description?: string; path?: string; sourcePath?: string }) {
  return request(`/api/roles/${encodeURIComponent(role.id)}`, {
    method: 'POST', headers: roleHeaders(role.id),
    body: JSON.stringify({ name: role.name, description: role.description || '', model_path: role.path || role.sourcePath || '' }),
  })
}
