// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.vue'

const state = vi.hoisted(() => ({
  settings: vi.fn(),
  listeners: new Map<string, (event: { payload: any }) => unknown>(),
  emit: vi.fn(async () => {}),
  session: vi.fn(),
  stream: vi.fn(),
  capabilities: vi.fn(),
}))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  getModelSettings: state.settings,
  getInteractionOffended: vi.fn(async () => false),
  setInteractionOffended: vi.fn(async () => {}),
  listSessions: vi.fn(async () => ({ sessions: [] })),
  createSession: vi.fn(async () => ({ id: 'session-a', title: '新对话' })),
  getSession: state.session,
  streamChat: state.stream,
  getChatCapabilities: state.capabilities,
}))
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: state.emit,
  listen: vi.fn(async (name, listener) => {
    state.listeners.set(name, listener)
    return () => state.listeners.delete(name)
  }),
}))
vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: vi.fn(async () => null),
  getCurrentWindow: () => ({ onCloseRequested: vi.fn(async () => () => {}), setFocus: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: class {} }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: (path: string) => path }))
vi.mock('./tauri', () => ({
  isTauri: () => true, startWindowDrag: vi.fn(), toggleAlwaysOnTop: vi.fn(), hideWindow: vi.fn(),
  setIgnoreCursorEvents: vi.fn(), getCursorPos: vi.fn(),
}))
vi.mock('./faceTracking', () => ({
  faceTrackingAllowed: () => false,
  FaceTracker: class { stop() {} },
}))
vi.mock('./mediaCapture', () => ({
  CameraLease: class { stop() {} }, ScreenLease: class { stop() {} }, cameraFrame: vi.fn(),
}))
vi.mock('./components/AvatarStage.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./components/CallVoiceControl.vue', () => ({
  default: { props: ['disabled', 'continuous', 'active'], template: '<button class="mock-voice" :disabled="disabled" :data-call="continuous" />' },
}))
vi.mock('./modelLibrary', () => ({ getModel: vi.fn(), listModels: vi.fn(async () => []), updateRoleConfig: vi.fn(), resolveModelUrl: (m: any) => m?.url || m?.path || null }))

beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn()
  localStorage.clear(); localStorage.setItem('deskaura-active-model', 'role-a')
  history.replaceState({}, '', '/?dialog=1')
  state.listeners.clear()
  state.session.mockReset().mockResolvedValue({ messages: [] })
  state.stream.mockReset()
  state.capabilities.mockReset().mockResolvedValue({
    image_input: false, file_input: false, max_attachments: 4,
    text_extensions: ['.txt', '.py'], image_mime_types: [], max_file_bytes: 1024 * 1024,
  })
  state.settings.mockReset().mockResolvedValue({
    base_url: '', model: '', asr_enabled: true, asr_has_api_key: true,
    vision_enabled: false, audio_enabled: false, ready: true,
  })
})
afterEach(() => { localStorage.clear(); history.replaceState({}, '', '/'); vi.useRealTimers() })

