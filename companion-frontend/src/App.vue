<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getCurrentWindow, currentMonitor } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { FileOutput } from '@lucide/vue'
import {
  emitTo as tauriEmitTo,
  listen as tauriListen,
  type Event as TauriEvent,
} from '@tauri-apps/api/event'
import { getModel, listModels, updateRoleConfig, resolveModelUrl, type StoredModel } from './modelLibrary'
import { bellyReaction } from './avatarBodyRegions'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import AvatarStage from './components/AvatarStage.vue'
import ThinkingBubble from './components/ThinkingBubble.vue'
import CallVoiceControl from './components/CallVoiceControl.vue'
import { ReplyAudioPlayer } from './audio'
import { CharacterStream, SentenceAudioQueue, SpeechSentenceBuffer } from './chatStreaming'
import { acceptsReplyMotion, endsThinkingPose, replyMotionCanEnd, textReplyHoldMs } from './replyLifecycle'
import ConfigPicker from './components/ConfigPicker.vue'
import { faceTrackingAllowed, FaceTracker, type FaceTarget } from './faceTracking'
import { StandbySchedule, standbyLabels, standbyLibraryOptions, standbyMotion, standbyMotionIds, type StandbyId } from './standby'
import { gazeOptions, selectedGaze, gazeSelectionPatch } from './interactionSettings'
import { CameraLease, ScreenLease, cameraFrame } from './mediaCapture'
import { bubblePages, streamingBubbleText } from './chatPresentation'
import { composerStatus, voiceStatusAfterEdit } from './composerStatus'
import { composerPresentation, messageDelivery } from './chatMessageFlow'
import { RoleRequestScope } from './roleRequestScope'
import { systemOperationPolicy } from './systemOperation'
import { attachmentAccept, attachmentSupportLabel, attachmentSupportDetail, defaultChatCapabilities, readChatAttachment } from './chatAttachments'
import { speechVoiceOptions, selectedSpeechProvider, speechPresets } from './speechProviders'
import { normalizeWorkerUrl } from './workerConnection'
import { startWindowDrag, toggleAlwaysOnTop, hideWindow, setIgnoreCursorEvents, getCursorPos, isTauri, raiseOwnedWindow } from './tauri'
import {
  clearModelKey,
  clearAudioKey,
  getModelSettings,
  request,
  roleHeaders,
  getChatCapabilities,
  getServicesStatus,
  activeConnectivityTest,
  reportClientFailure,
  verifyFaceDetection,
  saveModelSettings,
  setInteractionOffended,
  getInteractionOffended,
  streamChat,
  listSessions, createSession, getSession, renameSession, deleteSession, decideFile, clearAsrKey, clearMotionKey,
  type ChatSession, type Attachment, type FileApproval, type ChatCapabilities,
  type ModelSettings,
  type Motion,
  type ServiceStatus,
  type SystemAction,
} from './api'

const props = defineProps<{ settingsOnly?: boolean }>()
const isSettingsOnly = !!props.settingsOnly
type Message = { role: 'user' | 'assistant'; text: string }
// Browser previews do not have the Tauri IPC bridge. Keep the same UI flow,
// but make desktop-only window/event calls harmless no-ops there.
async function emitTo(target: string, eventName: string, payload?: unknown) {
  if (!isTauri()) return
  await tauriEmitTo(target, eventName, payload)
}
function listen<T>(eventName: string, handler: (event: TauriEvent<T>) => void) {
  if (!isTauri()) return Promise.resolve(() => {})
  return tauriListen<T>(eventName, handler)
}

