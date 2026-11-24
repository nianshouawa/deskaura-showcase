import type { ModelSettings } from './api'
import { confirmConnectivity, currentRoleId, reportClientFailure, roleHeaders } from './api'
import { localFetch } from './localFetch'

type PlaybackOptions = { preview?: ModelSettings; onLevel?: (level: number) => void; silent?: boolean; roleId?: string }

/** Validate the response before playback. Browser decoding handles the actual
 * MP3/WAV/Ogg/AAC/FLAC container; the backend wraps raw PCM as WAV. */
export class ReplyAudioPlayer {
  private controller?: AbortController
  private audio?: HTMLAudioElement
  private url?: string
  private context?: AudioContext
  private levelFrame = 0
  private onLevel?: (level: number) => void
  private cache?: { text: string; roleId: string; blob: Blob }

  stop() {
    this.controller?.abort()
    if (this.audio) {
      this.audio.onended = this.audio.onerror = this.audio.onplaying = null
      this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load()
    }
    if (this.url) URL.revokeObjectURL(this.url)
    if (this.levelFrame) cancelAnimationFrame(this.levelFrame)
    this.onLevel?.(0)
    this.controller = undefined; this.audio = undefined; this.url = undefined; this.levelFrame = 0
  }

  invalidate() { this.cache = undefined }
  dispose() { this.stop(); void this.context?.close().catch(() => {}) }

  /** Explicit detection is complete only after decoded audio reaches onended. */
  async verify(text = 'Hello, this is a voice connection test.', options: { silent?: boolean; roleId?: string } = {}): Promise<void> {
    this.invalidate()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.stop(); reject(new Error('播放超时')) }, 150000)
      void this.play(text, (state, playing) => {
        if (playing || state === '正在合成语音…') return
        clearTimeout(timer)
        if (state) reject(new Error(state))
        else resolve()
      }, options).catch(error => { clearTimeout(timer); reject(error) })
    })
  }

  private async analyse(audio: HTMLAudioElement, signal: AbortSignal) {
    if (!this.onLevel || typeof AudioContext === 'undefined') return
    try {
      this.context ||= new AudioContext()
      await this.context.resume()
      if (signal.aborted) return
      const source = this.context.createMediaElementSource(audio)
      const analyser = this.context.createAnalyser()
      analyser.fftSize = 512; analyser.smoothingTimeConstant = .65
      source.connect(analyser); analyser.connect(this.context.destination)
      const samples = new Uint8Array(analyser.fftSize)
      let last = 0
      const tick = (now: number) => {
        if (signal.aborted) { source.disconnect(); analyser.disconnect(); return }
        if (now - last > 45) {
          last = now
          analyser.getByteTimeDomainData(samples)
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length)
          this.onLevel?.(audio.paused ? 0 : Math.min(.85, Math.max(0, (rms - .012) * 3.8)))
        }
        this.levelFrame = requestAnimationFrame(tick)
      }
      signal.addEventListener('abort', () => { source.disconnect(); analyser.disconnect() }, { once: true })
      this.levelFrame = requestAnimationFrame(tick)
    } catch { /* Audio remains playable even if waveform analysis is unavailable. */ }
  }

  async play(text: string, onState: (state: string, playing: boolean) => void, options: PlaybackOptions = {}) {
    const roleId = options.roleId ?? currentRoleId()
    this.stop()
    this.onLevel = options.onLevel
    const controller = this.controller = new AbortController(), { signal } = controller
    onState('正在合成语音…', false)
    const timeout = setTimeout(() => controller.abort('timeout'), 100000)
    let verification: string | null = null
    try {
      let blob = !options.preview && this.cache?.text === text && this.cache.roleId === roleId ? this.cache.blob : undefined
      if (!blob) {
        const localAgent = typeof window !== 'undefined'
          && ('__TAURI_INTERNALS__' in window || import.meta.env.MODE === 'test')
          ? 'http://127.0.0.1:8000'
          : ''
        const response = await localFetch(`${import.meta.env.VITE_AGENT_API_URL || localAgent}/api/audio/${options.preview ? 'preview' : 'speech'}`, {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json', ...roleHeaders(roleId) },
          body: JSON.stringify({ ...options.preview, text }),
        })
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}))
          throw new Error(typeof failure.detail === 'string' ? failure.detail : `语音请求失败（${response.status}）`)
        }
        if (!/^audio\//i.test(response.headers.get('Content-Type') || '')) throw new Error('服务返回的不是音频，请检查平台协议与输出格式')
        verification = response.headers.get('X-DeskAura-Verification')
        blob = await response.blob()
        if (!blob.size) throw new Error('服务返回了空音频')
      }
      clearTimeout(timeout)
      if (signal.aborted) return
      const audio = this.audio = new Audio()
      audio.muted = options.silent === true
      audio.onplaying = () => { if (!signal.aborted) onState('正在播放语音', true) }
      audio.onended = async () => {
        if (!signal.aborted) {
          const accepted = !verification || await confirmConnectivity(verification, true, roleId).catch(() => false)
          if (signal.aborted) return
          if (!options.preview && accepted) this.cache = { text, roleId, blob: blob! }
          this.stop(); onState(accepted ? '' : '检测结果未确认，请重新检测', false)
        }
      }
      audio.onerror = () => {
        if (!signal.aborted) {
          if (verification) void confirmConnectivity(verification, false, roleId).catch(() => false)
          void reportClientFailure('speech', roleId)
          this.invalidate(); this.stop(); onState('音频解码失败，请将输出格式改为 WAV 或 MP3 后重试', false)
        }
      }
      audio.src = this.url = URL.createObjectURL(blob)
      await this.analyse(audio, signal)
      if (!signal.aborted) await audio.play()
    } catch (error) {
      if (signal.aborted && signal.reason !== 'timeout') return
      const timeoutError = signal.reason === 'timeout'
      if (verification) void confirmConnectivity(verification, false, roleId).catch(() => false)
      this.invalidate()
      void reportClientFailure('speech', roleId)
      this.stop()
      onState(timeoutError ? '语音合成超时，请检查网络或缩短文本后重试' : error instanceof DOMException && error.name === 'NotAllowedError'
        ? '请点击重播语音以允许播放' : error instanceof Error ? error.message : '语音播放失败，文字不受影响', false)
    } finally { clearTimeout(timeout) }
  }
}
