// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Settings from './Settings.vue'
import ConfigPicker from './components/ConfigPicker.vue'
import type { ModelSettings } from './api'

const storage = vi.hoisted(() => ({
  configs: new Map<string, ModelSettings>(), saved: vi.fn(), exported: vi.fn(), emit: vi.fn(),
}))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: storage.emit, listen: vi.fn(async () => () => {}) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: storage.exported }))
vi.mock('@tauri-apps/api/webview', () => ({ getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }) }))
vi.mock('./tauri', () => ({ isTauri: () => true }))
vi.mock('./api', () => ({
  getModelSettings: vi.fn(async (id: string) => structuredClone(storage.configs.get(id))),
  saveModelSettings: storage.saved,
  roleHeaders: (id: string) => ({ 'X-DeskAura-Role': id }),
  request: vi.fn(async () => ({})),
}))
vi.mock('./modelLibrary', () => ({
  listModels: vi.fn(async () => [{ id: 'alpha', name: '甲', added: 1 }, { id: 'beta', name: '乙', added: 2 }]),
  updateModel: vi.fn(), updateRoleConfig: vi.fn(), safeRoleConfig: (value: unknown) => value,
}))
vi.mock('./roleModules', async importOriginal => {
  const actual = await importOriginal<typeof import('./roleModules')>()
  return { ...actual, ensureRoleRecord: vi.fn(), testRoleModule: vi.fn(async () => ({ verified: true, detail: '正常' })) }
})
vi.mock('./components/RoleModulePanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./components/LocalOperationPanel.vue', () => ({ default: { template: '<div />' } }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear(); localStorage.setItem('deskaura-active-model', 'alpha')
  storage.configs.clear()
  storage.configs.set('alpha', {
    base_url: 'https://saved-alpha.example/v1', model: 'alpha-model', persona_text: '甲的角色设定',
    hearing_local_provider: 'external', hearing_connection_mode: 'cloud',
    asr_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', asr_model: 'qwen3-asr-flash',
  })
  storage.configs.set('beta', { base_url: 'https://saved-beta.example/v1', model: 'beta-model', persona_text: '乙的角色设定' })
  storage.saved.mockImplementation(async (patch: Partial<ModelSettings>, id: string) => {
    const next = { ...storage.configs.get(id)!, ...patch }
    storage.configs.set(id, next)
    return structuredClone(next)
  })
  storage.exported.mockResolvedValue('D:/export.txt')
})