const messages = ref<Message[]>([])
const text = ref('')
const loading = ref(false)
// Waiting for the model's first actual words is different from a turn still
// streaming, synthesizing speech, or generating its reply animation.
const thinking = ref(false)
const textStreaming = ref(false)
const motion = ref<Motion>({ id: 'cloud_idle', kind: 'hymotion', url: '/api/motion/library/cloud_idle', duration: 8, loop: true })
const emotion = ref('neutral')
const demoMode = ref(true)
const isDialogWindow = window.location.search.includes('dialog=1') || isSettingsOnly
const dialogOpen = ref(isDialogWindow)
const panelTab = ref<'chat' | 'settings'>(isSettingsOnly ? 'settings' : 'chat')
const modelLoaded = ref(false)
const speaking = ref(localStorage.getItem('deskaura-speaking') !== 'false')
const audioPlayer = new ReplyAudioPlayer()
const callActive = ref(false), callMic = ref(false), micRecording = ref(false), micLevel = ref(0)
const userSpeaking = ref(false)
type PendingMessage = { value: string; attachments: Attachment[]; source: 'text' | 'voice' }
const queuedMessages = ref<PendingMessage[]>([])
const pendingMessage = computed(() => queuedMessages.value[0])
const queuePaused = ref(false)
const pendingSpeech = ref(0)
const awaitingReplyMotion = ref(false)
// The pet window renders a reply, but its speech queue lives in the dialog.
// Only the dialog's explicit ended/interrupt events may finish that remote loop.
const remoteReplyActive = ref(false)
const replyActive = computed(() => loading.value || audioBusy.value || pendingSpeech.value > 0)
const composerMode = computed(() => composerPresentation(callActive.value, replyActive.value, userSpeaking.value, micRecording.value))
let chatController: AbortController | undefined
const callCamera = ref(false), screenSharing = ref(false), callBusy = ref(false), callStarting = ref(false)
let callStartGeneration = 0
const cameraPreview = ref<HTMLVideoElement>()
const cameraSize = ref({ width: 116, height: 87 })
function resizeCamera(event: PointerEvent, axis: 'both' | 'width' | 'height' = 'both') {
  if (event.button !== 0) return
  event.preventDefault(); event.stopPropagation()
  const handle = event.currentTarget as HTMLElement, x = event.clientX, y = event.clientY
  const original = { ...cameraSize.value }
  handle.setPointerCapture(event.pointerId)
  const move = (value: PointerEvent) => {
    const width = axis === 'height' ? original.width : Math.max(96, Math.min(window.innerWidth - 48, original.width + x - value.clientX))
    const height = axis === 'width' ? original.height : Math.max(72, Math.min(window.innerHeight * .5, original.height + value.clientY - y))
    cameraSize.value = { width, height }
  }
  const done = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', done); handle.removeEventListener('pointercancel', done) }
  handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', done); handle.addEventListener('pointercancel', done)
}
const callCameraLease = new CameraLease(), screenLease = new ScreenLease()
const faceTracker = new FaceTracker()
const faceTarget = ref<FaceTarget>({ x: 0, y: 0, visible: false })
const gazeMode = ref<'mouse' | 'face' | 'auto'>('face'), gazeEnabled = ref(true), autoGaze = ref<'mouse' | 'face'>('face')
const visionEnabled = ref(true), visionCamera = ref('')
const asrEnabled = ref(false), clickFeedbackEnabled = ref(true)
const standbyEnabled = ref(true)
const effectiveGaze = computed(() => !gazeEnabled.value ? 'none' : gazeMode.value === 'auto' ? autoGaze.value : gazeMode.value)
const offended = ref(false)
const petVisible = ref(false), gazeSettingsLoaded = ref(false)
const mediaRequest = ref<{ source: 'screen' | 'camera'; kind: 'snapshot' | 'record'; duration?: number } | null>(null)
const mediaBusy = ref(false)
const mediaRequestGeneration = ref(0)
const audioStatus = ref('')
const audioMessage = ref('')
const lastAudioText = ref('')
const audioSaving = ref(false)
const audioBusy = ref(false)
const audioPlaying = ref(false)
const speechLevel = ref(0)
const voiceInputStatus = ref('')
const chatError = ref('')
const composerFeedback = computed(() => composerStatus(chatError.value, voiceInputStatus.value, audioStatus.value))
const capabilities = ref<ChatCapabilities>({ ...defaultChatCapabilities })
let capabilitiesRevision = 0
async function refreshCapabilities() {
  const revision = ++capabilitiesRevision, scope = historyScope.capture(roleId.value)
  try {
    const next = await getChatCapabilities()
    if (revision === capabilitiesRevision && historyScope.accepts(scope, roleId.value)) capabilities.value = next
  } catch {
    if (revision === capabilitiesRevision && historyScope.accepts(scope, roleId.value))
      capabilities.value = { ...defaultChatCapabilities, detail: '模型能力检测失败，请稍后重试' }
  }
}
const sessions = ref<ChatSession[]>([])
const roleId = ref(localStorage.getItem('deskaura-active-model') || 'default')
const sessionKey = (id = roleId.value) => `deskaura-session-${id}`
const sessionId = ref(localStorage.getItem(sessionKey()) || localStorage.getItem('deskaura-session') || '')
const historyOpen = ref(false)
const historyBusy = ref(false)
const renameId = ref('')
const sessionTitle = ref('')
const deleteId = ref('')
const attachments = ref<Attachment[]>([])
const attachmentReading = ref(false)
const attachmentInput = ref<HTMLInputElement>()
const fileApproval = ref<FileApproval | null>(null)
const pendingSystemAction = ref<{ action: SystemAction; roleId: string; sessionId: string } | null>(null)
const systemActionBusy = ref(false)
const fileBusy = ref(false)
const historyScope = new RoleRequestScope()
let sessionListRevision = 0
watch(roleId, () => historyScope.invalidate(), { flush: 'sync' })
async function refreshSessions() {
  const token = historyScope.capture(roleId.value), revision = ++sessionListRevision
  const value = await listSessions(token.roleId)
  if (!historyScope.accepts(token, roleId.value) || revision !== sessionListRevision) return
  sessions.value = value.sessions
}
async function selectSession(id: string) {
  if (loading.value || historyBusy.value || attachmentReading.value || mediaBusy.value || fileBusy.value) return
  const token = historyScope.capture(roleId.value)
  historyBusy.value = true; chatError.value = ''
  try {
    const value = await getSession(id, token.roleId)
    if (!historyScope.accepts(token, roleId.value)) return
    stopAudio(); lastAudioText.value = ''; fileApproval.value = null; pendingSystemAction.value = null
    mediaRequest.value = null; mediaRequestGeneration.value++; queuedMessages.value = []; queuePaused.value = false
    sessionId.value = id; localStorage.setItem(sessionKey(token.roleId), id)
    messages.value = value.messages.map(m => ({ role: m.role, text: m.content }))
    fileApproval.value = value.file_approval || null
    lastAudioText.value = [...messages.value].reverse().find(m => m.role === 'assistant')?.text || ''
    text.value = ''; attachments.value = []; historyOpen.value = false
  } catch { if (historyScope.accepts(token, roleId.value)) chatError.value = '无法读取会话，请检查本地服务。' }
  finally { if (historyScope.accepts(token, roleId.value)) historyBusy.value = false }
}
async function newConversation() {
  if (loading.value || historyBusy.value || attachmentReading.value || mediaBusy.value || fileBusy.value) return
  const token = historyScope.capture(roleId.value)
  historyBusy.value = true
  try {
    const value = await createSession(token.roleId)
    if (!historyScope.accepts(token, roleId.value)) return
    await setInteractionOffended(false, token.roleId).catch(() => {})
    if (!historyScope.accepts(token, roleId.value)) return
    offended.value = false
    await emitTo('main', 'deskaura:interaction-settings', token.roleId).catch(() => {})
    if (!historyScope.accepts(token, roleId.value)) return
    await refreshSessions()
    if (!historyScope.accepts(token, roleId.value)) return
    historyBusy.value = false
    await selectSession(value.id)
  }
  catch { if (historyScope.accepts(token, roleId.value)) chatError.value = '无法创建会话，请稍后重试。' }
  finally { if (historyScope.accepts(token, roleId.value)) historyBusy.value = false }
}
async function switchRole(id: string) {
  if (!id || id === roleId.value) return
  queuedMessages.value = []
  interruptReply()
  endCall()
  roleId.value = id
  const token = historyScope.capture(id)
  sessionListRevision++
  historyBusy.value = false
  historyOpen.value = false
  renameId.value = ''; deleteId.value = ''; sessionTitle.value = ''
  text.value = ''; attachments.value = []; attachmentReading.value = false
  fileApproval.value = null; fileBusy.value = false; pendingSystemAction.value = null
  mediaBusy.value = false; voiceInputStatus.value = ''; chatError.value = ''
  lastAudioText.value = ''
  sessions.value = []
  sessionId.value = localStorage.getItem(sessionKey(id)) || ''
  localStorage.setItem('deskaura-active-model', id)
  localStorage.removeItem('deskaura-session')
  messages.value = []
  offended.value = false
  queuedMessages.value = []
  queuePaused.value = false
  await refreshGazeSettings()
  if (!historyScope.accepts(token, roleId.value)) return
  void refreshCapabilities()
  await refreshSessions()
  if (!historyScope.accepts(token, roleId.value)) return
  const existing = sessions.value.find(session => session.id === sessionId.value)?.id || sessions.value[0]?.id
  if (existing) await selectSession(existing)
  else await newConversation()
}
async function commitSessionTitle(id: string) {
  const token = historyScope.capture(roleId.value)
  try {
    await renameSession(id, sessionTitle.value.trim() || '新对话', token.roleId)
    if (!historyScope.accepts(token, roleId.value)) return
    renameId.value = ''; await refreshSessions()
  }
  catch { if (historyScope.accepts(token, roleId.value)) chatError.value = '重命名失败。' }
}
async function removeConversation(id: string) {
  if (loading.value || historyBusy.value || attachmentReading.value || mediaBusy.value || fileBusy.value) return
  const token = historyScope.capture(roleId.value)
  try {
    await deleteSession(id, token.roleId)
    if (!historyScope.accepts(token, roleId.value)) return
    deleteId.value = ''; await refreshSessions()
    if (!historyScope.accepts(token, roleId.value)) return
    if (sessionId.value === id) {
      if (sessions.value[0]) await selectSession(sessions.value[0].id)
      else await newConversation()
    }
  } catch (e) { if (historyScope.accepts(token, roleId.value)) chatError.value = e instanceof Error ? e.message : '删除失败，请稍后重试。' }
}
async function attachFiles(event: Event) {
  const input = event.target as HTMLInputElement
  if (attachmentReading.value || loading.value || historyBusy.value || mediaBusy.value) { input.value = ''; return }
  const token = historyScope.capture(roleId.value)
  attachmentReading.value = true
  chatError.value = ''
  try {
    for (const file of Array.from(input.files || [])) {
      if (!historyScope.accepts(token, roleId.value)) return
      if (attachments.value.length >= capabilities.value.max_attachments) { chatError.value = '每次最多附加 3 个文件。'; break }
      try {
        const attached = await readChatAttachment(file, capabilities.value)
        if (!historyScope.accepts(token, roleId.value)) return
        attachments.value.push(attached)
      } catch (error) { if (historyScope.accepts(token, roleId.value)) chatError.value = error instanceof Error ? error.message : '附件读取失败，请重试。' }
    }
  } finally {
    if (historyScope.accepts(token, roleId.value)) {
      attachmentReading.value = false
      input.value = ''
    }
  }
}
async function confirmFile(approve: boolean) {
  if (!fileApproval.value || fileBusy.value || loading.value || mediaBusy.value || historyBusy.value) return
  const token = historyScope.capture(roleId.value)
  const approval = fileApproval.value, session = sessionId.value
  fileBusy.value = true
  try {
    const result = await decideFile(approval.id, session, approve, token.roleId)
    if (!historyScope.accepts(token, roleId.value)) return
    messages.value.push({ role: 'assistant', text: result.text }); fileApproval.value = result.file_approval || null
    if (approve) void emitTo('main', 'deskaura:bubble', result.text).catch(() => {})
    if (approve && speaking.value) void playReplyAudio(result.text)
  } catch (e) {
    if (historyScope.accepts(token, roleId.value)) {
      chatError.value = e instanceof Error ? e.message : '文件操作失败。'
      try {
        const latest = await getSession(session, token.roleId)
        if (historyScope.accepts(token, roleId.value)) fileApproval.value = latest.file_approval || null
      } catch { /* Keep the card visible so an interrupted response cannot silently hide approval. */ }
    }
  }
  finally {
    if (historyScope.accepts(token, roleId.value)) {
      fileBusy.value = false
      drainMessages()
    }
  }
}
const composerInput = ref<HTMLTextAreaElement>()
const messageList = ref<HTMLDivElement>()
const speechProvider = computed(() => selectedSpeechProvider(settings.value))
const speechPreset = computed(() => speechPresets[speechProvider.value])
const voiceOptions = computed(() => speechVoiceOptions(speechProvider.value, settings.value.audio_model || ''))
let lastSpeechLevelSent = 0
function syncSpeechLevel(level: number) {
  speechLevel.value = level
  const now = performance.now()
  if (isDialogWindow && !isSettingsOnly && (level === 0 || now - lastSpeechLevelSent > 55)) {
    lastSpeechLevelSent = now
    void emitTo('main', 'deskaura:speech-level', level).catch(() => {})
  }
}
function resizeComposer() {
  const input = composerInput.value
  if (!input) return
  input.style.height = '0px'
  const maximum = Math.max(64, Math.min(156, window.innerHeight * .28))
  input.style.height = `${Math.max(46, Math.min(input.scrollHeight, maximum))}px`
  input.style.overflowY = input.scrollHeight > maximum ? 'auto' : 'hidden'
}
watch(text, () => { voiceInputStatus.value = voiceStatusAfterEdit(voiceInputStatus.value); void nextTick(resizeComposer) })
watch(() => messages.value.length, () => { void nextTick(() => messageList.value?.scrollTo({ top: messageList.value.scrollHeight, behavior: 'smooth' })) })
function composerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); void send()
  }
}
let audioGeneration = 0
let audioConfigSignature = ''
let replyTimer: number | undefined
let textReplyUntil = 0
let chatGeneration = 0
let settlePlayback: (() => void) | undefined
const sentenceAudio = new SentenceAudioQueue(value => playReplyAudio(value), count => { pendingSpeech.value = count })
watch(replyActive, value => { if (!value) { returnToIdle(); void nextTick(drainMessages) } })
watch([textStreaming, audioBusy, pendingSpeech], () => returnToIdle())
const idleMotion = (): Motion => ({ id: 'cloud_idle', kind: 'hymotion', url: '/api/motion/library/cloud_idle', duration: 8, loop: true })
const standbySchedule = new StandbySchedule(performance.now())
const standbyActive = ref(false)
let standbyTimer: number | undefined
const remoteCallActive = ref(false)
let lastInteractionSent = -Infinity
watch(petVisible, () => resetStandbyTimer())
watch(standbyEnabled, () => resetStandbyTimer())
function normalIdle() {
  standbyActive.value = false
  motion.value = idleMotion()
  emotion.value = 'neutral'
}
function updateStandby() {
  const key = standbySchedule.tick(performance.now(), standbyEnabled.value && !isDialogWindow && petVisible.value && modelLoaded.value,
    replyActive.value || thinking.value || remoteReplyActive.value || callActive.value || remoteCallActive.value || micRecording.value || userSpeaking.value)
  if (!key) return
  clearTimeout(interactionTimer)
  standbyActive.value = true
  motion.value = key === 'idle' ? idleMotion() : standbyMotion(key, false)
  emotion.value = key === 'sleep' ? 'tired' : key === 'sing' ? 'happy' : 'neutral'
}
function avatarMotionEnded(id: string) {
  if (!standbyActive.value || !standbySchedule.finish(id, performance.now())) return
  motion.value = idleMotion()
  emotion.value = 'neutral'
}
function resetStandbyTimer() {
  standbySchedule.interaction(performance.now())
  if (standbyActive.value) normalIdle()
}
function noteUserInteraction(event?: Event) {
  // The fullscreen transparent pet window is not itself the character.
  if (!isDialogWindow && event?.type === 'pointerdown' &&
      !(event.target instanceof Element && event.target.closest('.pet-toolbar, .bubble'))) return
  resetStandbyTimer()
  const now = performance.now()
  if (isDialogWindow && !isSettingsOnly && now - lastInteractionSent > 200) {
    lastInteractionSent = now
    void emitTo('main', 'deskaura:user-interaction', roleId.value).catch(() => {})
  }
}
watch(callActive, value => {
  if (isDialogWindow && !isSettingsOnly) void emitTo('main', 'deskaura:call-active', value).catch(() => {})
})
function returnToIdle() {
  if (standbyActive.value) return
  if (!isDialogWindow && remoteReplyActive.value) return
  if (awaitingReplyMotion.value) return
  if (!replyMotionCanEnd(textStreaming.value, audioBusy.value, pendingSpeech.value)) return
  if (replyTimer) clearTimeout(replyTimer)
  replyTimer = undefined
  if (textReplyUntil > performance.now()) {
    replyTimer = window.setTimeout(returnToIdle, textReplyUntil - performance.now())
    return
  }
  if (motion.value.loop && motion.value.id !== 'cloud_idle' && motion.value.id !== 'cloud_thinking_loop') {
    normalIdle()
    if (isDialogWindow) void emitTo('main', 'deskaura:reply-ended', null).catch(() => {})
  }
}
function stopAudio() {
  awaitingReplyMotion.value = false
  textReplyUntil = 0
  if (replyTimer) { clearTimeout(replyTimer); replyTimer = undefined }
  sentenceAudio.clear()
  settlePlayback?.(); settlePlayback = undefined
  audioGeneration++; audioPlayer.stop(); audioStatus.value = ''; audioBusy.value = false; audioPlaying.value = false
  syncSpeechLevel(0); returnToIdle()
}
async function playReplyAudio(value: string, explicit = false) {
  if (!explicit && callActive.value && userSpeaking.value) return
  const generation = ++audioGeneration
  settlePlayback?.()
  let settle!: () => void
  const finished = new Promise<void>(resolve => { settle = resolve })
  settlePlayback = settle
  audioPlayer.stop()
  audioBusy.value = false; audioPlaying.value = false; syncSpeechLevel(0)
  try {
    const config = await getModelSettings()
    if (generation !== audioGeneration) { settle(); return }
    if (!speaking.value && !explicit) { settle(); return }
    if (!config.audio_enabled) { settle(); return }
    const signature = JSON.stringify(Object.entries(config).filter(([key]) => key.startsWith('audio_')))
    if (signature !== audioConfigSignature) { audioPlayer.invalidate(); audioConfigSignature = signature }
    audioBusy.value = true
    if (replyTimer) { clearTimeout(replyTimer); replyTimer = undefined }
    lastAudioText.value = value
    await audioPlayer.play(value, (state, playing) => {
      if (generation !== audioGeneration) return
      audioStatus.value = state
      audioPlaying.value = playing
      audioBusy.value = playing || state.includes('正在合成')
      if (playing && replyTimer) { clearTimeout(replyTimer); replyTimer = undefined }
      if (!playing && !state.includes('正在合成')) { settle(); returnToIdle() }
    }, { onLevel: syncSpeechLevel })
    await finished
  } catch { settle(); if (generation === audioGeneration) { audioStatus.value = '无法读取语音设置，文字不受影响'; audioBusy.value = false; returnToIdle() } }
}
async function saveAudioSettings() {
  clearMotionPreviewFeedback()
  audioSaving.value = true
  let previousEnabled: boolean | undefined
  try {
    const current = await getModelSettings()
    previousEnabled = current.audio_enabled
    const saved = await saveModelSettings({ ...current,
      ...Object.fromEntries(Object.entries(settings.value).filter(([key]) => key.startsWith('audio_'))),
      audio_provider: speechProvider.value })
    settings.value = { ...settings.value, ...saved, audio_api_key: '' }
    await persistRoleConfig({ audio: Object.fromEntries(Object.entries(saved).filter(([key]) => key.startsWith('audio_'))) })
    audioPlayer.invalidate()
    void emitTo('dialog', 'deskaura:audio-settings-changed', null).catch(() => {})
    void emitTo('main', 'deskaura:audio-settings-changed', null).catch(() => {})
    audioMessage.value = saved.audio_enabled ? '已保存 · 连接中…' : '已保存 · 已停用'
    if (!saved.audio_enabled) stopAudio()
    if (saved.audio_enabled) audioMessage.value = await connectSavedService('speech')
    else void checkLocalServices()
  } catch {
    if (previousEnabled !== undefined) settings.value.audio_enabled = previousEnabled
    audioMessage.value = '保存失败，请检查本地服务与凭据管理器'
  }
  finally { audioSaving.value = false }
}
async function removeAudioKey() {
  try { const saved = await clearAudioKey(); settings.value = { ...settings.value, ...saved, audio_api_key: '' }; stopAudio(); void emitTo('dialog', 'deskaura:audio-settings-changed', null).catch(() => {}); void emitTo('main', 'deskaura:audio-settings-changed', null).catch(() => {}); audioMessage.value = '密钥已删除' }
  catch { audioMessage.value = '删除失败，请检查凭据管理器' }
}
const alwaysOnTop = ref(localStorage.getItem('deskaura-on-top') !== 'false')
const settingsSaving = ref(false)
const settingsMessage = ref('')
const cloudMessage = ref('')
const localChecking = ref(false)
const serviceTestProgress = ref('')
const selectedLibraryMotion = ref('gesture:idle')
async function previewLibraryMotion() {
  const [kind, id] = selectedLibraryMotion.value.split(':')
  if (kind === 'gesture') await previewGesture(id!)
  else await previewEmotion(id!)
}
const durationMessage = ref('')
const emotionLabels: Record<string, string> = { neutral: '正常', happy: '开心', sad: '伤心', angry: '生气', nervous: '紧张', serious: '严肃', fearful: '恐惧', surprised: '惊讶', disgusted: '厌恶', shy: '害羞', tired: '疲倦', curious: '好奇', confident: '自信', affectionate: '撒娇' }
const motionPreviewFeedback = ref('')
let motionPreviewFeedbackRevision = 0
function clearMotionPreviewFeedback() {
  motionPreviewFeedbackRevision++
  motionPreviewFeedback.value = ''
}
function beginMotionPreviewFeedback() {
  clearTimeout(memoryNoticeTimer); memoryConfiguration.value = ''
  motionPreviewFeedback.value = '正在加载动作…'
  return ++motionPreviewFeedbackRevision
}
function showMotionPreviewFeedback(revision: number, value: string) {
  if (revision === motionPreviewFeedbackRevision) motionPreviewFeedback.value = value
}
const gestureLabels: Record<string, string> = { ...standbyLabels, idle: '自然待机', thinking_loop: '思考', wave: '友好挥手', nod: '点头回应', bow: '礼貌鞠躬', clap: '轻轻鼓掌', celebrate: '开心庆祝', point: '指向介绍', shrug: '轻轻耸肩' }
const standbyGestureIds = new Set<string>([...standbyMotionIds, 'idle'])
const standbyGestureMotion = (id: string): Motion => {
  return standbyMotionIds.includes(id as StandbyId) ? standbyMotion(id as StandbyId) : idleMotion()
}
const libraryOptions = computed(() => [
  ...standbyLibraryOptions,
  ...Object.entries(emotionLabels).map(([id,label]) => ({ value: `emotion:${id}`, label: `${label}回答`, group: '回答动作' })),
  ...Object.entries(gestureLabels).filter(([id]) => !standbyGestureIds.has(id)).map(([id,label]) => ({ value: `gesture:${id}`, label, group: '常用动作' })),
])
const motionModeOptions = [
  { value: 'online', label: '在线', description: '回答动作和动作请求均现场生成' },
  { value: 'offline', label: '离线', description: '回答动作和动作请求均使用本地动作库' },
  { value: 'hybrid', label: '混合', description: '回答用本地动作，动作请求优先云端、失败兜底' },
]
const durationModeOptions = [{ value: 'auto', label: '自动时长', description: '原生预测优先，否则由对话模型估算' }, { value: 'manual', label: '手动时长', description: '使用指定的固定秒数' }]
const speechFormatOptions = computed(() => speechPreset.value.formats.map(value => ({ value, label: value.toUpperCase() })))
const motionModeNote = computed(() => motionModeOptions.find(option => option.value === (settings.value.motion_mode || 'hybrid'))?.description)
async function previewGesture(id: string) {
  const revision = beginMotionPreviewFeedback()
  try {
    if (standbyGestureIds.has(id)) {
      await emitTo('main', 'deskaura:reply', { motion: standbyGestureMotion(id), emotion: id === 'sleep' ? 'tired' : id === 'sing' ? 'happy' : 'neutral' })
      showMotionPreviewFeedback(revision, `${gestureLabels[id]}：已发送到桌宠循环播放。`)
      return
    }
    const response = await fetch(`http://127.0.0.1:8002/api/motion/library/cloud_${id}`)
    if (!response.ok) throw new Error('归档不可用')
    const clip = await response.json()
    if (revision !== motionPreviewFeedbackRevision) return
    await emitTo('main', 'deskaura:reply', { motion: { id: clip.id, kind: 'hymotion', url: `/api/motion/library/${clip.id}`, duration: clip.duration, loop: clip.loop === true }, emotion: 'neutral' })
    showMotionPreviewFeedback(revision, `${gestureLabels[id]}：已发送到桌宠${clip.loop ? '循环' : '单次'}播放。`)
  } catch { showMotionPreviewFeedback(revision, '播放失败，请确认动作服务在线，并先应用一个支持动作的角色。') }
}
async function previewEmotion(id: string) {
  const revision = beginMotionPreviewFeedback()
  try {
    const response = await fetch(`http://127.0.0.1:8002/api/motion/emotion/${id}`)
    if (!response.ok) throw new Error('归档不可用')
    const result = await response.json()
    if (revision !== motionPreviewFeedbackRevision) return
    await emitTo('main', 'deskaura:reply', { motion: result.motion, emotion: id })
    showMotionPreviewFeedback(revision, `${emotionLabels[id]}：${result.motion.archive_fallback ? '此片段缺失，正在播放归档待机' : '已发送到桌宠循环播放'}；点击停止可回到待机。`)
  } catch { showMotionPreviewFeedback(revision, '播放失败，请确认动作服务在线，并先应用一个支持动作的角色。') }
}
async function stopEmotionPreview() {
  const revision = beginMotionPreviewFeedback()
  await emitTo('main', 'deskaura:cancel-thinking', null).catch(() => {})
  showMotionPreviewFeedback(revision, '已停止预览')
}
const settings = ref<ModelSettings>({
  base_url: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  api_key: '',
  motion_duration: 6,
  motion_duration_mode: 'auto',
  audio_enabled: false,
  audio_provider: 'compatible',
  audio_base_url: 'https://api.openai.com/v1',
  audio_model: 'gpt-4o-mini-tts',
  audio_voice: 'alloy',
  audio_api_key: '',
  audio_format: 'mp3', audio_speed: 1, audio_sample_rate: 24000,
})
type SettingsSection = 'role' | 'brain' | 'persona' | 'memory' | 'hearing' | 'voice' | 'motion'
const settingsSection = ref<SettingsSection>('role')
const settingsRoles = ref<StoredModel[]>([])
const settingsRoleId = ref(localStorage.getItem('deskaura-active-model') || '')
const personaTemplate = ref('无')
const personaText = ref('')
const personaTemplates: Record<string, string> = {
  '无': '',
  '温柔陪伴': '角色名称：\n身份/身世：\n性格：温柔、耐心、尊重边界。\n说话风格：自然、简洁，适度表达关心。\n和你的关系：日常陪伴者。\n禁忌：不泄露隐私，不做未经确认的危险操作。\n世界观：\n背景故事：',
  '元气伙伴': '角色名称：\n身份/身世：\n性格：积极、开朗、可靠。\n说话风格：有活力但不喧闹，先解决问题再开玩笑。\n和你的关系：值得信赖的伙伴。\n禁忌：\n世界观：\n背景故事：',
  '专注助手': '角色名称：\n身份/身世：\n性格：专注、清晰、务实。\n说话风格：先给结论，再给必要步骤。\n和你的关系：工作与学习助手。\n禁忌：执行文件或命令前必须说明风险并请求确认。\n世界观：\n背景故事：',
}
/** Keep the IndexedDB role record in sync with the current module settings.
 * Secrets are filtered by updateRoleConfig; backend credentials remain in the
 * OS credential store and are never copied into a character record.
 */
