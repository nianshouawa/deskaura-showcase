// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CallVoiceControl from './CallVoiceControl.vue'
const state = vi.hoisted(() => ({ settings: vi.fn(), transcribe: vi.fn(), processor: undefined as any, acquire: vi.fn(), stop: vi.fn(), close: vi.fn(),
  listeners: new Map<string, (event: { payload: string | null }) => void>() }))
vi.mock('../api', () => ({ currentRoleId: () => 'role-a', getModelSettings: state.settings, transcribeAudio: state.transcribe, reportClientFailure: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (name, handler) => {
  state.listeners.set(name, handler)
  return () => state.listeners.delete(name)
}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve() }
beforeEach(() => {
  vi.useFakeTimers(); state.stop.mockReset(); state.close.mockReset(); state.acquire.mockReset(); state.transcribe.mockReset()
  state.listeners.clear()
  state.settings.mockResolvedValue({ asr_enabled: true, asr_has_api_key: true }); state.transcribe.mockResolvedValue('你好')
  const track = { stop: state.stop, addEventListener: vi.fn() }
  state.acquire.mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: state.acquire } })
  vi.stubGlobal('AudioContext', class {
    sampleRate = 16000; destination = {}; resume = async () => {}; close = state.close
    createMediaStreamSource() { return { connect: vi.fn(), disconnect: vi.fn() } }
    createScriptProcessor() { return state.processor = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: null } }
  })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function feed(value: number, times = 5) {
  for (let i = 0; i < times; i++) state.processor.onaudioprocess({ inputBuffer: { getChannelData: () => Float32Array.from({ length: 2048 }, (_, index) => value * (.6 * Math.sin(index * Math.PI * 2 * 170 / 16000) + .4 * Math.sin(index * Math.PI * 2 * 340 / 16000) + .2 * Math.sin(index * Math.PI * 2 * 510 / 16000))) } })
}
describe('voice call lifecycle', () => {
  it('allows a saved keyless local hearing service instead of requiring a cloud key', async () => {
    state.settings.mockResolvedValueOnce({ asr_enabled: true, asr_has_api_key: false,
      hearing_connection_mode: 'local', asr_base_url: 'http://127.0.0.1:8003/v1' })
    const wrapper = mount(CallVoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    expect(state.acquire).toHaveBeenCalledOnce()
    expect(wrapper.emitted('recording')?.at(-1)).toEqual([true])
    wrapper.unmount()
  })
  it('releases a one-shot microphone after only a short noise burst and silence', async () => {
    const wrapper = mount(CallVoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    feed(.1, 1)
    await vi.advanceTimersByTimeAsync(10300); await flush()
    expect(state.transcribe).not.toHaveBeenCalled()
    expect(state.stop).toHaveBeenCalled()
    expect(wrapper.emitted('recording')?.at(-1)).toEqual([false])
    wrapper.unmount()
  })
  it('does not record before a user action, displays level, and interrupts only on actual speech', async () => {
    const wrapper = mount(CallVoiceControl); await flush()
    expect(state.acquire).not.toHaveBeenCalled()
    await wrapper.get('button').trigger('click'); await flush()
    expect(wrapper.emitted('recording')?.at(-1)).toEqual([true])
    feed(0); expect(wrapper.emitted('speech')).toBeUndefined()
    feed(.1); expect(wrapper.emitted('speech')).toHaveLength(1)
    expect(wrapper.emitted('speaking')?.at(-1)).toEqual([true])
    expect(wrapper.emitted('level')?.at(-1)?.[0]).toBeGreaterThan(.4)
    await wrapper.get('button').trigger('click'); await flush()
    expect(state.transcribe).toHaveBeenCalledOnce(); expect(wrapper.emitted('transcript')?.[0]).toEqual(['你好'])
    expect(wrapper.emitted('speaking')?.at(-1)).toEqual([false])
    expect(state.stop).toHaveBeenCalled(); wrapper.unmount()
  })
  it('captures sustained quiet speech rather than discarding a softly spoken sentence', async () => {
    const wrapper = mount(CallVoiceControl)
    await wrapper.get('button').trigger('click'); await flush()
    expect(state.acquire).toHaveBeenCalledWith({ audio: {
      channelCount: 1, echoCancellation: true, noiseSuppression: false, autoGainControl: true,
    } })
    feed(.016, 6)
    expect(wrapper.emitted('speech')).toHaveLength(1)
    await wrapper.get('button').trigger('click'); await flush()
    expect(state.transcribe).toHaveBeenCalledOnce()
    expect(wrapper.emitted('transcript')?.at(-1)).toEqual(['你好'])
    wrapper.unmount()
  })
  it('keeps the microphone open between call utterances, closes on mute, and cancels stale ASR on hangup', async () => {
    const wrapper = mount(CallVoiceControl, { props: { continuous: true, active: true } }); await flush()
    feed(.1, 6); await vi.advanceTimersByTimeAsync(1300); await flush()
    expect(state.transcribe).toHaveBeenCalled(); expect(wrapper.emitted('recording')?.at(-1)).toEqual([true])
    await wrapper.setProps({ active: false }); expect(state.stop).toHaveBeenCalled()
    let resolve!: (value: string) => void
    state.transcribe.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    await wrapper.setProps({ active: true }); await flush(); feed(.1)
    await vi.advanceTimersByTimeAsync(1300); await flush()
    const prior = wrapper.emitted('transcript')?.length || 0
    await wrapper.setProps({ continuous: false, active: false }); resolve('不应发送'); await flush()
    expect(wrapper.emitted('transcript')?.length || 0).toBe(prior); wrapper.unmount()
  })
  it('does not send recognized background noise or playback echo as a call message', async () => {
    const wrapper = mount(CallVoiceControl, { props: { continuous: true, active: true, outputActive: true, outputText: '这是角色正在播放的完整回答。' } }); await flush()
    state.transcribe.mockResolvedValueOnce('角色正在播放的完整回答')
    feed(.1, 6); await vi.advanceTimersByTimeAsync(1300); await flush()
    expect(state.transcribe).toHaveBeenCalledOnce()
    expect(wrapper.emitted('transcript')).toBeUndefined()
    state.transcribe.mockResolvedValueOnce('[noise]')
    feed(.1); await vi.advanceTimersByTimeAsync(1300); await flush()
    expect(state.transcribe).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('transcript')).toBeUndefined()
    wrapper.unmount()
  })
  it('stops the call microphone, aborts ASR, and drops queued utterances on hearing disable', async () => {
    let resolve!: (value: string) => void
    state.transcribe.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const wrapper = mount(CallVoiceControl, { props: { continuous: true, active: true } }); await flush()
    state.listeners.get('deskaura:asr-settings-changed')!({ payload: 'another-role' })
    expect(state.stop).not.toHaveBeenCalled()
    feed(.1, 6); await vi.advanceTimersByTimeAsync(1300); await flush()
    const signal = state.transcribe.mock.calls[0][1] as AbortSignal
    expect(state.transcribe.mock.calls[0][2]).toBe('role-a')
    feed(.1, 6); await vi.advanceTimersByTimeAsync(1300); await flush()
    state.listeners.get('deskaura:asr-settings-changed')!({ payload: 'role-a' })
    expect(state.stop).toHaveBeenCalledOnce()
    expect(state.close).toHaveBeenCalledOnce()
    expect(signal.aborted).toBe(true)
    expect(wrapper.emitted('recording')?.at(-1)).toEqual([false])
    expect(wrapper.emitted('update:active')?.at(-1)).toEqual([false])
    resolve('过期识别不能发送'); await flush()
    expect(wrapper.emitted('transcript')).toBeUndefined()
    expect(state.transcribe).toHaveBeenCalledOnce()
    wrapper.unmount()
    expect(state.listeners.has('deskaura:asr-settings-changed')).toBe(false)
  })
})
