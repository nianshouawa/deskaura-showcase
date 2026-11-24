<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { emitTo, listen } from '@tauri-apps/api/event'
import { FileInput, FileOutput } from '@lucide/vue'
import ConfigPicker from './ConfigPicker.vue'
import LocalOperationPanel from './LocalOperationPanel.vue'
import { getModelSettings, saveModelSettings, type ModelSettings } from '../api'
import { moduleEnabled, moduleModelName, moduleStatusText, moduleStatusUnknown, roleModules, testRoleModule, type ModuleId, type ModuleStates } from '../roleModules'
import { savedModuleDetection } from '../moduleDetection'
import { isTauri, toggleAlwaysOnTop } from '../tauri'
import { gazeOptions, selectedGaze, gazeSelectionPatch } from '../interactionSettings'
const props = defineProps<{ roleId: string; desktop?: boolean; overview?: boolean }>()
const emit = defineEmits<{ configure: [section?: ModuleId]; export: []; importRole: [] }>()
const settings = ref<ModelSettings>({ base_url: '', model: '' })
const states = ref<ModuleStates>({})
const busy = ref(false), notice = ref(''), loaded = ref(false), saving = ref(false)
const localNotice = ref('')
function enabled(id: ModuleId) { return !!props.roleId && loaded.value && moduleEnabled(settings.value, id) }
function modelNameFor(id: ModuleId): string {
  if (!props.roleId) return '未启用'
  if (id === 'tools' && states.value.tools?.mcp_label) return states.value.tools.mcp_label
  return moduleModelName(settings.value, id)
}
const top = ref(localStorage.getItem('deskaura-on-top') === 'true')
let revision = 0
let disposed = false, offStatus: (() => void) | undefined, offConfig: (() => void) | undefined, offRuntime: (() => void) | undefined, offToggle: (() => void) | undefined
let startupRetry: ReturnType<typeof setTimeout> | undefined
let queuedRefresh = false
let loadedRole = ''
let pendingPatch: Partial<ModelSettings> = {}
let writeRevision = 0
let roleRevision = 0
function refreshStatuses() {
  states.value = savedModuleDetection(props.roleId)
}
if (isTauri()) void listen<string>('deskaura:module-status-changed', event => {
  if (event.payload === props.roleId) void refreshStatuses()
}).then(off => { if (disposed) off(); else offStatus = off }).catch(() => {})
if (isTauri()) void listen<string>('deskaura:config-changed', event => {
  if (event.payload === props.roleId && !saving.value) { if (busy.value) queuedRefresh = true; else void refresh() }
}).then(off => { if (disposed) off(); else offConfig = off }).catch(() => {})
if (isTauri()) void listen<{ roleId: string; settings: ModelSettings }>('deskaura:runtime-settings', event => {
  if (event.payload.roleId !== props.roleId || disposed) return
  if (saving.value) { queuedRefresh = true; return }
  revision++; writeRevision++
  clearTimeout(startupRetry)
  settings.value = { ...event.payload.settings }
  loadedRole = props.roleId
  loaded.value = !!props.roleId
}).then(off => { if (disposed) off(); else offRuntime = off }).catch(() => {})
if (isTauri()) void listen<{ roleId: string; patch: Partial<ModelSettings> }>('deskaura:module-toggle', event => {
  if (event.payload.roleId !== props.roleId || disposed) return
  revision++; writeRevision++
  settings.value = { ...settings.value, ...event.payload.patch, ...pendingPatch }
}).then(off => { if (disposed) off(); else offToggle = off }).catch(() => {})
async function refresh() {
  clearTimeout(startupRetry)
  if (saving.value && loadedRole === props.roleId) { queuedRefresh = true; return }
  const current = ++revision, id = props.roleId, write = writeRevision
  if (loadedRole !== id || !id) {
    roleRevision++
    loadedRole = id
    loaded.value = false; states.value = savedModuleDetection(id); notice.value = ''
    settings.value = { base_url: '', model: '' }
    pendingPatch = {}
  }
  if (!id) return
  try {
    const config = await getModelSettings(id)
    if (current !== revision || write !== writeRevision || id !== props.roleId || disposed) return
    settings.value = config; loaded.value = true
    void refreshStatuses()
  } catch (error) {
    if (current === revision && !disposed) {
      if (!loaded.value) {
        notice.value ||= error instanceof Error ? error.message : '配置读取失败'
        startupRetry = setTimeout(() => { if (!disposed && current === revision) void refresh() }, 1000)
      }
    }
  }
}
watch(() => props.roleId, refresh, { immediate: true })
watch([busy, saving], ([checking, writing]) => {
  if (!checking && !writing && queuedRefresh) { queuedRefresh = false; void refresh() }
})
async function save(patch: Partial<ModelSettings>): Promise<boolean> {
  if (!props.roleId || !loaded.value) return false
  Object.assign(pendingPatch, patch)
  settings.value = { ...settings.value, ...patch }
  writeRevision++
  if (isTauri()) void Promise.all(['home', 'settings'].map(target =>
    emitTo(target, 'deskaura:module-toggle', { roleId: props.roleId, patch }).catch(() => {})))
  if (saving.value) return false
  const id = props.roleId, current = roleRevision
  saving.value = true
  try {
    while (Object.keys(pendingPatch).length && current === roleRevision && id === props.roleId && !disposed) {
      const next = pendingPatch
      pendingPatch = {}
      const saved = await saveModelSettings(next, id)
      if (current !== roleRevision || id !== props.roleId || disposed) return false
      settings.value = { ...saved, ...pendingPatch }
    }
    notice.value = '已保存'
    return current === roleRevision && id === props.roleId && !disposed
  } catch (error) {
    if (current !== roleRevision || id !== props.roleId || disposed) return false
    pendingPatch = {}
    try {
      const persisted = await getModelSettings(id)
      if (current === roleRevision && id === props.roleId && !disposed) {
        settings.value = persisted
        if (isTauri()) void Promise.all(['home', 'settings'].map(target =>
          emitTo(target, 'deskaura:runtime-settings', { roleId: id, settings: persisted }).catch(() => {})))
      }
    } catch { /* Show the save error once, without starting automatic detection. */ }
    notice.value = error instanceof Error ? error.message : '保存失败'
    return false
  } finally {
    saving.value = false
    if (!disposed && loaded.value && Object.keys(pendingPatch).length) void save({})
  }
}
async function toggleModule(id: ModuleId, checked: boolean) {
  const target = props.roleId
  const item = roleModules.find(value => value.id === id)!
  const saved = await save({ [item.enabled]: checked })
  if (!saved || checked || !isTauri() || target !== props.roleId ||
      target !== (localStorage.getItem('deskaura-active-model') || 'default') || moduleEnabled(settings.value, id)) return
  const event = id === 'hearing' ? 'deskaura:asr-settings-changed'
    : id === 'voice' ? 'deskaura:audio-settings-changed' : undefined
  if (event) void Promise.all(['main', 'dialog'].map(window => emitTo(window, event, target).catch(() => {})))
}
async function detect() {
  if (busy.value || !loaded.value) return
  const current = revision, id = props.roleId, write = writeRevision
  busy.value = true; notice.value = '检测中…'
  const errors: string[] = []
  await Promise.all(roleModules.map(async item => {
    if (!moduleEnabled(settings.value, item.id)) return
    try {
      const value = await testRoleModule(item.id, id)
      if (current !== revision || id !== props.roleId || write !== writeRevision ||
          !moduleEnabled(settings.value, item.id) || disposed) return
      if (!value.verified) errors.push(`${item.label}：${value.detail || '检测未通过'}`)
      refreshStatuses()
    } catch (error) {
      const detail = error instanceof Error ? error.message : '检测失败'
      if (current !== revision || id !== props.roleId || write !== writeRevision ||
          !moduleEnabled(settings.value, item.id) || disposed) return
      errors.push(`${item.label}：${detail}`)
      refreshStatuses()
    }
  }))
  if (current === revision && write === writeRevision && id === props.roleId && !disposed) {
    notice.value = errors.length ? errors.join('\n') : '检测完成'
  }
  busy.value = false
}
const moduleRows = computed(() => roleModules.map(item => {
  const previous = states.value[item.id]
  return {
    ...item,
    state: loaded.value && !moduleEnabled(settings.value, item.id)
      ? { ...previous, enabled: false, verified: false, detail: '此模块已停用' }
      : previous ? { ...previous, enabled: true } : undefined,
  }
}))
async function setTop(checked: boolean) {
  if (!props.roleId || !loaded.value) return
  top.value = checked; localStorage.setItem('deskaura-on-top', String(checked))
  if (isTauri()) await toggleAlwaysOnTop(checked)
}
function reloadChanged(event: StorageEvent) {
  if (event.key === `deskaura-module-detection:${props.roleId}`) refreshStatuses()
  if (event.key === 'deskaura-role-config-updated') {
    if (saving.value || busy.value) queuedRefresh = true
    else void refresh()
  }
  if (event.key === 'deskaura-on-top') top.value = event.newValue === 'true'
}
window.addEventListener('storage', reloadChanged)
function detectionSaved(event: Event) {
  if ((event as CustomEvent<string>).detail === props.roleId) refreshStatuses()
}
window.addEventListener('deskaura:detection-saved', detectionSaved)
onBeforeUnmount(() => { disposed = true; revision++; clearTimeout(startupRetry); offStatus?.(); offConfig?.(); offRuntime?.(); offToggle?.(); window.removeEventListener('storage', reloadChanged); window.removeEventListener('deskaura:detection-saved', detectionSaved) })
defineExpose({ refresh, detect })
</script>
<template>
  <div class="role-module-panel" :class="{ 'desktop-module-panel': desktop }">
    <div v-if="desktop" class="home-desktop-controls">
      <div class="home-interaction-checks">
        <label class="compact-check"><span>角色置顶</span><input type="checkbox" :disabled="!loaded || !roleId" :checked="loaded && !!roleId && top" @change="setTop(($event.target as HTMLInputElement).checked)" /></label>
        <label class="compact-check"><span>对话气泡</span><input type="checkbox" :disabled="!loaded" :checked="loaded && !!roleId && settings.bubble_enabled !== false" @change="save({bubble_enabled: ($event.target as HTMLInputElement).checked})" /></label>
        <label class="compact-check"><span>待机动作</span><input type="checkbox" :disabled="!loaded" :checked="loaded && !!roleId && settings.standby_enabled !== false" @change="save({standby_enabled: ($event.target as HTMLInputElement).checked})" /></label>
        <label class="compact-check"><span>点击反馈</span><input type="checkbox" :disabled="!loaded" :checked="loaded && !!roleId && settings.click_feedback_enabled !== false" @change="save({click_feedback_enabled: ($event.target as HTMLInputElement).checked})" /></label>
      </div>
      <div class="home-tracking-picker"><span>视线追踪</span><ConfigPicker class="home-tracking-mode" :model-value="loaded && roleId ? selectedGaze(settings) : 'off'" :options="gazeOptions" label="视线追踪" :disabled="!loaded" @update:model-value="save(gazeSelectionPatch($event))" /></div>
    </div>
    <header class="module-panel-head"><h3>角色模块</h3><div v-if="overview" class="module-header-actions"><button type="button" class="secondary" :disabled="busy || !loaded" @click="detect">{{ busy ? '检测中…' : '一键检测' }}</button><button type="button" class="secondary" :disabled="!roleId" @click="emit('importRole')"><FileInput :size="15" aria-hidden="true" />导入</button><button type="button" class="secondary" :disabled="!roleId" @click="emit('export')"><FileOutput :size="15" aria-hidden="true" />导出</button></div><span v-else>{{ busy ? '检测中' : '启用状态' }}</span></header>
    <div class="role-module-grid">
      <div v-for="item in moduleRows" :key="item.id" class="role-module-item">
        <button type="button" class="module-status-link" :title="item.state?.detail || '尚未检测'" :disabled="!roleId" @click="emit('configure', item.id)">
          <i class="status-dot" :class="{ verified: item.state?.verified && item.state?.enabled !== false, disabled: !enabled(item.id), unknown: enabled(item.id) && !item.state?.verified && moduleStatusUnknown(item.state) }"></i>
          <span class="module-copy"><span class="module-name-line"><strong>{{ item.label }}</strong><span class="module-tag" :title="modelNameFor(item.id)">{{ modelNameFor(item.id) }}</span></span><small>{{ item.hint }}</small></span>
          <em v-if="!desktop">{{ !roleId ? '未选择' : moduleStatusText(item.state) }}</em>
        </button>
        <label class="switch" :title="`${item.label}${enabled(item.id) ? '已启用' : '未启用'}`">
          <input type="checkbox" :disabled="!loaded" :checked="enabled(item.id)" :aria-label="`启用${item.label}`" @change="toggleModule(item.id, ($event.target as HTMLInputElement).checked)" /><span></span>
        </label>
      </div>
    </div>
    <div v-if="!overview" class="module-panel-actions"><button type="button" class="secondary" :disabled="busy || !loaded" @click="detect">检测</button><button type="button" :disabled="!roleId" @click="emit('configure')">配置</button></div>
    <p v-if="!desktop && notice" class="module-panel-notice" :title="notice" role="status">{{ notice }}</p>
    <LocalOperationPanel v-if="desktop" :role-id="roleId" compact @notice="localNotice = $event; notice = ''" />
    <p v-if="desktop && (notice || localNotice)" class="module-panel-notice" :title="notice || localNotice" role="status">{{ notice || localNotice }}</p>
  </div>
</template>