describe('active role runtime settings', () => {
  it('applies saved runtime settings directly without waiting for another configuration request', async () => {
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: false, vision_enabled: false })
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeDefined()
    state.settings.mockClear()
    await state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-a', settings: { asr_enabled: true, vision_enabled: false } },
    })
    await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeUndefined()
    expect(state.settings).not.toHaveBeenCalled()
    await state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-b', settings: { asr_enabled: false, vision_enabled: false } },
    })
    await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
  it('updates interaction settings independently of the motion generation module', async () => {
    const wrapper = mount(App); await flushPromises()
    const runtime = (wrapper.vm as any).$?.setupState
    await state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-a', settings: {
        gaze_enabled: false, standby_enabled: false, bubble_enabled: false,
        click_feedback_enabled: false, vision_enabled: false, asr_enabled: false,
      } },
    })
    await flushPromises()
    expect(runtime.gazeEnabled).toBe(false)
    expect(runtime.standbyEnabled).toBe(false)
    expect(runtime.bubbleEnabled).toBe(false)
    expect(runtime.clickFeedbackEnabled).toBe(false)
    await state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-a', settings: {
        motion_enabled: false, standby_enabled: true, bubble_enabled: true,
        click_feedback_enabled: true, gaze_enabled: true, gaze_mode: 'mouse',
      } },
    })
    await flushPromises()
    expect(runtime.standbyEnabled).toBe(true)
    expect(runtime.bubbleEnabled).toBe(true)
    expect(runtime.clickFeedbackEnabled).toBe(true)
    expect(runtime.gazeEnabled).toBe(true)
    expect(runtime.gazeMode).toBe('mouse')
    wrapper.unmount()
  })
  it('does not apply late image capabilities from the previously active character', async () => {
    let finish!: (value: unknown) => void
    state.capabilities.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const wrapper = mount(App); await flushPromises()
    await state.listeners.get('deskaura:role-changed')!({ payload: 'role-b' }); await flushPromises()
    finish({ image_input: true, file_input: true, max_attachments: 4,
      text_extensions: ['.txt', '.py'], image_mime_types: ['image/png'], max_file_bytes: 1024 * 1024 })
    await flushPromises()
    expect(wrapper.get('input[type=file]').attributes('accept')).not.toContain('image/png')
    wrapper.unmount()
  })
  it('cancels pending typewriter text before a role switch can replace another conversation or its approval', async () => {
    localStorage.setItem('deskaura-speaking', 'false')
    const wrapper = mount(App); await flushPromises()
    vi.useFakeTimers()
    const oldText = '过期回答'.repeat(100)
    state.stream.mockImplementation(async (_message, _session, _attachments, onDelta) => {
      onDelta(oldText)
      return { text: oldText, emotion: 'neutral', demo_mode: false,
        motion: { id: 'cloud_idle', kind: 'hymotion', url: '/clip', duration: 2 },
        file_approval: { id: 'old-approval', operation: 'create', path: 'D:/old.txt', preview: 'old' } }
    })
    await wrapper.get('[aria-label="聊天消息"]').setValue('旧角色的问题')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(state.stream).toHaveBeenCalledOnce()
    state.session.mockResolvedValue({ messages: [
      { role: 'user', content: '新角色问题' }, { role: 'assistant', content: '新角色已保存的回答' },
    ] })
    await state.listeners.get('deskaura:role-changed')!({ payload: 'role-b' }); await flushPromises()
    await vi.advanceTimersByTimeAsync(10000); await flushPromises()
    expect(wrapper.text()).toContain('新角色已保存的回答')
    expect(wrapper.text()).not.toContain(oldText)
    expect(wrapper.find('.file-approval').exists()).toBe(false)
    wrapper.unmount()
  })
  it('restores a pending approval card when reopening the conversation', async () => {
    state.session.mockResolvedValue({
      messages: [{ role: 'user', content: '创建文件' }, { role: 'assistant', content: '等待确认' }],
      file_approval: { id: 'pending-one', operation: 'create', path: 'D:/workspace/one.txt', preview: 'one' },
    })
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('.file-approval').text()).toContain('D:/workspace/one.txt')
    expect(wrapper.get('.file-approval').text()).toContain('确认执行')
    wrapper.unmount()
  })
  it('keeps legacy speech and hearing settings on shared forms with an export icon', async () => {
    state.settings.mockResolvedValue({
      base_url: '', model: '', asr_enabled: true, asr_has_api_key: true,
      vision_enabled: false, audio_enabled: true, ready: true,
      audio_provider: 'dashscope', audio_base_url: 'https://dashscope.aliyuncs.com/api/v1',
      audio_model: 'qwen3-tts-flash', audio_voice: 'Cherry',
      asr_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asr_model: 'qwen3-asr-flash',
    })
    const wrapper = mount(App, { props: { settingsOnly: true } }); await flushPromises()
    expect(wrapper.find('[aria-label="语音合成服务平台"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="语音识别服务平台"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="语音合成接入地域"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="语音识别接入地域"]').exists()).toBe(false)
    expect(wrapper.get('#settings-speech input[placeholder="服务商 TTS API 根地址"]').element).toHaveProperty('value', 'https://dashscope.aliyuncs.com/api/v1')
    expect(wrapper.get('#settings-speech input[placeholder="服务商语音合成模型 ID"]').element).toHaveProperty('value', 'qwen3-tts-flash')
    expect(wrapper.get('#settings-recognition input[placeholder="服务商 ASR API 根地址"]').element).toHaveProperty('value', 'https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(wrapper.get('.settings-window-actions .import-export-action svg').attributes('width')).toBe('15')
    wrapper.unmount()
  })

  it('loads hearing at dialog startup and rereads the saved role before dialing', async () => {
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeUndefined()
    state.settings.mockClear()
    await wrapper.get('[aria-label="通话"]').trigger('click'); await flushPromises()
    expect(state.settings).toHaveBeenCalledWith('role-a')
    expect(wrapper.find('[aria-label="挂断通话"]').exists()).toBe(true)
    expect(wrapper.get('.mock-voice').attributes('data-call')).toBe('true')
    wrapper.unmount()
  })

  it('applies a saved hearing enable immediately and ends an active call when disabled', async () => {
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: false, vision_enabled: false })
    const wrapper = mount(App); await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeDefined()
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: true, vision_enabled: false })
    await state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' }); await flushPromises()
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="通话"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[aria-label="挂断通话"]').exists()).toBe(true)
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: false, vision_enabled: false })
    await state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' }); await flushPromises()
    expect(wrapper.find('[aria-label="挂断通话"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('does not use a cached enabled value after another window disabled hearing', async () => {
    const wrapper = mount(App); await flushPromises()
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: false, vision_enabled: false })
    await wrapper.get('[aria-label="通话"]').trigger('click'); await flushPromises()
    expect(wrapper.find('[aria-label="挂断通话"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('听觉模块已停用')
    wrapper.unmount()
  })

  it('refreshes newly applied role settings and ignores other-role config events', async () => {
    const wrapper = mount(App); await flushPromises()
    state.settings.mockClear()
    await state.listeners.get('deskaura:config-changed')!({ payload: 'role-b' }); await flushPromises()
    expect(state.settings).not.toHaveBeenCalled()
    state.settings.mockResolvedValue({ base_url: '', model: '', asr_enabled: false, vision_enabled: false })
    await state.listeners.get('deskaura:role-changed')!({ payload: 'role-b' }); await flushPromises()
    expect(state.settings).toHaveBeenCalledWith('role-b')
    expect(wrapper.get('.mock-voice').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})
