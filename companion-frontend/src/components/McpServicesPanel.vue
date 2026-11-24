<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { FileInput, FileOutput, List, RefreshCw, Server, X } from '@lucide/vue'
import { isTauri } from '../tauri'
import ExpandableContent from './ExpandableContent.vue'
import {
  connectMcpServices, defaultMcpTemplate, getMcpConfiguration, getMcpServices,
  parseMcpConfiguration, saveMcpConfiguration, setMcpToolEnabled, type McpService,
} from '../mcp'

const props = defineProps<{ roleId: string; roleName?: string }>()
const emit = defineEmits<{ saved: []; feedback: [text: string, error: boolean] }>()
const text = ref(defaultMcpTemplate), savedText = ref(defaultMcpTemplate)
const services = ref<McpService[]>([]), loaded = ref(false), busy = ref(false), error = ref('')
const selectedService = ref(''), toolBusy = ref(''), importer = ref<HTMLInputElement>()
const dialog = ref<HTMLElement>(), opener = ref<HTMLElement>()
const editor = ref<HTMLTextAreaElement>(), refreshingService = ref('')
const currentService = computed(() => services.value.find(item => item.name === selectedService.value))
const label = computed(() => {
  const connected = services.value.filter(item => item.connected).length, total = services.value.length
  return total === 1 && connected === 1 ? services.value[0]!.name : total ? `MCP(${connected}/${total})` : '未配置服务'
})
let revision = 0, pendingSave: Promise<void> | undefined
let suppressBlurSave = false

async function load() {
  const id = props.roleId, current = ++revision
  pendingSave = undefined; busy.value = false
  loaded.value = false; error.value = ''; services.value = []; selectedService.value = ''
  text.value = savedText.value = defaultMcpTemplate
  if (!id) return
  try {
    const [configuration, state] = await Promise.all([getMcpConfiguration(id), getMcpServices(id)])
    if (current !== revision || id !== props.roleId) return
    text.value = savedText.value = JSON.stringify(configuration.config, null, 2)
    services.value = state.services; loaded.value = true
  } catch (failure) { if (current === revision) error.value = failure instanceof Error ? failure.message : '读取 MCP 配置失败' }
}
watch(() => props.roleId, load, { immediate: true })
function report(failure: unknown) {
  error.value = failure instanceof Error ? failure.message : 'MCP 配置失败'
  emit('feedback', error.value, true)
}
function format() {
  const configuration = parseMcpConfiguration(text.value)
  text.value = JSON.stringify(configuration, null, 2)
  error.value = ''
  return configuration
}
async function save(reconnect = true) {
  if (!loaded.value) throw new Error('MCP 配置尚未加载，请稍后重试')
  const id = props.roleId, current = revision
  let configuration
  try { configuration = format() }
  catch (failure) { report(failure); throw failure }
  const formatted = text.value, previous = pendingSave
  busy.value = true
  const operation = (async () => {
    if (previous) await previous.catch(() => {})
    if (current !== revision || id !== props.roleId) return
    if (formatted === savedText.value) {
      if (reconnect) {
        const state = await connectMcpServices(id)
        if (current === revision && id === props.roleId) services.value = state.services
      }
      return
    }
    const saved = await saveMcpConfiguration(id, configuration, reconnect)
    if (current !== revision || id !== props.roleId) return
    savedText.value = formatted
    if (text.value === formatted) text.value = savedText.value
    emit('saved')
    const state = saved.services ? saved : reconnect ? await connectMcpServices(id) : await getMcpServices(id)
    if (current !== revision || id !== props.roleId) return
    services.value = state.services
    const connected = state.services.filter(item => item.connected).length
    emit('feedback', reconnect && state.services.length ? `已保存 · MCP ${connected}/${state.services.length} 已连接` : '已保存 MCP 配置', false)
  })()
  pendingSave = operation
  try { await operation }
  catch (failure) { if (current === revision) report(failure); throw failure }
  finally { if (pendingSave === operation) { pendingSave = undefined; if (current === revision) busy.value = false } }
}
async function blur(event: FocusEvent) {
  if (!loaded.value) return
  try {
    format()
    const target = event.relatedTarget as HTMLElement | null
    const explicitAction = target?.closest('[data-mcp-no-autosave],[data-mcp-explicit-save]')
    if (!suppressBlurSave && !explicitAction && text.value !== savedText.value) await save(false)
  } catch (failure) { report(failure) }
}
function outsidePointer(event: PointerEvent) {
  const target = event.target as HTMLElement | null
  suppressBlurSave = !!target?.closest('[data-mcp-no-autosave],[data-mcp-explicit-save],.settings-nav')
  if (document.activeElement === editor.value && target !== editor.value) editor.value?.blur()
}
async function detect() {
  if (pendingSave) await pendingSave
}
async function refreshStatus() {
  const id = props.roleId, current = revision
  const state = await getMcpServices(id)
  if (current === revision && id === props.roleId) services.value = state.services
}
async function refreshService(name: string) {
  const id = props.roleId, current = revision
  refreshingService.value = name
  try {
    if (pendingSave) await pendingSave
    const state = await connectMcpServices(id, name)
    if (current !== revision || id !== props.roleId) return
    services.value = state.services
    const service = state.services.find(item => item.name === name)
    emit('feedback', `${name}：${service?.detail || (service?.connected ? '已连接' : '未连接')}`, !service?.connected)
    emit('saved')
  } catch (failure) { if (current === revision) report(failure) }
  finally { if (current === revision) refreshingService.value = '' }
}
async function importConfiguration(event: Event) {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  const current = revision
  try {
    if (!/\.json$/i.test(file.name)) throw new Error('请选择 .json 配置文件')
    if (file.size > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MB')
    const content = await file.text()
    const parsed = parseMcpConfiguration(content)
    if (current !== revision) return
    text.value = JSON.stringify(parsed, null, 2)
    await save(false)
  } catch (failure) { if (current === revision) report(failure) }
  finally { input.value = '' }
}
async function exportConfiguration() {
  try {
    const content = JSON.stringify(parseMcpConfiguration(text.value), null, 2)
    const suggestedName = `${props.roleName || 'DeskAura'}-MCP配置.json`
    if (isTauri()) {
      if (!await invoke<string | null>('save_role_export', { content, suggestedName, exportKind: 'mcp' })) return
    } else {
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = suggestedName; anchor.click(); URL.revokeObjectURL(url)
    }
    emit('feedback', 'MCP 配置已导出', false)
  } catch (failure) { report(failure) }
}
async function openTools(service: McpService, event: MouseEvent) {
  opener.value = event.currentTarget as HTMLElement
  selectedService.value = service.name
  await nextTick()
  dialog.value?.focus()
}
function closeTools() { selectedService.value = ''; opener.value?.focus() }
function trapFocus(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeTools(); return }
  if (event.key !== 'Tab') return
  const focusable = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')
  if (!focusable?.length) return
  const first = focusable[0]!, last = focusable[focusable.length - 1]!
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.value)) {
    event.preventDefault(); last.focus()
  } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}
