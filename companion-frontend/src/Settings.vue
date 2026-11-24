<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { emitTo, listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { FileInput, FileOutput } from '@lucide/vue'
import ConfigPicker from './components/ConfigPicker.vue'
import ExpandableContent from './components/ExpandableContent.vue'
import RoleModulePanel from './components/RoleModulePanel.vue'
import LocalOperationPanel from './components/LocalOperationPanel.vue'
import McpServicesPanel from './components/McpServicesPanel.vue'
import { getModelSettings, request, roleHeaders, saveModelSettings, type ModelSettings } from './api'
import { listModels, updateModel, updateRoleConfig, type StoredModel } from './modelLibrary'
import { ensureRoleRecord, moduleModelName, moduleSettingsPatch, roleModules, testRoleModule, type ModuleId } from './roleModules'
import { selectedSpeechProvider, speechVoiceOptions } from './speechProviders'
import { isTauri } from './tauri'
import { safeRoleConfig } from './modelLibrary'
import { standbyLabels, standbyLibraryOptions, standbyMotion, standbyMotionIds, type StandbyId } from './standby'
import { motionConnectionPatch } from './motionConnection'
import { localFetch } from './localFetch'

type Section = 'role' | ModuleId
const query = new URLSearchParams(location.search)
function knownSection(value?: string | null): Section { return value === 'role' || roleModules.some(item => item.id === value) ? value as Section : 'role' }
const section = ref<Section>(knownSection(query.get('section')))
const roles = ref<StoredModel[]>([])
const roleId = ref(query.get('role') || localStorage.getItem('deskaura-active-model') || '')
const selectedRole = computed(() => roles.value.find(role => role.id === roleId.value))
const settings = ref<ModelSettings>({ base_url: '', model: '' })
const loaded = ref(false), saving = ref(false), detecting = ref(false)
const feedback = ref(''), feedbackError = ref(false)
const rolePanel = ref<InstanceType<typeof RoleModulePanel>>()
const mcpPanel = ref<InstanceType<typeof McpServicesPanel>>()
const roleDescription = ref('')
const roleConfigInput = ref<HTMLInputElement>()
const unlisten: Array<() => void> = []
let loadRevision = 0
let loadedRole = ''
let detectionController: AbortController | undefined
let disposed = false
const templates: Record<string, string> = {
  '无': '',
  '温柔陪伴': '角色名称：……\n身份/身世：……\n性格：温柔、耐心、尊重边界。\n说话风格：自然、简洁，适度表达关心。\n和你的关系：日常陪伴者。\n禁忌：不泄露隐私，不做未经确认的危险操作。\n世界观：……\n背景故事：……\n其他设定：……',
  '元气伙伴': '角色名称：……\n身份/身世：……\n性格：积极、开朗、可靠。\n说话风格：有活力但不喧闹。\n和你的关系：值得信赖的伙伴。\n禁忌：尊重隐私和个人边界。\n世界观：……\n背景故事：……\n其他设定：……',
  '专注助手': '角色名称：……\n身份/身世：……\n性格：专注、清晰、务实。\n说话风格：先结论，再给必要解释。\n和你的关系：工作与学习助手。\n禁忌：不虚构工具结果，危险操作遵循权限。\n世界观：……\n背景故事：……\n其他设定：……',
}
const connectionField = computed(() => `${section.value}_connection_mode` as keyof ModelSettings)
const localProviderField = computed(() => `${section.value}_local_provider` as keyof ModelSettings)
const localProvider = computed(() => settings.value[localProviderField.value] === 'built_in' ? 'built_in' : 'external')
const supportsBuiltIn = computed(() => ['persona', 'memory', 'vision', 'hearing'].includes(section.value))
const connectionMode = computed(() => supportsBuiltIn.value && localProvider.value === 'built_in' ? 'local' : 'cloud')
const usingBuiltIn = computed(() => supportsBuiltIn.value && localProvider.value === 'built_in')
const builtInDescription = computed(() => ({
  persona: 'BGE 中文 Embedding · 在本机检索角色设定',
  memory: 'BGE 中文 Embedding + MemU · 在本机索引和检索记忆',
  vision: 'BlazeFace 人脸检测 · 在本机识别人脸位置，仅用于视线追踪',
  hearing: 'SenseVoice ONNX · 在本机将语音转为文字',
}[section.value as 'persona' | 'memory' | 'vision' | 'hearing'] || ''))
const activeModule = computed(() => roleModules.find(item => item.id === section.value))
const label = computed(() => activeModule.value?.label || '角色')
const modelSectionTitle = computed(() => ({
  brain: '大语言模型（LLM）',
  persona: '文本嵌入模型（Text Embedding）',
  memory: '文本嵌入模型（Text Embedding）',
  tools: '模型上下文协议（MCP）',
  vision: '人脸检测模型（Face Detection）',
  hearing: '自动语音识别模型（ASR）',
  voice: '语音合成模型（TTS）',
  motion: '动作生成模型（Motion Generation）',
}[section.value as ModuleId] || '模型配置'))
function modelNameFor(id: ModuleId): string {
  if (id === 'tools') return mcpPanel.value?.label || '未配置服务'
  return moduleModelName(settings.value, id)
}
const modelDisplayName = computed(() => activeModule.value ? modelNameFor(activeModule.value.id) : '')
const personaPlaceholder = '角色名称：……\n身份/身世：……\n性格：……\n说话风格：……\n和你的关系：……\n禁忌：……\n世界观：……\n背景故事：……\n其他设定：……'
const templateOptions = Object.keys(templates).map(value => ({ value, label: value }))
const voices = computed(() => speechVoiceOptions(selectedSpeechProvider(settings.value), settings.value.audio_model || ''))
const emotionLabels = { neutral: '正常', happy: '开心', sad: '伤心', angry: '生气', nervous: '紧张', serious: '严肃', fearful: '恐惧', surprised: '惊讶', disgusted: '厌恶', shy: '害羞', tired: '疲倦', curious: '好奇', confident: '自信', affectionate: '撒娇' }
const gestureLabels = { ...standbyLabels, idle: '自然待机', thinking_loop: '思考', wave: '友好挥手', nod: '点头回应', bow: '礼貌鞠躬', clap: '轻轻鼓掌', celebrate: '开心庆祝', point: '指向介绍', shrug: '轻轻耸肩' }
const motionOptions = [
  ...standbyLibraryOptions,
  ...Object.entries(emotionLabels).map(([value, text]) => ({ value: `emotion:${value}`, label: `${text}回答`, group: '回答动作' })),
  ...Object.entries(gestureLabels).filter(([value]) => ![...standbyMotionIds, 'idle'].includes(value))
    .map(([value, text]) => ({ value: `gesture:${value}`, label: text, group: '常用动作' })),
]
const libraryMotion = ref('gesture:idle')
const personaInput = ref<HTMLInputElement>(), importedDocument = ref('')
const cameras = ref<Array<{ value: string; label: string }>>([])
const cameraFeedback = ref('')
const refreshingCameras = ref(false)
const memoryPathInput = ref<HTMLInputElement>()
const memoryPathPanel = ref<HTMLElement>()
let offMemoryDrop: (() => void) | undefined
async function chooseMemoryFile() {
  if (!isTauri()) return memoryPathInput.value?.click()
  try {
    const initial = settings.value.memory_path?.trim()
    const path = await invoke<string | null>('pick_file', initial ? { initialFolder: initial } : undefined)
    if (path) settings.value.memory_path = path
  } catch (error) { setError(error, '选择记忆文件失败') }
}
function acceptMemoryDrop(event: DragEvent) {
  const file = event.dataTransfer?.files?.[0]
  const path = (file as File & { path?: string })?.path || file?.name
  if (path) settings.value.memory_path = path
}
async function load() {
  detectionController?.abort()
  const revision = ++loadRevision, id = roleId.value, role = selectedRole.value
  if (loadedRole !== id || !role) {
    loadedRole = id
    feedback.value = ''; loaded.value = false
    importedDocument.value = ''
  }
  if (!role) return
  try {
    await ensureRoleRecord(role)
    const saved = await getModelSettings(id)
    if (revision !== loadRevision) return
    settings.value = { ...saved, persona_template: saved.persona_template ?? '无' }
    if (section.value === 'memory' && !settings.value.memory_path) throw new Error('记忆路径尚未加载完成')
    roleDescription.value = role.description || ''
    loaded.value = true
    // This window stays mounted while hidden. Opening the same character again
    // must retry a child status read that failed before the sidecars were ready.
    await nextTick()
    if (revision === loadRevision && id === roleId.value) await rolePanel.value?.refresh()
  } catch (error) { if (revision === loadRevision && !loaded.value && !feedback.value) setError(error, '读取配置失败') }
}
async function loadUntilReady(requireMemoryPath = false) {
  const id = roleId.value
  for (let attempt = 0; attempt < 60 && !disposed && id === roleId.value; attempt++) {
    await load()
    if (loaded.value && (!requireMemoryPath || !!settings.value.memory_path)) return
    await new Promise(resolve => window.setTimeout(resolve, 500))
  }
}
function setError(error: unknown, fallback: string) {
  feedback.value = error instanceof Error ? error.message : typeof error === 'string' && error.trim() ? error : fallback
  feedbackError.value = true
}
watch(roleId, load)
watch(section, value => {
  detectionController?.abort()
  feedback.value = ''; feedbackError.value = false
  if (value === 'vision') void refreshCameras()
  if (value === 'memory' && !settings.value.memory_path) void loadUntilReady(true)
})
function selectLocalProvider(value: string) {
  Object.assign(settings.value, {
    [localProviderField.value]: value,
    [connectionField.value]: value === 'built_in' ? 'local' : 'cloud',
  })
}
async function refreshCameras() {
  if (refreshingCameras.value) return
  refreshingCameras.value = true; cameraFeedback.value = ''
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    if (!navigator.mediaDevices?.enumerateDevices) throw new Error('当前运行环境无法枚举摄像头')
    const devices = await Promise.race([
      navigator.mediaDevices.enumerateDevices(),
      new Promise<MediaDeviceInfo[]>((_, reject) => { timeout = setTimeout(() => reject(new Error('读取设备超时，请检查系统摄像头权限后刷新')), 8000) }),
    ])
    cameras.value = devices.filter(item => item.kind === 'videoinput').map((item, index) => ({
      value: item.deviceId, label: item.label || `摄像头 ${index + 1}`,
    }))
    if (!cameras.value.length) cameraFeedback.value = '没有发现摄像头；请检查连接和系统摄像头权限。'
    else if (cameras.value.every(item => !item.value)) cameraFeedback.value = '系统尚未授权摄像头，首次使用时将请求权限。'
  } catch (error) { cameraFeedback.value = error instanceof Error ? error.message : '读取摄像头失败' }
  finally { if (timeout) clearTimeout(timeout); refreshingCameras.value = false }
}
const cameraOptions = computed(() => {
  const result = [{ value: '', label: '系统默认摄像头' }, ...cameras.value.filter(item => item.value)]
  const selected = settings.value.vision_camera_id
  if (selected && !result.some(item => item.value === selected)) result.push({ value: selected, label: '已保存的摄像头（当前不可用）' })
  return result
})
function chooseTemplate(value: string) {
  settings.value.persona_template = value
  if (value !== '无') settings.value.persona_text = templates[value] || ''
}
function publicSnapshot(value: ModelSettings) {
  return safeRoleConfig(value as unknown as Record<string, unknown>)
}
async function syncRecord(saved: ModelSettings, id: string, savedSection: Section) {
  await updateRoleConfig(id, publicSnapshot(saved))
  localStorage.setItem('deskaura-role-config-updated', `${id}:${Date.now()}`)
  if (isTauri()) {
    for (const target of ['home', 'main', 'dialog']) void emitTo(target, 'deskaura:config-changed', id).catch(() => {})
    const active = localStorage.getItem('deskaura-active-model') || 'default'
    if (id !== active) return
    if (savedSection === 'voice') {
      void emitTo('dialog', 'deskaura:audio-settings-changed', null).catch(() => {})
      void emitTo('main', 'deskaura:audio-settings-changed', null).catch(() => {})
    }
    if (savedSection === 'hearing') void emitTo('dialog', 'deskaura:asr-settings-changed', id).catch(() => {})
    if (savedSection === 'brain') void emitTo('dialog', 'deskaura:chat-settings-changed', null).catch(() => {})
    void emitTo('main', 'deskaura:interaction-settings', id).catch(() => {})
    void emitTo('main', 'deskaura:bubble-settings', saved.bubble_enabled !== false).catch(() => {})
  }
}
async function mcpChanged() {
  const id = roleId.value, revision = loadRevision
  try {
    const saved = await getModelSettings(id)
    if (revision !== loadRevision || id !== roleId.value) return
    settings.value = { ...saved }
    await syncRecord(saved, id, 'tools')
    if (isTauri()) await emitTo('home', 'deskaura:module-status-changed', id).catch(() => {})
  } catch (error) { if (revision === loadRevision) setError(error, '同步 MCP 配置失败') }
}
function currentModulePatch(id: ModuleId) {
  const patch = moduleSettingsPatch(settings.value, id)
  if (id === 'motion') Object.assign(patch, motionConnectionPatch(settings.value))
  return patch
}
async function save(test = true) {
  if (!loaded.value || saving.value || !roleId.value) return
  const id = roleId.value, savedSection = section.value, revision = loadRevision
  saving.value = true; feedbackError.value = false; feedback.value = '保存中…'
  let persisted = false
  try {
    if (savedSection === 'role') return
    if (savedSection === 'tools') {
      await mcpPanel.value?.save(false)
      if (test) await detect(true)
      return
    }
    const patch = currentModulePatch(savedSection)
    const saved = await saveModelSettings(patch, id)
    persisted = true
    await syncRecord(saved, id, savedSection)
    if (revision !== loadRevision || id !== roleId.value || savedSection !== section.value) return
    settings.value = { ...saved }
    feedback.value = '已保存'
    if (test && savedSection === section.value) await detect(true)
  } catch (error) {
    if (revision === loadRevision && id === roleId.value) {
      setError(error, '保存失败')
      if (persisted) feedback.value = `配置已保存，但角色资料同步失败：${feedback.value}`
    }
  }
  finally { saving.value = false }
}
async function detect(alreadySaved = false) {
  if (!loaded.value || detecting.value || section.value === 'role') return
  const id = section.value, target = roleId.value, revision = loadRevision
  const controller = new AbortController()
  const visionCameraId = settings.value.vision_camera_id || ''
  let persisted = alreadySaved
  detectionController = controller
  detecting.value = true; feedbackError.value = false; feedback.value = '检测中…'
  try {
    if (id === 'tools') {
      await mcpPanel.value?.detect()
      let result
      try { result = await testRoleModule(id, target) }
      finally { await mcpPanel.value?.refresh() }
      if (controller.signal.aborted || revision !== loadRevision || target !== roleId.value) return
      feedback.value = result.detail || (result.verified ? '正常' : '异常')
      feedbackError.value = result.verified !== true
      await mcpChanged()
      return
    }
    // Begin camera acquisition in the click turn, while the saved form is
    // synchronized independently. Always consume both outcomes before leaving.
    let allowVisionVerification!: () => void
    const beforeVisionVerify = new Promise<void>(resolve => { allowVisionVerification = resolve })
    const visualProbe = id === 'vision'
      ? testRoleModule(id, target, { signal: controller.signal, visionCameraId, beforeVisionVerify })
      : undefined
    const saveConfiguration = async () => {
      if (alreadySaved) return
      const saved = await saveModelSettings(currentModulePatch(id), target)
      persisted = true
      await syncRecord(saved, target, id)
      if (controller.signal.aborted || revision !== loadRevision || id !== section.value || target !== roleId.value) return
      settings.value = { ...saved }
    }
    let result
    if (visualProbe) {
      const [persisted, detected] = await Promise.allSettled([
        saveConfiguration().catch(error => { controller.abort(); throw error }).finally(allowVisionVerification), visualProbe,
      ])
      if (persisted.status === 'rejected') throw persisted.reason
      if (detected.status === 'rejected') throw detected.reason
      result = detected.value
    } else {
      await saveConfiguration()
      if (controller.signal.aborted || revision !== loadRevision || id !== section.value || target !== roleId.value) return
      result = await testRoleModule(id, target)
    }
    if (isTauri()) void emitTo('home', 'deskaura:module-status-changed', target).catch(() => {})
    if (revision !== loadRevision || id !== section.value || target !== roleId.value) return
    feedback.value = `${persisted ? '配置已保存；' : ''}${result.detail || (result.verified ? '正常' : '异常')}`
    feedbackError.value = result.verified !== true
    await rolePanel.value?.refresh()
  } catch (error) {
    if (isTauri()) void emitTo('home', 'deskaura:module-status-changed', target).catch(() => {})
    if (revision === loadRevision && id === section.value && target === roleId.value) {
      setError(error, '检测失败')
      if (persisted) feedback.value = `配置已保存；检测未通过：${feedback.value}`
    }
  }
  finally { if (detectionController === controller) detectionController = undefined; detecting.value = false }
}
async function saveDescription() {
  if (!selectedRole.value || !loaded.value) return
  const id = roleId.value, revision = loadRevision, description = roleDescription.value.trim().slice(0, 500)
  if (description === (selectedRole.value.description || '')) return
  try {
    const updated = await updateModel(id, { description })
    roles.value = roles.value.map(item => item.id === updated.id ? updated : item)
    await ensureRoleRecord(updated)
    localStorage.setItem('deskaura-role-config-updated', `${id}:${Date.now()}`)
    if (revision === loadRevision && id === roleId.value) feedback.value = '已保存'
  } catch (error) { if (revision === loadRevision && id === roleId.value) setError(error, '保存角色描述失败') }
}
async function importPersona(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  const id = roleId.value, revision = loadRevision
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('文档不能超过 10 MB')
    const result = await request<{ text: string }>(`/api/persona/import?filename=${encodeURIComponent(file.name)}`, {
      method: 'POST', headers: { ...roleHeaders(id), 'Content-Type': 'application/octet-stream' }, body: file,
    })
    if (revision !== loadRevision || id !== roleId.value) return
    if (!result.text?.trim()) throw new Error('文档没有可提取的文字')
    settings.value.persona_text = result.text
    importedDocument.value = file.name
    feedback.value = '文档已导入，保存后生效'; feedbackError.value = false
  } catch (error) { if (revision === loadRevision && id === roleId.value) setError(error, '文档导入失败') }
  finally { input.value = '' }
}
async function exportPersona() {
  const role = selectedRole.value
  if (!role || !loaded.value) return
  try {
    const content = settings.value.persona_text || '', suggestedName = `${role.name}-角色设定.txt`
    if (isTauri()) {
      if (!await invoke<string | null>('save_role_export', { content, suggestedName, exportKind: 'persona' })) return
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = suggestedName; anchor.click(); URL.revokeObjectURL(url)
    }
    feedback.value = '角色设定已导出'; feedbackError.value = false
  } catch (error) { setError(error, '导出文档失败') }
}
async function previewMotion() {
  try {
    const [kind, id] = libraryMotion.value.split(':')
    const standby = standbyMotionIds.includes(id as StandbyId) ? standbyMotion(id as StandbyId) : undefined
    const endpoint = kind === 'emotion' ? `emotion/${id}` : `library/${standby?.id || `cloud_${id}`}`
    const response = await localFetch(`http://127.0.0.1:8002/api/motion/${endpoint}`, { headers: roleHeaders(roleId.value) })
    if (!response.ok) throw new Error('本地动作不可用')
    const data = await response.json()
    const motion = kind === 'emotion' ? data.motion : { id: data.id, kind: 'hymotion', url: `/api/motion/library/${data.id}`, duration: data.duration, loop: data.loop === true }
    if (isTauri()) await emitTo('main', 'deskaura:reply', { motion, emotion: kind === 'emotion' ? id : 'neutral' })
    feedback.value = '动作已发送到桌面角色'; feedbackError.value = false
  } catch (error) { setError(error, '动作预览失败') }
}
async function exportRole() {
  const role = selectedRole.value
  if (!role) return
  try {
    const snapshot = await request(`/api/roles/${encodeURIComponent(role.id)}/export`, { headers: roleHeaders(role.id) })
    const content = JSON.stringify(snapshot, null, 2), suggestedName = `${role.name}-角色配置.json`
    if (isTauri()) {
      const result = await invoke<string | null>('save_role_export', { content, suggestedName })
      if (!result) return
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = suggestedName; anchor.click(); URL.revokeObjectURL(url)
    }
    feedback.value = '已导出（不含密钥）'; feedbackError.value = false
  } catch (error) { setError(error, '导出失败') }
}
async function importRole(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0], role = selectedRole.value
  if (!file || !role) return
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MB')
    const snapshot = JSON.parse(await file.text())
    await request(`/api/roles/${encodeURIComponent(role.id)}/import`, {
      method: 'POST', headers: roleHeaders(role.id), body: JSON.stringify(snapshot),
    })
    await refreshRoles()
    await load()
    await syncRecord(settings.value, role.id, 'role')
    feedback.value = '配置已导入；密钥需在对应模块重新填写'; feedbackError.value = false
    localStorage.setItem('deskaura-role-config-updated', `${role.id}:${Date.now()}`)
  } catch (error) { setError(error, '导入失败') }
  finally { input.value = '' }
}
async function refreshRoles() {
  roles.value = await listModels()
  if (!selectedRole.value) roleId.value = roles.value[0]?.id || ''
}
function rolesChanged(event: StorageEvent) {
  if (event.key === 'deskaura-role-config-updated') void refreshRoles().catch(error => setError(error, '读取角色失败'))
}
onMounted(async () => {
  if (isTauri()) {
    unlisten.push(await listen<{ roleId: string; settings: ModelSettings; fields?: string[] }>('deskaura:runtime-settings', event => {
      if (event.payload.roleId !== roleId.value || disposed) return
      // Preserve unsaved form fields; synchronize only fields actually persisted.
      const fields = event.payload.fields || Object.keys(event.payload.settings)
      const patch = Object.fromEntries(fields.filter(key => key in event.payload.settings &&
        !/(?:^api_key$|_api_key$|_password$|_secret$|_token$)/.test(key))
        .map(key => [key, event.payload.settings[key as keyof ModelSettings]]))
      settings.value = { ...settings.value, ...patch }
    }))
    unlisten.push(await listen<{ roleId?: string; section?: Section }>('deskaura:configure-role', async event => {
      feedback.value = ''
      await refreshRoles()
      if (event.payload.roleId && roles.value.some(role => role.id === event.payload.roleId)) roleId.value = event.payload.roleId
      section.value = knownSection(event.payload.section)
      void loadUntilReady(section.value === 'memory')
    }))
    unlisten.push(await listen<{ roleId: string; patch: Partial<ModelSettings> }>('deskaura:module-toggle', event => {
      if (event.payload.roleId !== roleId.value || disposed) return
      settings.value = { ...settings.value, ...event.payload.patch }
    }))
    unlisten.push(await listen<string>('deskaura:config-changed', event => {
      if (event.payload !== roleId.value || saving.value || detecting.value) return
      if (!loaded.value) { void load(); return }
      const id = roleId.value, revision = loadRevision
      void getModelSettings(id).then(saved => {
        if (disposed || revision !== loadRevision || id !== roleId.value || saving.value || detecting.value) return
        const fields = roleModules.map(item => item.enabled).filter(Boolean)
        settings.value = { ...settings.value, ...Object.fromEntries(fields.map(field => [field, saved[field]])) }
      }).catch(() => { /* Background synchronization must not replace an explicit detection result. */ })
    }))
  }
  await refreshRoles()
  if (selectedRole.value && !loaded.value) await loadUntilReady(section.value === 'memory')
  window.addEventListener('storage', rolesChanged)
  if (section.value === 'vision') void refreshCameras()
  if (isTauri()) {
    try {
      offMemoryDrop = await getCurrentWebview().onDragDropEvent(event => {
        if (event.payload.type !== 'drop' || !event.payload.paths.length || section.value !== 'memory') return
        const bounds = memoryPathPanel.value?.getBoundingClientRect(), p = event.payload.position
        const scale = window.devicePixelRatio || 1
        if (bounds && p.x / scale >= bounds.left && p.x / scale <= bounds.right &&
            p.y / scale >= bounds.top && p.y / scale <= bounds.bottom) {
          settings.value.memory_path = event.payload.paths[0]!
        }
      })
    } catch { /* Browser preview and older Tauri builds use the native drop fallback. */ }
  }
})
onBeforeUnmount(() => { disposed = true; detectionController?.abort(); loadRevision++; unlisten.forEach(off => off()); offMemoryDrop?.(); window.removeEventListener('storage', rolesChanged) })
</script>
<template>
  <main class="settings-app">
    <div class="settings-shell">
      <nav class="settings-nav" aria-label="设置目录">
        <div class="settings-brand"><span class="section-label">SETTINGS</span><h1>设置</h1></div>
        <button type="button" :class="{active:section==='role'}" @click="section='role'"><b>角色</b><small>配置与模块概览</small></button><hr />
        <button v-for="item in roleModules" :key="item.id" type="button" :class="{active:section===item.id}" @click="section=item.id"><b>{{ item.label }}</b><small>{{ item.hint }}</small></button>
      </nav>
      <div class="settings-content settings-body">
        <section v-if="section==='role'" class="settings-page">
          <header class="settings-page-heading"><div><span>ROLE PROFILE</span><h2>角色</h2></div></header>
          <label>选择角色<ConfigPicker v-model="roleId" :options="roles.map(role=>({value:role.id,label:role.name}))" label="选择角色" placeholder="请先在主页创建角色" /></label>
          <template v-if="selectedRole">
            <label>角色描述<ExpandableContent label="角色描述"><textarea v-model="roleDescription" class="role-description-input" rows="2" maxlength="500" placeholder="很高兴与你相伴。" @blur="saveDescription" /></ExpandableContent></label>
            <p class="settings-hint role-path">{{ selectedRole.path || selectedRole.sourcePath || '内嵌模型' }}</p>
            <RoleModulePanel ref="rolePanel" :role-id="roleId" :overview="true" @configure="section=$event||'role'" @export="exportRole" @import-role="roleConfigInput?.click()" />
            <input ref="roleConfigInput" hidden type="file" accept=".json,application/json" @change="importRole" />
            <LocalOperationPanel :role-id="roleId" />
          </template><p v-else class="settings-empty">先在主页导入模型来创建角色配置。这里不会另建角色。</p>
        </section>
        <section v-else class="settings-page" :class="{ 'memory-settings-page': section === 'memory' }" :key="section">
          <header class="settings-page-heading module-page-heading"><span class="module-eyebrow">{{ String(roleModules.findIndex(item=>item.id===section)+1).padStart(2,'0') }} · ROLE MODULE</span><h2>{{ label }}</h2><span v-if="selectedRole" class="current-role-badge">当前角色 · {{ selectedRole.name }}</span></header>
          <p v-if="!selectedRole" class="settings-empty">请先在「角色」目录选择一个角色。</p>
          <template v-else>
            <template v-if="section==='persona'">
              <label>角色模板<ConfigPicker :model-value="settings.persona_template" :options="templateOptions" label="角色模板" placeholder="选择模板填入设定" @update:model-value="chooseTemplate" /></label>
              <label>角色设定<ExpandableContent label="角色设定"><textarea v-model="settings.persona_text" class="persona-editor" rows="15" :placeholder="personaPlaceholder" /></ExpandableContent></label>
              <div class="document-import"><button type="button" class="secondary" :disabled="!loaded" @click="personaInput?.click()"><FileInput :size="15" aria-hidden="true" />导入文档</button><button type="button" class="secondary" :disabled="!loaded" @click="exportPersona"><FileOutput :size="15" aria-hidden="true" />导出文档</button><span>{{ importedDocument || '从本地文档填入角色设定' }}</span><input ref="personaInput" hidden type="file" accept=".txt,.md,.json,.docx,.pdf" @change="importPersona" /></div>
            </template>
            <template v-if="section==='motion'">
              <label>动作模式<ConfigPicker v-model="settings.motion_mode" :options="[{value:'online',label:'在线',description:'回复与动作请求均现场生成'},{value:'offline',label:'离线',description:'均使用本地动作库'},{value:'hybrid',label:'混合',description:'回复用本地库，动作请求优先生成'}]" label="动作模式" /></label>
              <label>本地动作库<ConfigPicker v-model="libraryMotion" :options="motionOptions" :group-tabs="true" label="本地动作库" /></label>
              <div class="settings-actions motion-library-actions"><button type="button" class="secondary" @click="previewMotion">预览</button><button type="button" class="secondary" @click="emitTo('main','deskaura:cancel-thinking',null)">停止</button></div>
              <label>时长模式<ConfigPicker v-model="settings.motion_duration_mode" :options="[{value:'auto',label:'自动时长',description:'使用动作模型原生时长预测，不调用对话模型'},{value:'manual',label:'固定时长'}]" label="时长模式" /></label>
              <label v-if="settings.motion_duration_mode==='manual'">固定秒数<input v-model.number="settings.motion_duration" type="number" min="0.5" max="12" step="0.5" aria-label="固定秒数" /></label>
            </template>
            <section v-if="section==='vision'" class="vision-camera-section">
              <label>摄像头<ConfigPicker v-model="settings.vision_camera_id" :options="cameraOptions" label="选择摄像头" placeholder="系统默认摄像头" /></label>
              <button type="button" class="secondary" :disabled="refreshingCameras" @click="refreshCameras">{{ refreshingCameras?'读取中…':'刷新设备' }}</button>
              <p v-if="cameraFeedback" class="settings-hint" role="status">{{ cameraFeedback }}</p>
            </section>
            <div v-if="section!=='memory'" class="model-section-title"><h3>{{ modelSectionTitle }}</h3><span v-if="modelDisplayName">{{ modelDisplayName }}</span></div>
            <template v-if="section==='memory'">
              <label>记忆路径
                <div ref="memoryPathPanel" class="directory-field memory-path-field" @dragover.prevent @drop.prevent="acceptMemoryDrop">
                  <input ref="memoryPathInput" v-model="settings.memory_path" placeholder="输入路径，或拖入文件/文件夹" />
                   <button type="button" class="secondary" @click="chooseMemoryFile">选择</button>
                </div>
              </label>
              <p class="settings-hint memory-path-hint">保存可迁移的 memory/skill Markdown；SQLite 索引和原始聊天记录用于本机检索与恢复。</p>
              <div class="model-section-title"><h3>{{ modelSectionTitle }}</h3><span v-if="modelDisplayName">{{ modelDisplayName }}</span></div>
            </template>
             <template v-if="supportsBuiltIn">
               <label>模型来源<ConfigPicker :model-value="localProvider" :options="[{value:'built_in',label:'内置模型'},{value:'external',label:'API服务'}]" label="模型来源" @update:model-value="selectLocalProvider" /></label>
               <p v-if="usingBuiltIn" class="builtin-model-note"><span>内置模型</span>{{ builtInDescription }}</p>
            </template>
            <template v-if="section==='brain'">
               <label>API 地址<input v-model="settings.base_url" placeholder="https://api.openai.com/v1 或本地服务地址" /></label>
              <label>模型<input v-model="settings.model" placeholder="服务商实际模型 ID" /></label>
              <label>API Key<input v-model="settings.api_key" type="password" autocomplete="new-password" :placeholder="settings.api_key_masked || (connectionMode==='local'?'本地服务无需密钥可留空':'输入密钥')" /></label>
            </template>
             <template v-if="section==='vision' && !usingBuiltIn">
               <label>API 地址<input v-model="settings.vision_base_url" placeholder="https://api.openai.com/v1" /></label>
               <label>模型<input v-model="settings.vision_model" placeholder="人脸检测模型 ID" /></label>
               <label>API Key<input v-model="settings.vision_api_key" type="password" autocomplete="new-password" :placeholder="settings.vision_api_key_masked || '无需鉴权可留空'" /></label>
            </template>
            <template v-if="section==='persona' && !usingBuiltIn">
              <label>API 地址<input v-model="settings.persona_embedding_base_url" :placeholder="connectionMode==='local'?'http://127.0.0.1:11434/v1':'https://api.openai.com/v1'" /></label>
              <label>模型<input v-model="settings.persona_embedding_model" placeholder="服务商实际 Embedding 模型 ID" /></label>
              <label>API Key<input v-model="settings.persona_embedding_api_key" type="password" autocomplete="new-password" :placeholder="settings.persona_embedding_api_key_masked || '输入密钥'" /></label>
            </template>
            <template v-if="section==='memory'">
              <section v-if="!usingBuiltIn" class="settings-subsection">
                <label>API 地址<input v-model="settings.memory_embedding_base_url" :placeholder="connectionMode==='local'?'http://127.0.0.1:11434/v1':'https://api.openai.com/v1'" /></label>
                <label>模型<input v-model="settings.memory_embedding_model" placeholder="服务商实际 Embedding 模型 ID" /></label>
                <label>API Key<input v-model="settings.memory_embedding_api_key" type="password" autocomplete="new-password" :placeholder="settings.memory_embedding_api_key_masked || (connectionMode==='local'?'本地服务无需密钥可留空':'输入密钥')" /></label>
              </section>
            </template>
            <template v-if="section==='tools'">
              <McpServicesPanel ref="mcpPanel" :role-id="roleId" :role-name="selectedRole.name" @saved="mcpChanged" @feedback="(text,error)=>{feedback=text;feedbackError=error}" />
            </template>
            <p v-if="section==='vision'" class="settings-hint">检测会立即开启所选摄像头，确认画面中能识别人脸后自动释放设备。</p>
            <template v-if="section==='hearing' && !usingBuiltIn">
              <label>API 地址<input v-model="settings.asr_base_url" :placeholder="connectionMode==='local'?'http://127.0.0.1:8003/v1':'服务商 ASR API 根地址'" /></label>
              <label>模型<input v-model="settings.asr_model" :placeholder="connectionMode==='local'?'本地服务实际语音识别模型 ID':'qwen3-asr-flash'" /></label>
              <label>API Key<input v-model="settings.asr_api_key" type="password" autocomplete="new-password" :placeholder="settings.asr_api_key_masked || (connectionMode==='local'?'本地服务无需密钥可留空':'输入密钥')" /></label>
            </template>
            <template v-if="section==='voice'">
              <label>API 地址<input v-model="settings.audio_base_url" :placeholder="connectionMode==='local'?'http://127.0.0.1:8004/v1':'服务商 TTS API 根地址'" /></label>
              <label>模型<input v-model="settings.audio_model" :placeholder="connectionMode==='local'?'本地服务实际语音合成模型 ID':'qwen3-tts-flash'" /></label>
              <label>音色 ID<ConfigPicker v-model="settings.audio_voice" :options="voices" :editable="true" label="音色 ID" placeholder="填写 Voice ID 或展开全部音色" /></label>
              <label>API Key<input v-model="settings.audio_api_key" type="password" autocomplete="new-password" :placeholder="settings.audio_api_key_masked || (connectionMode==='local'?'本地服务无需密钥可留空':'输入密钥')" /></label>
            </template>
            <template v-if="section==='motion'">
              <label>API 地址<input v-model="settings.motion_api_base_url" placeholder="https://tokenhub.tencentmaas.com/v1/api/3d 或 http://127.0.0.1:6006" /></label>
              <label>模型<input v-model="settings.motion_api_model" placeholder="hy-3d-motion 或本地 Worker 模型" /></label>
              <label>API Key<input v-model="settings.motion_api_key" type="password" autocomplete="new-password" :placeholder="settings.motion_api_key_masked || '无需鉴权可留空'" /></label>
              <p class="settings-hint">云端与本地共用同一组动作模型配置；地址按实际服务填写。</p>
            </template>
            <footer class="settings-save-row"><div class="settings-actions"><button type="button" data-mcp-explicit-save :disabled="saving||detecting||!loaded" @click="save()">{{ saving?'保存中…':'保存配置' }}</button><button type="button" class="secondary" data-mcp-no-autosave :disabled="saving||detecting||!loaded" @click="detect()">{{ detecting?'检测中…':'检测' }}</button></div><p v-if="feedback" class="config-result" :class="{error:feedbackError}" :title="feedback" role="status"><span class="config-result-text" tabindex="0">{{ feedback }}</span></p></footer>
          </template>
        </section>
        <p v-if="section==='role' && feedback" class="config-result" :class="{error:feedbackError}" role="status">{{ feedback }}</p>
      </div>
    </div>
  </main>
</template>
