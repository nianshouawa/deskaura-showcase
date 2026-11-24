// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import VoiceControl from './VoiceControl.vue'
const state = vi.hoisted(() => ({ transcribe: vi.fn(), processor: undefined as any, acquire: vi.fn(), stop: vi.fn(),
  listeners: new Map<string, (event: { payload: string | null }) => void>() }))
vi.mock('../api', () => ({
  currentRoleId: () => 'role-a',
  getModelSettings: vi.fn(async () => ({ asr_enabled: true, asr_has_api_key: true })),
  transcribeAudio: state.transcribe, reportClientFailure: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, handler) => {
  state.listeners.set(name, handler)
  return () => state.listeners.delete(name)
}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers(); state.acquire.mockReset(); state.stop.mockReset(); state.transcribe.mockReset()
  state.listeners.clear()
  state.transcribe.mockResolvedValue('小声说话也可以。')
  state.acquire.mockResolvedValue({ getTracks: () => [{ stop: state.stop }] })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: state.acquire } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 16000; destination = {}; resume = async () => {}; close = vi.fn()
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
    createScriptProcessor() { return state.processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null } }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function feed(quiet: boolean) {
  for (let frame = 0; frame < 4; frame++) {
    const samples = Float32Array.from({ length: 4096 }, (_, i) => quiet
      ? .007 * Math.sin(i * Math.PI * 2 * 170 / 16000) + .005 * Math.sin(i * Math.PI * 2 * 340 / 16000) + .003 * Math.sin(i * Math.PI * 2 * 510 / 16000)
      : .008 * Math.sin(i * Math.PI * 2 * 100 / 16000))
    state.processor.onaudioprocess({ inputBuffer: { getChannelData: () => samples } })
  }
}
describe('one-shot microphone gate', () => {
  it('captures quiet speech and sends after the user pauses without the old fixed RMS cutoff', async () => {
    const wrapper = mount(VoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    feed(true); await vi.advanceTimersByTimeAsync(1400); await flush()
    expect(state.transcribe).toHaveBeenCalledOnce()
    expect(wrapper.emitted('transcript')?.at(-1)).toEqual(['小声说话也可以。'])
    expect(state.stop).toHaveBeenCalled()
    wrapper.unmount()
  })
  it('does not submit low-level steady hum as a sentence', async () => {
    const wrapper = mount(VoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    feed(false); await wrapper.get('button').trigger('click'); await flush()
    expect(state.transcribe).not.toHaveBeenCalled()
    expect(wrapper.emitted('transcript')).toBeUndefined()
    wrapper.unmount()
  })
  it('cancels the microphone and pending ASR when this role’s hearing settings change', async () => {
    let resolve!: (value: string) => void
    state.transcribe.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const wrapper = mount(VoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    state.listeners.get('deskaura:asr-settings-changed')!({ payload: 'another-role' })
    expect(state.stop).not.toHaveBeenCalled()
    feed(true); await vi.advanceTimersByTimeAsync(1400); await flush()
    const signal = state.transcribe.mock.calls[0][1] as AbortSignal
    expect(state.transcribe.mock.calls[0][2]).toBe('role-a')
    state.listeners.get('deskaura:asr-settings-changed')!({ payload: 'role-a' })
    expect(state.stop).toHaveBeenCalled()
    expect(signal.aborted).toBe(true)
    resolve('旧录音不能发送'); await flush()
    expect(wrapper.emitted('transcript')).toBeUndefined()
    wrapper.unmount()
    expect(state.listeners.has('deskaura:asr-settings-changed')).toBe(false)
  })
  it('immediately releases an active microphone for a legacy unscoped settings event', async () => {
    const wrapper = mount(VoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    state.listeners.get('deskaura:asr-settings-changed')!({ payload: null })
    expect(state.stop).toHaveBeenCalledOnce()
    await flush()
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })
})
