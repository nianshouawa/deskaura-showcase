// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RoleModulePanel from './RoleModulePanel.vue'
import ConfigPicker from './ConfigPicker.vue'
import { saveModuleDetection } from '../moduleDetection'
const state = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), emit: vi.fn(),
  listeners: new Map<string, (event: { payload: string }) => unknown>() }))
vi.mock('../api', () => ({ getModelSettings: state.get, saveModelSettings: state.save }))
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: state.emit, listen: vi.fn(async (name, listener) => {
    state.listeners.set(name, listener)
    return () => state.listeners.delete(name)
  }),
}))
vi.mock('../tauri', () => ({ isTauri: () => true, toggleAlwaysOnTop: vi.fn() }))
vi.mock('../roleModules', () => ({
  roleModules: [
    { id: 'hearing', label: '听觉', enabled: 'asr_enabled', tag: 'hearing_tag' },
    { id: 'voice', label: '语音', enabled: 'audio_enabled', tag: 'voice_tag' },
  ],
  moduleEnabled: (config: Record<string, unknown>, id: string) => config[id === 'hearing' ? 'asr_enabled' : 'audio_enabled'] === true,
  moduleStates: vi.fn(async () => ({})), moduleStatusText: () => '未检测', moduleStatusUnknown: () => true, testRoleModule: vi.fn(),
  moduleModelName: () => '未配置模型',
}))
const config = { base_url: '', model: '', asr_enabled: true, audio_enabled: true }
beforeEach(() => {
  localStorage.clear(); localStorage.setItem('deskaura-active-model', 'role-a')
  state.get.mockReset().mockResolvedValue(config)
  state.save.mockReset().mockImplementation(async patch => ({ ...config, ...patch }))
  state.emit.mockReset().mockResolvedValue(undefined)
  state.listeners.clear()
})
afterEach(() => { localStorage.clear(); vi.useRealTimers() })
function deviceCalls() { return state.emit.mock.calls.filter(([, event]) => /audio-settings-changed|asr-settings-changed/.test(event)) }
describe('role module device shutdown', () => {
  it('ignores an old save after switching away and back and drains new changes', async () => {
    let finish!: (value: unknown) => void
    state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await wrapper.setProps({ roleId: 'role-b' }); await flushPromises()
    await wrapper.setProps({ roleId: 'role-a' }); await flushPromises()
    await wrapper.get('input[aria-label="启用语音"]').setValue(false)
    finish({ ...config, asr_enabled: false })
    await flushPromises()
    expect(state.save.mock.calls).toEqual([
      [{ asr_enabled: false }, 'role-a'], [{ audio_enabled: false }, 'role-a'],
    ])
    expect((wrapper.get('input[aria-label="启用语音"]').element as HTMLInputElement).checked).toBe(false)
    expect(deviceCalls()).toEqual([])
    wrapper.unmount()
  })
  it('synchronizes saved role settings from the other window without a new configuration read', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.get.mockClear()
    state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-a', settings: { ...config, asr_enabled: false } } as any,
    })
    await flushPromises()
    expect(state.get).not.toHaveBeenCalled()
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(false)
    expect((wrapper.get('input[aria-label="启用语音"]').element as HTMLInputElement).checked).toBe(true)
    state.listeners.get('deskaura:runtime-settings')!({
      payload: { roleId: 'role-b', settings: { ...config, audio_enabled: false } } as any,
    })
    await flushPromises()
    expect((wrapper.get('input[aria-label="启用语音"]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('reads saved results on status notifications without issuing live status requests', async () => {
    const { moduleStates } = await import('../roleModules')
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    vi.mocked(moduleStates).mockClear()
    saveModuleDetection('role-a', 'hearing', { verified: true, detail: 'latest' })
    state.listeners.get('deskaura:module-status-changed')!({ payload: 'role-a' })
    state.listeners.get('deskaura:module-status-changed')!({ payload: 'role-a' })
    await flushPromises()
    expect((wrapper.vm as any).$?.setupState.states.hearing.detail).toBe('latest')
    expect(moduleStates).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('keeps the last explicit detection when toggled off and on with no polling or recheck', async () => {
    vi.useFakeTimers()
    const { moduleStates, testRoleModule } = await import('../roleModules')
    saveModuleDetection('role-a', 'hearing', { verified: true, detail: '上次手动检测正常' })
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    vi.mocked(moduleStates).mockClear()
    vi.mocked(testRoleModule).mockClear()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(true)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(120000)
    const runtime = (wrapper.vm as any).$?.setupState
    expect(runtime.moduleRows.find((item: any) => item.id === 'hearing').state)
      .toMatchObject({ verified: true, detail: '上次手动检测正常' })
    expect(moduleStates).not.toHaveBeenCalled()
    expect(testRoleModule).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('broadcasts toggle changes before waiting for persistence', async () => {
    state.save.mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    expect(state.emit).toHaveBeenCalledWith('settings', 'deskaura:module-toggle', {
      roleId: 'role-a', patch: { asr_enabled: false },
    })
    wrapper.unmount()
  })
  it('keeps disabled status stable when a previously running check completes', async () => {
    const { testRoleModule } = await import('../roleModules')
    let finish!: (value: any) => void
    vi.mocked(testRoleModule).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('.module-panel-actions button').trigger('click')
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await flushPromises()
    finish({ enabled: true, verified: true, detail: 'late success' })
    await flushPromises()
    const runtime = (wrapper.vm as any).$?.setupState
    expect(runtime.moduleRows.find((item: any) => item.id === 'hearing').state).toMatchObject({
      enabled: false, verified: false, detail: '此模块已停用',
    })
    expect(runtime.notice).toBe('已保存')
    wrapper.unmount()
  })
  it('retains unrelated switches during a slow same-role configuration refresh', async () => {
    let finish!: (value: unknown) => void
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a', desktop: true },
      global: { stubs: { LocalOperationPanel: true } } })
    await flushPromises()
    state.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' })
    await flushPromises()
    const voice = wrapper.get('input[aria-label="启用语音"]')
    expect((voice.element as HTMLInputElement).checked).toBe(true)
    expect(voice.attributes('disabled')).toBeUndefined()
    expect(wrapper.findComponent(ConfigPicker).props('disabled')).toBe(false)
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await flushPromises()
    finish(config)
    await flushPromises()
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(false)
    expect((voice.element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('refreshes only detection results for a module status notification', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.get.mockClear()
    state.listeners.get('deskaura:module-status-changed')!({ payload: 'role-a' })
    await flushPromises()
    expect(state.get).not.toHaveBeenCalled()
    expect((wrapper.get('input[aria-label="启用语音"]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('serializes rapid independent changes without locking switches or overwriting queued values', async () => {
    let finish!: (value: unknown) => void
    state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    const voice = wrapper.get('input[aria-label="启用语音"]')
    expect(voice.attributes('disabled')).toBeUndefined()
    await voice.setValue(false)
    expect(state.save).toHaveBeenCalledTimes(1)
    expect((voice.element as HTMLInputElement).checked).toBe(false)
    state.save.mockImplementationOnce(async patch => ({ ...config, asr_enabled: false, ...patch }))
    finish({ ...config, asr_enabled: false })
    await flushPromises()
    expect(state.save.mock.calls).toEqual([
      [{ asr_enabled: false }, 'role-a'], [{ audio_enabled: false }, 'role-a'],
    ])
    expect((voice.element as HTMLInputElement).checked).toBe(false)
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(false)
    wrapper.unmount()
  })
  it('does not keep controls locked while an event recipient is unresponsive', async () => {
    state.emit.mockImplementation(() => new Promise(() => {}))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await flushPromises()
    expect(wrapper.get('input[aria-label="启用语音"]').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('input[aria-label="启用语音"]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('shows all home controls off and unavailable when no character is selected', async () => {
    localStorage.setItem('deskaura-on-top', 'true')
    const wrapper = mount(RoleModulePanel, { props: { roleId: '', desktop: true },
      global: { stubs: { LocalOperationPanel: true } } })
    await flushPromises()
    for (const input of wrapper.findAll('input[type="checkbox"]')) {
      expect((input.element as HTMLInputElement).checked).toBe(false)
      expect(input.attributes('disabled')).toBeDefined()
    }
    const picker = wrapper.findComponent(ConfigPicker)
    expect(picker.props('modelValue')).toBe('off')
    expect(picker.props('disabled')).toBe(true)
    expect(state.get).not.toHaveBeenCalled()
    wrapper.unmount()
    localStorage.removeItem('deskaura-on-top')
  })
  it('keeps switches available while status discovery is still pending', async () => {
    const { moduleStates } = await import('../roleModules')
    vi.mocked(moduleStates).mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    expect(wrapper.get('input[aria-label="启用听觉"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false)
    await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ asr_enabled: false }, 'role-a')
    wrapper.unmount()
  })
  it('uses file input and output icons for role configuration actions', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a', overview: true } })
    await flushPromises()
    const buttons = wrapper.findAll('.module-header-actions button')
    expect(buttons.map(button => button.text())).toEqual(['一键检测', '导入', '导出'])
    expect(buttons[1]!.find('svg.lucide-file-input').exists()).toBe(true)
    expect(buttons[2]!.find('svg.lucide-file-output').exists()).toBe(true)
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    expect(wrapper.emitted('importRole')).toHaveLength(1)
    expect(wrapper.emitted('export')).toHaveLength(1)
    wrapper.unmount()
  })
  it('recovers saved controls automatically when the backend starts after the home window', async () => {
    vi.useFakeTimers()
    state.get.mockRejectedValueOnce(new Error('backend starting')).mockResolvedValue(config)
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    expect(wrapper.get('input[aria-label="启用听觉"]').attributes('disabled')).toBeDefined()
    await vi.advanceTimersByTimeAsync(1000); await flushPromises()
    expect(wrapper.get('input[aria-label="启用听觉"]').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(true)
    wrapper.unmount()
  })
  it('saves standby separately and leaves the gaze menu available when off', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a', desktop: true },
      global: { stubs: { LocalOperationPanel: true } } })
    await flushPromises()
    const standby = wrapper.findAll('label.compact-check').find(label => label.text() === '待机动作')!
    await standby.get('input').setValue(false); await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ standby_enabled: false }, 'role-a')
    const picker = wrapper.findComponent(ConfigPicker)
    picker.vm.$emit('update:modelValue', 'off'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ gaze_enabled: false }, 'role-a')
    expect(picker.props('disabled')).toBe(false)
    expect(picker.props('modelValue')).toBe('off')
    picker.vm.$emit('update:modelValue', 'mouse'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ gaze_enabled: true, gaze_mode: 'mouse' }, 'role-a')
    wrapper.unmount()
  })
  it.each([['启用听觉', 'asr_enabled', 'deskaura:asr-settings-changed'],
    ['启用语音', 'audio_enabled', 'deskaura:audio-settings-changed']])('notifies both windows only after %s is saved off', async (label, field, event) => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get(`input[aria-label="${label}"]`).setValue(false); await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ [field]: false }, 'role-a')
    expect(deviceCalls()).toEqual([['main', event, 'role-a'], ['dialog', event, 'role-a']])
    wrapper.unmount()
  })
  it('does not stop a device if saving its disable request fails', async () => {
    state.save.mockRejectedValueOnce(new Error('save failed'))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false); await flushPromises()
    expect(deviceCalls()).toEqual([])
    expect(wrapper.text()).toContain('save failed')
    wrapper.unmount()
  })
  it('does not stop another applied role after an asynchronous save completes', async () => {
    let resolve!: (value: unknown) => void
    state.save.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    await wrapper.get('input[aria-label="启用语音"]').setValue(false)
    localStorage.setItem('deskaura-active-model', 'role-b')
    resolve({ ...config, audio_enabled: false }); await flushPromises()
    expect(deviceCalls()).toEqual([])
    wrapper.unmount()
  })
  it('refreshes controls for settings saved in another window without waiting for a poll', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.get.mockResolvedValue({ ...config, asr_enabled: false })
    await state.listeners.get('deskaura:config-changed')!({ payload: 'role-b' }); await flushPromises()
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(true)
    await state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' }); await flushPromises()
    expect((wrapper.get('input[aria-label="启用听觉"]').element as HTMLInputElement).checked).toBe(false)
    wrapper.unmount()
    expect(state.listeners.has('deskaura:config-changed')).toBe(false)
  })
  it('does not invalidate its own in-flight save when the same window receives its event', async () => {
    const wrapper = mount(RoleModulePanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.emit.mockImplementation(async (_target, event, payload) => {
      state.listeners.get(event)?.({ payload })
    })
    state.get.mockClear()
    await wrapper.get('input[aria-label="启用听觉"]').setValue(false); await flushPromises()
    expect(state.get).not.toHaveBeenCalled()
    expect(deviceCalls()).toEqual([
      ['main', 'deskaura:asr-settings-changed', 'role-a'],
      ['dialog', 'deskaura:asr-settings-changed', 'role-a'],
    ])
    wrapper.unmount()
  })
})
