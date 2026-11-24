<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { FileInput } from '@lucide/vue'
import { emitTo, listen } from '@tauri-apps/api/event'
import AvatarStage from './components/AvatarStage.vue'
import RoleModulePanel from './components/RoleModulePanel.vue'
import { addModelPath, addModelFile, listModels, getModel, deleteModel, renameModel, resolveModelUrl, MODEL_EXTENSIONS, type StoredModel } from './modelLibrary'
import { seedBuiltinModels, restoreBuiltinModels, markBuiltinDeleted } from './builtinModels'
import { invoke, convertFileSrc } from '@tauri-apps/api/core'
import { raiseOwnedWindow } from './tauri'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { applicationButton } from './modelSelection'
import { request, roleHeaders } from './api'
import { ensureRoleRecord, type ModuleId } from './roleModules'
const models = ref<StoredModel[]>([])
const selected = ref('')
const applied = ref('')
const applying = ref('')
const previewReady = ref('')
const selectedModel = computed(() => models.value.find(model => model.id === selected.value))
const applyButton = computed(() => applicationButton(selected.value, applied.value, applying.value, previewReady.value))
const preview = ref<InstanceType<typeof AvatarStage>>()
const picker = ref<HTMLInputElement>()
const message = ref('')
const previewCapability = ref('')
const previewLoading = ref(false)
let previewGeneration = 0
let applyTimer: ReturnType<typeof setTimeout> | undefined
const pendingDelete = ref('')
const renaming = ref('')
const renameText = ref('')
const renameInput = ref<HTMLInputElement[]>()
let renameSaving = false
const maximized = ref(false)
const win = getCurrentWindow()
let off: (() => void) | undefined
let unlistenDrop: (() => void) | undefined
function refreshRoleRecords(event?: StorageEvent) {
  if (!event || event.key === 'deskaura-role-config-updated') void listModels().then(value => { models.value = value })
}
async function dragStudio(event: MouseEvent) {
  if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, a')) return
  try { await win.startDragging() }
  catch (e) { message.value = `窗口拖动失败：${String(e)}` }
}
async function toggleSize() {
  if (await win.isMaximized()) await win.unmaximize()
  else await win.maximize()
  maximized.value = await win.isMaximized()
}
async function raiseWindow(target: WebviewWindow) {
  try {
    await target.unminimize()
    await target.show()
    await target.setFocus()
  } catch {}
  await raiseOwnedWindow(target.label as 'settings' | 'tutorial')
}
async function tutorial() {
  const existing = await WebviewWindow.getByLabel('tutorial')
  if (existing) {
    await existing.setMinSize(new LogicalSize(720, 520))
    await raiseWindow(existing); return
  }
  new WebviewWindow('tutorial', { url: '/?tutorial=1', title: 'DeskAura · 使用指南', width: 980, height: 760, minWidth: 720, minHeight: 520, center: true })
}
async function settingsWindow(section?: ModuleId) {
  const existing = await WebviewWindow.getByLabel('settings')
  if (existing) {
    await emitTo('settings', 'deskaura:configure-role', { roleId: selected.value, section: section || 'role' })
    await raiseWindow(existing); return
  }
  const query = new URLSearchParams({ settings: '1', role: selected.value, section: section || 'role' })
  new WebviewWindow('settings', {
    url: `/?${query}`, title: 'DeskAura · 设置',
    width: 980, height: 760, minWidth: 760, minHeight: 560, center: true,
  })
}
async function selectModel(id: string) {
  if (id === selected.value && previewReady.value === id && !previewLoading.value) return
  const generation = ++previewGeneration
  const previous = selected.value
  const previousReady = previewReady.value
  const previousCapability = previewCapability.value
  message.value = ''
  previewCapability.value = ''
  previewLoading.value = true
  previewReady.value = ''
  try {
    const model = await getModel(id)
    if (!model) throw new Error('找不到模型文件')
    if (generation !== previewGeneration) return
    // Keep the existing canvas mounted while the new VRM loads: no blank-frame flash.
    selected.value = id
    await ensureRoleRecord(model)
    await nextTick()
    if (generation !== previewGeneration) return
    if (!preview.value) throw new Error('预览尚未就绪，请重试')
    const url = resolveModelUrl(model)
    if (url) await preview.value?.loadUrl(url)
    else if (model.file) await preview.value?.loadFile(new File([model.file], model.name + '.vrm'))
    else throw new Error('模型没有可读取的文件')
    if (generation !== previewGeneration) return
    previewReady.value = id
  } catch (e) {
    if (generation === previewGeneration) {
      selected.value = previous
      previewReady.value = previousReady
      previewCapability.value = previousCapability
      message.value = String(e)
    }
  } finally {
    if (generation === previewGeneration) previewLoading.value = false
  }
}
async function applySelected() {
  if (applyButton.value.disabled) return
  if (selected.value === applied.value) {
    try {
      await emitTo('main', 'deskaura:model-remove', applied.value)
    } catch (error) { message.value = `取消应用失败：${String(error)}` }
    return
  }
  const id = selected.value
  applying.value = id
  message.value = ''
  clearTimeout(applyTimer)
  applyTimer = setTimeout(() => {
    if (applying.value !== id) return
    applying.value = ''
    message.value = '应用超时，请确认桌宠窗口后重试'
    void emitTo('main', 'deskaura:query-model', null)
  }, 120000)
  try { await emitTo('main', 'deskaura:model', id) }
  catch (error) {
    clearTimeout(applyTimer)
    applying.value = ''
    message.value = `应用失败：${String(error)}`
  }
}
async function importFile(file?: File) {
  if (!file) return
  try { const model = await addModelFile(file); models.value = await listModels(); await selectModel(model.id) }
  catch(e) { message.value = String(e) }
}
async function pickAndLink() {
  message.value = ''
  try {
    const path = await invoke<string | null>('pick_model_file')
    if (!path) return
    const model = await addModelPath(path)
    models.value = await listModels()
    await selectModel(model.id)
  } catch (e) { message.value = String(e) }
}
async function linkDropped(paths: string[]) {
  const vrm = paths.find(path => MODEL_EXTENSIONS.test(path))
  if (!vrm) return // Folder drops belong to the local-operation workspace picker.
  try { const model = await addModelPath(vrm); models.value = await listModels(); await selectModel(model.id) }
  catch (e) { message.value = String(e) }
}
async function startRename(model: StoredModel) {
  if (renameSaving) return
  renaming.value = model.id
  renameText.value = model.name
  await nextTick()
  renameInput.value?.[0]?.focus()
  renameInput.value?.[0]?.select()
}
async function commitRename() {
  const id = renaming.value
  if (!id || renameSaving) return
  renameSaving = true
  try {
    await renameModel(id, renameText.value)
    models.value = await listModels()
    const model = models.value.find(item => item.id === id)
    if (model) await ensureRoleRecord(model)
    if (renaming.value === id) renaming.value = ''
  } catch (e) { message.value = String(e) }
  finally { renameSaving = false }
}
async function remove(id: string) {
  if (applying.value === id) { message.value = '角色正在应用，请稍后再移除'; return }
  try {
    markBuiltinDeleted(id)
    await request(`/api/roles/${encodeURIComponent(id)}`, { method: 'DELETE', headers: roleHeaders(id) })
    await deleteModel(id)
    localStorage.removeItem(`deskaura-session-${id}`)
    models.value = await listModels()
    if (selected.value === id) {
      previewGeneration++
      selected.value = ''
      previewReady.value = ''
      previewLoading.value = false
    }
    if (applied.value === id) {
      applied.value = ''
      localStorage.removeItem('deskaura-active-model')
      await emitTo('main', 'deskaura:model-remove', id)
    }
    pendingDelete.value = ''
  } catch(e) { message.value = String(e) }
}
async function restoreBuiltins() {
  message.value = ''
  try {
    models.value = await restoreBuiltinModels()
    if (!selected.value && models.value.length > 0) {
      await selectModel(models.value[0].id)
    }
    message.value = '内置模型已恢复'
  } catch (e) {
    message.value = `恢复内置模型失败：${String(e)}`
  }
}
onMounted(async () => {
  window.addEventListener('storage', refreshRoleRecords)
  // Only this studio window is normalized; never resize the transparent pet.
  try {
    await win.setFullscreen(false)
    await win.unmaximize()
    await win.setSize(new LogicalSize(1180, 780))
    await win.center()
  } catch (error) { message.value = `工作室窗口恢复失败：${String(error)}` }
  models.value = await seedBuiltinModels()
  if (!selected.value && models.value.length > 0) {
    void selectModel(models.value[0].id)
  }
  const listeners = await Promise.all([
    listen<string>('deskaura:applied', event => {
      applied.value = event.payload
      if (event.payload) localStorage.setItem('deskaura-active-model', event.payload)
      else localStorage.removeItem('deskaura-active-model')
      void emitTo('dialog', 'deskaura:role-changed', event.payload || 'default')
      if (applying.value === event.payload) { applying.value = ''; clearTimeout(applyTimer) }
    }),
    listen<{ id: string; message: string }>('deskaura:apply-failed', event => {
      if (applying.value !== event.payload.id) return
      applying.value = ''
      clearTimeout(applyTimer)
      message.value = `应用失败：${event.payload.message}`
    }),
    listen<string>('deskaura:config-changed', event => {
      void refreshRoleRecords()
      if (event.payload === applied.value) void emitTo('main', 'deskaura:config-changed', event.payload).catch(() => {})
    }),
  ])
  off = () => listeners.forEach(listener => listener())
  await emitTo('main', 'deskaura:query-model', null)
  try {
    unlistenDrop = await getCurrentWebview().onDragDropEvent(event => {
      if (event.payload.type === 'drop' && event.payload.paths.length) void linkDropped(event.payload.paths)
    })
  } catch { /* 浏览器环境下没有原生拖放 */ }
})
onBeforeUnmount(() => { off?.(); unlistenDrop?.(); clearTimeout(applyTimer); window.removeEventListener('storage', refreshRoleRecords) })
</script>
<template>
  <main class="studio">
    <header class="studio-nav" @mousedown="dragStudio">
      <button class="quiet studio-nav-link" @click="tutorial"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5.5c-2.8-2-6-2-9-1v15c3-1 6.2-1 9 1 2.8-2 6-2 9-1v-15c-3-1-6.2-1-9 1Zm0 0v15" /></svg>使用指南</button><button class="quiet studio-nav-link" @click="settingsWindow()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 3-.7 2.6-2 .9-2.5-.7L2 9.7l1.9 1.9v2.2L2 15.7l2.3 3.9 2.5-.7 2 .9.7 2.2h5l.7-2.2 2-.9 2.5.7 2.3-3.9-1.9-1.9v-2.2L22 9.7l-2.3-3.9-2.5.7-2-.9L14.5 3z" /><circle cx="12" cy="12.5" r="3.2" /></svg>设置</button><strong>DeskAura <small> / COMPANION STUDIO</small></strong>
      <div class="window-tools">
        <button title="最小化" aria-label="最小化" @click="win.minimize()"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8" /></svg></button>
        <button :title="maximized ? '还原窗口' : '最大化'" :aria-label="maximized ? '还原窗口' : '最大化'" @click="toggleSize"><svg viewBox="0 0 16 16" aria-hidden="true"><template v-if="maximized"><path d="M6 3v3H3M10 13V10h3M10 3v3h3M6 13v-3H3" /></template><rect v-else x="3.5" y="3.5" width="9" height="9" rx="1" /></svg></button>
        <button class="exit" title="关闭" aria-label="关闭" @click="win.close()"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
      </div>
    </header>
    <div class="studio-body">
      <aside class="model-library"><div class="section-label">WORKSPACE</div><h2>我的角色 <span>{{ models.length }}</span></h2>
        <div class="model-actions">
          <button class="add-model" @click="pickAndLink()"><FileInput :size="15" aria-hidden="true" />导入模型</button>
          <button class="restore-builtin" title="恢复内置默认模型" @click="restoreBuiltins">恢复内置模型</button>
        </div>
        <div class="model-list"><div v-for="model in models" :key="model.id" class="model-row" :class="{selected: selected === model.id, applied: applied === model.id}" @contextmenu.prevent="startRename(model)"><input v-if="renaming === model.id" ref="renameInput" v-model="renameText" class="rename-input" maxlength="60" aria-label="角色名称" @click.stop @keyup.enter="commitRename" @keyup.esc="renaming = ''" @blur="commitRename" /><button v-else class="model-name" :title="model.name" :aria-label="`预览角色 ${model.name}`" @click="selectModel(model.id)"><span>{{ applied === model.id ? '◆' : '◇' }}</span>{{ model.name }}</button><button class="rename-model" :title="`修改 ${model.name} 的名称`" :aria-label="`修改 ${model.name} 的名称`" @click.stop="startRename(model)"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m10.8 2.4 2.8 2.8M3 10.3l7.7-7.7a1.2 1.2 0 0 1 1.7 0l1 1a1.2 1.2 0 0 1 0 1.7L5.7 13H3z" /></svg></button><button :disabled="applying === model.id" title="从模型库移除" class="remove-model" @click.stop="pendingDelete = model.id">×</button></div></div>
        <div v-if="pendingDelete" class="delete-confirm"><p>删除此角色配置、会话与记忆？原始模型文件会保留，角色数据无法恢复。</p><button @click="remove(pendingDelete)">确认删除</button><button class="quiet" @click="pendingDelete = ''">取消</button></div>
        <p class="library-foot">ROLE PROFILES<br>独立配置 · 会话 · 记忆</p>
      </aside>
      <section class="preview-column"><div class="preview-heading"><div><div class="section-label">CHARACTER PREVIEW</div><h1>让陪伴，出现在桌面。</h1><p class="home-role-description" :title="selectedModel?.description"><span>{{ selectedModel ? `${selectedModel.name}：${selectedModel.description?.trim() || '很高兴与你相伴。'}` : '选择一个角色，开始你们的日常。' }}</span></p></div><button v-if="selectedModel" class="apply-model" :class="{ 'is-applied': selected === applied }" :disabled="applyButton.disabled" @click="applySelected">{{ applyButton.label }}</button></div>
        <div class="preview-box" >
          <AvatarStage v-if="selected" ref="preview" :preview="true" @capability="previewCapability = $event" />
          <div v-if="previewLoading" class="preview-loading"><span class="spinner"></span><span>正在加载角色…</span></div>
          <button v-if="!selected && !previewLoading" class="drop-zone" @click="pickAndLink()"><span>＋</span><strong>导入你的角色模型</strong><small>点击选择文件，或拖入可信的模型与场景</small></button>
          <div class="preview-meta"><span v-if="selectedModel" class="preview-model-name" :title="selectedModel.name">{{ selectedModel.name }}</span><span v-if="selectedModel && previewCapability" class="studio-message">{{ previewCapability }}</span><small>支持 VRM / FBX / GLB / GLTF；Blend / Maya 需本机转换软件。</small></div>
        </div><p v-if="message" class="studio-message" role="status">{{ message }}</p><p class="preview-note">选择角色仅作预览 · 应用后在桌面播放动作</p>
      </section>
      <aside class="studio-settings">
        <div class="section-label">INTERACTION & CONTROL</div>
        <h2>交互与控制</h2>
        <RoleModulePanel :role-id="selected" :desktop="true" @configure="settingsWindow" />
      </aside>
    </div><input ref="picker" hidden type="file" accept=".vrm,.fbx,.glb,.gltf,.blend,.ma,.mb" @change="importFile(($event.target as HTMLInputElement).files?.[0]); ($event.target as HTMLInputElement).value = ''" />
  </main>
</template>
<style scoped>
.model-actions{display:flex;flex-direction:column;gap:8px}
.add-model{width:100%;display:inline-flex;align-items:center;justify-content:center;gap:7px}
.add-model svg{flex-shrink:0}
.restore-builtin{width:100%;background:transparent!important;color:#8f95b2!important;border:1px dashed #ffffff24!important;border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;transition:all .15s ease}
.restore-builtin:hover{color:#c4b5ff!important;border-color:#6e5eb188!important;background:#ffffff08!important}
.preview-heading .apply-model.is-applied{background:#51232c;color:#ffd5db;border-color:#a84c60}
.preview-heading .apply-model.is-applied:hover{background:#682c38}
</style>
