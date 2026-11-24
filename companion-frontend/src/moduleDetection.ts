import type { ModuleId, ModuleState, ModuleStates } from './roleModules'

const key = (roleId: string) => `deskaura-module-detection:${roleId}`

/** Historical user-requested results, not live permission or connectivity proof. */
export function savedModuleDetection(roleId: string): ModuleStates {
  if (!roleId) return {}
  try {
    const value = JSON.parse(localStorage.getItem(key(roleId)) || '{}')
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ModuleStates : {}
  }
  catch { return {} }
}

export function saveModuleDetection(roleId: string, id: ModuleId, state: ModuleState) {
  if (typeof localStorage === 'undefined') return
  const results = { ...savedModuleDetection(roleId), [id]: { ...state, enabled: true } }
  localStorage.setItem(key(roleId), JSON.stringify(results))
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('deskaura:detection-saved', { detail: roleId }))
}