async function toggleTool(server: string, name: string, enabled: boolean) {
  const id = props.roleId, current = revision
  const tool = services.value.find(item => item.name === server)?.tools.find(item => item.name === name)
  const previousEnabled = tool?.enabled
  if (tool) tool.enabled = enabled
  toolBusy.value = name
  try {
    if (pendingSave) await pendingSave
    const state = await setMcpToolEnabled(id, server, name, enabled)
    if (current !== revision || id !== props.roleId) return
    services.value = state.services
    const configuration = await getMcpConfiguration(id)
    if (current !== revision || id !== props.roleId) return
    const clean = text.value === savedText.value
    savedText.value = JSON.stringify(configuration.config, null, 2)
    if (clean) text.value = savedText.value
    else {
      try {
        const draft = parseMcpConfiguration(text.value), definition = draft.mcpServers[server]
        if (definition) {
          const disabled = new Set(Array.isArray(definition.disabledTools) ? definition.disabledTools as string[] : [])
          if (enabled) disabled.delete(name); else disabled.add(name)
          if (disabled.size) definition.disabledTools = Array.from(disabled)
          else delete definition.disabledTools
          text.value = JSON.stringify(draft, null, 2)
        }
      } catch { /* An invalid draft remains editable; the saved tool preference still applies. */ }
    }
    emit('saved')
  } catch (failure) { if (current === revision) { if (tool && previousEnabled !== undefined) tool.enabled = previousEnabled; report(failure) } }
  finally {
    if (current === revision) {
      toolBusy.value = ''
      await nextTick()
      dialog.value?.focus()
    }
  }
}
onMounted(() => document.addEventListener('pointerdown', outsidePointer, true))
onBeforeUnmount(() => { revision++; document.removeEventListener('pointerdown', outsidePointer, true) })
defineExpose({ save, detect, refresh: refreshStatus, label })
</script>
<template>
  <div class="mcp-settings">
    <section class="mcp-service-section" aria-labelledby="mcp-services-heading">
      <h3 id="mcp-services-heading">MCP服务</h3>
      <ExpandableContent label="MCP服务"><div class="mcp-service-list" aria-label="MCP 服务列表" :aria-busy="busy">
        <article v-for="service in services" :key="service.name" class="mcp-service-card">
          <Server :size="18" class="mcp-server-icon" aria-hidden="true" />
          <div class="mcp-service-copy">
            <div class="mcp-service-name"><strong>{{ service.name }}</strong><span class="mcp-connection" :class="{connected: service.connected}"><i />{{ service.connected ? '已连接' : '未连接' }}</span></div>
            <p v-if="service.server_info?.name">{{ service.server_info.name }}{{ service.server_info.version ? ` · ${service.server_info.version}` : '' }}</p>
            <p>{{ service.description || service.detail || (service.connected ? '服务已就绪' : '尚未连接') }}</p>
          </div>
          <div class="mcp-service-actions">
            <button type="button" class="secondary mcp-refresh-button" data-mcp-no-autosave :disabled="busy || !!refreshingService || !!toolBusy" :aria-label="`刷新${service.name}`" :title="`刷新${service.name}`" @click="refreshService(service.name)"><RefreshCw :size="15" :class="{ 'mcp-refreshing': refreshingService === service.name }" aria-hidden="true" /></button>
            <button type="button" class="secondary mcp-tools-button" :aria-label="`${service.name}工具列表`" @click="openTools(service, $event)"><List :size="15" aria-hidden="true" /><span>工具列表</span><b>{{ service.tools.length }}</b></button>
          </div>
        </article>
        <p v-if="!services.length" class="mcp-list-empty">{{ loaded ? '暂无 MCP 服务' : error ? 'MCP 配置未加载' : '读取中…' }}</p>
      </div></ExpandableContent>
    </section>
    <div class="mcp-json-label"><span>JSON配置</span><ExpandableContent label="JSON配置"><textarea id="mcp-json-editor" ref="editor" v-model="text" class="mcp-json-editor" aria-label="MCP JSON配置" :disabled="!loaded" spellcheck="false" autocapitalize="off" autocomplete="off" rows="14" @focus="suppressBlurSave = false" @blur="blur" /></ExpandableContent></div>
    <p v-if="error" class="mcp-editor-error" role="alert">{{ error }}</p>
    <div class="settings-actions mcp-config-actions">
      <button type="button" class="secondary" :disabled="!loaded" @click="importer?.click()"><FileInput :size="15" aria-hidden="true" />导入配置</button>
      <button type="button" class="secondary" :disabled="!loaded" @click="exportConfiguration"><FileOutput :size="15" aria-hidden="true" />导出配置</button>
      <input ref="importer" type="file" hidden accept=".json,application/json" @change="importConfiguration" />
    </div>
    <Teleport to="body">
      <div v-if="currentService" class="mcp-modal-backdrop" @click.self="closeTools">
        <section ref="dialog" class="mcp-tools-dialog" role="dialog" aria-modal="true" aria-labelledby="mcp-tools-title" tabindex="-1" @keydown="trapFocus">
          <header><div><h3 id="mcp-tools-title">{{ currentService.name }}</h3><span>工具列表 · {{ currentService.tools.length }}</span></div><button type="button" class="mcp-close-button" title="关闭工具列表" aria-label="关闭工具列表" @click="closeTools"><X :size="18" /></button></header>
          <div class="mcp-tool-list">
            <article v-for="tool in currentService.tools" :key="tool.name" class="mcp-tool-row">
              <div><h4>{{ tool.name }}</h4><p>{{ tool.description || '服务未提供工具说明' }}</p><details v-if="tool.inputSchema"><summary>参数信息</summary><pre>{{ JSON.stringify(tool.inputSchema, null, 2) }}</pre></details></div>
              <label class="mcp-tool-toggle"><span>{{ tool.enabled ? '已启用' : '已禁用' }}</span><input type="checkbox" :checked="tool.enabled" :disabled="!!toolBusy" :aria-label="`启用${tool.name}`" @change="toggleTool(currentService.name, tool.name, ($event.target as HTMLInputElement).checked)" /></label>
            </article>
            <p v-if="!currentService.tools.length" class="mcp-list-empty">{{ currentService.connected ? '此服务没有公开工具' : '服务连接成功后显示工具列表' }}</p>
          </div>
        </section>
      </div>
    </Teleport>
  </div>
</template>
