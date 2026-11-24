// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { testRoleModule } from './roleModules'
import { savedModuleDetection } from './moduleDetection'

const state = vi.hoisted(() => ({ request: vi.fn(), emit: vi.fn(async () => {}) }))
vi.mock('./api', () => ({
  request: state.request, roleHeaders: (roleId: string) => ({ 'X-DeskAura-Role': roleId }),
}))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: state.emit }))

beforeEach(() => {
  localStorage.clear()
  state.request.mockReset()
  state.emit.mockClear()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
})
afterEach(() => {
  localStorage.clear()
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
})
describe('single detection recording entry', () => {
  it.each([true, false])('records and broadcasts each explicit result once: success=%s', async success => {
    const detail = success ? '正常' : '检测失败'
    if (success) state.request.mockResolvedValueOnce({}).mockResolvedValueOnce({ verified: true, detail })
    else state.request.mockRejectedValueOnce(new Error(detail))
    const saved = vi.fn()
    window.addEventListener('deskaura:detection-saved', saved)
    try {
      if (success) await expect(testRoleModule('persona', 'alpha')).resolves.toMatchObject({ verified: true })
      else await expect(testRoleModule('persona', 'alpha')).rejects.toThrow(detail)
      expect(savedModuleDetection('alpha').persona).toMatchObject({ verified: success, detail })
      expect(saved).toHaveBeenCalledOnce()
      expect(state.emit.mock.calls).toEqual([
        ['home', 'deskaura:module-status-changed', 'alpha'],
        ['settings', 'deskaura:module-status-changed', 'alpha'],
      ])
    } finally { window.removeEventListener('deskaura:detection-saved', saved) }
  })
  it('does not replace historical results when a detection has been cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    state.request.mockRejectedValueOnce(new Error('cancelled'))
    await expect(testRoleModule('persona', 'alpha', { signal: controller.signal })).rejects.toThrow('cancelled')
    expect(savedModuleDetection('alpha')).toEqual({})
    expect(state.emit).not.toHaveBeenCalled()
  })
})
