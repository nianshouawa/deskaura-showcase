import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  BUILTIN_MODEL_DEFINITIONS,
  BUILTIN_SEEDED_STORAGE_KEY,
  BUILTIN_DELETED_STORAGE_KEY,
  isBuiltinModelId,
  createBuiltinStoredModel,
  getDeletedBuiltinIds,
  markBuiltinDeleted,
  clearBuiltinDeleted,
  seedBuiltinModels,
  restoreBuiltinModels,
} from './builtinModels'
import * as modelLib from './modelLibrary'
import { resolveModelUrl, type StoredModel } from './modelLibrary'

describe('builtinModels definitions & helpers', () => {
  it('contains the two required compliant builtin models', () => {
    expect(BUILTIN_MODEL_DEFINITIONS).toHaveLength(2)
    const [yuki, shibu] = BUILTIN_MODEL_DEFINITIONS
    expect(yuki.id).toBe('builtin-yuki')
    expect(yuki.fileName).toBe('yuki.vrm')
    expect(yuki.url).toBe('/builtin-models/yuki.vrm')
    expect(yuki.name).toContain('结海')
    expect(yuki.author).toBe('minto_akayama')

    expect(shibu.id).toBe('builtin-shibu')
    expect(shibu.fileName).toBe('shibu.vrm')
    expect(shibu.url).toBe('/builtin-models/shibu.vrm')
    expect(shibu.name).toContain('千駄ヶ谷渋')
    expect(shibu.author).toBe('VRoidプロジェクト')
  })

  it('identifies builtin model IDs correctly', () => {
    expect(isBuiltinModelId('builtin-yuki')).toBe(true)
    expect(isBuiltinModelId('builtin-shibu')).toBe(true)
    expect(isBuiltinModelId('custom-role-123')).toBe(false)
  })

  it('creates valid StoredModel record with proper namespaces', () => {
    const yukiDef = BUILTIN_MODEL_DEFINITIONS[0]
    const stored = createBuiltinStoredModel(yukiDef)
    expect(stored.id).toBe('builtin-yuki')
    expect(stored.name).toBe(yukiDef.name)
    expect(stored.url).toBe('/builtin-models/yuki.vrm')
    expect(stored.path).toBe('/builtin-models/yuki.vrm')
    expect(stored.builtin).toBe(true)
    expect(stored.memoryPath).toBe('deskaura://roles/builtin-yuki/memory')
    expect(stored.sessionPath).toBe('deskaura://roles/builtin-yuki/session')
    expect(stored.roleConfig).toEqual({})
  })
})

describe('resolveModelUrl', () => {
  it('prefers explicit url field', () => {
    const model: StoredModel = {
      id: 'm1',
      name: 'Yuki',
      url: '/builtin-models/yuki.vrm',
      added: 1,
    }
    expect(resolveModelUrl(model)).toBe('/builtin-models/yuki.vrm')
  })

  it('returns relative or web url path as is', () => {
    const model1: StoredModel = {
      id: 'm1',
      name: 'Yuki',
      path: '/builtin-models/yuki.vrm',
      added: 1,
    }
    expect(resolveModelUrl(model1)).toBe('/builtin-models/yuki.vrm')

    const model2: StoredModel = {
      id: 'm2',
      name: 'WebModel',
      path: 'https://example.com/model.vrm',
      added: 1,
    }
    expect(resolveModelUrl(model2)).toBe('https://example.com/model.vrm')
  })

  it('returns null if neither url nor path exists', () => {
    const model: StoredModel = {
      id: 'm1',
      name: 'BlobOnly',
      file: new Blob([]),
      added: 1,
    }
    expect(resolveModelUrl(model)).toBeNull()
  })
})

describe('builtinModels seeding and preservation', () => {
  let fakeStore: Record<string, string> = {}
  let fakeDb: Map<string, StoredModel> = new Map()

  beforeEach(() => {
    fakeStore = {}
    fakeDb = new Map()

    vi.stubGlobal('localStorage', {
      getItem: (key: string) => fakeStore[key] ?? null,
      setItem: (key: string, val: string) => { fakeStore[key] = String(val) },
      removeItem: (key: string) => { delete fakeStore[key] },
      clear: () => { fakeStore = {} },
    })

    vi.spyOn(modelLib, 'listModels').mockImplementation(async () => Array.from(fakeDb.values()))
    vi.spyOn(modelLib, 'putModel').mockImplementation(async (m: StoredModel) => {
      fakeDb.set(m.id, { ...m })
      return m.id
    })
  })

  it('tracks deleted builtin IDs and clears them', () => {
    expect(getDeletedBuiltinIds()).toEqual([])
    markBuiltinDeleted('builtin-yuki')
    expect(getDeletedBuiltinIds()).toContain('builtin-yuki')
    markBuiltinDeleted('unknown-model')
    expect(getDeletedBuiltinIds()).toEqual(['builtin-yuki'])

    clearBuiltinDeleted('builtin-yuki')
    expect(getDeletedBuiltinIds()).toEqual([])
  })

  it('seeds builtin models on clean startup without overwriting existing data', async () => {
    // Add existing custom user model
    const customUserRole: StoredModel = {
      id: 'custom-momo',
      name: 'Momo',
      description: 'User created role',
      path: 'C:/models/momo.vrm',
      added: 123456,
      roleConfig: { customSetting: true },
      memoryPath: 'deskaura://roles/custom-momo/memory',
      sessionPath: 'deskaura://roles/custom-momo/session',
    }
    fakeDb.set(customUserRole.id, customUserRole)

    const result = await seedBuiltinModels()
    expect(result).toHaveLength(3)

    // Existing user role must be completely intact
    const preserved = result.find(m => m.id === 'custom-momo')
    expect(preserved).toBeDefined()
    expect(preserved?.name).toBe('Momo')
    expect(preserved?.roleConfig).toEqual({ customSetting: true })

    // Builtin models must be added
    expect(result.some(m => m.id === 'builtin-yuki')).toBe(true)
    expect(result.some(m => m.id === 'builtin-shibu')).toBe(true)
    expect(fakeStore[BUILTIN_SEEDED_STORAGE_KEY]).toBe('true')
  })

  it('does not re-seed deleted builtin model automatically', async () => {
    // Initial seed
    await seedBuiltinModels()
    expect(fakeDb.has('builtin-yuki')).toBe(true)

    // Simulate user deleting builtin-yuki
    fakeDb.delete('builtin-yuki')
    markBuiltinDeleted('builtin-yuki')

    // Next run of seedBuiltinModels
    const nextResult = await seedBuiltinModels()
    expect(nextResult.some(m => m.id === 'builtin-yuki')).toBe(false)
    expect(nextResult.some(m => m.id === 'builtin-shibu')).toBe(true)

    // User explicitly clicks "恢复内置模型"
    const restored = await restoreBuiltinModels()
    expect(restored.some(m => m.id === 'builtin-yuki')).toBe(true)
    expect(restored.some(m => m.id === 'builtin-shibu')).toBe(true)
    expect(getDeletedBuiltinIds()).toEqual([])
  })
})
