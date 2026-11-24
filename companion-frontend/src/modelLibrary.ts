import { invoke, convertFileSrc } from '@tauri-apps/api/core'
export const MODEL_EXTENSIONS = /\.(vrm|fbx|glb|gltf|blend|ma|mb)$/i
export interface StoredModel {
  id: string
  name: string
  /** Optional user-facing description shown for the selected character. */
  description?: string
  /** 原始文件路径；设置后不再复制模型文件。 */
  path?: string
  sourcePath?: string
  /** 内置或静态模型资源 URL */
  url?: string
  /** 是否为内置角色 */
  builtin?: boolean
  /** 旧版本遗留的内嵌副本，仅用于兼容已导入的模型。 */
  file?: Blob
  added: number
  /** Per-character configuration and conversation namespace. */
  roleConfig?: Record<string, unknown>
  /** Stable namespaces used by the local session and memory providers. */
  memoryPath?: string
  sessionPath?: string
  sessionId?: string
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('deskaura-model-library', 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('models')) db.createObjectStore('models', { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('models', mode)
    const req = operation(tx.objectStore('models'))
    tx.oncomplete = () => { db.close(); resolve(req.result) }
    tx.onerror = () => { db.close(); reject(tx.error) }
    tx.onabort = () => { db.close(); reject(tx.error) }
  })
}

export const listModels = () => transact('readonly', store => store.getAll()) as Promise<StoredModel[]>
export const getModel = (id: string) => transact('readonly', store => store.get(id)) as Promise<StoredModel | undefined>
export const deleteModel = (id: string) => transact('readwrite', store => store.delete(id))
export const putModel = (model: StoredModel) => transact('readwrite', store => store.put(model))

/**
 * 解析模型的可加载 URL。
 * - 若模型带有 url 字段（如内置模型 /builtin-models/yuki.vrm），直接返回；
 * - 若 path 为相对 URL 或网络地址，直接返回；
 * - 若 path 为本地绝对路径，转换为 Tauri asset 协议 URL。
 */
export function resolveModelUrl(model: StoredModel): string | null {
  if (model.url) return model.url
  if (model.path) {
    if (model.path.startsWith('/') || model.path.startsWith('http://') || model.path.startsWith('https://')) {
      return model.path
    }
    try {
      return convertFileSrc(model.path)
    } catch {
      return model.path
    }
  }
  return null
}

/** Update one role record without exposing its raw IndexedDB transaction. */
export async function updateModel(id: string, patch: Partial<StoredModel>) {
  const model = await getModel(id)
  if (!model) throw new Error('找不到角色记录')
  const next: StoredModel = { ...model, ...patch, id: model.id }
  await transact('readwrite', store => store.put(next))
  return next
}

/** Persist safe per-role settings; credentials are deliberately removed. */
export async function updateRoleConfig(id: string, config: Record<string, unknown>) {
  return updateModel(id, { roleConfig: safeRoleConfig(config) })
}

/** Credentials are never duplicated into IndexedDB, including nested profiles. */
export function safeRoleConfig(config: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (key === 'tools_mcp_config') continue
    if (/^(?:api[_-]?key|password|secret|token)$/i.test(key) ||
        /(?:_api_key|_password|_secret|_token)$/i.test(key)) continue
    if (Array.isArray(value)) {
      safe[key] = value.map(item => item && typeof item === 'object' ? safeRoleConfig(item as Record<string, unknown>) : item)
    } else safe[key] = value && typeof value === 'object' ? safeRoleConfig(value as Record<string, unknown>) : value
  }
  return safe
}

export function roleNamespace(id: string, kind: 'memory' | 'session') {
  return `deskaura://roles/${encodeURIComponent(id)}/${kind}`
}

export async function renameModel(id: string, name: string) {
  const clean = name.trim()
  if (!clean) throw new Error('名称不能为空')
  const model = await getModel(id)
  if (!model) throw new Error('找不到模型')
  await transact('readwrite', store => store.put({ ...model, name: clean.slice(0, 60) }))
}

export function modelName(path: string) {
  return path.split(/[\\/]/).pop()?.replace(MODEL_EXTENSIONS, '') || '未命名角色'
}

/** 登记原始路径，不复制文件内容。 */
export async function addModelPath(path: string) {
  if (!MODEL_EXTENSIONS.test(path)) throw new Error('支持 VRM / FBX / GLB / GLTF / Blend / Maya')
  const models = await listModels()
  // Importing the same source more than once is intentional: each entry is a
  // separate character record with its own persona, memory and session space.
  // Keep the source path for traceability, but always allocate a fresh id and
  // a collision-free display name.
  const sourcePath = path
  if (/\.(blend|ma|mb)$/i.test(path)) path = await invoke<string>('convert_model', { path })
  const baseName = modelName(sourcePath)
  const name = uniqueModelName(baseName, models)
  const id = crypto.randomUUID()
  const model: StoredModel = {
    id, name, path, sourcePath, added: Date.now(), description: '',
    roleConfig: {}, memoryPath: roleNamespace(id, 'memory'), sessionPath: roleNamespace(id, 'session'),
  }
  await transact('readwrite', store => store.put(model))
  return model
}

/** 旧版拖放/选择得到的 File 没有路径，只能作为内嵌副本兼容保存。 */
export async function addModelFile(file: File) {
  if (!/\.(vrm|fbx|glb)$/i.test(file.name)) throw new Error('无原始路径时仅支持独立 VRM/FBX/GLB；其他格式请使用原生导入按钮')
  const models = await listModels()
  const id = crypto.randomUUID()
  const model: StoredModel = {
    id, name: uniqueModelName(modelName(file.name), models), file, added: Date.now(),
    description: '', roleConfig: {}, memoryPath: roleNamespace(id, 'memory'), sessionPath: roleNamespace(id, 'session'),
  }
  await transact('readwrite', store => store.put(model))
  return model
}

export function uniqueModelName(base: string, models: StoredModel[]) {
  if (!models.some(model => model.name === base)) return base
  let index = 1
  while (models.some(model => model.name === `${base}(${index})`)) index += 1
  return `${base}(${index})`
}
