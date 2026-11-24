// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LocalOperationPanel from './LocalOperationPanel.vue'
import ConfigPicker from './ConfigPicker.vue'

const state = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), request: vi.fn(), emit: vi.fn(),
  listeners: new Map<string, (event: { payload: any }) => unknown>() }))
vi.mock('../api', () => ({
  getModelSettings: state.get, saveModelSettings: state.save, request: state.request,
  roleHeaders: (id: string) => ({ 'X-DeskAura-Role': id }),
}))
vi.mock('../tauri', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: state.emit, listen: vi.fn(async (name, listener) => {
  state.listeners.set(name, listener)
  return () => state.listeners.delete(name)
}) }))
vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({ onDragDropEvent: vi.fn(async () => () => {}) }),
}))
beforeEach(() => {
  state.get.mockReset().mockResolvedValue({ base_url: '', model: '', file_access_root: 'D:/before' })
  state.save.mockReset().mockImplementation(async patch => ({ base_url: '', model: '', ...patch }))
  state.request.mockReset().mockImplementation(async (_url, init) => JSON.parse(init.body))
  state.emit.mockReset().mockResolvedValue(undefined)
  state.listeners.clear()
})
describe('saved local operation workspace', () => {
  it('finishes queued changes for a new role after an earlier role save returns', async () => {
    let finish!: (value: unknown) => void
    state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    wrapper.findAllComponents(ConfigPicker)[0]!.vm.$emit('update:modelValue', 'help_me_approve')
    await flushPromises()
    await wrapper.setProps({ roleId: 'role-b' }); await flushPromises()
    wrapper.findAllComponents(ConfigPicker)[0]!.vm.$emit('update:modelValue', 'full_approval')
    await flushPromises()
    finish({ base_url: '', model: '', local_operation_mode: 'help_me_approve' })
    await flushPromises()
    expect(state.save.mock.calls).toEqual([
      [{ local_operation_mode: 'help_me_approve' }, 'role-a'],
      [{ local_operation_mode: 'full_approval' }, 'role-b'],
    ])
    expect(wrapper.findAllComponents(ConfigPicker)[0]!.props('modelValue')).toBe('full_approval')
    expect(state.request).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('syncs a local policy immediately and queues rapid edits without detection or locking', async () => {
    let finish!: (value: unknown) => void
    state.save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    const approvalPicker = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '批准策略')!
    const accessPicker = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '沙盒权限')!
    approvalPicker.vm.$emit('update:modelValue', 'help_me_approve')
    await flushPromises()
    expect(approvalPicker.props('modelValue')).toBe('help_me_approve')
    expect(state.emit).toHaveBeenCalledWith('settings', 'deskaura:module-toggle', {
      roleId: 'role-a', patch: { local_operation_mode: 'help_me_approve' },
    })
    expect(accessPicker.props('disabled')).toBe(false)
    accessPicker.vm.$emit('update:modelValue', 'workspace_write')
    await flushPromises()
    expect(accessPicker.props('modelValue')).toBe('workspace_write')
    expect(state.save).toHaveBeenCalledTimes(1)
    finish({ base_url: '', model: '', file_access_root: 'D:/before', local_operation_mode: 'help_me_approve' })
    await flushPromises()
    expect(state.save.mock.calls).toEqual([
      [{ local_operation_mode: 'help_me_approve' }, 'role-a'],
      [{ local_sandbox_mode: 'workspace_write', local_sandbox_enabled: false }, 'role-a'],
    ])
    expect(state.request).not.toHaveBeenCalled()
    expect(state.emit.mock.calls.some(([, event]) => /status|config-changed/.test(event))).toBe(false)
    wrapper.unmount()
  })
  it('accepts another window’s local policy without a fetch and ignores other characters', async () => {
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.get.mockClear()
    state.listeners.get('deskaura:module-toggle')!({ payload: {
      roleId: 'role-a', patch: { local_sandbox_mode: 'workspace_write', file_access_root: 'D:/shared' },
    } })
    await flushPromises()
    expect(wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '沙盒权限')!.props('modelValue')).toBe('workspace_write')
    expect((wrapper.get('[aria-label="授权目录"]').element as HTMLInputElement).value).toBe('D:/shared')
    state.listeners.get('deskaura:module-toggle')!({ payload: {
      roleId: 'other', patch: { file_access_root: 'D:/other' },
    } })
    expect(state.get).not.toHaveBeenCalled()
    expect((wrapper.get('[aria-label="授权目录"]').element as HTMLInputElement).value).toBe('D:/shared')
    wrapper.unmount()
  })
  it('preserves the workspace controls while a configuration refresh is pending', async () => {
    let finish!: (value: unknown) => void
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } })
    await flushPromises()
    state.get.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const refreshing = (wrapper.vm as any).$?.setupState.refresh()
    await flushPromises()
    expect(wrapper.get('[aria-label="授权目录"]').attributes('disabled')).toBeUndefined()
    expect((wrapper.get('[aria-label="授权目录"]').element as HTMLInputElement).value).toBe('D:/before')
    finish({ base_url: '', model: '', file_access_root: 'D:/after' })
    await refreshing
    await flushPromises()
    expect((wrapper.get('[aria-label="授权目录"]').element as HTMLInputElement).value).toBe('D:/after')
    wrapper.unmount()
  })
  it('keeps all local-operation controls unavailable without a selected role', async () => {
    const wrapper = mount(LocalOperationPanel, { props: { roleId: '', compact: true } })
    await flushPromises()
    for (const picker of wrapper.findAllComponents(ConfigPicker)) {
      expect(picker.props('modelValue')).toBe('')
      expect(picker.props('placeholder')).toBe('未启用')
      expect(picker.props('disabled')).toBe(true)
    }
    expect(wrapper.get('[aria-label="授权目录"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.directory-field button').attributes('disabled')).toBeDefined()
    expect(state.get).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('saves the visible access choice immediately and clears the obsolete sandbox switch', async () => {
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } }); await flushPromises()
    const picker = wrapper.findAllComponents(ConfigPicker).find(item => item.props('label') === '沙盒权限')!
    expect(picker.props('modelValue')).toBe('read_only')
    picker.vm.$emit('update:modelValue', 'full_access'); await flushPromises()
    expect(state.save).toHaveBeenCalledWith({ local_sandbox_mode: 'full_access', local_sandbox_enabled: false }, 'role-a')
    wrapper.unmount()
  })
  it('validates and saves a newly typed workspace on blur and updates the active dialog', async () => {
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } }); await flushPromises()
    const input = wrapper.get('input[aria-label="授权目录"]')
    await input.setValue('D:/saved'); await input.trigger('blur'); await flushPromises()
    expect(state.request).toHaveBeenCalledWith('/api/local/directory', expect.objectContaining({
      body: JSON.stringify({ path: 'D:/saved' }), headers: { 'X-DeskAura-Role': 'role-a' },
    }))
    expect(state.save).toHaveBeenCalledWith({ file_access_root: 'D:/saved' }, 'role-a')
    expect(state.emit).toHaveBeenCalledWith('settings', 'deskaura:module-toggle', {
      roleId: 'role-a', patch: { file_access_root: 'D:/saved' },
    })
    await input.trigger('blur'); await flushPromises()
    expect(state.save).toHaveBeenCalledOnce()
    wrapper.unmount()
  })
  it('keeps invalid directories unsaved and reports the validation reason', async () => {
    const wrapper = mount(LocalOperationPanel, { props: { roleId: 'role-a' } }); await flushPromises()
    state.request.mockRejectedValueOnce(new Error('请选择现有的具体文件夹'))
    await wrapper.get('input[aria-label="授权目录"]').setValue('D:/missing')
    await wrapper.get('input[aria-label="授权目录"]').trigger('blur'); await flushPromises()
    expect(state.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('请选择现有的具体文件夹')
    wrapper.unmount()
  })
})