async function section(wrapper: ReturnType<typeof mount>, name: string) {
  await wrapper.findAll('.settings-nav button').find(button => button.find('b').text() === name)!.trigger('click')
  await flushPromises()
}
describe('saved per-character settings', () => {
  it('saves the applied character even when another window does not acknowledge notifications', async () => {
    storage.emit.mockImplementation(() => new Promise(() => {}))
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '大脑')
    await wrapper.get('input[placeholder="服务商实际模型 ID"]').setValue('updated-while-applied')
    await wrapper.findAll('button').find(button => button.text() === '保存配置')!.trigger('click')
    await flushPromises()
    expect(storage.configs.get('alpha')?.model).toBe('updated-while-applied')
    expect(wrapper.get('.config-result').text()).toContain('配置已保存')
    expect(wrapper.get('.settings-save-row button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
    storage.emit.mockResolvedValue(undefined)
  })
  it('defaults to no template without erasing custom text and preserves saved selections', async () => {
    storage.configs.get('beta')!.persona_template = '元气伙伴'
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '人设')
    const template = () => wrapper.findAllComponents(ConfigPicker).find(component => component.props('label') === '角色模板')!
    expect(template().props('modelValue')).toBe('无')
    expect(template().props('options')[0]).toEqual({ value: '无', label: '无' })
    expect((wrapper.get('.persona-editor').element as HTMLTextAreaElement).value).toBe('甲的角色设定')
    template().vm.$emit('update:modelValue', '温柔陪伴'); await flushPromises()
    expect((wrapper.get('.persona-editor').element as HTMLTextAreaElement).value).toContain('温柔、耐心')
    await wrapper.get('.persona-editor').setValue('保留我的手写设定')
    template().vm.$emit('update:modelValue', '无'); await flushPromises()
    expect((wrapper.get('.persona-editor').element as HTMLTextAreaElement).value).toBe('保留我的手写设定')
    await wrapper.findAll('button').find(button => button.text() === '保存配置')!.trigger('click')
    await flushPromises()
    expect(storage.configs.get('alpha')).toMatchObject({ persona_template: '无', persona_text: '保留我的手写设定' })
    await section(wrapper, '角色')
    wrapper.findComponent(ConfigPicker).vm.$emit('update:modelValue', 'beta'); await flushPromises()
    await section(wrapper, '人设')
    expect(template().props('modelValue')).toBe('元气伙伴')
    expect((wrapper.get('.persona-editor').element as HTMLTextAreaElement).value).toBe('乙的角色设定')
    wrapper.unmount()
  })
  it('loads the previous configuration after switching characters and remounting', async () => {
    const wrapper = mount(Settings); await flushPromises()
    await section(wrapper, '大脑')
    const model = wrapper.get('input[placeholder="服务商实际模型 ID"]')
    expect((model.element as HTMLInputElement).value).toBe('alpha-model')
    await model.setValue('alpha-saved-again')
    await wrapper.findAll('button').find(button => button.text() === '保存配置')!.trigger('click')
    await flushPromises()
    await section(wrapper, '角色')
    const picker = wrapper.findComponent(ConfigPicker)
    picker.vm.$emit('update:modelValue', 'beta'); await flushPromises()
    await section(wrapper, '大脑')
    expect((wrapper.get('input[placeholder="服务商实际模型 ID"]').element as HTMLInputElement).value).toBe('beta-model')
    await section(wrapper, '角色')
    wrapper.findComponent(ConfigPicker).vm.$emit('update:modelValue', 'alpha'); await flushPromises()
    await section(wrapper, '大脑')
    expect((wrapper.get('input[placeholder="服务商实际模型 ID"]').element as HTMLInputElement).value).toBe('alpha-saved-again')
    wrapper.unmount()
    const restarted = mount(Settings); await flushPromises(); await section(restarted, '大脑')
    expect((restarted.get('input[placeholder="服务商实际模型 ID"]').element as HTMLInputElement).value).toBe('alpha-saved-again')
    restarted.unmount()
  })
  it('does not overwrite saved API fields when toggling built-in models', async () => {
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '听觉')
    const picker = wrapper.findAllComponents(ConfigPicker).find(component => component.props('label') === '模型来源')!
    picker.vm.$emit('update:modelValue', 'built_in'); await flushPromises()
    picker.vm.$emit('update:modelValue', 'external'); await flushPromises()
    expect(wrapper.findAll('input').map(input => input.element.value)).toContain('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(wrapper.findAll('input').map(input => input.element.value)).toContain('qwen3-asr-flash')
    expect(wrapper.text()).not.toContain('服务平台')
    wrapper.unmount()
  })
  it('exports the current persona document next to the import button without changing another role', async () => {
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '人设')
    await wrapper.get('.persona-editor').setValue('当前编辑的设定')
    const buttons = wrapper.findAll('.document-import button')
    expect(buttons.map(button => button.text())).toEqual(['导入文档', '导出文档'])
    expect(buttons.map(button => button.find('svg').exists())).toEqual([true, true])
    expect(buttons[0]!.find('svg.lucide-file-input').exists()).toBe(true)
    expect(buttons[1]!.find('svg.lucide-file-output').exists()).toBe(true)
    await buttons[1]!.trigger('click'); await flushPromises()
    expect(storage.exported).toHaveBeenCalledWith('save_role_export', { content: '当前编辑的设定', suggestedName: '甲-角色设定.txt', exportKind: 'persona' })
    expect(storage.configs.get('beta')?.persona_text).toBe('乙的角色设定')
    wrapper.unmount()
  })
  it('uses one speech form without a service selector and preserves configured speech fields', async () => {
    Object.assign(storage.configs.get('alpha')!, {
      audio_provider: 'dashscope', audio_base_url: 'https://dashscope.aliyuncs.com/api/v1',
      audio_model: 'qwen3-tts-flash', audio_voice: 'Cherry',
    })
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '语音')
    expect(wrapper.text()).not.toContain('服务平台')
    expect(wrapper.findAll('input').map(input => input.element.value)).toContain('https://dashscope.aliyuncs.com/api/v1')
    expect(wrapper.findAll('input').map(input => input.element.value)).toContain('qwen3-tts-flash')
    const voice = wrapper.findAllComponents(ConfigPicker).find(component => component.props('label') === '音色 ID')!
    expect(voice.props('modelValue')).toBe('Cherry')
    expect(voice.props('options').some((option: { value: string }) => option.value === 'Cherry')).toBe(true)
    wrapper.unmount()
  })
  it('keeps the single shared motion address and removes the optional worker field', async () => {
    const wrapper = mount(Settings); await flushPromises(); await section(wrapper, '动作')
    expect(wrapper.text()).not.toContain('本地 Worker 地址')
    expect(wrapper.find('input[placeholder*="tokenhub.tencentmaas.com"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
