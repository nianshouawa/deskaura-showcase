// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import McpServicesPanel from './McpServicesPanel.vue'

const state = vi.hoisted(() => ({
  get: vi.fn(), services: vi.fn(), save: vi.fn(), connect: vi.fn(), toggle: vi.fn(), invoke: vi.fn(),
}))
vi.mock('../mcp', async importOriginal => ({
  ...await importOriginal<typeof import('../mcp')>(),
  getMcpConfiguration: state.get, getMcpServices: state.services, saveMcpConfiguration: state.save,
  connectMcpServices: state.connect, setMcpToolEnabled: state.toggle,
}))
vi.mock('../tauri', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }))
const service = {
  name: '文件服务', connected: true, detail: '已连接', server_info: { name: 'Local Files', version: '1.0' },
  tools: [{ name: 'read_file', description: '读取授权目录里的文件', inputSchema: { type: 'object' }, enabled: true }],
}
beforeEach(() => {
  vi.clearAllMocks()
  state.get.mockResolvedValue({ config: { mcpServers: {} } })
  state.services.mockResolvedValue({ services: [] })
  state.save.mockImplementation(async (_id, config) => ({ config, services: [structuredClone(service)] }))
  state.connect.mockResolvedValue({ services: [structuredClone(service)] })
  state.toggle.mockResolvedValue({ services: [{ ...service, tools: [{ ...service.tools[0], enabled: false }] }] })
})
afterEach(() => { document.body.innerHTML = '' })

