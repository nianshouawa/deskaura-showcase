// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.vue'
import ConfigPicker from './components/ConfigPicker.vue'

const state = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: any }) => unknown>(),
  refresh: vi.fn(),
  settings: vi.fn(),
  ensureRole: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({}) }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}))
vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn(async () => {}),
  listen: vi.fn(async (name, listener) => {
    state.listeners.set(name, listener)
    return () => state.listeners.delete(name)
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./tauri', () => ({ isTauri: () => true }))
vi.mock('./api', () => ({
  getModelSettings: state.settings,
  request: vi.fn(async () => ({ available: false, detail: '没有已配置的系统沙箱' })),
  roleHeaders: (id: string) => ({ 'X-DeskAura-Role': id }),
  saveModelSettings: vi.fn(),
}))
vi.mock('./modelLibrary', () => ({
  listModels: vi.fn(async () => [{ id: 'role-a', name: '角色 A', path: 'D:/role-a.vrm', added: 1 }]),
  updateModel: vi.fn(),
  updateRoleConfig: vi.fn(),
  safeRoleConfig: (value: unknown) => value,
}))
vi.mock('./roleModules', async importOriginal => ({
  ...await importOriginal<typeof import('./roleModules')>(),
  ensureRoleRecord: state.ensureRole,
  moduleSettingsPatch: vi.fn(),
  testRoleModule: vi.fn(),
  roleModules: [
    { id: 'persona', label: '人设', tag: 'persona_tag' },
    { id: 'memory', label: '记忆', tag: 'memory_tag' },
    { id: 'brain', label: '大脑', tag: 'brain_tag' },
    { id: 'tools', label: '手脚', tag: 'tools_tag' },
    { id: 'vision', label: '视觉', tag: 'vision_tag' },
    { id: 'hearing', label: '听觉', tag: 'hearing_tag' },
    { id: 'voice', label: '语音', tag: 'voice_tag' },
    { id: 'motion', label: '动作', tag: 'motion_tag' },
  ],
}))
vi.mock('./components/LocalOperationPanel.vue', () => ({
  default: { props: ['roleId'], template: '<div class="test-local-operations" :data-role="roleId" />' },
}))
vi.mock('./components/RoleModulePanel.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({
    props: ['roleId'],
    setup(props, { expose }) {
      expose({ refresh: state.refresh })
      return () => h('div', { class: 'test-role-module-panel', 'data-role': props.roleId })
    },
  }) }
})

beforeEach(() => {
  localStorage.clear()
  localStorage.setItem('deskaura-active-model', 'role-a')
  state.listeners.clear()
  state.refresh.mockReset().mockResolvedValue(undefined)
  state.settings.mockReset().mockResolvedValue({ base_url: 'https://example.invalid/v1', model: 'qa' })
  state.ensureRole.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: vi.fn(async () => []), getUserMedia: vi.fn() },
  })
})
afterEach(() => { localStorage.clear() })

