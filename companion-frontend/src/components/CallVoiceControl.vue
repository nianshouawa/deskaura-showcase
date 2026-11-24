<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { currentRoleId, getModelSettings, transcribeAudio, reportClientFailure } from '../api'
import { encodeVoiceWav, voiceCaptureConstraints } from '../voiceRecording'
import { microphoneError } from '../voiceErrors'
import { listen as listenEvent } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { likelyPlaybackEcho, usefulTranscript, VoiceActivityGate } from '../voiceActivity'
const props = defineProps<{ disabled?: boolean; continuous?: boolean; active?: boolean; outputActive?: boolean; outputText?: string }>()
const emit = defineEmits<{ transcript: [value: string]; status: [value: string]; start: []; speech: []; speaking: [value: boolean]; level: [value: number]; recording: [value: boolean]; 'update:active': [value: boolean] }>()
const recording = ref(false), busy = ref(false)
let stream: MediaStream | undefined, context: AudioContext | undefined
let processor: ScriptProcessorNode | undefined, source: MediaStreamAudioSourceNode | undefined
let chunks: Float32Array[] = [], voiced = 0, lastVoice = 0, started = 0, speechStarted = false
let controller: AbortController | undefined
let generation = 0, timer: number | undefined, queue: { parts: Float32Array[]; rate: number; output: string }[] = []
let recordingRole: string | undefined
const gate = new VoiceActivityGate()
let echoCandidate = ''
function resetUtterance() { chunks = []; voiced = 0; speechStarted = false; echoCandidate = ''; started = lastVoice = performance.now(); gate.reset(); emit('speaking', false) }
function cleanup() {
  clearInterval(timer); timer = undefined
  if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = undefined }
  source?.disconnect(); source = undefined
  stream?.getTracks().forEach(track => track.stop()); stream = undefined
  void context?.close(); context = undefined
  recording.value = false; emit('recording', false); emit('level', 0)
}
function cancel() { generation++; controller?.abort(); cleanup(); resetUtterance(); queue = []; busy.value = false }
async function drain() {
  if (busy.value || !queue.length) return
  busy.value = true
  const current = generation, item = queue.shift()!
  controller = new AbortController()
  emit('status', '正在识别…')
  try {
    const value = await transcribeAudio(encodeVoiceWav(item.parts, item.rate), controller.signal, recordingRole)
    if (current !== generation) return
    if (!usefulTranscript(value) || item.output && likelyPlaybackEcho(value, item.output)) { emit('status', ''); return }
    emit('status', ''); emit('transcript', value)
  } catch (e) { if (current === generation) { void reportClientFailure('recognition', recordingRole); emit('status', e instanceof Error ? e.message : '语音识别失败，请重试。') } }
  finally { if (current === generation) { busy.value = false; if (queue.length) void drain() } }
}
function finish() {
  if (!recording.value || !context) return
  const item = { parts: chunks, rate: context.sampleRate, output: echoCandidate }, valid = speechStarted && voiced >= .44
  resetUtterance()
  if (!props.continuous) cleanup()
  if (!valid) { if (!props.continuous) emit('status', '没有检测到有效说话声音，请重试。'); return }
  if (queue.length >= 2) { emit('status', '识别繁忙，请稍后再说。'); return }
  queue.push(item); void drain()
}
async function start() {
  if (recording.value) return
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
    if ('__TAURI_INTERNALS__' in window) await invoke('prepare_microphone_access')
    if (current !== generation) return
    const acquired = await navigator.mediaDevices.getUserMedia(voiceCaptureConstraints())
    if (current !== generation) { acquired.getTracks().forEach(t => t.stop()); return }
    stream = acquired
    context = new AudioContext(); await context.resume()
    if (current !== generation || !context || !stream) return
    source = context.createMediaStreamSource(stream); processor = context.createScriptProcessor(2048, 1, 1)
    resetUtterance()
    processor.onaudioprocess = event => {
      if (!recording.value || !context) return
      const part = event.inputBuffer.getChannelData(0), seconds = part.length / context.sampleRate
      const { rms, voice, speech } = gate.frame(part, context.sampleRate, !!props.outputActive)
      emit('level', Math.min(1, rms * 9))
      if (voice) {
        voiced += seconds; lastVoice = performance.now()
        if (props.outputActive) echoCandidate = props.outputText || echoCandidate
        if (!speechStarted && speech) { speechStarted = true; emit('speaking', true); emit('speech') }
      }
      chunks.push(new Float32Array(part))
      if (!speechStarted && chunks.length > Math.ceil(context.sampleRate * .25 / part.length)) chunks.shift()
    }
    source.connect(processor); processor.connect(context.destination)
    recording.value = true; emit('recording', true); emit('start'); emit('status', '')
    stream.getAudioTracks()[0]?.addEventListener('ended', () => { cancel(); emit('update:active', false); emit('status', '麦克风已断开') }, { once: true })
    timer = window.setInterval(() => {
      const now = performance.now()
      if (speechStarted && now - lastVoice > 1000 || now - started > 30000 && speechStarted) finish()
      else if (!props.continuous && !speechStarted && now - lastVoice > 10000) finish()
      else if (props.continuous && !speechStarted && now - lastVoice > 5000) resetUtterance()
    }, 100)
  } catch (e) { if (current === generation) { cleanup(); void reportClientFailure('recognition', recordingRole); emit('update:active', false); emit('status', microphoneError(e)) } }
  finally { if (current === generation) busy.value = false }
}
function toggle() {
  if (props.continuous) { emit('update:active', !props.active); return }
  if (recording.value) finish()
  else if (busy.value) { cancel(); emit('status', '') }
  else void start()
}
watch(() => props.disabled, value => { if (value) { cancel(); emit('status', '') } })
watch(() => [props.continuous, props.active] as const, ([continuous, active], previous) => {
  if (continuous && active && !props.disabled) void start()
  else if (continuous || previous?.[0] || recording.value) cancel()
}, { immediate: true })
let unmounted = false, offHidden: (() => void) | undefined, offSettings: (() => void) | undefined
void listenEvent('deskaura:app-hidden', () => { cancel(); emit('update:active', false); emit('status', '') }).then(off => { if (unmounted) off(); else offHidden = off }).catch(() => {})
void listenEvent<string | null>('deskaura:asr-settings-changed', event => {
  if (event.payload != null && event.payload !== (recordingRole || currentRoleId())) return
  cancel(); emit('update:active', false); emit('status', '')
}).then(off => { if (unmounted) off(); else offSettings = off }).catch(() => {})
onBeforeUnmount(() => { unmounted = true; offHidden?.(); offSettings?.(); cancel() })
defineExpose({ cancel })
</script>
<template>
  <button class="voice" type="button" :disabled="disabled" :aria-pressed="recording" :class="{ recording, busy }" :title="continuous ? active ? '静音麦克风' : '开启麦克风' : recording ? '结束录音并识别' : busy ? '取消识别' : '模型语音输入，说完自动发送'" :aria-label="continuous ? active ? '静音麦克风' : '开启麦克风' : '模型语音输入'" @click="toggle">
    <svg viewBox="0 0 20 20"><rect x="7" y="2" width="6" height="10" rx="3"/><path d="M4 9v1a6 6 0 0 0 12 0V9M10 16v3M7 19h6"/><path v-if="continuous && !active" d="m3 3 14 14"/></svg>
  </button>
</template>