async function persistRoleConfig(patch: Record<string, unknown> = {}) {
  const id = settingsRoleId.value || roleId.value
  if (!id || id === 'default') return
  try {
    await updateRoleConfig(id, {
      ...(settingsRoles.value.find(item => item.id === id)?.roleConfig || {}),
      ...patch,
      session_path: settingsRoles.value.find(item => item.id === id)?.sessionPath || `deskaura://roles/${encodeURIComponent(id)}/session`,
      memory_path: settingsRoles.value.find(item => item.id === id)?.memoryPath || `deskaura://roles/${encodeURIComponent(id)}/memory`,
    })
  } catch {
    // Role persistence is supplementary; a backend save must not be reported
    // as failed just because IndexedDB is temporarily unavailable.
  }
}
function moduleStatus(label: string) {
  const aliases: Record<string, string[]> = {
    brain: ['大脑'], hearing: ['听觉'], voice: ['语音'], motion: ['动作'],
    memory: ['记忆'], persona: [],
  }
  const hit = aliases[label]?.map(name => serviceStatuses.value.find(item => item.name === name)).find(Boolean)
  return hit?.running ? '正常' : hit?.state === 'error' ? '异常' : hit ? '未知' : '未检测'
}
function serviceLabel(name: string) {
  return ({ '对话模型': '大脑', '语音识别': '听觉', '语音合成': '语音', '动作模型': '动作', '记忆服务': '记忆' } as Record<string, string>)[name] || name
}
const settingsModuleItems = [
  { id: 'brain' as SettingsSection, label: '大脑', hint: '模型对话' },
  { id: 'persona' as SettingsSection, label: '人设', hint: '角色提示与背景' },
  { id: 'memory' as SettingsSection, label: '记忆', hint: '长期记忆与会话' },
  { id: 'hearing' as SettingsSection, label: '听觉', hint: '语音转文字' },
  { id: 'voice' as SettingsSection, label: '语音', hint: '文字转语音' },
  { id: 'motion' as SettingsSection, label: '动作', hint: '动作生成与动作库' },
]
type ModuleToggle = 'brain_enabled' | 'persona_enabled' | 'memory_enabled' | 'asr_enabled' | 'audio_enabled' | 'motion_enabled'
async function saveModuleEnabled(field: ModuleToggle, enabled: boolean) {
  settings.value[field] = enabled
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({ base_url: current.base_url, model: current.model, [field]: enabled })
    settings.value = { ...settings.value, ...saved, api_key: '', asr_api_key: '', audio_api_key: '', motion_api_key: '' }
    const roleKey = field === 'asr_enabled' ? 'hearing' : field === 'audio_enabled' ? 'voice' : field.replace('_enabled', '')
    await persistRoleConfig({ [roleKey]: { enabled } })
  } catch {
    settings.value[field] = !enabled
    settingsMessage.value = '模块状态保存失败，请检查本地服务。'
  }
}
function selectSettingsSection(section: SettingsSection) {
  settingsSection.value = section
  const id = section === 'brain' ? 'settings-chat' : section === 'hearing' ? 'settings-recognition' : section === 'voice' ? 'settings-speech' : section === 'motion' ? 'settings-motion' : ''
  if (id) nextTick(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}
async function loadSettingsRoles() {
  try {
    settingsRoles.value = await listModels()
    if (!settingsRoleId.value && settingsRoles.value[0]) settingsRoleId.value = settingsRoles.value[0].id
  } catch { settingsRoles.value = [] }
}
function selectedSettingsRole() { return settingsRoles.value.find(item => item.id === settingsRoleId.value) }
function choosePersonaTemplate(value: string) {
  personaTemplate.value = value
  if (value !== '无' && (!personaText.value.trim() || Object.values(personaTemplates).includes(personaText.value))) personaText.value = personaTemplates[value] || ''
}
async function savePersonaSettings() {
  const role = selectedSettingsRole()
  if (!role) { settingsMessage.value = '请先在主页创建并选择角色'; return }
  try {
    const updated = await updateRoleConfig(role.id, {
      ...(role.roleConfig || {}),
      persona: { template: personaTemplate.value, text: personaText.value },
    })
    settingsRoles.value = settingsRoles.value.map(item => item.id === updated.id ? updated : item)
    settingsMessage.value = '人设已保存到当前角色'
  } catch { settingsMessage.value = '人设保存失败，请稍后重试' }
}
function exportSettingsSnapshot() {
  const role = selectedSettingsRole()
  const snapshot = { exported_at: new Date().toISOString(), role: role ? { id: role.id, name: role.name, path: role.path || role.sourcePath, roleConfig: role.roleConfig || {} } : null, settings: { ...settings.value, api_key: undefined, audio_api_key: undefined, asr_api_key: undefined } }
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${role?.name || 'deskaura'}-配置.json`; anchor.click(); URL.revokeObjectURL(url)
}
const serviceStatuses = ref<ServiceStatus[]>([])
const serviceChecking = ref(false)
const settingsLoading = ref(false)
const settingsLoaded = ref(false)
const gpuWorkerUrl = ref('http://127.0.0.1:6006')
const DEFAULT_WORKER_URL = 'http://127.0.0.1:6006'
const connectionChecking = ref(false)
const workerConnectionMessage = ref('')
function jumpSettings(id?: string) {
  if (!id) return
  if (id === 'settings-services') { void showMemoryConfiguration(); return }
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  document.querySelector<HTMLElement>(`#${id} h4`)?.focus({ preventScroll: true })
}
const memoryConfiguration = ref('')
let memoryNoticeTimer: ReturnType<typeof setTimeout> | undefined
async function showMemoryConfiguration() {
  clearMotionPreviewFeedback()
  const revision = motionPreviewFeedbackRevision
  clearTimeout(memoryNoticeTimer)
  memoryConfiguration.value = '记忆服务 · 本机 127.0.0.1:8001 · SQLite 持久保存'
  try {
    const response = await fetch('http://127.0.0.1:8001/api/memory/status', { signal: AbortSignal.timeout(4000) })
    if (!response.ok) throw new Error()
    const value = await response.json()
    if (revision !== motionPreviewFeedbackRevision) return
    memoryConfiguration.value += typeof value.memory_count === 'number' ? ` · ${value.memory_count} 条记忆` : ''
  } catch { if (revision !== motionPreviewFeedbackRevision) return; memoryConfiguration.value += ' · 暂不可用' }
  memoryNoticeTimer = setTimeout(() => { memoryConfiguration.value = '' }, 8000)
}
async function openSshTunnelTool() {
  try { cloudMessage.value = await invoke<string>('open_ssh_tunnel_tool') }
  catch (error) { cloudMessage.value = typeof error === 'string' ? error : '未能打开 SSH 隧道工具' }
}
async function saveMotionMode(value: string) {
  clearMotionPreviewFeedback()
  const mode = value as 'online' | 'offline' | 'hybrid'
  if (!settingsLoaded.value) return
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({ ...current, motion_mode: mode })
    settings.value = { ...settings.value, ...saved }
    await persistRoleConfig({ motion_mode: mode })
    cloudMessage.value = mode === 'offline' ? '已保存 · 使用本地动作库' : '已保存 · 连接中…'
    if (mode !== 'offline') cloudMessage.value = await connectSavedService('motion')
    else void checkLocalServices()
  } catch { cloudMessage.value = '模式保存失败，请重试' }
}

function saveSpeaking() {
  localStorage.setItem('deskaura-speaking', String(speaking.value))
  if (!speaking.value) stopAudio()
  void emitTo('dialog', 'deskaura:auto-speech', speaking.value).catch(() => {})
  void emitTo('main', 'deskaura:auto-speech', speaking.value).catch(() => {})
  void emitTo('home', 'deskaura:auto-speech', speaking.value).catch(() => {})
}
async function sendQueued(pending?: PendingMessage, fromQueue = false) {
  noteUserInteraction()
  speaking.value = localStorage.getItem('deskaura-speaking') !== 'false'
  const draft = pending?.value ?? text.value
  const attached = pending ? [...pending.attachments] : [...attachments.value]
  const value = draft.trim() || (attached.length ? '请分析我上传的附件。' : '')
  if (!value || attachmentReading.value || historyBusy.value || mediaBusy.value || fileBusy.value) return
  if (fileApproval.value || pendingSystemAction.value) {
    if (enqueueMessage(value, attached, pending?.source || 'text') && !pending) { text.value = ''; attachments.value = [] }
    chatError.value = '请先确认或取消当前操作；下一条消息已保留'
    return
  }
  if (!pending && !queuedMessages.value.length) queuePaused.value = false
  const delivery = messageDelivery(callActive.value, replyActive.value, !fromQueue && !!queuedMessages.value.length)
  if (delivery === 'interrupt') interruptReply()
  else if (delivery === 'queue' || delivery === 'full') {
    if (enqueueMessage(value, attached, pending?.source || 'text') && !pending) { text.value = ''; attachments.value = [] }
    if (delivery === 'full') drainMessages()
    return
  }
  stopAudio()
  awaitingReplyMotion.value = true
  const generation = ++chatGeneration
  const requestRole = roleId.value
  const controller = chatController = new AbortController()
  const pendingIndex = messages.value.length
  let received = false
  let motionDelivered = false
  let plannedMotion: { motion: Motion; emotion: string; gaze?: 'mouse' | 'face'; text?: string } | undefined
  let textCompleted = false
  let replyIndex = -1, streamed = '', streamedTarget = ''
  const sentences = new SpeechSentenceBuffer(sentence => {
    if (generation === chatGeneration && speaking.value && (!callActive.value || !userSpeaking.value)) sentenceAudio.enqueue(sentence)
  })
  const characterStream = new CharacterStream(visible => {
    if (generation !== chatGeneration) return
    streamed = visible
    if (replyIndex >= 0) messages.value[replyIndex]!.text = visible
    lastAudioText.value = visible
    if (plannedMotion) {
      const ready = plannedMotion; plannedMotion = undefined
      deliverMotion(ready.motion, ready.emotion, ready.gaze, ready.text)
    }
    void nextTick(() => messageList.value?.scrollTo({ top: messageList.value.scrollHeight }))
    if (isDialogWindow) {
      if (thinking.value) void emitTo('main', 'deskaura:thinking', false).catch(() => {})
      void emitTo('main', 'deskaura:bubble-stream', { text: visible, done: false }).catch(() => {})
    }
  })
  const cancelCharacterStream = () => characterStream.clear()
  controller.signal.addEventListener('abort', cancelCharacterStream, { once: true })
  const completeReplyText = () => {
    if (textCompleted) return
    textCompleted = true
    sentences.finish()
    textStreaming.value = false
    thinking.value = false
    if (!speaking.value) textReplyUntil = performance.now() + textReplyHoldMs(streamed.length)
    if (isDialogWindow) {
      void emitTo('main', 'deskaura:thinking', false).catch(() => {})
      void emitTo('main', 'deskaura:bubble-stream', { text: streamed, done: true }).catch(() => {})
    }
    returnToIdle()
  }
  const deliverMotion = (value: Motion, replyEmotion: string, gaze?: 'mouse' | 'face', replyText?: string) => {
    if (motionDelivered) return
    // A fast local plan can arrive before the first word. Keep the real
    // thinking state until visible prose begins, then install that ready plan.
    if (!streamed && !textCompleted) {
      plannedMotion = { motion: value, emotion: replyEmotion, gaze, text: replyText }
      return
    }
    motionDelivered = true
    emotion.value = replyEmotion
    // Text remains live while speech waits for this turn's actual motion.
    // Muted replies start their reading hold on arrival, not during generation.
    if (awaitingReplyMotion.value && textCompleted && !speaking.value)
      textReplyUntil = performance.now() + textReplyHoldMs(streamed.length)
    awaitingReplyMotion.value = false
    const speechBound = value.reply_motion === true || value.playback === 'speech' ||
      value.loop === true && !['cloud_idle', 'cloud_thinking_loop'].includes(value.id)
    if (acceptsReplyMotion(speechBound, textStreaming.value, audioBusy.value, pendingSpeech.value,
      speaking.value, textReplyUntil, performance.now())) {
      motion.value = value
      if (isDialogWindow) void emitTo('main', 'deskaura:reply', { motion: value, emotion: replyEmotion, gaze_target: gaze, text: replyText }).catch(() => {})
    }
    // An unavailable/error result also releases otherwise usable speech.
    sentenceAudio.resume()
  }
  messages.value.push({ role: 'user', text: value + attached.map(a => `\n[附件：${a.name}]`).join('') })
  if (!pending) { attachments.value = []; text.value = '' }
  chatError.value = ''; fileApproval.value = null; mediaRequest.value = null
  loading.value = true
  thinking.value = true
  textStreaming.value = true
  try {
    // Sharing only opens a local source. Capture is intent-driven and separately confirmed.
    if (!sessionId.value) {
      const session = await createSession(requestRole)
      if (generation !== chatGeneration || controller.signal.aborted) return
      sessionId.value = session.id
      localStorage.setItem(sessionKey(requestRole), session.id)
    }
    if (generation !== chatGeneration || controller.signal.aborted) return
    if (isDialogWindow) await emitTo('main', 'deskaura:thinking', true)
    if (generation !== chatGeneration || controller.signal.aborted) return
    const reply = await streamChat(value, sessionId.value, attached, delta => {
      if (generation !== chatGeneration) return
      thinking.value = false
      if (replyIndex < 0) { replyIndex = messages.value.length; messages.value.push({ role: 'assistant', text: '' }) }
      received = true; streamedTarget += delta
      characterStream.push(delta)
      sentences.push(delta)
    }, controller.signal, progress => {
      if (generation !== chatGeneration) return
      if (progress.type === 'motion' && progress.motion) {
        deliverMotion(progress.motion, progress.emotion || 'neutral', progress.gaze_target)
      }
    }, requestRole)
    if (generation !== chatGeneration) return
    received = true
    if (replyIndex < 0) { replyIndex = messages.value.length; messages.value.push({ role: 'assistant', text: '' }) }
    if (reply.text && reply.text !== streamedTarget) {
      const missing = reply.text.startsWith(streamedTarget) ? reply.text.slice(streamedTarget.length) : reply.text
      if (!reply.text.startsWith(streamedTarget)) {
        streamedTarget = reply.text
        characterStream.clear()
      }
      if (missing) { streamedTarget = reply.text; characterStream.push(missing); sentences.push(missing) }
    }
    await characterStream.finish()
    if (generation !== chatGeneration || controller.signal.aborted) return
    messages.value[replyIndex]!.text = reply.text
    streamed = reply.text
    completeReplyText()
    lastAudioText.value = reply.text
    if (!motionDelivered) deliverMotion(reply.motion, reply.emotion, reply.gaze_target, reply.text)
    emotion.value = reply.emotion
    if (reply.motion.generation_error) chatError.value = reply.motion.generation_error
    else if (reply.motion.archive_fallback) voiceInputStatus.value = '云端不可用 · 已使用本地动作'
    fileApproval.value = reply.file_approval || null
    void refreshSessions()
    if (isDialogWindow) {
      try {
        if (reply.text) await emitTo('main', 'deskaura:bubble-stream', { text: reply.text, done: true })
      } catch (error) {
        console.warn('[DeskAura] 动作同步到角色窗口失败:', error)
      }
    }
    if (generation !== chatGeneration || controller.signal.aborted) return
    demoMode.value = reply.demo_mode
    void refreshInteractionState()
    if (isDialogWindow) void emitTo('main', 'deskaura:interaction-settings', null).catch(() => {})
    mediaRequest.value = reply.media_request || null
    // Reply loops follow the ENTIRE speech queue, not an estimated per-sentence
    // timer. Only muted text replies use a short reading-time fallback.
    await executeSystemAction(reply.system_action)
  } catch (error) {
    if (generation !== chatGeneration) return
    if (!received) {
      // A failed send must not create a second waiting item or discard a newer draft.
      const keepFailedMessage = pending && queuedMessages.value.length && (text.value.trim() || attachments.value.length)
      if (!keepFailedMessage) messages.value.splice(pendingIndex, 1)
      if (pending && fromQueue && !callActive.value && !queuedMessages.value.length) { queuedMessages.value = [pending]; queuePaused.value = true }
      else if (!text.value.trim() && !attachments.value.length) { text.value = draft; attachments.value = attached }
    }
    stopAudio()
    chatError.value = error instanceof Error ? error.message : received ? '回复已收到，但后续操作失败。' : '发送失败，请重试。'
    if (!received) void reportClientFailure('chat', requestRole)
  } finally {
    controller.signal.removeEventListener('abort', cancelCharacterStream)
    characterStream.clear()
    if (generation !== chatGeneration) return
    chatController = undefined
    awaitingReplyMotion.value = false
    sentenceAudio.resume()
    loading.value = false
    thinking.value = false
    textStreaming.value = false
    if (isDialogWindow) await emitTo('main', 'deskaura:thinking', false).catch(() => {})
    returnToIdle()
    drainMessages()
  }
}

async function send() { await sendQueued() }

function enqueueMessage(value: string, attached: Attachment[] = [], source: 'text' | 'voice' = 'voice') {
  if (callActive.value) return false
  if (queuedMessages.value.length) { chatError.value = '已有一条待发送消息，请先发送或取消；当前输入已保留'; return false }
  queuedMessages.value.push({ value, attachments: attached, source })
  return true
}
function cancelPendingMessage() {
  queuedMessages.value = []; queuePaused.value = false
  if (/待发送消息|等待消息/.test(chatError.value)) chatError.value = ''
}
function sendPendingMessage() {
  if (!queuedMessages.value.length || callActive.value) return
  queuePaused.value = false
  if (replyActive.value) interruptReply()
  else drainMessages()
}
function drainMessages() {
  if (callActive.value || replyActive.value || fileApproval.value || pendingSystemAction.value || mediaBusy.value || fileBusy.value || historyBusy.value || attachmentReading.value || !queuedMessages.value.length || queuePaused.value) return
  const pending = queuedMessages.value.shift()!
  void sendQueued(pending, true)
}
function transcript(value: string) {
  userSpeaking.value = false
  const recognized = value.trim()
  if (!recognized) return
  if (callActive.value && replyActive.value) interruptReply()
  if (mediaBusy.value || fileBusy.value || historyBusy.value || attachmentReading.value) {
    if (!text.value.trim() && !attachments.value.length) text.value = recognized
    chatError.value = '正在处理其他操作，请稍后发送；本次识别内容未发送'
    return
  }
  if (!callActive.value && queuedMessages.value.length) {
    if (!text.value.trim()) text.value = recognized
    chatError.value = '已有一条待发送消息，请先发送或取消；本次语音未发送'
    return
  }
  void sendQueued({ value: recognized, attachments: [], source: 'voice' })
}

