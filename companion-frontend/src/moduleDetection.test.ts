// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { savedModuleDetection, saveModuleDetection } from './moduleDetection'

afterEach(() => localStorage.clear())
describe('last explicit detection results', () => {
  it('stores results by role and preserves their values independently of enable switches', () => {
    saveModuleDetection('role-a', 'brain', { verified: true, detail: '上次检测正常' })
    saveModuleDetection('role-b', 'brain', { verified: false, detail: '上次检测失败' })
    expect(savedModuleDetection('role-a').brain).toEqual({ enabled: true, verified: true, detail: '上次检测正常' })
    expect(savedModuleDetection('role-b').brain?.verified).toBe(false)
    expect(savedModuleDetection('other')).toEqual({})
  })
  it('does not break the screen if the saved display record is corrupt', () => {
    localStorage.setItem('deskaura-module-detection:role-a', 'invalid')
    expect(savedModuleDetection('role-a')).toEqual({})
  })
})