describe('hidden settings window recovery', () => {
  it('updates a module switch immediately without reading configuration or replacing a detection result', async () => {
    const wrapper = mount(Settings)
    await flushPromises()
    const runtime = (wrapper.vm as any).$?.setupState
    runtime.feedback = '上次检测正常'
    state.settings.mockClear()
    await state.listeners.get('deskaura:module-toggle')!({ payload: {
      roleId: 'role-a', patch: { brain_enabled: false },
    } })
    expect(runtime.settings.brain_enabled).toBe(false)
    expect(runtime.feedback).toBe('上次检测正常')
    expect(state.settings).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('never replaces a manual result with repeated background connection errors', async () => {
    const wrapper = mount(Settings)
    await flushPromises()
    const runtime = (wrapper.vm as any).$?.setupState
    runtime.feedback = '上次检测正常'
    state.settings.mockRejectedValueOnce(new Error('请求超时')).mockRejectedValueOnce(new Error('无法连接本机服务'))
    state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' })
    await flushPromises()
    state.listeners.get('deskaura:config-changed')!({ payload: 'role-a' })
    await flushPromises()
    expect(runtime.feedback).toBe('上次检测正常')
    wrapper.unmount()
  })
  it('merges home module toggles without overwriting an unsaved form', async () => {
    const wrapper = mount(Settings)
    await flushPromises()
    const runtime = (wrapper.vm as any).$?.setupState
    runtime.settings.model = 'unsaved-model'
    await state.listeners.get('deskaura:runtime-settings')!({ payload: {
      roleId: 'role-a', settings: { model: 'saved-model', brain_enabled: false },
      fields: ['brain_enabled'],
    } })
    await flushPromises()
    expect(runtime.settings.brain_enabled).toBe(false)
    expect(runtime.settings.model).toBe('unsaved-model')
    await state.listeners.get('deskaura:runtime-settings')!({ payload: {
      roleId: 'role-b', settings: { brain_enabled: true }, fields: ['brain_enabled'],
    } })
    expect(runtime.settings.brain_enabled).toBe(false)
    wrapper.unmount()
  })
  it('refreshes module status when reopened for the same role without remounting the panel', async () => {
    const wrapper = mount(Settings)
    await flushPromises()
    const panel = wrapper.get('.test-role-module-panel').element
    expect(state.refresh).toHaveBeenCalledOnce()
    state.refresh.mockClear()
    state.settings.mockClear()

    await state.listeners.get('deskaura:configure-role')!({ payload: { roleId: 'role-a', section: 'role' } })
    await flushPromises()

    expect(wrapper.get('.test-role-module-panel').element).toBe(panel)
    expect(state.settings).toHaveBeenCalledExactlyOnceWith('role-a')
    expect(state.refresh).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('retries a failed initial status read when the hidden window is opened again', async () => {
    state.refresh.mockRejectedValueOnce(new Error('sidecars not ready'))
    const wrapper = mount(Settings)
    await flushPromises()
    expect(wrapper.find('.config-result').exists()).toBe(false)

    await state.listeners.get('deskaura:configure-role')!({ payload: { roleId: 'role-a', section: 'role' } })
    await flushPromises()

    expect(state.refresh).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.config-result').exists()).toBe(false)
    wrapper.unmount()
  })

  it('registers reopen events before waiting for slow backend startup', async () => {
    state.settings.mockRejectedValue(new Error('backend starting'))
    const wrapper = mount(Settings)
    await flushPromises()
    expect(state.listeners.has('deskaura:configure-role')).toBe(true)
    state.settings.mockResolvedValue({ base_url: 'https://saved.example/v1', model: 'restored-model' })
    await state.listeners.get('deskaura:configure-role')!({ payload: { roleId: 'role-a', section: 'brain' } })
    await flushPromises()
    expect((wrapper.get('input[placeholder="服务商实际模型 ID"]').element as HTMLInputElement).value).toBe('restored-model')
    expect(wrapper.get('.settings-save-row button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })
})

describe('native settings layout and module configuration', () => {
  it('keeps branding over the eight-module directory and leaves titlebar controls to the system', async () => {
    const wrapper = mount(Settings)
    await flushPromises()
    expect(wrapper.get('.settings-nav .settings-brand h1').text()).toBe('设置')
    expect(wrapper.find('.settings-titlebar').exists()).toBe(false)
    expect(wrapper.find('.settings-window-buttons').exists()).toBe(false)
    expect(wrapper.findAll('.settings-nav button b').map(button => button.text())).toEqual([
      '角色', '人设', '记忆', '大脑', '手脚', '视觉', '听觉', '语音', '动作',
    ])
    expect(wrapper.get('.test-local-operations').attributes('data-role')).toBe('role-a')
    wrapper.unmount()
  })

  it('lists camera devices without starting capture and preserves an unavailable saved device', async () => {
    state.settings.mockResolvedValueOnce({
      base_url: '', model: '', vision_camera_id: 'unplugged-camera',
    })
    vi.mocked(navigator.mediaDevices.enumerateDevices).mockResolvedValueOnce([
      { kind: 'videoinput', deviceId: 'camera-a', label: '内置摄像头' } as MediaDeviceInfo,
      { kind: 'audioinput', deviceId: 'microphone-a', label: '麦克风' } as MediaDeviceInfo,
    ])
    const wrapper = mount(Settings)
    await flushPromises()
    await wrapper.findAll('.settings-nav button').find(item => item.text().includes('视觉'))!.trigger('click')
    await flushPromises()
    const picker = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '选择摄像头')!
    expect(picker.props('options')).toEqual([
      { value: '', label: '系统默认摄像头' },
      { value: 'camera-a', label: '内置摄像头' },
      { value: 'unplugged-camera', label: '已保存的摄像头（当前不可用）' },
    ])
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('shows built-in capability and hides unused credential inputs in local persona mode', async () => {
    state.settings.mockResolvedValueOnce({
      base_url: '', model: '', persona_connection_mode: 'local', persona_local_provider: 'built_in',
    })
    const wrapper = mount(Settings)
    await flushPromises()
    await wrapper.findAll('.settings-nav button').find(item => item.text().includes('人设'))!.trigger('click')
    expect(wrapper.get('.builtin-model-note').text()).toContain('BGE 中文 Embedding')
    expect(wrapper.find('input[type=password]').exists()).toBe(false)
    const picker = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '模型来源')!
    picker.vm.$emit('update:modelValue', 'external')
    await flushPromises()
    expect(wrapper.find('.builtin-model-note').exists()).toBe(false)
    expect(wrapper.find('input[type=password]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('keeps the saved recognition connection when selecting API services again', async () => {
    state.settings.mockResolvedValueOnce({
      base_url: '', model: '', asr_provider: 'dashscope', asr_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      asr_model: 'qwen3-asr-flash', hearing_connection_mode: 'cloud',
    })
    const wrapper = mount(Settings)
    await flushPromises()
    await wrapper.findAll('.settings-nav button').find(item => item.text().includes('听觉'))!.trigger('click')
    expect(wrapper.find('[role=tab]').exists()).toBe(false)
    const source = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '模型来源')!
    source.vm.$emit('update:modelValue', 'external')
    await flushPromises()
    expect(wrapper.findAll('input').some(input => input.element.value === 'https://dashscope.aliyuncs.com/compatible-mode/v1')).toBe(true)
    expect(wrapper.findAll('input').some(input => input.element.value === 'qwen3-asr-flash')).toBe(true)
    expect(wrapper.text()).not.toContain('服务平台')
    wrapper.unmount()
  })

  it('shows MCP-specific labels and keeps the detected visual model name without duplicate notes', async () => {
    state.settings.mockResolvedValueOnce({ base_url: '', model: '', vision_local_provider: 'built_in' })
    const wrapper = mount(Settings)
    await flushPromises()
    await wrapper.findAll('.settings-nav button').find(item => item.text().includes('手脚'))!.trigger('click')
    expect(wrapper.text()).toContain('MCP服务')
    expect(wrapper.text()).toContain('JSON配置')
    expect(wrapper.text()).not.toContain('MCP 端点地址')
    expect(wrapper.text()).not.toContain('MCP 认证凭证')
    expect(wrapper.get('.model-section-title').text()).toContain('未配置服务')
    await wrapper.findAll('.settings-nav button').find(item => item.text().includes('视觉'))!.trigger('click')
    expect(wrapper.get('.model-section-title').text()).toContain('BlazeFace')
    expect(wrapper.get('.builtin-model-note').text()).toContain('BlazeFace')
    wrapper.unmount()
  })
})