function interruptSpeech() {
  // Outside a call, voice input is queued; only the square button interrupts.
  if (callActive.value && replyActive.value) interruptReply()
}
function interruptReply() {
  chatGeneration++; chatController?.abort(); chatController = undefined
  queuePaused.value = false
  loading.value = false
  thinking.value = false
  textStreaming.value = false
  stopAudio()
  void emitTo('main', 'deskaura:interrupt-speech', null).catch(() => {})
  void emitTo('main', 'deskaura:cancel-thinking', null).catch(() => {})
  if (!callActive.value) drainMessages()
}
async function toggleCall() {
  if (callActive.value) { endCall(); return }
  if (callStarting.value) return
  if (queuedMessages.value.length) { chatError.value = '请先发送或取消待发送消息，再开始通话'; return }
  const generation = ++callStartGeneration, scope = historyScope.capture(roleId.value)
  callStarting.value = true; chatError.value = ''
  try {
    // The role can be edited in another window immediately before dialing.
    const cfg = await getModelSettings(scope.roleId)
    if (generation !== callStartGeneration || !historyScope.accepts(scope, roleId.value)) return
    applyRuntimeSettings(cfg)
    if (!asrEnabled.value) { chatError.value = '听觉模块已停用，请先在角色模块中开启'; return }
    callActive.value = true; callMic.value = true; autoGaze.value = 'face'
    void emitTo('main', 'deskaura:gaze-target', 'face').catch(() => {})
    if (visionEnabled.value) await toggleCallCamera()
  } catch (error) {
    if (generation === callStartGeneration && historyScope.accepts(scope, roleId.value))
      chatError.value = error instanceof Error ? error.message : '无法读取当前角色的通话配置，请稍后重试'
  } finally {
    if (generation === callStartGeneration) callStarting.value = false
  }
}
function endCall() {
  callStartGeneration++; callStarting.value = false
  mediaRequestGeneration.value++
  mediaRequest.value = null
  callActive.value = false; callMic.value = false; callCamera.value = false; screenSharing.value = false; userSpeaking.value = false
  callCameraLease.stop(); screenLease.stop()
}
async function toggleCallCamera() {
  if (callBusy.value || mediaBusy.value) return
  if (callCamera.value) { callCameraLease.stop(); callCamera.value = false; return }
  callBusy.value = true
  const scope = historyScope.capture(roleId.value)
  try {
    const cfg = await getModelSettings(scope.roleId)
    if (!historyScope.accepts(scope, roleId.value) || !callActive.value) return
    if (cfg.vision_enabled === false) throw new Error('视觉模块已停用')
    const video = await callCameraLease.start(cfg.vision_camera_id || '')
    if (!historyScope.accepts(scope, roleId.value) || !callActive.value) { callCameraLease.stop(); return }
    visionCamera.value = cfg.vision_camera_id || ''
    callCamera.value = true; await nextTick()
    if (cameraPreview.value) { cameraPreview.value.srcObject = video.srcObject; await cameraPreview.value.play() }
  } catch (error) { chatError.value = error instanceof Error ? error.message : '无法开启摄像头' }
  finally { callBusy.value = false }
}
async function toggleScreenShare() {
  if (mediaBusy.value) return
  if (screenSharing.value) { screenLease.stop(); screenSharing.value = false; return }
  if (!capabilities.value.image_input) { chatError.value = '模型图片输入能力未知或不支持，暂不能共享屏幕。'; return }
  try {
    await screenLease.start()
    if (!callActive.value) { screenLease.stop(); return }
    screenSharing.value = !!screenLease.stream?.active
    screenLease.stream?.getVideoTracks()[0]?.addEventListener('ended', () => { screenSharing.value = false }, { once: true })
  } catch (error) { chatError.value = error instanceof Error ? error.message : '未开启屏幕共享' }
}
async function confirmMediaCapture(approve: boolean) {
  const request = mediaRequest.value
  if (!request || mediaBusy.value || loading.value || historyBusy.value || fileBusy.value || attachmentReading.value) return
  if (!approve) { mediaRequest.value = null; return }
  if (text.value.trim() || attachments.value.length) { chatError.value = '请先发送或清空当前草稿，再采集画面。'; return }
  mediaRequest.value = null
  if (!capabilities.value.image_input) { chatError.value = '模型图片输入能力未知或不支持，未采集画面。'; return }
  mediaBusy.value = true
  const generation = ++mediaRequestGeneration.value
  const captureSession = sessionId.value
  let temporaryCamera = false, temporaryScreen = false
  try {
    if (request.source === 'camera' && !callCameraLease.video) {
      const cfg = await getModelSettings(roleId.value)
      if (cfg.vision_enabled === false) throw new Error('视觉模块已停用')
      temporaryCamera = true; await callCameraLease.start(cfg.vision_camera_id || '')
    }
    if (request.source === 'screen' && !screenLease.stream?.active) { temporaryScreen = true; await screenLease.start() }
    const frames: Attachment[] = []
    const count = request.kind === 'record' ? Math.min(3, capabilities.value.max_attachments) : 1
    const seconds = Math.max(2, Math.min(8, request.duration || 4))
    for (let index = 0; index < count; index++) {
      if (index) await new Promise(resolve => window.setTimeout(resolve, seconds * 1000 / Math.max(1, count - 1)))
      if (generation !== mediaRequestGeneration.value || captureSession !== sessionId.value) throw new Error('采集已取消，未上传画面。')
      frames.push(request.source === 'camera' ? cameraFrame(callCameraLease.video!, `摄像头_${index + 1}.jpg`) : screenLease.frame(`屏幕_${index + 1}.jpg`))
    }
    if (generation !== mediaRequestGeneration.value || captureSession !== sessionId.value) throw new Error('采集已取消，未上传画面。')
    attachments.value = frames
    text.value = request.kind === 'record' ? '这是经我确认采集的短时序画面，请按图片顺序分析。它不是完整视频，也不含声音。' : '这是经我确认采集的画面，请查看并继续回答。'
    mediaBusy.value = false
    if (generation === mediaRequestGeneration.value) await send()
  } catch (error) { chatError.value = error instanceof Error ? error.message : '画面采集失败，未上传。' }
  finally {
    if (temporaryCamera) callCameraLease.stop()
    if (temporaryScreen) screenLease.stop()
    mediaBusy.value = false
    drainMessages()
  }
}
let gazeSettingsRevision = 0
let runtimeAudioSignature = ''
function applyRuntimeSettings(cfg: ModelSettings) {
  if (callCamera.value && (cfg.vision_enabled === false || (cfg.vision_camera_id || '') !== visionCamera.value)) {
    callCameraLease.stop(); callCamera.value = false
  }
  gazeMode.value = cfg.gaze_mode || 'face'; gazeEnabled.value = cfg.gaze_enabled !== false
  visionEnabled.value = cfg.vision_enabled !== false
  visionCamera.value = cfg.vision_camera_id || ''
  asrEnabled.value = cfg.asr_enabled === true
  clickFeedbackEnabled.value = cfg.click_feedback_enabled !== false
  standbyEnabled.value = cfg.standby_enabled !== false
  bubbleEnabled.value = cfg.bubble_enabled !== false
  if (!asrEnabled.value && callActive.value) endCall()
  const audioSignature = JSON.stringify([
    cfg.audio_enabled, cfg.audio_provider, cfg.audio_base_url, cfg.audio_model, cfg.audio_voice,
    cfg.audio_format, cfg.audio_speed, cfg.audio_sample_rate, cfg.audio_api_key_masked, cfg.audio_revision,
  ])
  if (cfg.audio_enabled === false || runtimeAudioSignature && runtimeAudioSignature !== audioSignature) {
    stopAudio(); audioPlayer.invalidate()
  }
  runtimeAudioSignature = audioSignature
  demoMode.value = !cfg.ready
  gazeSettingsLoaded.value = true
}
function receiveRuntimeSettings(event: { payload: { roleId: string; settings: ModelSettings } }) {
  if (event.payload.roleId !== roleId.value) return
  gazeSettingsRevision++
  const cfg = event.payload.settings
  settings.value = { ...settings.value, ...cfg }
  if (cfg.brain_enabled === false) {
    queuedMessages.value = []
    interruptReply()
  }
  if (cfg.tools_enabled === false) {
    fileApproval.value = null
    pendingSystemAction.value = null
  }
  if (cfg.motion_enabled === false && remoteReplyActive.value) {
    remoteReplyActive.value = false
    normalIdle()
  }
  applyRuntimeSettings(cfg)
}
async function refreshGazeSettings() {
  const revision = ++gazeSettingsRevision
  const scope = historyScope.capture(roleId.value)
  try {
    const cfg = await getModelSettings(scope.roleId)
    if (revision !== gazeSettingsRevision || !historyScope.accepts(scope, roleId.value)) return
    applyRuntimeSettings(cfg)
    const nextOffended = await getInteractionOffended(scope.roleId)
    if (revision === gazeSettingsRevision && historyScope.accepts(scope, roleId.value)) offended.value = nextOffended
  } catch { /* Keep last known choice; do not open devices from defaults. */ }
}
async function refreshInteractionState() {
  const token = historyScope.capture(roleId.value)
  try {
    const value = await getInteractionOffended(token.roleId)
    if (historyScope.accepts(token, roleId.value)) offended.value = value
  }
  catch { /* Preserve the current local state if the backend is starting. */ }
}
let faceProofAt = -Infinity, faceProofBusy = false, faceProofScope = ''
function syncFaceTracking() {
  if (!isDialogWindow && gazeSettingsLoaded.value && visionEnabled.value &&
      faceTrackingAllowed(gazeMode.value, gazeEnabled.value, !!appliedLibraryModel, modelLoaded.value, petVisible.value)) {
    void faceTracker.start(target => {
      faceTarget.value = target
      const scope = `${roleId.value}:${visionCamera.value}`
      const now = performance.now()
      if (target.visible && (target.confidence ?? 0) > 0 && !faceProofBusy &&
          (scope !== faceProofScope || now - faceProofAt > 60000)) {
        const id = roleId.value, camera = visionCamera.value
        faceProofBusy = true
        faceProofAt = now; faceProofScope = scope
        void verifyFaceDetection({ faces: 1, confidence: target.confidence! }, id, camera)
          .then(() => Promise.all(['home', 'settings'].map(window => emitTo(window, 'deskaura:module-status-changed', id).catch(() => {}))))
          .catch(() => { faceProofAt = performance.now() - 50000 })
          .finally(() => { faceProofBusy = false })
      }
      if (standbySchedule.observeFace(target.visible, performance.now()) && standbyActive.value) normalIdle()
    }, status => {
      void emitTo('home', 'deskaura:face-status', status).catch(() => {})
    }, visionCamera.value, () => { standbySchedule.observeFace(null, performance.now()) })
  } else {
    standbySchedule.observeFace(null, performance.now())
    faceTracker.stop()
    faceTarget.value = { x: 0, y: 0, visible: false }
  }
}
watch(visionCamera, () => { standbySchedule.observeFace(null, performance.now()); faceTracker.stop(); syncFaceTracking() })
watch([gazeMode, gazeEnabled, visionEnabled, gazeSettingsLoaded, modelLoaded, petVisible], syncFaceTracking)

/** 根据后端返回的 system_action 执行白名单系统操作。 */
async function executeSystemAction(action?: SystemAction | null, approved = false) {
  if (!action) return
  const scope = historyScope.capture(roleId.value), session = sessionId.value
  try {
    const cfg = await getModelSettings(scope.roleId)
    if (!historyScope.accepts(scope, roleId.value) || session !== sessionId.value) return
    const policy = systemOperationPolicy(cfg)
    if (policy === 'deny') throw new Error('当前权限不允许系统操作')
    if (policy === 'confirm' && !approved) {
      pendingSystemAction.value = { action: { ...action }, roleId: scope.roleId, sessionId: session }
      return
    }
    const param =
      action.type === 'open_url' ? action.url : action.type === 'volume' ? action.command : action.app
    if (!isTauri()) throw new Error('系统操作需要桌面程序')
    await invoke('run_system_action', { actionType: action.type, param: param ?? null })
    if (historyScope.accepts(scope, roleId.value) && session === sessionId.value) voiceInputStatus.value = '系统操作已完成'
  } catch (error) {
    if (historyScope.accepts(scope, roleId.value) && session === sessionId.value)
      chatError.value = error instanceof Error ? error.message : '系统操作失败'
  }
}
async function confirmSystemAction(approved: boolean) {
  const pending = pendingSystemAction.value
  if (!pending || systemActionBusy.value) return
  pendingSystemAction.value = null
  if (!approved || pending.roleId !== roleId.value || pending.sessionId !== sessionId.value) { drainMessages(); return }
  systemActionBusy.value = true
  try { await executeSystemAction(pending.action, true) }
  finally { systemActionBusy.value = false; drainMessages() }
}

async function openDialog(tab: 'chat' | 'settings' = 'chat') {
  noteUserInteraction()
  if (tab === 'settings') {
    await raiseOwnedWindow('home'); return
  }
  const existing = await WebviewWindow.getByLabel('dialog')
  if (existing) {
    await emitTo('dialog', 'deskaura:tab', tab)
    await raiseOwnedWindow('dialog')
    return
  }
  const main = getCurrentWindow()
  const [origin, scale] = await Promise.all([main.outerPosition(), main.scaleFactor()])
  const monitor = await currentMonitor()
  const area = monitor?.workArea
  const x = area ? Math.max(area.position.x / scale, (area.position.x + area.size.width) / scale - 480) : origin.x / scale + 20
  const dialog = new WebviewWindow('dialog', {
    url: `/?dialog=1&tab=${tab}`, title: 'DeskAura 对话', width: 460, height: 680, minWidth: 360, minHeight: 420,
    x: Math.round(x), y: Math.round((area?.position.y ?? origin.y) / scale + 20),
    decorations: false, transparent: true, alwaysOnTop: alwaysOnTop.value, resizable: true, dragDropEnabled: false,
  })
  dialog.once('tauri://error', error => console.error('[DeskAura] 对话窗口创建失败:', error))
}

const chatMaximized = ref(false)
const resizeEdges = ['North', 'NorthEast', 'East', 'SouthEast', 'South', 'SouthWest', 'West', 'NorthWest'] as const
function resizeChat(direction: typeof resizeEdges[number], event: PointerEvent) {
  if (event.button === 0) void getCurrentWindow().startResizeDragging(direction)
}
async function toggleChatSize() {
  const win = getCurrentWindow()
  if (await win.isMaximized()) await win.unmaximize()
  else await win.maximize()
  chatMaximized.value = await win.isMaximized()
}
async function dragChat(event: MouseEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
  await getCurrentWindow().startDragging()
}

/** 关闭对话框时恢复贴合角色的窗口尺寸。 */
async function closeDialog() {
  chatGeneration++
  chatController?.abort(); queuedMessages.value = []
  stopAudio()
  // Cancel the thinking state before destroying the dialog; otherwise the pet window
  // can keep the thinking pose when the user closes the chat mid-request.
  loading.value = false
  motion.value = idleMotion()
  thinking.value = false
  textStreaming.value = false
  await emitTo('main', 'deskaura:cancel-thinking', null).catch(() => {})
  await getCurrentWindow().close()
}

// ---- 模型包围盒自适应窗口 + 像素级点击穿透 ----
// alpha 遮罩（缩小网格），用于判断鼠标是否落在非透明区域
let alphaMask: { pixels: Uint8Array; width: number; height: number } | null = null
let maskTime = 0
// 当前窗口是否处于“穿透”状态，避免重复调用
let ignoreCursor = false
// 宠物本体尺寸（贴合角色后的窗口尺寸），用于对话框收起时恢复
let petWidth = 420
let petHeight = 560
// AvatarStage 组件引用，用于 resize 后重新拟合相机
const avatarRef = ref<InstanceType<typeof AvatarStage> | null>(null)
const bubbleEnabled = ref(true)
const bubbleText = ref('')
const headAnchor = ref({ x: 0, y: 0, visible: false })
let bubbleTimer: number | undefined
let interactionTimer: number | undefined
let lastTouchAt = -Infinity
const bubbleStyle = computed(() => ({ left: `${Math.max(170, Math.min(window.innerWidth - 170, headAnchor.value.x))}px`, top: `${Math.max(140, headAnchor.value.y - 28)}px` }))
const thinkingStyle = computed(() => ({ left: `${Math.max(80, Math.min(window.innerWidth - 80, headAnchor.value.x + 40))}px`, top: `${Math.max(120, headAnchor.value.y - 20)}px` }))
function showBubble(value: string) {
  clearTimeout(bubbleTimer)
  const pages = bubblePages(value)
  function page(index: number) {
    if (index >= pages.length) { bubbleText.value = ''; return }
    const content = pages[index]
    bubbleText.value = content + (pages.length > 1 ? `\n${index + 1} / ${pages.length}` : '')
    bubbleTimer = window.setTimeout(() => page(index + 1), Math.max(6500, content.length * 230))
  }
  page(0)
}
function showStreamingBubble(value: string, done: boolean) {
  clearTimeout(bubbleTimer)
  bubbleText.value = streamingBubbleText(value)
  if (done && bubbleText.value) {
    bubbleTimer = window.setTimeout(() => { bubbleText.value = '' }, Math.max(6500, bubbleText.value.length * 230))
  }
}
async function bodyInteraction(region: string) {
  noteUserInteraction()
  if (!clickFeedbackEnabled.value) return
  if (loading.value || (region !== 'private-triple' && performance.now() - lastTouchAt < 1800)) return
  lastTouchAt = performance.now()
  if (offended.value) {
    const text = '走开!不要动我.'
    stopAudio(); clearTimeout(interactionTimer)
    showBubble(text); emotion.value = 'angry'
    motion.value = { id: 'cloud_emotion_angry', kind: 'hymotion', url: '/api/motion/library/cloud_emotion_angry', duration: 5, loop: false }
    if (speaking.value) void playReplyAudio(text, true)
    interactionTimer = window.setTimeout(() => { if (!loading.value) { motion.value = idleMotion(); emotion.value = 'neutral' } }, 6500)
    return
  }
  if (region === 'private-triple') {
    const text = '滚啊!变态!!!'
    offended.value = true
    // Do not silently leave only the pet window offended while chat stays friendly.
    try { await setInteractionOffended(true, roleId.value) }
    catch { showBubble('交互状态保存失败，请检查本地服务。'); return }
    stopAudio(); clearTimeout(interactionTimer)
    showBubble(text); emotion.value = 'angry'
    motion.value = { id: 'cloud_emotion_angry', kind: 'hymotion', url: '/api/motion/library/cloud_emotion_angry', duration: 5, loop: false }
    if (speaking.value) void playReplyAudio(text, true)
    interactionTimer = window.setTimeout(() => {
      if (!loading.value) { motion.value = idleMotion(); emotion.value = 'neutral' }
    }, 6500)
    return
  }
  const reactions: Record<string, { text: string; emotion: string; clip: string }> = {
    head: { text: '不要动我的头啦，发型要乱了。', emotion: 'shy', clip: 'nod' },
    hand: { text: '牵一下手吗？我在这里呢。', emotion: 'happy', clip: 'wave' },
    arm: { text: '戳戳手臂，是在叫我吗？', emotion: 'curious', clip: 'shrug' },
    torso: { text: '这里不要乱戳哦，轻一点。', emotion: 'serious', clip: 'shrug' },
    belly: { ...bellyReaction, clip: 'emotion_happy' },
    chest: { text: '这里不要乱碰，我会生气的。', emotion: 'serious', clip: 'emotion_serious' },
    groin: { text: '不可以碰这里，请尊重我的边界。', emotion: 'serious', clip: 'emotion_serious' },
    leg: { text: '嘿，小心让我站稳呀。', emotion: 'surprised', clip: 'nod' },
    foot: { text: '我的鞋子也被你发现啦。', emotion: 'happy', clip: 'nod' },
  }
  const reaction = reactions[region]
  if (!reaction) return
  stopAudio(); clearTimeout(interactionTimer)
  showBubble(reaction.text); emotion.value = reaction.emotion
  motion.value = { id: `cloud_${reaction.clip}`, kind: 'hymotion', url: `/api/motion/library/cloud_${reaction.clip}`, duration: 5, loop: false }
  // Ephemeral by design: no chat request, session append or memory-service call.
  if (speaking.value) void playReplyAudio(reaction.text)
  interactionTimer = window.setTimeout(() => { if (!loading.value) { motion.value = idleMotion(); emotion.value = 'neutral' } }, 6500)
}
async function saveInteractionSettings() {
  clearMotionPreviewFeedback()
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({ ...current, bubble_enabled: settings.value.bubble_enabled,
      click_feedback_enabled: settings.value.click_feedback_enabled,
      standby_enabled: settings.value.standby_enabled,
      file_access_enabled: settings.value.file_access_enabled, file_access_root: settings.value.file_access_root,
      execution_enabled: settings.value.execution_enabled, gaze_enabled: settings.value.gaze_enabled, gaze_mode: settings.value.gaze_mode,
      local_operation_mode: settings.value.local_operation_mode,
      local_sandbox_enabled: settings.value.local_sandbox_enabled })
    settings.value = { ...settings.value, ...saved }
    await persistRoleConfig({
      interaction: {
        bubble_enabled: saved.bubble_enabled, file_access_enabled: saved.file_access_enabled,
        click_feedback_enabled: saved.click_feedback_enabled,
        standby_enabled: saved.standby_enabled,
        file_access_root: saved.file_access_root, execution_enabled: saved.execution_enabled,
        gaze_enabled: saved.gaze_enabled, gaze_mode: saved.gaze_mode,
        local_operation_mode: saved.local_operation_mode, local_sandbox_enabled: saved.local_sandbox_enabled,
      },
    })
    void emitTo('main', 'deskaura:bubble-settings', saved.bubble_enabled !== false).catch(() => {})
    void emitTo('main', 'deskaura:interaction-settings', null).catch(() => {})
    interactionMessage.value = '已保存'
  } catch { interactionMessage.value = '保存失败，请检查本地服务。' }
}
const interactionMessage = ref('')
function changeGazeSelection(value: string) {
  Object.assign(settings.value, gazeSelectionPatch(value))
  void saveInteractionSettings()
}
const faceTrackingMessage = ref('尚未开启摄像头')
let offFaceStatus: (() => void) | undefined
let faceListenerDestroyed = false
if (isSettingsOnly) void listen<string>('deskaura:face-status', event => { faceTrackingMessage.value = event.payload }).then(off => { if (faceListenerDestroyed) off(); else offFaceStatus = off }).catch(() => {})
async function enableFaceTracking() {
  await saveInteractionSettings()
  faceTrackingMessage.value = '等待设备授权…'
  try { await emitTo('main', 'deskaura:enable-face', null) }
  catch { faceTrackingMessage.value = '请先应用一个桌面角色，再开启检测' }
}
const asrMessage = ref('')
const asrSaving = ref(false)
async function saveRecognitionSettings() {
  clearMotionPreviewFeedback()
  asrSaving.value = true
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({ ...current, ...Object.fromEntries(Object.entries(settings.value).filter(([key]) => key.startsWith('asr_'))) })
    settings.value = { ...settings.value, ...saved, asr_api_key: '' }
    await persistRoleConfig({ hearing: Object.fromEntries(Object.entries(saved).filter(([key]) => key.startsWith('asr_'))) })
    asrMessage.value = saved.asr_enabled ? '已保存 · 连接中…' : '已保存 · 已停用'
    if (saved.asr_enabled) asrMessage.value = await connectSavedService('recognition')
    else void checkLocalServices()
    void emitTo('dialog', 'deskaura:asr-settings-changed', null).catch(() => {})
  } catch { asrMessage.value = '保存失败，请检查本地接口和凭据管理器。' }
  finally { asrSaving.value = false }
}
async function removeRecognitionKey() {
  try { settings.value = { ...settings.value, ...await clearAsrKey(), asr_api_key: '' }; asrMessage.value = 'ASR 密钥已移除。' }
  catch { asrMessage.value = '移除密钥失败。' }
}

