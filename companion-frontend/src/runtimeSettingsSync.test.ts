// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveModelSettings } from './api'

const events = vi.hoisted(() => ({ emit: vi.fn(async () => {}) }))
vi.mock('@tauri-apps/api/event', () => ({ emitTo: events.emit }))

afterEach(() => {
  vi.unstubAllGlobals()
  events.emit.mockClear()
  localStorage.clear()
  delete (window as any).__TAURI_INTERNALS__
})

describe('saved configuration runtime delivery', () => {
  it('delivers the saved role configuration to all role surfaces after persistence', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    localStorage.setItem('deskaura-active-model', 'desktop-role')
    const saved = { base_url: '', model: '', standby_enabled: false, asr_enabled: false }
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      expect(events.emit).not.toHaveBeenCalled()
      expect(options.headers['X-DeskAura-Role']).toBe('selected-role')
      return Response.json(saved)
    }))
    expect(await saveModelSettings({ standby_enabled: false }, 'selected-role')).toEqual(saved)
    expect(events.emit.mock.calls).toEqual(['main', 'dialog', 'home', 'settings'].map(target =>
      [target, 'deskaura:runtime-settings', { roleId: 'selected-role', settings: saved, fields: ['standby_enabled'] }]))
  })
  it('does not apply a setting when persistence failed', async () => {
    ;(window as any).__TAURI_INTERNALS__ = {}
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: '保存失败' }, { status: 503 })))
    await expect(saveModelSettings({ asr_enabled: false }, 'role-a')).rejects.toThrow('保存失败')
    expect(events.emit).not.toHaveBeenCalled()
  })
})
