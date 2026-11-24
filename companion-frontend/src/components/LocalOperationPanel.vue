<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { emitTo, listen } from '@tauri-apps/api/event'
import ConfigPicker from './ConfigPicker.vue'
import { getModelSettings, request, roleHeaders, saveModelSettings, type ModelSettings } from '../api'
import { isTauri } from '../tauri'

const props = defineProps<{ roleId: string; compact?: boolean }>()
const emit = defineEmits<{ notice: [value: string] }>()
const state = ref<ModelSettings>({ base_url: '', model: '' })
const root = ref(''), notice = ref(''), loaded = ref(false), saving = ref(false)
let pendingPatch: Partial<ModelSettings> = {}
watch(notice, value => emit('notice', value))
const panel = ref<HTMLElement>()
const approval = [
  { value: 'request_approval', label: '请求批准' },
  { value: 'help_me_approve', label: '帮我批准' },
  { value: 'full_approval', label: '完全批准' },
]
const access = [
  { value: 'read_only', label: '只读' },
  { value: 'workspace_write', label: '工作空间写入' },
  { value: 'full_access', label: '完全访问权限' },
]
let revision = 0, offDrop: (() => void) | undefined, offConfig: (() => void) | undefined, offRuntime: (() => void) | undefined, offToggle: (() => void) | undefined, disposed = false
let startupRetry: ReturnType<typeof setTimeout> | undefined
let loadedRole = ''
let writeRevision = 0
let roleRevision = 0
let directoryRevision = 0
async function refresh() {
  clearTimeout(startupRetry)
  if (saving.value && loadedRole === props.roleId) return
  const current = ++revision, id = props.roleId, write = writeRevision
  if (loadedRole !== id || !id) {
    roleRevision++; directoryRevision++
    loadedRole = id; pendingPatch = {}
    loaded.value = false; notice.value = ''; root.value = ''
    state.value = { base_url: '', model: '' }
  }
  if (!id) return
  try {
    const config = await getModelSettings(id)
    if (current !== revision || id !== props.roleId || write !== writeRevision || disposed) return
    state.value = config; root.value = config.file_access_root || ''; loaded.value = true
  } catch {
    if (current === revision && !disposed && !loaded.value) {
      notice.value ||= '配置读取失败'
      startupRetry = setTimeout(() => { if (!disposed && current === revision) void refresh() }, 1000)
    }
  }
}
watch(() => props.roleId, refresh, { immediate: true })
async function save(patch: Partial<ModelSettings>) {
  if (!loaded.value || !props.roleId || disposed) return
  Object.assign(pendingPatch, patch)
  state.value = { ...state.value, ...patch }
  if (patch.file_access_root !== undefined) root.value = patch.file_access_root
  writeRevision++
  if (isTauri()) void Promise.all(['home', 'settings'].map(target =>
    emitTo(target, 'deskaura:module-toggle', { roleId: props.roleId, patch }).catch(() => {})))
  if (saving.value) return
  const id = props.roleId, current = roleRevision
  saving.value = true; notice.value = ''
  try {
    while (Object.keys(pendingPatch).length && current === roleRevision && id === props.roleId && !disposed) {
      const next = pendingPatch; pendingPatch = {}
      const config = await saveModelSettings(next, id)
      if (current !== roleRevision || id !== props.roleId || disposed) return
      const editingRoot = root.value !== (state.value.file_access_root || '')
      state.value = { ...config, ...pendingPatch }
      if (!editingRoot) root.value = state.value.file_access_root || ''
      notice.value = '已保存'
    }
  } catch (error) {
    if (current === roleRevision && id === props.roleId && !disposed) {
      pendingPatch = {}
      try {
        const config = await getModelSettings(id)
        if (current === roleRevision && id === props.roleId && !disposed) {
          state.value = config; root.value = config.file_access_root || ''
          if (isTauri()) void Promise.all(['home', 'settings'].map(target =>
            emitTo(target, 'deskaura:runtime-settings', { roleId: id, settings: config }).catch(() => {})))
        }
      } catch { /* Retain one save error without retrying or detecting services. */ }
      notice.value = error instanceof Error ? error.message : '保存失败'
    }
  }
  finally {
    saving.value = false
    if (!disposed && loaded.value && Object.keys(pendingPatch).length) void save({})
  }
}
async function saveRoot(path = root.value) {
  if (!path.trim() || !loaded.value) return
  const id = props.roleId, current = roleRevision, directory = ++directoryRevision
  try {
    const result = await request<{ path: string }>('/api/local/directory', {
      method: 'POST', body: JSON.stringify({ path: path.trim() }), headers: roleHeaders(id),
    })
    if (current !== roleRevision || id !== props.roleId || directory !== directoryRevision || disposed) return
    await save({ file_access_root: result.path })
  } catch (error) { if (current === roleRevision && directory === directoryRevision) notice.value = error instanceof Error ? error.message : '目录无效' }
}
async function choose() {
  try {
    const path = await invoke<string | null>('pick_folder', root.value.trim() ? { initialFolder: root.value.trim() } : undefined)
    if (path) await saveRoot(path)
  } catch { notice.value = '文件夹选择失败，可直接输入目录后按回车' }
}
onMounted(async () => {
  if (!isTauri()) return
  offToggle = await listen<{ roleId: string; patch: Partial<ModelSettings> }>('deskaura:module-toggle', e => {
    if (e.payload.roleId !== props.roleId || disposed) return
    writeRevision++
    state.value = { ...state.value, ...e.payload.patch, ...pendingPatch }
    if (e.payload.patch.file_access_root !== undefined) root.value = state.value.file_access_root || ''
  })
  if (disposed) { offToggle(); return }
  offRuntime = await listen<{ roleId: string; settings: ModelSettings }>('deskaura:runtime-settings', e => {
    if (e.payload.roleId !== props.roleId || saving.value || disposed) return
    revision++; writeRevision++
    state.value = e.payload.settings
    root.value = state.value.file_access_root || ''
    loadedRole = props.roleId
    loaded.value = !!props.roleId
  })
  if (disposed) { offRuntime(); return }
  offConfig = await listen<string>('deskaura:config-changed', e => {
    if (e.payload === props.roleId && !saving.value) void refresh()
  })
  if (disposed) { offConfig(); return }
  offDrop = await getCurrentWebview().onDragDropEvent(e => {
    if (e.payload.type !== 'drop' || !e.payload.paths.length || !loaded.value) return
    const bounds = panel.value?.getBoundingClientRect(), p = e.payload.position
    const scale = window.devicePixelRatio || 1
    if (bounds && p.x / scale >= bounds.left && p.x / scale <= bounds.right &&
        p.y / scale >= bounds.top && p.y / scale <= bounds.bottom) void saveRoot(e.payload.paths[0])
  })
  if (disposed) offDrop()
})
onBeforeUnmount(() => { disposed = true; revision++; roleRevision++; directoryRevision++; clearTimeout(startupRetry); offDrop?.(); offConfig?.(); offRuntime?.(); offToggle?.() })
</script>
<template>
  <section ref="panel" class="local-operation-panel" :class="{ compact }" aria-label="本地操作" @dragover.prevent @drop.prevent>
    <h3>本地操作</h3>
    <div class="local-policy-grid">
      <label>批准策略<ConfigPicker :model-value="roleId && loaded ? state.local_operation_mode || 'request_approval' : ''" :placeholder="roleId ? '' : '未启用'" :options="approval" :disabled="!loaded" label="批准策略" @update:model-value="save({ local_operation_mode: $event as ModelSettings['local_operation_mode'] })" /></label>
      <label>沙盒权限<ConfigPicker :model-value="roleId && loaded ? state.local_sandbox_mode || 'read_only' : ''" :placeholder="roleId ? '' : '未启用'" :options="access" :disabled="!loaded" label="沙盒权限" @update:model-value="save({ local_sandbox_mode: $event as ModelSettings['local_sandbox_mode'], local_sandbox_enabled: false })" /></label>
    </div>
    <label class="local-directory-label">工作空间
      <div class="directory-field"><input v-model="root" :disabled="!loaded" placeholder="输入目录后回车，或拖入文件夹" aria-label="授权目录" @keyup.enter="saveRoot()" @blur="root.trim() !== (state.file_access_root || '').trim() && saveRoot()" /><button type="button" :disabled="!loaded" @click="choose">选择</button></div>
    </label>
    <p v-if="!compact" class="settings-hint">{{ state.local_sandbox_mode === 'full_access' ? '完全访问允许操作工作空间外的文件，并按批准策略运行命令和 MCP 工具。' : state.local_sandbox_mode === 'read_only' ? '只允许读取工作空间；禁止修改文件、执行命令和调用第三方 MCP 工具。' : '文件修改限制在工作空间；没有可验证的系统隔离时，命令和第三方 MCP 工具会被阻止。' }}</p>
    <p v-if="notice && !compact" class="local-operation-notice" role="status">{{ notice }}</p>
  </section>
</template>
