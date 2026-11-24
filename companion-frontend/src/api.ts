import type { ChatAttachment, ChatCapabilities } from './chatAttachments'
import { readEventStream } from './chatStreaming'
import { emitTo } from '@tauri-apps/api/event'
import { localFetch } from './localFetch'
export type { ChatCapabilities } from './chatAttachments'
export interface Motion {
  id: string
  role_id?: string
  kind: 'preset' | 'glb' | 'hymotion' | 'fbx'
  url: string
  duration: number
  source_duration?: number
  duration_source?: string
  reply_motion?: boolean
  playback?: 'once' | 'speech'
  loop?: boolean
  emotion?: string | null
  archive_fallback?: boolean
  generation_error?: string | null
}

export interface SystemAction {
  type: string
  app?: string
  url?: string
  command?: string
}

export interface Reply {
  verification_id?: string | null
  text: string
  emotion: string
  motion: Motion
  demo_mode: boolean
  system_action?: SystemAction | null
  file_approval?: FileApproval | null
  gaze_target?: 'mouse' | 'face'
  media_request?: { source: 'screen' | 'camera'; kind: 'snapshot' | 'record'; duration?: number } | null
}
export interface FileApproval { id: string; operation: string; path: string; preview: string; runtime?: string; timeout?: number; warning?: string }
export type Attachment = ChatAttachment
export interface ChatSession { id: string; title: string; updated_at: string }

export interface ModelSettings {
  base_url: string
  model: string
  api_key?: string
  api_key_masked?: string
  has_api_key?: boolean
  ready?: boolean
  provider?: 'openai' | 'ollama'
  /** HY-Motion 动作时长（秒），0.5–12；manual 模式下生效。 */
  motion_duration?: number
  /** 自动只使用动作模型原生预测，不支持时明确失败；手动使用固定值。 */
  motion_duration_mode?: 'auto' | 'manual'
  /** 云端 worker 地址；保存后动作服务会直接使用它。 */
  motion_worker_url?: string
  motion_worker_api_key?: string
  motion_worker_api_key_masked?: string
  motion_worker_has_api_key?: boolean
  motion_mode?: 'online' | 'offline' | 'hybrid'
  gaze_mode?: 'mouse' | 'face' | 'auto'
  gaze_enabled?: boolean
  standby_enabled?: boolean
  execution_enabled?: boolean
  local_operation_mode?: 'request_approval' | 'help_me_approve' | 'full_approval'
  local_sandbox_enabled?: boolean
  local_sandbox_mode?: 'read_only' | 'workspace_write' | 'full_access'
  click_feedback_enabled?: boolean
  brain_enabled?: boolean
  persona_enabled?: boolean
  memory_enabled?: boolean
  motion_enabled?: boolean
  tools_enabled?: boolean
  vision_enabled?: boolean
  audio_enabled?: boolean
  audio_provider?: 'compatible' | 'easyvoice' | 'elevenlabs' | 'azure' | 'dashscope'
  audio_base_url?: string
  audio_model?: string
  audio_voice?: string
  audio_api_key?: string
  audio_has_api_key?: boolean
  audio_api_key_masked?: string
  audio_format?: 'mp3' | 'wav' | 'pcm' | 'opus' | 'aac' | 'flac'
  audio_speed?: number
  audio_sample_rate?: number
  audio_revision?: number
  asr_enabled?: boolean
  asr_provider?: 'compatible' | 'dashscope'
  asr_base_url?: string
  asr_model?: string
  asr_language?: string
  asr_api_key?: string
  asr_has_api_key?: boolean
  asr_api_key_masked?: string
  motion_provider?: 'hymotion' | 'tencent_tokenhub'
  motion_api_base_url?: string
  motion_api_model?: string
  motion_api_key?: string
  motion_has_api_key?: boolean
  motion_api_key_masked?: string
  chat_image_mode?: 'auto' | 'on' | 'off'
  bubble_enabled?: boolean
  file_access_enabled?: boolean
  file_access_root?: string
  offended?: boolean
  brain_tag?: string
  persona_tag?: string
  memory_tag?: string
  hearing_tag?: string
  voice_tag?: string
  motion_tag?: string
  tools_tag?: string
  vision_tag?: string
  brain_connection_mode?: 'cloud' | 'local'
  persona_connection_mode?: 'cloud' | 'local'
  memory_connection_mode?: 'cloud' | 'local'
  hearing_connection_mode?: 'cloud' | 'local'
  voice_connection_mode?: 'cloud' | 'local'
  motion_connection_mode?: 'cloud' | 'local'
  tools_connection_mode?: 'cloud' | 'local'
  vision_connection_mode?: 'cloud' | 'local'
  persona_local_provider?: 'built_in' | 'external'
  memory_local_provider?: 'built_in' | 'external'
  hearing_local_provider?: 'built_in' | 'external'
  vision_local_provider?: 'built_in' | 'external'
  vision_camera_id?: string
  vision_base_url?: string
  vision_model?: string
  vision_api_key?: string
  vision_api_key_masked?: string
  vision_has_api_key?: boolean
  tools_mcp_url?: string
  tools_mcp_api_key?: string
  tools_mcp_api_key_masked?: string
  tools_mcp_has_api_key?: boolean
  tools_mcp_config?: { mcpServers: Record<string, Record<string, unknown>> }
  persona_template?: string
  persona_text?: string
  persona_embedding_base_url?: string
  persona_embedding_model?: string
  persona_embedding_api_key?: string
  persona_embedding_api_key_masked?: string
  persona_embedding_has_api_key?: boolean
  memory_provider?: 'memu'
  memory_path?: string
  memory_llm_tag?: string
  memory_llm_base_url?: string
  memory_llm_model?: string
  memory_llm_api_key?: string
  memory_llm_api_key_masked?: string
  memory_llm_has_api_key?: boolean
  memory_embedding_tag?: string
  memory_embedding_base_url?: string
  memory_embedding_model?: string
  memory_embedding_api_key?: string
  memory_embedding_api_key_masked?: string
  memory_embedding_has_api_key?: boolean
  memory_retrieve_method?: 'rag' | 'llm'
}

