import { listModels, putModel, getModel, roleNamespace, type StoredModel } from './modelLibrary'

export const BUILTIN_SEEDED_STORAGE_KEY = 'deskaura_builtin_seeded_v1'
export const BUILTIN_DELETED_STORAGE_KEY = 'deskaura_deleted_builtin_models'

export interface BuiltinModelDefinition {
  id: string
  name: string
  fileName: string
  url: string
  description: string
  author: string
  license: string
  licenseUrl: string
  features: {
    bones: number
    eyeBones: boolean
    blendshapes: number
    gazeTracking: boolean
    visemes: boolean
  }
}

export const BUILTIN_MODEL_DEFINITIONS: BuiltinModelDefinition[] = [
  {
    id: 'builtin-yuki',
    name: '结海 (Yuika)',
    fileName: 'yuki.vrm',
    url: '/builtin-models/yuki.vrm',
    description: 'DeskAura 内置默认角色 · 活泼灵动 · 作者 minto_akayama',
    author: 'minto_akayama',
    license: 'VRoid Hub 许可 (允许再分发、商业使用、必须署名)',
    licenseUrl: 'https://hub.vroid.com/characters/6016654817173699195/models/6936306532454655938',
    features: {
      bones: 53,
      eyeBones: true,
      blendshapes: 17,
      gazeTracking: true,
      visemes: true,
    },
  },
  {
    id: 'builtin-shibu',
    name: '千駄ヶ谷渋 (Shibu)',
    fileName: 'shibu.vrm',
    url: '/builtin-models/shibu.vrm',
    description: 'VRoid 官方示例内置角色 · 沉稳知性 · 作者 VRoidプロジェクト',
    author: 'VRoidプロジェクト',
    license: 'VRoid Hub 许可 (允许再分发、商业使用、无需强制署名)',
    licenseUrl: 'https://vroid.com/',
    features: {
      bones: 54,
      eyeBones: true,
      blendshapes: 15,
      gazeTracking: true,
      visemes: true,
    },
  },
]

export function isBuiltinModelId(id: string): boolean {
  return BUILTIN_MODEL_DEFINITIONS.some(def => def.id === id)
}

export function createBuiltinStoredModel(def: BuiltinModelDefinition): StoredModel {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    path: def.url,
    url: def.url,
    sourcePath: def.url,
    builtin: true,
    added: 1700000000000,
    roleConfig: {},
    memoryPath: roleNamespace(def.id, 'memory'),
    sessionPath: roleNamespace(def.id, 'session'),
  }
}

export function getDeletedBuiltinIds(): string[] {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(BUILTIN_DELETED_STORAGE_KEY) : null
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function markBuiltinDeleted(id: string): void {
  if (!isBuiltinModelId(id)) return
  try {
    const deleted = getDeletedBuiltinIds()
    if (!deleted.includes(id)) {
      deleted.push(id)
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(BUILTIN_DELETED_STORAGE_KEY, JSON.stringify(deleted))
      }
    }
  } catch {}
}

export function clearBuiltinDeleted(id?: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (!id) {
      localStorage.removeItem(BUILTIN_DELETED_STORAGE_KEY)
      return
    }
    const deleted = getDeletedBuiltinIds().filter(item => item !== id)
    localStorage.setItem(BUILTIN_DELETED_STORAGE_KEY, JSON.stringify(deleted))
  } catch {}
}

/**
 * 自动无侵入注册内置模型：
 * 1. 首次启动（或干净安装）自动将两个内置角色预置入 IndexedDB，不影响任何已有的用户角色数据。
 * 2. 如果用户之前手动删除了某个内置角色，不会在每次刷新时强行复活。
 * 3. 如果本地没有任何角色，则自动重新注册未标记删除的内置角色。
 */
export async function seedBuiltinModels(): Promise<StoredModel[]> {
  try {
    const seeded = typeof localStorage !== 'undefined' ? localStorage.getItem(BUILTIN_SEEDED_STORAGE_KEY) : null
    const existingModels = await listModels()
    const deletedIds = getDeletedBuiltinIds()

    let changed = false
    for (const def of BUILTIN_MODEL_DEFINITIONS) {
      const exists = existingModels.some(m => m.id === def.id)
      if (!exists) {
        // 如果从未 seeded 过，或者该模型未被用户主动标记删除
        if (!seeded || !deletedIds.includes(def.id)) {
          const builtinModel = createBuiltinStoredModel(def)
          await putModel(builtinModel)
          existingModels.push(builtinModel)
          changed = true
        }
      }
    }

    if (typeof localStorage !== 'undefined' && !seeded) {
      localStorage.setItem(BUILTIN_SEEDED_STORAGE_KEY, 'true')
    }

    return changed ? await listModels() : existingModels
  } catch (error) {
    console.warn('[DeskAura] Failed to seed builtin models:', error)
    return await listModels()
  }
}

/**
 * 恢复所有内置模型（供用户在界面点击「恢复内置模型」按钮时调用）。
 * 清除删除标记，并将缺失的内置模型写回 IndexedDB。
 */
export async function restoreBuiltinModels(): Promise<StoredModel[]> {
  clearBuiltinDeleted()
  const existingModels = await listModels()
  for (const def of BUILTIN_MODEL_DEFINITIONS) {
    const exists = existingModels.some(m => m.id === def.id)
    if (!exists) {
      const builtinModel = createBuiltinStoredModel(def)
      await putModel(builtinModel)
    }
  }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BUILTIN_SEEDED_STORAGE_KEY, 'true')
  }
  return await listModels()
}