async function onModelFit(_payload: { width: number; height: number }) {
  // 不能仅缩小窗口：alpha 包围盒可能不从左上角开始，直接缩窗会裁掉头/脚。
  // 保持完整画布，由 AvatarStage 的相机拟合保证全身入镜。
}

function onAlphaMask(payload: { pixels: Uint8Array; width: number; height: number }) {
  alphaMask = payload
  maskTime = performance.now()
}

/** 查询某个窗口内坐标 (px, py)（CSS 像素，相对窗口左上角）是否为模型非透明区域。 */
function isOpaqueAt(px: number, py: number): boolean {
  if (!modelLoaded.value) return true
  if (!alphaMask || performance.now() - maskTime > 500) return true
  const rect = (document.querySelector('.pet-stage') as HTMLElement | null)?.getBoundingClientRect()
  if (!rect) return true
  const nx = (px - rect.left) / rect.width
  const ny = (py - rect.top) / rect.height
  if (nx < 0 || nx >= 1 || ny < 0 || ny >= 1) return false
  const x = Math.floor(nx * alphaMask.width)
  const y = alphaMask.height - 1 - Math.floor(ny * alphaMask.height)
  // 与渲染图逐像素比对；向周围扩展 2px 避免抗锯齿/轻微运动令角色失去可点区域。
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const sx = x + dx, sy = y + dy
      if (sx >= 0 && sx < alphaMask.width && sy >= 0 && sy < alphaMask.height &&
          alphaMask.pixels[sy * alphaMask.width + sx] > 8) return true
    }
  }
  return false
}

// isOpaqueAtCss 与 isOpaqueAt 同义，均接受窗口内 CSS 坐标
const isOpaqueAtCss = isOpaqueAt

let passthroughTimer: number | undefined
let passthroughBusy = false
let passthroughPending = false

async function setPassthrough(value: boolean) {
  if (ignoreCursor === value || passthroughPending) return
  passthroughPending = true
  try {
    await setIgnoreCursorEvents(value)
    ignoreCursor = value
    if (value) startPassthroughPoll()
    else if (passthroughTimer) {
      window.clearInterval(passthroughTimer)
      passthroughTimer = undefined
    }
  } finally {
    passthroughPending = false
  }
}

/** 根据鼠标位置动态切换整窗点击穿透。 */
async function updateCursorPassthrough(_px: number, _py: number) {
  const win = getCurrentWindow()
  const [origin, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
  const pos = await getCursorPos()
  if (pos) await setPassthrough(!isOpaqueAt((pos.x - origin.x) / scale, (pos.y - origin.y) / scale))
}

/** 穿透状态下，用全局光标坐标轮询，鼠标回到非透明区域时恢复窗口拦截。 */
function startPassthroughPoll() {
  if (passthroughTimer) window.clearInterval(passthroughTimer)
  passthroughTimer = window.setInterval(async () => {
    if (passthroughBusy) return
    passthroughBusy = true
    try {
      if (!ignoreCursor) return
      const pos = await getCursorPos()
      if (!pos) return
      // 两个值都取 Windows 物理屏幕像素，避免 screenX 的 DPI 语义不一致。
      const win = getCurrentWindow()
      const [origin, scale] = await Promise.all([win.outerPosition(), win.scaleFactor()])
      const cssX = (pos.x - origin.x) / scale
      const cssY = (pos.y - origin.y) / scale
      const root = document.querySelector('.pet-root') as HTMLElement | null
      if (!root) return
      const rect = root.getBoundingClientRect()
      if (cssX >= 0 && cssX < rect.width && cssY >= 0 && cssY < rect.height && isOpaqueAtCss(cssX, cssY)) {
        await setPassthrough(false)
      }
    } catch (error) {
      console.warn('[DeskAura] 穿透恢复失败:', error)
    } finally {
      passthroughBusy = false
    }
  }, 100)
}

function onPointerMove(event: PointerEvent) {
  if (isDialogWindow || dialogOpen.value || event.buttons !== 0) return
  void updateCursorPassthrough(event.clientX, event.clientY)
}

let unlistenMain: (() => void) | undefined
let unlistenClose: (() => void) | undefined
let serviceRefreshTimer: number | undefined
onBeforeUnmount(() => {
  historyScope.invalidate()
  faceListenerDestroyed = true; offFaceStatus?.(); clearTimeout(memoryNoticeTimer)
  chatGeneration++
  chatController?.abort(); queuedMessages.value = []
  endCall(); faceTracker.stop()
  stopAudio()
  audioPlayer.dispose()
  clearTimeout(bubbleTimer); clearTimeout(interactionTimer)
  if (standbyTimer) clearInterval(standbyTimer)
  window.removeEventListener('pointerdown', noteUserInteraction)
  window.removeEventListener('keydown', noteUserInteraction)
  window.removeEventListener('resize', resizeComposer)
  window.removeEventListener('deskaura:connectivity-changed', refreshConnectivity)
  clearInterval(serviceRefreshTimer)
  unlistenMain?.()
  unlistenClose?.()
  if (passthroughTimer) window.clearInterval(passthroughTimer)
  if (ignoreCursor) void setIgnoreCursorEvents(false)
})

async function openSettings() {
  panelTab.value = 'settings'
  settingsMessage.value = ''
  void loadSettingsRoles()
  // 对话框是独立窗口，无需扩大宠物窗口。
  if (settingsLoaded.value) return
  settingsLoading.value = true
  // Backend sidecars need a few seconds after startup; retry instead of showing defaults.
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const current = await getModelSettings()
      settings.value = {
        ...current,
        motion_duration_mode: current.motion_duration_mode ?? 'auto',
        api_key: '',
      }
      settingsLoaded.value = true
      gpuWorkerUrl.value = current.motion_worker_url || DEFAULT_WORKER_URL
      settingsMessage.value = ''
      break
    } catch {
      settingsMessage.value = '正在读取已保存的配置…'
      await new Promise(resolve => setTimeout(resolve, 600))
    }
  }
  settingsLoading.value = false
  if (!settingsLoaded.value) settingsMessage.value = '暂时读不到已保存的配置，请点「重新读取」。'
  void checkLocalServices()
  // Explicit button only: cloud verification generates a real GPU clip.
}

async function reloadSettings() {
  settingsLoaded.value = false
  settingsMessage.value = ''
  await openSettings()
}

async function saveSettings() {
  clearMotionPreviewFeedback()
  settingsSaving.value = true
  settingsMessage.value = ''
  try {
    const saved = await saveModelSettings({ base_url: settings.value.base_url, model: settings.value.model, api_key: settings.value.api_key, chat_image_mode: 'auto' })
    settings.value = { ...settings.value, ...saved, api_key: '' }
    demoMode.value = !saved.ready
    settingsLoaded.value = true
    settingsMessage.value = '已保存 · 连接中…'
    void emitTo('dialog', 'deskaura:chat-settings-changed', null).catch(() => {})
    void refreshCapabilities()
    settingsMessage.value = await connectSavedService('chat')
    await persistRoleConfig({ brain: { base_url: saved.base_url, model: saved.model, provider: saved.provider } })
  } catch (error) {
    settingsMessage.value = error instanceof Error ? error.message : '保存失败。'
  } finally {
    settingsSaving.value = false
  }
}

async function saveMotionApiSettings() {
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({
      base_url: current.base_url,
      model: current.model,
      motion_provider: settings.value.motion_provider,
      motion_api_base_url: settings.value.motion_api_base_url,
      motion_api_model: settings.value.motion_api_model,
      motion_api_key: settings.value.motion_api_key,
    })
    settings.value = { ...settings.value, ...saved, motion_api_key: '' }
    await persistRoleConfig({ motion: { provider: saved.motion_provider, base_url: saved.motion_api_base_url, model: saved.motion_api_model } })
    cloudMessage.value = '已保存配置'
  } catch (error) {
    cloudMessage.value = error instanceof Error ? error.message : '动作 API 保存失败'
  }
}

async function removeMotionApiKey() {
  try {
    const saved = await clearMotionKey()
    settings.value = { ...settings.value, ...saved, motion_api_key: '' }
    cloudMessage.value = '动作 API 密钥已移除'
  } catch (error) {
    cloudMessage.value = error instanceof Error ? error.message : '移除动作 API 密钥失败'
  }
}

async function pickAuthorizedFolder() {
  try {
    const path = await invoke<string | null>('pick_folder')
    if (!path) return
    settings.value.file_access_root = path
    await saveInteractionSettings()
  } catch (error) {
    interactionMessage.value = error instanceof Error ? error.message : '选择授权目录失败'
  }
}

async function onAuthorizedFolderDrop(event: DragEvent) {
  const path = (event.dataTransfer?.files?.[0] as (File & { path?: string }) | undefined)?.path
  if (!path) {
    interactionMessage.value = '拖入的项目没有可读取的本机路径，请使用选择文件夹'
    return
  }
  settings.value.file_access_root = path
  await saveInteractionSettings()
}

async function removeKey() {
  const saved = await clearModelKey()
  settings.value = { ...saved, api_key: '' }
  demoMode.value = true
  settingsMessage.value = 'API 密钥已移除，当前使用离线演示模式。'
}

async function onToggleTop() {
  alwaysOnTop.value = await toggleAlwaysOnTop(alwaysOnTop.value)
  localStorage.setItem('deskaura-on-top', String(alwaysOnTop.value))
}