// Browser previews (including tunnels) use the Vite proxy on their own origin.
// Tauri and unit tests retain the local backend address.
const browserPreview = typeof window !== 'undefined'
  && !('__TAURI_INTERNALS__' in window)
  && import.meta.env.MODE !== 'test'
const baseUrl = import.meta.env.VITE_AGENT_API_URL || (browserPreview ? '' : 'http://127.0.0.1:8000')

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const longRequest = path === '/api/chat/send' || path.endsWith('/test') ||
    path.startsWith('/api/files/approval/') || path.startsWith('/api/tools/mcp')
  const response = await localFetch(`${baseUrl}${path}`, {
    signal: AbortSignal.timeout(longRequest ? 180000 : path.endsWith('/status') ? 30000 : 10000),
    ...options,
    headers: { 'Content-Type': 'application/json', ...roleHeaders(), ...options?.headers },
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    const detail = typeof failure.detail === 'string' ? failure.detail : response.status === 422 ? '输入或附件格式不符合要求，请调整后重试。' : `请求失败：${response.status}`
    throw new Error(detail)
  }
  return response.json()
}

function storedRoleId(): string | undefined {
  try {
    return typeof localStorage !== 'undefined'
      ? localStorage.getItem('deskaura-active-model') || undefined
      : undefined
  } catch { return undefined }
}

/** Capture this once before an asynchronous operation, not again for its receipt. */
export function currentRoleId(): string { return storedRoleId() || 'default' }

export function roleHeaders(roleId?: string): Record<string, string> {
  const id = roleId ?? storedRoleId()
  return id ? { 'X-DeskAura-Role': id } : {}
}