describe('MCP service settings', () => {
  it('starts with the valid JSON template and only the requested controls', async () => {
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' } }); await flushPromises()
    expect(wrapper.get('textarea').element.value).toBe('{\n  "mcpServers": {}\n}')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['导入配置', '导出配置'])
    expect(wrapper.findAll('button')[0]!.find('svg.lucide-file-input').exists()).toBe(true)
    expect(wrapper.findAll('button')[1]!.find('svg.lucide-file-output').exists()).toBe(true)
    expect(wrapper.find('input[type=file]').attributes('accept')).toBe('.json,application/json')
    expect(wrapper.text()).toContain('MCP服务')
    expect(wrapper.text()).not.toContain('端点地址')
    wrapper.unmount()
  })
  it('formats and saves on blur without starting connection detection', async () => {
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' } }); await flushPromises()
    const editor = wrapper.get('textarea')
    await editor.setValue('{"mcpServers":{"文件服务":{"url":"http://localhost:3900/mcp"}}}')
    await editor.trigger('blur'); await flushPromises()
    expect(state.save).toHaveBeenCalledExactlyOnceWith('alpha', { mcpServers: { 文件服务: { url: 'http://localhost:3900/mcp' } } }, false)
    expect(editor.element.value).toContain('\n  "mcpServers":')
    expect(wrapper.get('.mcp-service-card').text()).toContain('文件服务')
    expect(wrapper.get('.mcp-service-card').text()).toContain('Local Files · 1.0')
    expect(wrapper.get('.mcp-connection').text()).toBe('已连接')
    expect(wrapper.emitted('saved')).toHaveLength(1)
    wrapper.unmount()
  })
  it('keeps invalid JSON visible and never saves it', async () => {
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' } }); await flushPromises()
    await wrapper.get('textarea').setValue('{bad json')
    await wrapper.get('textarea').trigger('blur'); await flushPromises()
    expect(state.save).not.toHaveBeenCalled()
    expect(wrapper.get('[role=alert]').text()).toContain('JSON 格式不正确')
    expect(wrapper.get('textarea').element.value).toBe('{bad json')
    wrapper.unmount()
  })
  it('blurs on blank space, formats every time and serializes repeated saves', async () => {
    let finish!: (value: unknown) => void
    state.save.mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' }, attachTo: document.body }); await flushPromises()
    const editor = wrapper.get('textarea')
    ;(editor.element as HTMLTextAreaElement).focus()
    await editor.setValue('{"mcpServers":{"one":{"url":"https://one.test/mcp"}}}')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    expect(document.activeElement).not.toBe(editor.element)
    expect(editor.element.value).toContain('\n  "mcpServers"')
    ;(editor.element as HTMLTextAreaElement).focus()
    await editor.setValue('{"mcpServers":{"two":{"url":"https://two.test/mcp"}}}')
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); await flushPromises()
    expect(editor.element.value).toContain('\n    "two"')
    finish({ services: [service] }); await flushPromises()
    expect(state.save).toHaveBeenCalledTimes(2)
    expect(state.save.mock.calls[1]![1]).toEqual({ mcpServers: { two: { url: 'https://two.test/mcp' } } })
    wrapper.unmount()
  })
  it('formats but never saves drafts when clicking the separate detect button', async () => {
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' }, attachTo: document.body }); await flushPromises()
    const button = document.createElement('button'); button.dataset.mcpNoAutosave = ''; document.body.append(button)
    const editor = wrapper.get('textarea')
    ;(editor.element as HTMLTextAreaElement).focus()
    await editor.setValue('{"mcpServers":{"draft":{"url":"https://draft.test/mcp"}}}')
    button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flushPromises()
    await (wrapper.vm as unknown as { detect: () => Promise<void> }).detect()
    expect(document.activeElement).not.toBe(editor.element)
    expect(editor.element.value).toContain('\n    "draft"')
    expect(state.save).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('also avoids autosaving when keyboard focus moves directly to detection', async () => {
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' }, attachTo: document.body }); await flushPromises()
    const button = document.createElement('button'); button.dataset.mcpNoAutosave = ''; document.body.append(button)
    const editor = wrapper.get('textarea')
    ;(editor.element as HTMLTextAreaElement).focus()
    await editor.setValue('{"mcpServers":{"draft":{"url":"https://draft.test/mcp"}}}')
    button.focus(); await flushPromises()
    expect(state.save).not.toHaveBeenCalled()
    expect(editor.element.value).toContain('\n    "draft"')
    wrapper.unmount()
  })
  it('adds a single-server refresh before the tools button without saving JSON', async () => {
    state.services.mockResolvedValueOnce({ services: [structuredClone(service)] })
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' } }); await flushPromises()
    expect(wrapper.findAll('.mcp-service-actions button').map(button => button.attributes('aria-label'))).toEqual(['刷新文件服务', '文件服务工具列表'])
    await wrapper.get('.mcp-refresh-button').trigger('click'); await flushPromises()
    expect(state.connect).toHaveBeenCalledExactlyOnceWith('alpha', '文件服务')
    expect(state.save).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('shows tool details and immediately persists disabled tools', async () => {
    state.services.mockResolvedValueOnce({ services: [structuredClone(service)] })
    state.get.mockResolvedValueOnce({ config: { mcpServers: { 文件服务: { url: 'http://localhost:3900/mcp' } } } })
      .mockResolvedValue({ config: { mcpServers: { 文件服务: { url: 'http://localhost:3900/mcp', disabledTools: ['read_file'] } } } })
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' }, attachTo: document.body }); await flushPromises()
    await wrapper.get('.mcp-tools-button').trigger('click'); await flushPromises()
    const dialog = document.querySelector('[role=dialog]')!
    expect(dialog.textContent).toContain('读取授权目录里的文件')
    const toggle = dialog.querySelector('input')!
    expect(toggle.checked).toBe(true)
    toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true })); await flushPromises()
    expect(state.toggle).toHaveBeenCalledExactlyOnceWith('alpha', '文件服务', 'read_file', false)
    expect(wrapper.get('textarea').element.value).toContain('"disabledTools"')
    expect(toggle.checked).toBe(false)
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await flushPromises()
    expect(document.querySelector('[role=dialog]')).toBeNull()
    wrapper.unmount()
  })
  it('exports JSON without falling back to a different role', async () => {
    state.invoke.mockResolvedValue('D:/config.json')
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha', roleName: '甲' } }); await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '导出配置')!.trigger('click')
    await flushPromises()
    expect(state.invoke).toHaveBeenCalledWith('save_role_export', {
      content: '{\n  "mcpServers": {}\n}', suggestedName: '甲-MCP配置.json', exportKind: 'mcp',
    })
    wrapper.unmount()
  })
  it('does not apply a late connection response after switching characters', async () => {
    let resolve!: (value: unknown) => void
    state.save.mockReturnValueOnce(new Promise(done => { resolve = done }))
    const wrapper = mount(McpServicesPanel, { props: { roleId: 'alpha' } }); await flushPromises()
    await wrapper.get('textarea').setValue('{"mcpServers":{"旧服务":{"url":"https://old.example/mcp"}}}')
    await wrapper.get('textarea').trigger('blur')
    await wrapper.setProps({ roleId: 'beta' }); await flushPromises()
    resolve({ config: { mcpServers: {} }, services: [service] }); await flushPromises()
    expect(wrapper.find('.mcp-service-card').exists()).toBe(false)
    expect(wrapper.get('textarea').element.value).toBe('{\n  "mcpServers": {}\n}')
    wrapper.unmount()
  })
})