async function checkLocalServices() {
  if (localChecking.value || serviceChecking.value || serviceConnections.size) return
  localChecking.value = true
  serviceStatuses.value = serviceStatuses.value.map(item => ({ ...item, running: false, detail: '正在重新检测…' }))
  try {
    serviceStatuses.value = await getServicesStatus(undefined, false)
  } catch {
    serviceStatuses.value = serviceStatuses.value.map(item => ({ ...item, running: false, online: false, detail: '检测未完成，请重试' }))
  } finally { localChecking.value = false }
}
const serviceConnections = new Set<string>()
const serviceConnectionNames = { chat: '对话模型', recognition: '语音识别', speech: '语音合成', motion: '动作模型' } as const
async function connectSavedService(kind: keyof typeof serviceConnectionNames): Promise<string> {
  clearMotionPreviewFeedback()
  const name = serviceConnectionNames[kind]
  if (serviceConnections.has(kind)) return '已保存 · 正在连接'
  serviceConnections.add(kind)
  clearTimeout(memoryNoticeTimer); memoryConfiguration.value = ''
  serviceTestProgress.value = `连接中 · ${[...serviceConnections].map(value => serviceConnectionNames[value as keyof typeof serviceConnectionNames]).join(' / ')}`
  serviceStatuses.value = serviceStatuses.value.map(item => item.name === name ? { ...item, running: false, state: 'unknown', detail: '正在连接已保存配置…' } : item)
  const player = kind === 'speech' ? new ReplyAudioPlayer() : undefined
  let failure = ''
  try {
    if (kind === 'speech') await player!.verify(undefined, { silent: true })
    else if (kind === 'motion') {
      const result = (await getServicesStatus(undefined, true)).find(item => item.name === '动作模型')
      if (!result?.running) throw new Error(result?.detail || '云端动作链路不可用')
    } else await activeConnectivityTest(kind)
  } catch (error) { failure = error instanceof Error ? error.message : '连接失败' }
  finally {
    player?.dispose()
    serviceConnections.delete(kind)
    try {
      const statuses = await getServicesStatus(undefined, false)
      const latest = statuses.find(item => item.name === name)
      if (!failure && !latest?.running) failure = latest?.detail || '验证结果未能确认连接'
      serviceStatuses.value = statuses.map(item => item.name === name && failure ? { ...item, running: false, state: 'error' as const, detail: failure } : item)
    } catch {
      serviceStatuses.value = serviceStatuses.value.map(item => item.name === name ? { ...item, running: false, state: 'error', detail: failure || '连接状态读取失败' } : item)
    }
    serviceTestProgress.value = serviceConnections.size ? `连接中 · ${[...serviceConnections].map(value => serviceConnectionNames[value as keyof typeof serviceConnectionNames]).join(' / ')}` : failure ? `${name}连接异常` : `${name}已连接`
  }
  return failure ? `已保存 · 连接异常：${failure}` : '已保存 · 已连接'
}
async function detectServices() {
  if (localChecking.value || serviceChecking.value || serviceConnections.size) return
  clearMotionPreviewFeedback()
  clearTimeout(memoryNoticeTimer); memoryConfiguration.value = ''
  serviceChecking.value = true
  serviceTestProgress.value = '检测中'
  const errors = new Map<string, string>()
  const pending = new Set(['对话模型', '语音识别', '语音合成', '动作模型'])
  serviceStatuses.value = ['对话模型', '语音识别', '语音合成', '动作模型', '记忆服务'].map((name, index) => ({
    name, url: '', running: false, latencyMs: null, detail: '检测中',
    section: ['settings-chat', 'settings-recognition', 'settings-speech', 'settings-motion', 'settings-services'][index],
  }))
  const player = new ReplyAudioPlayer()
  const check = async (name: string, test: () => Promise<unknown>) => {
    try { await test() }
    catch (error) { errors.set(name, error instanceof Error ? error.message : '检测失败') }
    finally {
      pending.delete(name)
      serviceTestProgress.value = pending.size ? `检测中 · ${Array.from(pending).join(' / ')}` : '检测完成'
    }
  }
  try {
    await Promise.all([
      check('对话模型', () => activeConnectivityTest('chat')),
      check('语音识别', () => activeConnectivityTest('recognition')),
      check('语音合成', () => player.verify(undefined, { silent: true })),
      check('动作模型', () => getServicesStatus(undefined, true)),
    ])
    const statuses = await getServicesStatus()
    serviceStatuses.value = statuses.map(item => {
      const detail = errors.get(item.name)
      if (detail) return { ...item, running: false, state: 'error' as const, detail }
      return item
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : '检测未完成'
    serviceStatuses.value = serviceStatuses.value.map(item => ({ ...item, running: false, state: 'error', detail }))
  } finally {
    player.dispose()
    serviceChecking.value = false
    serviceTestProgress.value = '检测完成'
  }
}
async function saveDuration() {
  clearMotionPreviewFeedback()
  durationMessage.value = ''
  try {
    const seconds = Number(settings.value.motion_duration)
    if (!Number.isFinite(seconds) || seconds < .5 || seconds > 12) {
      durationMessage.value = '请输入 0.5–12 秒'
      return
    }
    const current = await getModelSettings()
    const saved = await saveModelSettings({ base_url: current.base_url, model: current.model, motion_duration: seconds, motion_duration_mode: 'manual' })
    settings.value = { ...settings.value, ...saved, api_key: '', motion_duration_mode: 'manual' }
    await persistRoleConfig({ motion_duration: seconds, motion_duration_mode: 'manual' })
    durationMessage.value = '已保存 · 连接中…'
    durationMessage.value = await connectSavedService('motion')
  } catch (e) { durationMessage.value = e instanceof Error ? e.message : '保存失败' }
}
async function setDurationMode(value: string) {
  clearMotionPreviewFeedback()
  const mode = value as 'auto' | 'manual'
  if (settings.value.motion_duration_mode === mode) return
  const previous = settings.value.motion_duration_mode
  durationMessage.value = ''
  try {
    const current = await getModelSettings()
    const saved = await saveModelSettings({ base_url: current.base_url, model: current.model, motion_duration: settings.value.motion_duration, motion_duration_mode: mode })
    settings.value = { ...settings.value, ...saved, api_key: '' , motion_duration_mode: mode }
    await persistRoleConfig({ motion_duration: saved.motion_duration, motion_duration_mode: mode })
    durationMessage.value = '已保存 · 连接中…'
    durationMessage.value = await connectSavedService('motion')
  } catch (e) { settings.value.motion_duration_mode = previous; durationMessage.value = e instanceof Error ? e.message : '模式保存失败' }
}
async function applyWorkerUrl() {
  if (connectionChecking.value || !settingsLoaded.value) return
  clearMotionPreviewFeedback()
  connectionChecking.value = true
  let savedAddress = false
  try {
    const url = normalizeWorkerUrl(gpuWorkerUrl.value)
    const current = await getModelSettings()
    const saved = await saveModelSettings({ base_url: current.base_url, model: current.model, motion_worker_url: url })
    savedAddress = true
    settings.value.motion_worker_url = saved.motion_worker_url
    gpuWorkerUrl.value = url
    serviceStatuses.value = serviceStatuses.value.filter(s => s.name !== 'GPU 云端')
    const response = await fetch('http://127.0.0.1:8002/api/motion/reload', { method: 'POST', signal: AbortSignal.timeout(5000) })
    if (!response.ok) throw new Error('动作服务未能重新加载地址')
    const loaded = await response.json()
    if (loaded.worker_url !== url) throw new Error('动作服务加载的地址与保存地址不一致')
    cloudMessage.value = '已保存 · 连接中…'
    cloudMessage.value = await connectSavedService('motion')
    workerConnectionMessage.value = ''
  } catch (error) {
    cloudMessage.value = (savedAddress ? '地址已保存，但连接尚未确认：' : '未保存：') + (error instanceof Error ? error.message : String(error))
  } finally { connectionChecking.value = false }
}

function onDragStart(event: PointerEvent) {
  // 全屏画布固定，左键只移动角色，不拖动原生窗口。
  if (event.button !== 0 || isDialogWindow) return
  const target = event.target as HTMLElement
  if (target.closest('.dialog-panel, button, input, textarea, label')) return
  // 区分“点击”与“拖动”：记录按下位置，移动超过阈值才真正开始拖动窗口，
  // 否则由角色画布区分单击触摸与双击聊天。
  const startX = event.clientX
  const startY = event.clientY
  const threshold = 4
  let lastX = startX
  let lastY = startY
  let dragTriggered = false
  const onMove = (e: PointerEvent) => {
    if (!dragTriggered && Math.hypot(e.clientX - startX, e.clientY - startY) < threshold) return
    dragTriggered = true
    avatarRef.value?.panAvatar(e.clientX - lastX, e.clientY - lastY)
    lastX = e.clientX
    lastY = e.clientY
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
  }
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
}

function onRightClick() {
  void openDialog('settings')
}
function refreshConnectivity() { if (isSettingsOnly || panelTab.value === 'settings') void checkLocalServices() }
async function toggleFullscreen() {
  const win = getCurrentWindow()
  await win.setFullscreen(!(await win.isFullscreen()))
}
// 滚轮缩放：只调相机距离，窗口尺寸与位置完全不动，角色围绕自身模型中心原地放大缩小。
function onWheel(event: WheelEvent) {
  if (isDialogWindow) return
  const target = event.target as HTMLElement
  if (target.closest('.dialog-panel, .messages, .settings-body')) return
  noteUserInteraction()
  event.preventDefault()
  const sign = event.deltaY < 0 ? 1 : -1
  // 每格滚轮以一个固定比例缩放相机距离（>1 拉近即放大）。
  const factor = Math.pow(1.1, sign)
  avatarRef.value?.zoomCamera(factor)
}

let modelApplyGeneration = 0
let appliedLibraryModel = ''
async function applyLibraryModel(id: string) {
  const generation = ++modelApplyGeneration
  try {
    const model = await getModel(id)
    if (!model) throw new Error('找不到模型文件')
    if (generation !== modelApplyGeneration) return
    petVisible.value = false
    gazeSettingsLoaded.value = false
    await setIgnoreCursorEvents(true)
    ignoreCursor = true
    await getCurrentWindow().setFullscreen(true)
    await getCurrentWindow().hide()
    const url = resolveModelUrl(model)
    if (url) await avatarRef.value?.loadUrl(url)
    else if (model.file) await avatarRef.value?.loadFile(new File([model.file], model.name + '.vrm'))
    else throw new Error('找不到模型文件')
    if (generation !== modelApplyGeneration) return
    // Applying a role changes the backend's fallback scope as well as the
    // renderer; previewing or editing another role never activates it.
    await request(`/api/roles/${encodeURIComponent(id)}/activate`, { method: 'POST', headers: roleHeaders(id) })
    if (generation !== modelApplyGeneration) return
    appliedLibraryModel = id
    roleId.value = id
    localStorage.setItem('deskaura-active-model', id)
    await refreshGazeSettings()
    if (generation !== modelApplyGeneration) return
    await getCurrentWindow().show()
    petVisible.value = true
    resetStandbyTimer()
    await toggleAlwaysOnTop(alwaysOnTop.value)
    await setPassthrough(false)
    sessionId.value = ''
    localStorage.removeItem('deskaura-session')
    await refreshInteractionState()
    await emitTo('dialog', 'deskaura:role-changed', id).catch(() => {})
    await emitTo('home', 'deskaura:applied', id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[DeskAura] Model apply failed', error)
    await emitTo('home', 'deskaura:apply-failed', { id, message }).catch(() => {})
  }
}
onMounted(async () => {
  window.addEventListener('resize', resizeComposer)
  window.addEventListener('pointerdown', noteUserInteraction, { passive: true })
  window.addEventListener('keydown', noteUserInteraction, { passive: true })
  if (!isDialogWindow) standbyTimer = window.setInterval(updateStandby, 250)
  window.addEventListener('deskaura:connectivity-changed', refreshConnectivity)
  if (isSettingsOnly) serviceRefreshTimer = window.setInterval(refreshConnectivity, 15000)
  void nextTick(resizeComposer)
  void refreshInteractionState()
  if (isSettingsOnly) {
    const off = await Promise.all([
      listen<boolean>('deskaura:auto-speech', e => { speaking.value = e.payload; if (!e.payload) stopAudio() }),
      listen<boolean>('deskaura:top-state', e => { alwaysOnTop.value = e.payload }),
    ])
    unlistenMain = () => off.forEach(fn => fn())
    await openSettings(); return
  }
  if (isDialogWindow) {
    if (isTauri()) {
      await invoke('polish_window')
      // Keep the original transparent cartoon card; controls live inside its header.
      unlistenClose = await getCurrentWindow().onCloseRequested(async (event) => {
        event.preventDefault()
        chatGeneration++
        chatController?.abort(); queuedMessages.value = []
        stopAudio()
        endCall()
        loading.value = false
        motion.value = idleMotion()
        thinking.value = false
        await emitTo('main', 'deskaura:cancel-thinking', null).catch(() => {})
        await getCurrentWindow().destroy()
      })
    }
    const off = await Promise.all([
      listen<string>('deskaura:role-changed', e => { void switchRole(e.payload) }),
      listen('deskaura:runtime-settings', receiveRuntimeSettings),
      listen<'chat' | 'settings'>('deskaura:tab', e => {
        panelTab.value = e.payload
        if (e.payload === 'settings') void openSettings()
      }),
      listen('deskaura:audio-settings-changed', () => { stopAudio(); audioPlayer.invalidate() }),
      listen<string | null>('deskaura:asr-settings-changed', event => {
        if (event.payload != null && event.payload !== roleId.value) return
        voiceInputStatus.value = ''; void refreshGazeSettings()
      }),
      listen('deskaura:chat-settings-changed', () => { chatError.value = ''; void refreshCapabilities() }),
      listen<string>('deskaura:config-changed', event => {
        if (event.payload !== roleId.value) return
        void refreshCapabilities()
        void refreshGazeSettings()
      }),
      listen<boolean>('deskaura:top-state', e => { alwaysOnTop.value = e.payload }),
      listen<boolean>('deskaura:auto-speech', e => { speaking.value = e.payload; if (!e.payload) stopAudio() }),
      listen('deskaura:app-hidden', endCall),
    ])
    unlistenMain = () => off.forEach(fn => fn())
    const initialHistory = historyScope.capture(roleId.value)
    for (let attempt = 0; attempt < 10; attempt++) {
      if (!historyScope.accepts(initialHistory, roleId.value)) break
      try {
        await refreshSessions()
        if (!historyScope.accepts(initialHistory, roleId.value)) break
        await refreshGazeSettings()
        if (!historyScope.accepts(initialHistory, roleId.value)) break
        void refreshCapabilities()
        const id = sessions.value.find(s => s.id === sessionId.value)?.id || sessions.value[0]?.id
        if (id) await selectSession(id)
        else await newConversation()
        break
      } catch { await new Promise(resolve => setTimeout(resolve, 700)) }
    }
    if (panelTab.value === 'settings') void openSettings()
    return
  }
  // Keep the overlay inert until an actual model application requests it.
  await getCurrentWindow().hide()
  await setIgnoreCursorEvents(true)
  ignoreCursor = true
  const off = await Promise.all([
    listen<string>('deskaura:model', e => { void applyLibraryModel(e.payload) }),
    listen('deskaura:runtime-settings', receiveRuntimeSettings),
    listen<string>('deskaura:model-remove', e => {
      if (e.payload && e.payload !== appliedLibraryModel) return
      modelApplyGeneration++
      gazeSettingsRevision++
      appliedLibraryModel = ''
      localStorage.removeItem('deskaura-active-model')
      petVisible.value = false
      gazeSettingsLoaded.value = false
      remoteCallActive.value = false
      remoteReplyActive.value = false
      thinking.value = false
      motion.value = idleMotion()
      clearTimeout(interactionTimer)
      resetStandbyTimer()
      stopAudio(); faceTracker.stop(); faceTarget.value = { x: 0, y: 0, visible: false }
      void emitTo('dialog', 'deskaura:app-hidden', null).catch(() => {})
      void getCurrentWindow().hide()
      void emitTo('home', 'deskaura:applied', '')
    }),
    listen('deskaura:query-model', () => { void emitTo('home', 'deskaura:applied', appliedLibraryModel) }),
    listen<string>('deskaura:user-interaction', e => { if (e.payload === roleId.value) resetStandbyTimer() }),
    listen<boolean>('deskaura:call-active', e => { remoteCallActive.value = e.payload; resetStandbyTimer() }),
    listen<{ motion: Motion; emotion: string; text?: string; gaze_target?: 'mouse' | 'face' }>('deskaura:reply', e => {
      resetStandbyTimer()
      remoteReplyActive.value = settings.value.motion_enabled !== false &&
        (e.payload.motion.loop === true || e.payload.motion.reply_motion === true)
      stopAudio(); clearTimeout(interactionTimer)
      loading.value = false
      thinking.value = false
      motion.value = settings.value.motion_enabled === false ? idleMotion() : e.payload.motion
      emotion.value = e.payload.emotion
      if (e.payload.text) showBubble(e.payload.text)
      if (e.payload.gaze_target) autoGaze.value = e.payload.gaze_target
    }),
    listen<string>('deskaura:bubble', e => showBubble(e.payload)),
    listen<{ text: string; done: boolean }>('deskaura:bubble-stream', e => showStreamingBubble(e.payload.text, e.payload.done)),
    listen<boolean>('deskaura:bubble-settings', e => { bubbleEnabled.value = e.payload }),
    listen<boolean>('deskaura:auto-speech', e => { speaking.value = e.payload; if (!e.payload) stopAudio() }),
    listen('deskaura:audio-settings-changed', () => { stopAudio(); audioPlayer.invalidate() }),
    listen('deskaura:interrupt-speech', stopAudio),
    listen<'mouse' | 'face'>('deskaura:gaze-target', e => { autoGaze.value = e.payload }),
    listen('deskaura:interaction-settings', refreshGazeSettings),
    listen<string>('deskaura:config-changed', event => { if (event.payload === roleId.value) void refreshGazeSettings() }),
    listen<string>('deskaura:role-changed', event => { void switchRole(event.payload || 'default') }),
    listen('deskaura:app-hidden', () => { petVisible.value = false; stopAudio(); syncFaceTracking() }),
    listen('deskaura:app-restored', () => { if (appliedLibraryModel) { petVisible.value = true; void refreshGazeSettings() } }),
    listen<number>('deskaura:speech-level', e => { speechLevel.value = Math.max(0, Math.min(1, e.payload)) }),
    listen('deskaura:cancel-thinking', () => {
      remoteReplyActive.value = false
      loading.value = false
      thinking.value = false
      motion.value = idleMotion()
    }),
    listen<boolean>('deskaura:thinking', e => {
      if (e.payload) resetStandbyTimer()
      if (e.payload) { remoteReplyActive.value = false; stopAudio(); clearTimeout(interactionTimer); clearTimeout(bubbleTimer); bubbleText.value = '' }
      const wasThinking = thinking.value
      loading.value = e.payload
      thinking.value = e.payload
      if (e.payload || endsThinkingPose(wasThinking, motion.value.id)) motion.value = e.payload
        ? { id: 'cloud_thinking_loop', kind: 'hymotion', url: '/api/motion/library/cloud_thinking_loop', duration: 8, loop: true }
        : idleMotion()
    }),
    listen<boolean>('deskaura:top-state', e => { alwaysOnTop.value = e.payload }),
    listen('deskaura:reply-ended', () => {
      remoteReplyActive.value = false
      if (!loading.value && motion.value.loop) { motion.value = idleMotion(); emotion.value = 'neutral' }
    }),
    listen('deskaura:hide', () => { void hideWindow() }),
  ])
  unlistenMain = () => off.forEach(fn => fn())
  // Keep the transparent overlay hidden and click-through until a model has
  // finished loading. The studio is the only visible startup surface.
  await getCurrentWindow().hide()
  await setIgnoreCursorEvents(true)
  window.setTimeout(async () => {
    try {
      const current = await getModelSettings()
      demoMode.value = !current.ready
      bubbleEnabled.value = current.bubble_enabled !== false
      gazeMode.value = current.gaze_mode || 'face'; gazeEnabled.value = current.gaze_enabled !== false
      offended.value = !!current.offended
    } catch {
      // 后端可能还在启动
    }
  }, 1500)
})
</script>

<template>
  <main class="pet-root" :class="{ 'dialog-root': isDialogWindow, 'settings-embedded': isSettingsOnly, 'comic-chat': isDialogWindow && !isSettingsOnly }" @pointerdown="onDragStart" @pointermove="onPointerMove" @wheel="onWheel">
    <!-- 宠物本体 -->
    <div
      v-if="!isDialogWindow"
      class="pet-stage"
      :style="{ width: '100%' }"
      @contextmenu.prevent="onRightClick"
    >
      <AvatarStage
        ref="avatarRef"
        :motion="motion"
        :emotion="emotion"
        :thinking="thinking"
        :speech-level="speechLevel"
        :gaze-mode="effectiveGaze"
        :face-target="faceTarget"
        @loaded="modelLoaded = $event"
        @model-fit="onModelFit"
        @alpha-mask="onAlphaMask"
        @head-anchor="headAnchor = $event"
        @body-touch="bodyInteraction"
        @open-chat="openDialog('chat')"
        @interaction="noteUserInteraction"
        @motion-ended="avatarMotionEnded"
      />
      <Transition name="pop"><div v-if="bubbleEnabled && bubbleText && headAnchor.visible" class="character-bubble" :style="bubbleStyle" aria-live="polite">{{ bubbleText }}</div></Transition>
      <ThinkingBubble v-if="bubbleEnabled && thinking && headAnchor.visible" :style="thinkingStyle" />
    </div>

    <!-- 点击宠物后弹出的对话框 -->
    <Transition name="pop">
      <aside v-if="isDialogWindow" class="dialog-panel">
        <div v-if="!isSettingsOnly" class="dialog-tabs" @mousedown="dragChat" @dblclick="toggleChatSize">
          <div class="chat-nav-actions" @dblclick.stop>
            <button class="memory-toggle" type="button" :aria-expanded="historyOpen" :disabled="loading" title="历史对话" @click="historyOpen = !historyOpen; refreshSessions()"><svg viewBox="0 0 20 20"><path d="M4 5h12v12H4zM7 2h6v5H7zM7 10h6M7 13h4"/></svg><span>记忆</span></button>
            <button type="button" class="speaker-toggle" :class="{ muted: !speaking }" :aria-pressed="speaking" :title="speaking ? '关闭自动语音播报' : '开启自动语音播报'" aria-label="自动语音播报" @click="speaking = !speaking; saveSpeaking()"><svg viewBox="0 0 20 20"><path d="M3 8h3l4-4v12l-4-4H3z"/><path v-if="speaking" d="M13 7q4 3 0 6M15 4q7 6 0 12"/><path v-else d="m13 7 5 6m0-6-5 6"/></svg></button>
            <button type="button" class="call-toggle" :class="{ active: callActive }" :disabled="callStarting" :aria-pressed="callActive" :title="callActive ? '结束通话' : callStarting ? '正在连接' : '开始通话'" aria-label="通话" @click="toggleCall"><svg viewBox="0 0 20 20"><path d="m4 3 3 1-1 4q2 4 6 5l3-2 2 3q-1 4-5 2Q3 13 3 6z"/></svg></button>
          </div>
          <strong><span aria-hidden="true">✦</span> 和我聊聊</strong>
          <div class="chat-window-tools" @dblclick.stop>
            <button title="最小化" aria-label="最小化" @click="getCurrentWindow().minimize()"><svg viewBox="0 0 16 16"><path d="M3 8h10" /></svg></button>
            <button :title="chatMaximized ? '还原窗口' : '最大化'" :aria-label="chatMaximized ? '还原窗口' : '最大化'" @click="toggleChatSize"><svg viewBox="0 0 16 16"><template v-if="chatMaximized"><path d="M6 3h7v7M3 6h7v7H3z" /></template><rect v-else x="3" y="3" width="10" height="10" rx="1" /></svg></button>
            <button class="chat-close" title="关闭聊天" aria-label="关闭聊天" @click="closeDialog"><svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8" /></svg></button>
          </div>
        </div>

        <template v-if="panelTab === 'chat'">
          <div v-if="callActive" class="call-strip"><span class="live-dot"></span>{{ callMic ? '通话中' : '通话已静音' }}<small>{{ screenSharing ? '屏幕已选择 · 按需采集' : callCamera ? '摄像头预览 · 按需采集' : '仅语音' }}</small></div>
          <div v-if="callActive && callCamera" class="call-camera-preview" :style="{ width: cameraSize.width + 'px', height: cameraSize.height + 'px' }"><video ref="cameraPreview" autoplay muted playsinline /><span>本地预览 · 截图前确认</span><div class="camera-resize-edge camera-resize-left" aria-hidden="true" @pointerdown="resizeCamera($event, 'width')" /><div class="camera-resize-edge camera-resize-bottom" aria-hidden="true" @pointerdown="resizeCamera($event, 'height')" /><button type="button" class="camera-resize-handle" aria-label="调整视频大小" title="拖动调整视频大小" @pointerdown="resizeCamera"><svg viewBox="0 0 16 16"><path d="m3 3 10 10M3 8v5h5M8 3h5v5"/></svg></button></div>
          <div v-if="historyOpen" class="history-scrim" @click.self="historyOpen = false">
            <section class="history-drawer" aria-label="历史会话">
              <header><div><small>MEMORIES</small><h3>我们的对话</h3></div><button title="收起记忆" @click="historyOpen = false">×</button></header>
              <button class="new-conversation" :disabled="loading || historyBusy || mediaBusy || fileBusy" @click="newConversation">＋ 新建对话</button>
              <div class="session-list">
                <div v-for="session in sessions" :key="session.id" class="session-row" :class="{ selected: session.id === sessionId }">
                  <form v-if="renameId === session.id" class="session-rename" @submit.prevent="commitSessionTitle(session.id)"><input v-model="sessionTitle" maxlength="80" aria-label="对话新名称" autofocus /><button>保存</button><button type="button" @click="renameId = ''">取消</button></form>
                  <template v-else><button class="session-select" :disabled="historyBusy || loading || mediaBusy || fileBusy" @click="selectSession(session.id)"><strong>{{ session.title }}</strong><small>{{ new Date(session.updated_at).toLocaleDateString() }}</small></button><button title="重命名对话" aria-label="重命名对话" @click="renameId = session.id; sessionTitle = session.title">✎</button><button title="删除对话" aria-label="删除对话" @click="deleteId = session.id">×</button></template>
                  <div v-if="deleteId === session.id" class="session-delete"><span>删除该对话及由它单独产生的记忆？无法撤销。</span><button @click="removeConversation(session.id)">删除</button><button @click="deleteId = ''">取消</button></div>
                </div>
              </div>
              <p>完整对话保存在本机；早期版本已截断的旧记录无法恢复。身体互动不进入这里。</p>
            </section>
          </div>
          <div ref="messageList" class="messages">
            <article v-for="(message, index) in messages" :key="index" :class="message.role">
              {{ message.text }}
            </article>
            <span v-if="loading && messages[messages.length - 1]?.role !== 'assistant'" class="thinking-indicator">正在想怎么回答你…</span>
            <div v-if="messages.length === 0 && !loading" class="chat-welcome"><span>✦</span><h2>今天，想聊点什么？</h2><p>从一句问候开始，也可以说说你的心情。</p></div>
            <section v-if="fileApproval" class="file-approval"><strong>等待确认 · {{ fileApproval.operation }}</strong><code>{{ fileApproval.path }}</code><small v-if="fileApproval.runtime">{{ fileApproval.runtime }} · 最长 {{ fileApproval.timeout }} 秒</small><pre v-if="fileApproval.preview">{{ fileApproval.preview }}</pre><p v-if="fileApproval.warning">{{ fileApproval.warning }}</p><p>{{ fileApproval.runtime ? '仅确认后执行。命令可修改文件或访问网络，其改动没有自动备份或撤销保证，请仔细核对。' : '仅确认后修改。此文件工具在修改与删除前保留恢复副本。' }}</p><div><button :disabled="fileBusy" @click="confirmFile(true)">{{ fileBusy ? '执行中…' : '确认执行' }}</button><button :disabled="fileBusy" @click="confirmFile(false)">取消</button></div></section>
            <section v-if="pendingSystemAction" class="file-approval"><strong>等待确认 · 系统操作</strong><code>{{ pendingSystemAction.action.type }}</code><p>{{ pendingSystemAction.action.url || pendingSystemAction.action.app || pendingSystemAction.action.command || '锁定屏幕' }}</p><div><button :disabled="systemActionBusy" @click="confirmSystemAction(true)">确认执行</button><button :disabled="systemActionBusy" @click="confirmSystemAction(false)">取消</button></div></section>
            <section v-if="mediaRequest" class="file-approval"><strong>请求{{ mediaRequest.source === 'camera' ? '摄像头' : '屏幕' }}{{ mediaRequest.kind === 'record' ? '短时采集' : '截图' }}</strong><p>确认后{{ mediaRequest.kind === 'record' ? '采集最多 3 张时序画面（不含音频，不是完整视频）' : '采集一张画面' }}并发送给当前对话模型，可能计费。</p><div><button :disabled="mediaBusy" @click="confirmMediaCapture(true)">允许本次</button><button @click="confirmMediaCapture(false)">取消</button></div></section>
          </div>
          <form class="chat-composer" @submit.prevent="send">
            <section v-if="pendingMessage && !callActive" class="pending-message" aria-label="下一条待发送消息" aria-live="polite">
              <div class="pending-message-copy"><small>{{ queuePaused ? '待发送 · 上次发送失败' : '下一条 · 回复结束后发送' }}</small><p>{{ pendingMessage.value }}</p><span v-if="pendingMessage.attachments.length">{{ pendingMessage.attachments.map(file => file.name).join(' · ') }}</span><small class="pending-hint">{{ queuePaused ? '点击下方 ■ 重试' : '点击下方 ■ 可打断并发送' }}</small></div>
              <button type="button" class="pending-cancel" title="取消待发送消息" aria-label="取消待发送消息" @click="cancelPendingMessage"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M7 17 17 7" /></svg></button>
            </section>
            <div class="composer-box">
            <div v-if="attachments.length" class="attachment-chips"><button v-for="(file, index) in attachments" :key="index" type="button" :title="'移除附件 ' + file.name" @click="attachments.splice(index, 1); chatError = ''">{{ file.name }} ×</button></div>
            <div v-if="composerMode === 'interrupt'" class="call-output-control"><button type="button" class="call-interrupt" title="打断回复，也可以直接说话" aria-label="打断通话回复" @click="interruptReply"><svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg></button><span>点击或直接说话打断</span></div>
            <div v-else-if="composerMode === 'waveform'" class="voice-waveform" role="img" aria-label="正在收音"><i v-for="bar in 32" :key="bar" :style="{ height: `${5 + Math.min(1, micLevel * (1 + Math.sin(bar * 1.7))) * 42}px` }" /><span>{{ userSpeaking || micLevel > .1 ? '正在听你说' : '等待你说话' }}</span></div>
            <textarea
              v-show="composerMode === 'text'"
              ref="composerInput"
              v-model="text"
              rows="1"
              maxlength="4000"
              :disabled="mediaBusy"
              aria-label="聊天消息"
              placeholder="说点什么..."
              @keydown="composerKeydown"
            />
            <div class="composer-actions">
              <button v-if="callActive" class="attach-file" :class="{ active: screenSharing }" type="button" :title="screenSharing ? '停止屏幕共享' : '选择屏幕共享'" aria-label="屏幕共享" @click="toggleScreenShare"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/></svg></button>
              <button v-else class="attach-file" type="button" :disabled="loading || historyBusy || attachmentReading || mediaBusy || fileBusy" title="上传附件" aria-label="上传文件" @click="attachmentInput?.click()"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg></button>
              <button v-if="callActive" type="button" :class="{ active: callCamera }" :disabled="callBusy" title="开关摄像头共享" aria-label="摄像头共享" @click="toggleCallCamera"><svg viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-4v12l-6-4"/><path v-if="!callCamera" d="m3 3 18 18"/></svg></button>
              <small class="attachment-support" :title="attachmentSupportDetail(capabilities)">{{ callActive ? '按需采集' : attachmentSupportLabel(capabilities) }}</small>
              <input ref="attachmentInput" hidden type="file" multiple :accept="attachmentAccept(capabilities)" @change="attachFiles" />
              <span class="composer-feedback playback-status" role="status" :title="composerFeedback">{{ mediaBusy ? '正在采集画面…' : attachmentReading ? '正在读取附件…' : composerFeedback }}</span>
              <button v-if="callActive" class="hangup-call" type="button" title="挂断" aria-label="挂断通话" @click="endCall"><svg viewBox="0 0 24 24"><path d="M3 15q9-10 18 0l-2 4-5-2v-4h-4v4l-5 2z"/></svg></button>
              <button v-if="!callActive && (replyActive || pendingMessage)" type="button" class="playback-action interrupt-reply" :disabled="mediaBusy || fileBusy || historyBusy || attachmentReading" :title="pendingMessage ? replyActive ? '打断回复并发送下一条' : '重试待发送消息' : '打断回复'" :aria-label="replyActive ? '打断回复' : '重试待发送消息'" @click="pendingMessage ? sendPendingMessage() : interruptReply()"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" /></svg></button>
              <CallVoiceControl v-if="callActive || !text.length && !attachments.length" :key="roleId" :disabled="historyBusy || attachmentReading || !asrEnabled" :continuous="callActive" :output-active="audioPlaying" :output-text="lastAudioText" v-model:active="callMic" @transcript="transcript" @speech="interruptSpeech" @speaking="userSpeaking = $event" @start="chatError = ''; voiceInputStatus = ''" @status="voiceInputStatus = $event" @level="micLevel = $event" @recording="micRecording = $event; if (!$event) userSpeaking = false" />
              <button v-else class="send-message" :disabled="historyBusy || attachmentReading || mediaBusy || fileBusy || (!text.trim() && !attachments.length)" :title="replyActive ? '下一条（最多一条）' : '发送消息'" aria-label="发送消息"><svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7M12 5v15"/></svg></button>
            </div>
            </div>
          </form>
        </template>

        <template v-else>
          <div v-if="isSettingsOnly" class="settings-window-head">
            <div>
              <span class="settings-eyebrow">DESKAURA / SETTINGS</span>
              <h2>设置</h2>
              <p>为当前角色配置各个角色模块。</p>
            </div>
            <div class="settings-window-actions">
              <button type="button" class="secondary" @click="detectServices">一键检测</button>
              <button type="button" class="secondary import-export-action" @click="exportSettingsSnapshot"><FileOutput :size="15" aria-hidden="true" />导出配置</button>
              <button type="button" class="window-close" title="关闭设置" @click="getCurrentWindow().close()">×</button>
            </div>
          </div>
          <div :class="['settings-layout', { 'settings-layout-window': isSettingsOnly }]">
            <nav v-if="isSettingsOnly" class="settings-sidebar" aria-label="设置目录">
              <button type="button" :class="{ active: settingsSection === 'role' }" @click="selectSettingsSection('role')"><span>角色</span><small>选择角色与桌面交互</small></button>
              <div class="settings-sidebar-rule"></div>
              <button v-for="item in settingsModuleItems" :key="item.id" type="button" :class="{ active: settingsSection === item.id }" @click="selectSettingsSection(item.id)">
                <span>{{ item.label }}</span><small>{{ item.hint }} · {{ moduleStatus(item.id) }}</small>
              </button>
            </nav>
            <div class="settings-body">
            <section v-if="isSettingsOnly" class="settings-card settings-role-card" :class="{ 'settings-selected-card': settingsSection === 'role' }">
              <header><span class="settings-eyebrow">ROLE</span><h4>角色</h4></header>
              <label>当前角色
                <ConfigPicker v-model="settingsRoleId" :options="settingsRoles.map(role => ({ value: role.id, label: role.name, description: role.path || role.sourcePath || '内嵌模型' }))" label="选择角色" placeholder="请先在主页导入角色" />
              </label>
              <div v-if="selectedSettingsRole()" class="settings-role-summary">
                <strong>{{ selectedSettingsRole()?.name }}</strong>
                <small>{{ selectedSettingsRole()?.path || selectedSettingsRole()?.sourcePath || '模型路径未记录' }}</small>
              </div>
              <p v-else class="settings-note">角色需要先在主页导入并应用；每个角色拥有独立的模块配置、会话与记忆空间。</p>
              <div class="settings-subsection">
                 <h5>桌面与交互</h5>
                <label class="check"><input v-model="alwaysOnTop" type="checkbox" @change="onToggleTop" /> 角色置顶</label>
                <label class="check"><input v-model="settings.bubble_enabled" type="checkbox" @change="saveInteractionSettings" /> 显示角色头顶对话气泡</label>
              </div>
              <div class="settings-subsection">
                <h5>视线追随</h5>
                <label class="check"><input v-model="settings.standby_enabled" type="checkbox" @change="saveInteractionSettings" /> 待机动作</label>
                <label>视线追踪
                  <ConfigPicker :model-value="selectedGaze(settings)" :options="gazeOptions" label="视线追踪" @update:model-value="changeGazeSelection" />
                </label>
                <p v-if="faceTrackingMessage" class="section-feedback" role="status">{{ faceTrackingMessage }}</p>
              </div>
              <div class="settings-subsection">
                <h5>本地操作</h5>
                <label>风险级别
                  <ConfigPicker
                    :model-value="settings.local_operation_mode || 'request_approval'"
                    :options="[
                      { value: 'request_approval', label: '请求批准', description: '每次写入、删除、命令和代码都先显示确认。' },
                      { value: 'help_me_approve', label: '帮我批准', description: '低风险创建/修改自动执行，删除、命令和代码仍需确认。' },
                      { value: 'full_approval', label: '完全批准', description: '在授权目录与安全边界内自动执行。' }
                    ]"
                    label="本地操作风险级别"
                    @update:model-value="settings.local_operation_mode = $event as ModelSettings['local_operation_mode']; saveInteractionSettings()"
                  />
                </label>
                <label class="check"><input v-model="settings.local_sandbox_enabled" type="checkbox" @change="saveInteractionSettings" /> 启用受限系统沙箱</label>
                <label>授权目录
                  <input v-model="settings.file_access_root" placeholder="输入目录后按 Enter 保存，或拖入文件夹" @keydown.enter.prevent="saveInteractionSettings" @dragover.prevent @drop.prevent="onAuthorizedFolderDrop" />
                </label>
                <button type="button" class="secondary" @click="pickAuthorizedFolder">选择文件夹</button>
                <p class="settings-note">操作会参考 OpenClaw 的风险判断，并受授权目录、文件类型、符号链接、超时和输出上限限制。系统不支持真正隔离时会明确提示。</p>
              </div>
            </section>
            <section v-if="!isSettingsOnly" class="settings-card" :class="{ 'settings-selected-card': isSettingsOnly && settingsSection === 'role' }">
              <header><span class="settings-eyebrow">GENERAL</span><h4>桌面与交互</h4></header>
              <label class="check"><input v-model="alwaysOnTop" type="checkbox" @change="onToggleTop" /> 角色置顶</label>
              <label class="check"><input v-model="settings.bubble_enabled" type="checkbox" @change="saveInteractionSettings" /> 显示角色头顶对话气泡</label>
              <div class="settings-subsection"><h5>动作与视线</h5><label class="check"><input v-model="settings.standby_enabled" type="checkbox" @change="saveInteractionSettings" /> 待机动作</label><label>视线追踪<ConfigPicker :model-value="selectedGaze(settings)" :options="gazeOptions" label="视线追踪" @update:model-value="changeGazeSelection" /></label><p v-if="faceTrackingMessage" class="section-feedback" role="status">{{ faceTrackingMessage }}</p></div>
               <div class="settings-subsection"><h5>本地操作</h5><label>风险级别<ConfigPicker :model-value="settings.local_operation_mode || 'request_approval'" :options="[{value:'request_approval',label:'请求批准',description:'每次写入、删除、命令和代码都先显示确认。'},{value:'help_me_approve',label:'帮我批准',description:'低风险创建/修改自动执行，删除、命令和代码仍需确认。'},{value:'full_approval',label:'完全批准',description:'在授权目录与安全边界内自动执行。'}]" label="本地操作风险级别" @update:model-value="settings.local_operation_mode = $event as ModelSettings['local_operation_mode']; saveInteractionSettings()" /></label><label>授权目录<input v-model="settings.file_access_root" placeholder="输入目录后按 Enter 保存，或拖入文件夹" @keydown.enter.prevent="saveInteractionSettings" @dragover.prevent @drop.prevent="onAuthorizedFolderDrop" /></label><button type="button" class="secondary" @click="pickAuthorizedFolder">选择文件夹</button><p class="settings-note">本地操作参考 OpenClaw：先判断风险，再按级别执行；始终限制在授权目录、受支持的文本格式、超时和输出上限内。当前是受限执行模式，不是 Windows 系统级隔离沙箱。</p></div>
              <p v-if="interactionMessage" class="section-feedback">{{ interactionMessage }}</p>
            </section>
            <section v-if="!isSettingsOnly" id="settings-services" class="settings-card service-directory">
               <header><span class="settings-eyebrow">MODULE DIRECTORY</span><h4 tabindex="-1">角色模块 · 状态目录</h4></header>
              <nav aria-label="模型设置目录">
                 <button v-for="s in serviceStatuses.filter(s => s.name !== 'GPU 云端')" :key="s.name" type="button" class="service-link" :title="s.detail" @click="jumpSettings(s.section)">
                  <span class="dot" :class="{ ok: s.running }"></span>
                   <span class="service-title">{{ serviceLabel(s.name) }}</span>
                  <span class="latency">{{ serviceChecking || localChecking ? '检测中' : s.running ? '正常' : s.state === 'unknown' ? '未知' : '异常' }} ›</span>
                </button>
              </nav>
              <button type="button" class="secondary" :disabled="localChecking || serviceChecking || serviceConnections.size > 0 || !settingsLoaded" @click="detectServices">{{ serviceChecking ? '检测中…' : '检测' }}</button>
              <div class="section-feedback service-feedback" :class="{ 'memory-notice': memoryConfiguration && !serviceChecking && !localChecking && !serviceConnections.size }" role="status" aria-live="polite"><template v-if="serviceChecking || localChecking || serviceConnections.size">{{ serviceTestProgress || '检测中' }}</template><template v-else-if="memoryConfiguration">{{ memoryConfiguration }}</template><template v-else-if="motionPreviewFeedback"><span class="motion-preview-feedback">{{ motionPreviewFeedback }}</span></template><template v-else><span>{{ serviceTestProgress || (serviceStatuses.length ? '连接状态' : '尚未检测') }}</span><p v-for="s in serviceStatuses.filter(s => !s.running && s.detail && s.name !== 'GPU 云端')" :key="s.name"><strong>{{ s.name }}</strong> · {{ s.detail }}</p></template></div>
            </section>
             <section id="settings-chat" class="settings-card" :class="{ 'settings-selected-card': isSettingsOnly && settingsSection === 'brain' }" v-show="!isSettingsOnly || settingsSection === 'brain'">
               <header><span class="settings-eyebrow">01 · BRAIN</span><h4 tabindex="-1">大脑</h4><label class="module-toggle"><input type="checkbox" :checked="settings.brain_enabled !== false" @change="saveModuleEnabled('brain_enabled', ($event.target as HTMLInputElement).checked)" /> 启用</label></header>
               <div class="settings-subsection provider-choice"><h5>模型服务配置</h5><p class="settings-note">云端服务与本机服务共用同一套 API 地址、模型和密钥字段。</p></div>
              <label>API 地址<input v-model="settings.base_url" placeholder="https://api.openai.com/v1" /></label>
              <label>模型名称<input v-model="settings.model" placeholder="gpt-4o-mini" /></label>
              <label>API 密钥<input v-model="settings.api_key" class="secret-input" type="password" autocomplete="new-password" :placeholder="settings.api_key_masked || '输入新密钥'" /></label>
              <p v-if="settingsLoading" class="settings-note">正在从本地配置读取…</p>
              <div class="settings-actions"><button type="button" :disabled="settingsSaving || settingsLoading" @click="saveSettings">{{ settingsSaving ? '保存中…' : '保存配置' }}</button><button v-if="!settingsLoaded && !settingsLoading" type="button" class="secondary" @click="reloadSettings">重新读取</button><button v-if="settings.has_api_key" type="button" class="danger" @click="removeKey">移除密钥</button></div>
              <p class="settings-note">密钥保存在 Windows 凭据管理器，不回显明文。</p>
              <p v-if="settingsMessage" class="section-feedback" role="status">{{ settingsMessage }}</p>
            </section>
             <section id="settings-recognition" class="settings-card recognition-settings" :class="{ 'settings-selected-card': isSettingsOnly && settingsSection === 'hearing' }" v-show="!isSettingsOnly || settingsSection === 'hearing'">
               <header><span class="settings-eyebrow">04 · HEARING</span><h4 tabindex="-1">听觉</h4><label class="module-toggle"><input type="checkbox" :checked="settings.asr_enabled === true" @change="saveModuleEnabled('asr_enabled', ($event.target as HTMLInputElement).checked)" /> 启用</label></header>
               <div class="settings-subsection provider-choice"><h5>模型服务配置</h5><p class="settings-note">云端服务与本机服务共用同一套 API 地址、模型和密钥字段。</p></div>
              <label>API 地址<input v-model="settings.asr_base_url" placeholder="服务商 ASR API 根地址" /></label>
              <label>识别模型<input v-model="settings.asr_model" placeholder="服务商语音识别模型 ID" /></label>
              <label>API 密钥<input v-model="settings.asr_api_key" class="secret-input" type="password" autocomplete="new-password" :placeholder="settings.asr_api_key_masked || '输入新密钥'" /></label>
              <div class="settings-actions"><button type="button" :disabled="!settingsLoaded || asrSaving" @click="saveRecognitionSettings">{{ asrSaving ? '保存中…' : '保存配置' }}</button><button v-if="settings.asr_has_api_key" type="button" class="danger" :disabled="asrSaving" @click="removeRecognitionKey">移除密钥</button></div>
              <p v-if="asrMessage" class="section-feedback" role="status">{{ asrMessage }}</p>
            </section>
             <section id="settings-speech" class="settings-card" :class="{ 'settings-selected-card': isSettingsOnly && settingsSection === 'voice' }" v-show="!isSettingsOnly || settingsSection === 'voice'">
               <header><span class="settings-eyebrow">05 · VOICE</span><h4 tabindex="-1">语音</h4><label class="module-toggle"><input type="checkbox" :checked="settings.audio_enabled === true" :disabled="audioSaving || !settingsLoaded" @change="saveModuleEnabled('audio_enabled', ($event.target as HTMLInputElement).checked); saveAudioSettings()" /> 启用</label></header>
               <div class="settings-subsection provider-choice"><h5>模型服务配置</h5><p class="settings-note">云端服务与本机服务共用同一套 API 地址、模型和密钥字段。</p></div>
              <label>语音 API 地址<input v-model="settings.audio_base_url" placeholder="服务商 TTS API 根地址" /></label>
              <label>语音模型<input v-model="settings.audio_model" placeholder="服务商语音合成模型 ID" /></label>
              <label>音色 ID<ConfigPicker v-model="settings.audio_voice" :options="voiceOptions" :editable="true" label="音色 ID" :placeholder="speechPreset.voice || '填写服务商提供的 Voice ID'" /></label>
              <div v-if="speechProvider !== 'dashscope'" class="speech-option-row"><label v-if="speechPreset.formats.length > 1">输出格式<ConfigPicker :model-value="settings.audio_format" :options="speechFormatOptions" label="语音输出格式" @update:model-value="settings.audio_format = $event as ModelSettings['audio_format']" /></label><label>语速<input v-model.number="settings.audio_speed" type="number" min="0.5" max="2" step="0.1" /></label></div>
              <label v-if="settings.audio_format === 'pcm' && speechProvider === 'compatible'">PCM 采样率（服务商要求值）<input v-model.number="settings.audio_sample_rate" type="number" min="8000" max="48000" step="1000" /></label>
              <label>API 密钥<input v-model="settings.audio_api_key" class="secret-input" type="password" autocomplete="new-password" :placeholder="settings.audio_api_key_masked || '输入新密钥'" /></label>
              <div class="settings-actions"><button type="button" :disabled="audioSaving || !settingsLoaded" @click="saveAudioSettings">保存配置</button><button v-if="settings.audio_has_api_key" type="button" class="danger" @click="removeAudioKey">移除密钥</button></div>
              <p v-if="audioMessage || audioStatus" class="section-feedback" role="status">{{ audioMessage }} {{ audioStatus }}</p>
            </section>

             <section id="settings-motion" class="settings-card" :class="{ 'settings-selected-card': isSettingsOnly && settingsSection === 'motion' }" v-show="!isSettingsOnly || settingsSection === 'motion'">
               <header><span class="settings-eyebrow">06 · MOTION</span><h4 tabindex="-1">动作</h4><label class="module-toggle"><input type="checkbox" :checked="settings.motion_enabled !== false" @change="saveModuleEnabled('motion_enabled', ($event.target as HTMLInputElement).checked)" /> 启用</label></header>
                <div class="settings-subsection provider-choice"><h5>模型服务配置</h5><p class="settings-note">云端服务与本机服务共用同一套 API 地址、模型和密钥字段。</p></div>
              <label>动作模式<ConfigPicker :model-value="settings.motion_mode || 'hybrid'" :options="motionModeOptions" :disabled="!settingsLoaded || connectionChecking" label="动作模式" @update:model-value="saveMotionMode" /></label>
              <p class="settings-note">{{ motionModeNote }}</p>
              <div v-if="settings.motion_mode !== 'offline'" class="motion-online">
              <label>Worker 的 HTTP 访问地址<input v-model="gpuWorkerUrl" placeholder="http://127.0.0.1:6006" /></label>
              <div class="settings-actions worker-address-actions"><button type="button" :disabled="serviceChecking || connectionChecking || !settingsLoaded" @click="applyWorkerUrl">{{ connectionChecking ? '保存中…' : '保存配置' }}</button><button type="button" class="secondary" @click="openSshTunnelTool">打开 SSH 隧道工具</button></div>
              <p v-if="workerConnectionMessage" class="section-feedback" role="status">{{ workerConnectionMessage }}</p>
              <div class="settings-subsection">
                <h5>动作时长</h5><label>时长模式<ConfigPicker :model-value="settings.motion_duration_mode || 'auto'" :options="durationModeOptions" label="时长模式" @update:model-value="setDurationMode" /></label>
                <label v-if="settings.motion_duration_mode === 'manual'">固定秒数<input v-model.number="settings.motion_duration" class="motion-duration-input" type="number" min="0.5" max="12" step="0.5" aria-label="固定秒数" /></label>
                <p class="settings-note">自动预测动作时长 · 手动 0.5–12 秒</p><button v-if="settings.motion_duration_mode === 'manual'" type="button" class="secondary" @click="saveDuration">保存配置</button>
                <p v-if="durationMessage" class="section-feedback" role="status">{{ durationMessage }}</p>
              </div>
              </div>
              <div class="settings-subsection"><h5>本地动作库</h5><ConfigPicker v-model="selectedLibraryMotion" :options="libraryOptions" :group-tabs="true" label="动作库" placeholder="选择动作" /><div class="settings-actions"><button type="button" class="secondary" @click="previewLibraryMotion">预览</button><button type="button" class="secondary" @click="stopEmotionPreview">停止</button></div></div>
              <p v-if="cloudMessage" class="section-feedback" role="status">{{ cloudMessage }}</p>
              <div class="settings-subsection"><h5>动作 API</h5><label>提供方<ConfigPicker :model-value="settings.motion_provider || 'hymotion'" :options="[{value:'hymotion',label:'HY-Motion Worker',description:'使用本地 HTTP Worker。'},{value:'tencent_tokenhub',label:'腾讯云 TokenHub',description:'使用 API Key 生成 FBX，需运行时支持重定向。'}]" label="动作 API 提供方" @update:model-value="settings.motion_provider = $event as ModelSettings['motion_provider']" /></label><label>API 地址<input v-model="settings.motion_api_base_url" placeholder="https://tokenhub.tencentmaas.com/v1/api/3d" /></label><label>模型<input v-model="settings.motion_api_model" placeholder="hy-3d-motion" /></label><label>API Key<input v-model="settings.motion_api_key" class="secret-input" type="password" autocomplete="new-password" :placeholder="settings.motion_api_key_masked || '输入新密钥'" /></label><div class="settings-actions"><button type="button" @click="saveMotionApiSettings">保存配置</button><button v-if="settings.motion_has_api_key" type="button" class="danger" @click="removeMotionApiKey">移除密钥</button></div><p class="settings-note">腾讯接口当前返回 FBX；未完成 VRM 重定向前不会把它误当作 SMPL-H JSON 播放。</p></div>
            </section>
             <section v-if="isSettingsOnly && settingsSection === 'persona'" class="settings-card settings-persona-card settings-selected-card">
               <header><span class="settings-eyebrow">02 · PERSONA / RAG</span><h4>人设</h4><label class="module-toggle"><input type="checkbox" :checked="settings.persona_enabled !== false" @change="saveModuleEnabled('persona_enabled', ($event.target as HTMLInputElement).checked)" /> 启用</label></header>
              <p class="settings-note">用结构化文本描述角色，再通过 Embedding 让检索结果参与对话上下文。</p>
              <label>角色模板
                <ConfigPicker :model-value="personaTemplate" :options="Object.keys(personaTemplates).map(value => ({ value, label: value }))" label="角色模板" @update:model-value="choosePersonaTemplate" />
              </label>
              <label>角色设定
                <textarea v-model="personaText" rows="15" placeholder="角色名称、身份/身世、性格、说话风格、和你的关系、禁忌、世界观、背景故事"></textarea>
              </label>
              <label>从本地导入文档<input type="file" accept=".txt,.md,.json,.docx,.pdf" /></label>
               <div class="settings-subsection"><h5>文本嵌入模型（Text Embedding）</h5><label>API 地址<input placeholder="https://api.openai.com/v1" /></label><label>模型<input placeholder="text-embedding-3-small" /></label><label>API 密钥<input class="secret-input" type="password" placeholder="输入新密钥" /></label></div>
              <div class="settings-actions"><button type="button" @click="savePersonaSettings">保存配置</button><button type="button" class="secondary" @click="settingsMessage = '人设检索服务待检测'">检测</button></div>
              <p v-if="settingsMessage" class="section-feedback">{{ settingsMessage }}</p>
            </section>
             <section v-if="isSettingsOnly && settingsSection === 'memory'" class="settings-card settings-memory-card settings-selected-card">
               <header><span class="settings-eyebrow">03 · MEMORY / MEMU</span><h4>记忆</h4><label class="module-toggle"><input type="checkbox" :checked="settings.memory_enabled !== false" @change="saveModuleEnabled('memory_enabled', ($event.target as HTMLInputElement).checked)" /> 启用</label></header>
              <p class="settings-note">当前角色的会话与长期记忆独立保存。此处保留 MemU 兼容配置入口，未配置时使用本机记忆服务。</p>
              <label>记忆路径<input placeholder="输入路径，或拖入文件/文件夹" /></label>
               <div class="settings-subsection"><h5>文本嵌入模型（Text Embedding）</h5><label>API 地址<input placeholder="https://api.openai.com/v1" /></label><label>模型<input placeholder="由记忆服务配置" /></label></div>
              <label>API 密钥<input class="secret-input" type="password" placeholder="输入新密钥" /></label>
              <div class="settings-actions"><button type="button" @click="settingsMessage = '记忆配置已保存'">保存配置</button><button type="button" class="secondary" @click="showMemoryConfiguration">检测</button></div>
              <p v-if="memoryConfiguration" class="section-feedback">{{ memoryConfiguration }}</p>
            </section>
            </div>
          </div>
        </template>
      </aside>
    </Transition>
    <template v-if="isDialogWindow && !isSettingsOnly && !chatMaximized"><div v-for="edge in resizeEdges" :key="edge" class="chat-resize-edge" :class="edge.toLowerCase()" @pointerdown.stop.prevent="resizeChat(edge, $event)" /></template>
  </main>
</template>
<style scoped>
.settings-window-actions .import-export-action{display:inline-flex;align-items:center;justify-content:center;gap:7px}
.settings-window-actions .import-export-action svg{flex-shrink:0}
</style>