export async function confirmConnectivity(token: string, success = true, roleId?: string): Promise<boolean> {
  const result = await request<{ accepted: boolean }>('/api/connectivity/receipt', { method: 'POST', body: JSON.stringify({ token, success }), headers: roleHeaders(roleId) })
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('deskaura:connectivity-changed'))
  await notifyModuleStatus(roleId)
  return result.accepted
}
export async function notifyModuleStatus(roleId = currentRoleId()) {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    await Promise.all(['home', 'settings'].map(target =>
      emitTo(target, 'deskaura:module-status-changed', roleId).catch(() => {})))
  }
}
export async function verifyFaceDetection(sample: { faces: number; confidence: number }, roleId: string, cameraId?: string): Promise<void> {
  const result = await request<{ text: string; verification_id?: string }>('/api/modules/vision/test', {
    method: 'POST', headers: roleHeaders(roleId),
    body: JSON.stringify({ ...sample, ...(cameraId !== undefined ? { camera_id: cameraId } : {}) }),
  })
  if (!result.text?.trim() || !result.verification_id || !await confirmConnectivity(result.verification_id, true, roleId)) {
    throw new Error('视觉检测未完成，请重新检测')
  }
}
export async function reportClientFailure(kind: 'chat' | 'recognition' | 'speech' | 'vision', roleId?: string) {
  await request(`/api/connectivity/${kind}/failure`, { method: 'POST', headers: roleHeaders(roleId) }).catch(() => {})
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('deskaura:connectivity-changed'))
}
export async function activeConnectivityTest(kind: 'chat' | 'recognition', roleId = currentRoleId()): Promise<string> {
  const result = await request<{ verification_id?: string; text?: string }>(`/api/connectivity/${kind}/test`, { method: 'POST', body: '{}', headers: roleHeaders(roleId) })
  if (!result.verification_id || !result.text?.trim()) throw new Error('检测未返回有效结果')
  if (!await confirmConnectivity(result.verification_id, true, roleId)) throw new Error('配置已改变，请重新检测')
  return result.text
}
export async function sendChat(message: string, sessionId: string, userEmotion?: string, attachments: Attachment[] = [], roleId = currentRoleId()): Promise<Reply> {
  const reply = await request<Reply>('/api/chat/send', {
    method: 'POST', headers: roleHeaders(roleId),
    body: JSON.stringify({ message, session_id: sessionId, role_id: roleId, user_emotion: userEmotion, attachments }),
  })
  if (reply.verification_id && reply.text.trim() && !reply.demo_mode) await confirmConnectivity(reply.verification_id, true, roleId).catch(() => false)
  return reply
}

export interface ChatProgress {
  type: 'text_done' | 'motion'
  motion?: Motion
  emotion?: string
  gaze_target?: 'mouse' | 'face'
}
export async function streamChat(message: string, sessionId: string, attachments: Attachment[], onDelta: (text: string) => void, signal?: AbortSignal, onProgress?: (event: ChatProgress) => void, roleId = currentRoleId()): Promise<Reply> {
  const response = await fetch(`${baseUrl}/api/chat/stream`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...roleHeaders(roleId) },
    body: JSON.stringify({ message, session_id: sessionId, role_id: roleId, attachments }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240000)]) : AbortSignal.timeout(240000),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}))
    throw new Error(typeof failure.detail === 'string' ? failure.detail : `回复失败：${response.status}`)
  }
  let reply: Reply | undefined
  await readEventStream(response, (event, data) => {
    const value = data as Record<string, unknown>
    if (event === 'delta' && typeof value.text === 'string') onDelta(value.text)
    else if (event === 'text_done') onProgress?.({ type: 'text_done' })
    else if (event === 'motion' && value.motion && typeof value.motion === 'object') onProgress?.({ type: 'motion', motion: value.motion as Motion, emotion: typeof value.emotion === 'string' ? value.emotion : 'neutral', gaze_target: value.gaze_target === 'mouse' ? 'mouse' : 'face' })
    else if (event === 'reply') reply = value as unknown as Reply
    else if (event === 'error') throw new Error(typeof value.detail === 'string' ? value.detail : '回复中断，请重试')
  }, signal)
  if (!reply || typeof reply.text !== 'string' || !reply.motion) throw new Error('回复未完成，请重试')
  if (reply.verification_id && reply.text.trim() && !reply.demo_mode) await confirmConnectivity(reply.verification_id, true, roleId).catch(() => false)
  return reply
}

