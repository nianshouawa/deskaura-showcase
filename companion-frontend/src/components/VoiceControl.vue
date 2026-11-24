<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { currentRoleId, getModelSettings, transcribeAudio, reportClientFailure } from '../api'
import { encodeVoiceWav, voiceCaptureConstraints } from '../voiceRecording'
import { usefulTranscript, VoiceActivityGate } from '../voiceActivity'
import { microphoneError } from '../voiceErrors'
import { listen as listenEvent } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
const props = defineProps<{ disabled?: boolean; test?: boolean }>()
const emit = defineEmits<{ transcript: [value: string]; status: [value: string]; start: [] }>()
const recording = ref(false)
const busy = ref(false)
let stream: MediaStream | undefined, context: AudioContext | undefined
let processor: ScriptProcessorNode | undefined, source: MediaStreamAudioSourceNode | undefined
let chunks: Float32Array[] = [], voiced = 0, lastVoice = 0, started = 0, speechStarted = false
let controller: AbortController | undefined
let generation = 0, timer: number | undefined
let recordingRole: string | undefined
const gate = new VoiceActivityGate()
function cleanup() {
  clearInterval(timer); timer = undefined
  if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = undefined }
  source?.disconnect(); source = undefined
  stream?.getTracks().forEach(track => track.stop()); stream = undefined
  void context?.close(); context = undefined
  recording.value = false
}
function cancel() { generation++; controller?.abort(); cleanup(); chunks = []; busy.value = false }
async function finish() {
  if (!recording.value || !context) return
  const rate = context.sampleRate, valid = speechStarted && voiced >= .42, parts = chunks
  cleanup(); chunks = []
  if (!valid) { void reportClientFailure('recognition', recordingRole); emit('status', '没有检测到有效说话声音，请重试。'); return }
  busy.value = true
  const current = generation
  controller = new AbortController()
  emit('status', props.test ? '正在验证模型识别…' : '正在交给模型识别，完成后自动发送…')
  try {
    const value = await transcribeAudio(encodeVoiceWav(parts, rate), controller.signal, recordingRole)
    if (current !== generation) return
    if (!usefulTranscript(value)) { emit('status', '没有识别到有效语音，请重试。'); return }
    emit('status', ''); emit('transcript', value)
  } catch (e) { if (current === generation) { void reportClientFailure('recognition', recordingRole); emit('status', e instanceof Error ? e.message : '语音识别失败，请重试。') } }
  finally { if (current === generation) busy.value = false }
}
async function listen() {
  if (recording.value) { await finish(); return }
  if (busy.value) { cancel(); emit('status', ''); return }
  const current = ++generation
  recordingRole = currentRoleId()
  busy.value = true
  try {
    const cfg = await getModelSettings(recordingRole)
    if (current !== generation) return
    if (!cfg.asr_enabled || !cfg.asr_has_api_key && cfg.hearing_connection_mode !== 'local') {
      throw new Error('请先在设置 → 听觉中启用并保存语音识别配置。')
    }
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('当前窗口无法访问录音，请检查系统麦克风权限。')
    if ('__TAURI_INTERNALS__' in window) {
      try { await invoke('prepare_microphone_access') }
      catch (error) { throw new Error(typeof error === 'string' ? error : '无法准备麦克风权限，请重试。') }
      if (current !== generation) return
    }
    const acquired = await navigator.mediaDevices.getUserMedia(voiceCaptureConstraints())
    if (current !== generation) { acquired.getTracks().forEach(t => t.stop()); return }
    stream = acquired; emit('start')
    context = new AudioContext(); await context.resume()
    if (current !== generation || !context || !stream) return
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(4096, 1, 1)
    chunks = []; voiced = 0; speechStarted = false; gate.reset(); started = lastVoice = performance.now()
    processor.onaudioprocess = event => {
      if (!recording.value || !context) return
      const part = event.inputBuffer.getChannelData(0), seconds = part.length / context.sampleRate
      chunks.push(new Float32Array(part))
      const activity = gate.frame(part, context.sampleRate)
      if (activity.voice) { voiced += seconds; lastVoice = performance.now() }
      if (activity.speech) speechStarted = true
    }
    source.connect(processor); processor.connect(context.destination)
    recording.value = true
    emit('status', props.test ? '正在听…说一句短话，停顿后检测，不发送聊天。' : '正在听…停顿约 1.2 秒后自动识别并发送，再点一次结束。')
    timer = window.setInterval(() => {
      const now = performance.now()
      if ((speechStarted && now - lastVoice > 1200) || (!speechStarted && now - started > 10000) || now - started > 45000) void finish()
    }, 100)
  } catch (e) { if (current === generation) { cleanup(); void reportClientFailure('recognition', recordingRole); emit('status', microphoneError(e)) } }
  finally { if (current === generation) busy.value = false }
}
watch(() => props.disabled, value => { if (value) { cancel(); emit('status', '') } })
let unmounted = false
let offHidden: (() => void) | undefined, offSettings: (() => void) | undefined
void listenEvent('deskaura:app-hidden', () => { cancel(); emit('status', '应用已隐藏，录音与识别已取消。') }).then(off => { if (unmounted) off(); else offHidden = off }).catch(() => {})
void listenEvent<string | null>('deskaura:asr-settings-changed', event => {
  if (event.payload != null && event.payload !== (recordingRole || currentRoleId())) return
  cancel(); emit('status', '')
}).then(off => { if (unmounted) off(); else offSettings = off }).catch(() => {})
onBeforeUnmount(() => { unmounted = true; offHidden?.(); offSettings?.(); cancel(); emit('status', '') })
</script>
<template>
  <button class="voice" type="button" :disabled="disabled" :aria-pressed="recording" :class="{ recording, busy }" :title="recording ? '结束录音并识别' : busy ? '取消识别' : test ? '录音检测，不发送聊天' : '模型语音识别，说完自动发送'" :aria-label="test ? '录音检测' : '模型语音输入'" @click="listen">
    <svg viewBox="0 0 20 20"><rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3M7 19h6"/></svg>
    <span v-if="test">{{ recording ? '结束录音' : busy ? '取消检测' : '录音检测' }}</span>
  </button>
</template>