export const listSessions = (roleId = currentRoleId()) => request<{ sessions: ChatSession[] }>(`/api/chat/sessions?role_id=${encodeURIComponent(roleId)}`, { headers: roleHeaders(roleId) })
export const createSession = (roleId = currentRoleId()) => request<ChatSession>(`/api/chat/sessions?role_id=${encodeURIComponent(roleId)}`, { method: 'POST', headers: roleHeaders(roleId) })
export const getSession = (id: string, roleId = currentRoleId()) => request<{ messages: { role: 'user' | 'assistant'; content: string }[]; file_approval?: FileApproval | null }>(`/api/chat/sessions/${encodeURIComponent(id)}`, { headers: roleHeaders(roleId) })
export const renameSession = (id: string, title: string, roleId = currentRoleId()) => request(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', headers: roleHeaders(roleId), body: JSON.stringify({ title }) })
export const deleteSession = (id: string, roleId = currentRoleId()) => request(`/api/chat/sessions/${encodeURIComponent(id)}`, { method: 'DELETE', headers: roleHeaders(roleId) })
export const decideFile = (token: string, session_id: string, approve: boolean, roleId = currentRoleId()) => request<{
  text: string; file_approval?: FileApproval | null; system_action?: SystemAction | null;
  media_request?: Reply['media_request'];
}>(`/api/files/approval/${token}`, { method: 'POST', headers: roleHeaders(roleId), body: JSON.stringify({ session_id, approve }) })
export const clearAsrKey = () => request<ModelSettings>('/api/settings/asr/key', { method: 'DELETE' })
export const clearMotionKey = () => request<ModelSettings>('/api/settings/motion/key', { method: 'DELETE' })
export const getChatCapabilities = () => request<ChatCapabilities>('/api/chat/capabilities')
export async function transcribeAudio(wav: Blob, signal?: AbortSignal, roleId = currentRoleId()): Promise<string> {
  const response = await fetch(`${baseUrl}/api/audio/transcribe`, { method: 'POST', body: wav, headers: { 'Content-Type': 'audio/wav', ...roleHeaders(roleId) }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(100000)]) : AbortSignal.timeout(100000) })
  const value = await response.json()
  if (!response.ok) throw new Error(value.detail || `语音识别失败：${response.status}`)
  if (typeof value.text !== 'string' || !value.text.trim()) throw new Error('识别接口未返回有效文字')
  if (value.verification_id) await confirmConnectivity(value.verification_id, true, roleId).catch(() => false)
  return value.text
}

export function getModelSettings(roleId?: string): Promise<ModelSettings> {
  return request('/api/settings/model', { headers: roleHeaders(roleId) })
}

export async function saveModelSettings(settings: Partial<ModelSettings>, roleId?: string): Promise<ModelSettings> {
  const id = roleId ?? currentRoleId()
  const saved = await request<ModelSettings>('/api/settings/model', { method: 'PUT', body: JSON.stringify(settings), headers: roleHeaders(id) })
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    void Promise.all(['main', 'dialog', 'home', 'settings'].map(target =>
      emitTo(target, 'deskaura:runtime-settings', { roleId: id, settings: saved, fields: Object.keys(settings) }).catch(() => {})))
  }
  return saved
}

export async function setInteractionOffended(offended: boolean, roleId = currentRoleId()): Promise<boolean> {
  const result = await request<{ offended: boolean }>('/api/interaction/offended', {
    method: 'POST', headers: roleHeaders(roleId),
    body: JSON.stringify({ offended, role_id: roleId }),
  })
  return result.offended
}
export async function getInteractionOffended(roleId = currentRoleId()): Promise<boolean> {
  const result = await request<{ offended: boolean }>(`/api/interaction/offended?role_id=${encodeURIComponent(roleId)}`, { headers: roleHeaders(roleId) })
  return result.offended
}

export function clearModelKey(): Promise<ModelSettings> {
  return request('/api/settings/model/key', { method: 'DELETE' })
}

export function clearAudioKey(): Promise<ModelSettings> {
  return request('/api/settings/audio/key', { method: 'DELETE' })
}
export function getMotionSettings(): Promise<ModelSettings> {
  return request('/api/settings/motion')
}
export async function saveMotionSettings(settings: ModelSettings): Promise<ModelSettings> {
  return request<ModelSettings>('/api/settings/motion', { method: 'PUT', body: JSON.stringify(settings) })
}

export function getProactiveMessages(): Promise<{ messages: Array<{ type: string; text: string }> }> {
  return request('/api/proactive')
}

// —— 本地服务状态探测 ——

export interface ServiceStatus {
  name: string
  url: string
  running: boolean
  online?: boolean
  latencyMs: number | null
  detail?: string
  section?: string
  state?: 'unknown' | 'normal' | 'error'
}

const motionServiceUrl = 'http://127.0.0.1:8002'

/** Verification belongs to the service, not to a particular WebView's memory. */
async function motionServiceStatus(roleId = currentRoleId()): Promise<ServiceStatus> {
  const start = Date.now()
  try {
    const response = await fetch(`${motionServiceUrl}/api/motion/status`, { headers: roleHeaders(roleId), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error()
    const value = await response.json()
    const verified = value.configured === true && value.provider_verified === true &&
      value.client_verified === true && value.verified === true
    return { name: '动作模型', url: motionServiceUrl, online: true, running: verified,
      state: verified ? 'normal' : value.configured === true && value.client_attempted === false ? 'unknown' : 'error',
      latencyMs: Date.now() - start, section: 'settings-motion',
      detail: typeof value.detail === 'string' && value.detail ? value.detail : '云端尚未验证' }
  } catch {
    return { name: '动作模型', url: motionServiceUrl, online: false, running: false,
      state: 'error', latencyMs: null, section: 'settings-motion', detail: '动作状态读取失败' }
  }
}

async function confirmMotionReadback(resultId: string, success: boolean, roleId: string): Promise<boolean> {
  const response = await fetch(`${motionServiceUrl}/api/motion/receipt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...roleHeaders(roleId) },
    body: JSON.stringify({ result_id: resultId, success }), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) return false
  const value = await response.json()
  return value.accepted === true
}

/**
 * Speech recognition and generation have independent local status endpoints.
 * External generation is explicit and off by default; configuration is not proof.
 */
export async function getServicesStatus(gpuWorkerUrl?: string, verifyCloud = false): Promise<ServiceStatus[]> {
  const roleId = currentRoleId()
  const results: ServiceStatus[] = await Promise.all([
    { name: '对话模型', path: '/api/chat/status', section: 'settings-chat' },
    { name: '语音识别', path: '/api/audio/recognition/status', section: 'settings-recognition' },
    { name: '语音合成', path: '/api/audio/speech/status', section: 'settings-speech' },
  ].map(async target => {
    const start = Date.now()
    try {
      const response = await fetch(`${baseUrl}${target.path}`, { headers: roleHeaders(roleId), signal: AbortSignal.timeout(4000) })
      if (!response.ok) throw new Error()
      const value = await response.json()
      const verified = value.verified === true && value.client_verified === true && value.configured === true &&
        (target.section === 'settings-chat' || value.enabled === true && value.provider_verified === true)
      return { name: target.name, url: `${baseUrl}${target.path}`, online: true, running: verified,
        state: verified ? 'normal' : value.configured === true && value.enabled !== false && value.client_attempted === false ? 'unknown' : 'error',
        latencyMs: Date.now() - start, detail: value.detail || '尚未完成全链路验证', section: target.section }
    } catch {
      return { name: target.name, url: `${baseUrl}${target.path}`, online: false, running: false,
        latencyMs: null, detail: '本地接口不可用', section: target.section }
    }
  }))
  const startLocal = Date.now()
  const [motionStatus, memory] = await Promise.all([
    motionServiceStatus(roleId),
    (async () => {
      try {
        const response = await fetch('http://127.0.0.1:8001/api/memory/status', { headers: roleHeaders(roleId), signal: AbortSignal.timeout(4000) })
        if (!response.ok) throw new Error()
        const data = await response.json()
        return typeof data.memory_count === 'number' && Number.isFinite(data.memory_count) && typeof data.relationship_level === 'number'
      } catch { return false }
    })(),
  ])
  results.push(motionStatus, { name: '记忆服务', url: 'http://127.0.0.1:8001', running: memory, online: memory,
    latencyMs: memory ? Date.now() - startLocal : null, section: 'settings-services', detail: memory ? '已读取真实记忆与关系状态' : '记忆状态读取失败' })
  if (!verifyCloud) return results

  // This directory entry always verifies ONLINE generation, even in offline mode.
  // A readable local archive is not evidence of cloud connectivity.
  let cloudActive = false
  let detail = '云端未验证'
  let resultId = ''
  let receiptSent = false
  const start = Date.now()
  try {
    const response = await fetch(`${motionServiceUrl}/api/motion/cloud-test`, {
      method: 'POST', headers: roleHeaders(roleId), signal: AbortSignal.timeout(200000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const info = await response.json()
    detail = typeof info.detail === 'string' && info.detail ? info.detail : '验证失败'
    if (info.verified === true && ['hymotion', 'fbx'].includes(info.kind) &&
        typeof info.result_url === 'string' &&
        /^\/api\/motion\/(?:result|fbx)\/[a-zA-Z0-9-]+$/.test(info.result_url)) {
      resultId = info.result_url.split('/').pop()!
      const dataResponse = await fetch(`${motionServiceUrl}${info.result_url}`, {
        headers: roleHeaders(roleId), signal: AbortSignal.timeout(10000),
      })
      if (!dataResponse.ok) throw new Error('生成结果无法回读')
      if (info.kind === 'fbx') {
        const { parseTencentFbxMotion } = await import('./fbxMotion')
        parseTencentFbxMotion(await dataResponse.arrayBuffer())
        cloudActive = true
      } else {
        const data = await dataResponse.json()
        cloudActive = Number.isInteger(info.frames) && info.frames > 0 && Number.isFinite(info.fps) && info.fps > 0 &&
          Array.isArray(data.poses) && data.poses.length === info.frames &&
          data.fps === info.fps && data.poses.every((frame: unknown) =>
            Array.isArray(frame) && frame.length >= 66 && frame.length % 3 === 0 &&
            frame.every((v: unknown) => typeof v === 'number' && Number.isFinite(v)))
      }
      detail = cloudActive ? '正常 · 在线生成与数据回读通过' : '回读骨骼数据无效'
      const accepted = await confirmMotionReadback(resultId, cloudActive, roleId)
      receiptSent = true
      if (cloudActive && !accepted) { cloudActive = false; detail = '验证结果未确认或配置已改变' }
      if (cloudActive) {
        const shared = await motionServiceStatus(roleId)
        cloudActive = shared.running
        detail = shared.detail || (cloudActive ? detail : '云端验证未通过')
        Object.assign(motionStatus, shared)
      }
    }
  } catch (error) {
    cloudActive = false
    detail = `异常：${error instanceof Error ? error.message : String(error)}`
  }
  if (resultId && !receiptSent) await confirmMotionReadback(resultId, false, roleId).catch(() => false)
  results.push({
    name: 'GPU 云端', url: gpuWorkerUrl || '动作服务配置地址',
    running: cloudActive, latencyMs: cloudActive ? Date.now() - start : null,
    detail,
  })
  motionStatus.running = cloudActive
  motionStatus.state = cloudActive ? 'normal' : 'error'
  motionStatus.detail = detail
  return results
}

export async function checkWorkerConnection(): Promise<{ reachable: boolean; ready: boolean; worker_url?: string; model?: string; automatic_duration?: boolean | null; detail: string }> {
  const response = await fetch('http://127.0.0.1:8002/api/motion/connection', { headers: roleHeaders(), signal: AbortSignal.timeout(12000) })
  if (!response.ok) throw new Error(`动作服务连接检查失败：HTTP ${response.status}`)
  return response.json()
}
