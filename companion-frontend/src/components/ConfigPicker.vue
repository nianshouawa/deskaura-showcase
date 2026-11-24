<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
export type PickerOption = { value: string; label: string; group?: string; description?: string }
const props = defineProps<{ modelValue?: string; options: PickerOption[]; editable?: boolean; placeholder?: string; label: string; disabled?: boolean; groupTabs?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const root = ref<HTMLElement>(), open = ref(false), query = ref(''), all = ref(true), active = ref(0)
const upward = ref(false), menuHeight = ref(250)
const listId = useId(), activeGroup = ref('')
const selected = computed(() => props.options.find(option => option.value === props.modelValue))
const groups = computed(() => [...new Set(props.options.map(option => option.group).filter((group): group is string => !!group))])
const groupedOptions = computed(() => props.groupTabs && activeGroup.value ? props.options.filter(option => option.group === activeGroup.value) : props.options)
const filtered = computed(() => all.value ? groupedOptions.value : groupedOptions.value.filter(option => `${option.label} ${option.value}`.toLowerCase().includes(query.value.toLowerCase())))
function reveal() { if (props.disabled) return; all.value = true; if (!open.value) activeGroup.value = selected.value?.group || groups.value[0] || ''; open.value = !open.value; active.value = Math.max(0, filtered.value.findIndex(option => option.value === props.modelValue)) }
function input(event: Event) { const value = (event.target as HTMLInputElement).value; query.value = value; all.value = false; open.value = true; active.value = 0; emit('update:modelValue', value) }
function choose(value: string) { emit('update:modelValue', value); open.value = false }
function chooseGroup(group: string) { activeGroup.value = group; active.value = 0 }
function keydown(event: KeyboardEvent) {
  if (props.disabled) return
  if ((event.target as HTMLElement | null)?.closest('[role=tab]')) return
  if (event.key === 'Escape') { open.value = false; return }
  if (event.key === 'Tab') { open.value = false; return }
  if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
    event.preventDefault()
    if (!open.value) { all.value = true; activeGroup.value = selected.value?.group || groups.value[0] || ''; open.value = true; active.value = Math.max(0, filtered.value.findIndex(option => option.value === props.modelValue)); return }
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : -1) + filtered.value.length) % Math.max(1, filtered.value.length)
    void nextTick(() => root.value?.querySelector('[role=option].highlighted')?.scrollIntoView?.({ block: 'nearest' }))
  }
  if (event.key === 'Enter' && open.value) { event.preventDefault(); const option = filtered.value[active.value]; if (option) choose(option.value) }
}
function outside(event: PointerEvent) { if (!root.value?.contains(event.target as Node)) open.value = false }
function placeMenu() {
  if (!open.value || !root.value) return
  const rect = root.value.getBoundingClientRect()
  let top = 0, bottom = window.innerHeight
  for (let parent = root.value.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
      const bounds = parent.getBoundingClientRect()
      top = Math.max(top, bounds.top); bottom = Math.min(bottom, bounds.bottom)
    }
  }
  const above = rect.top - top, below = bottom - rect.bottom
  upward.value = below < 260 && above > below
  menuHeight.value = Math.max(50, Math.min(250, (upward.value ? above : below) - 14))
}
watch(open, async value => { if (value) { await nextTick(); placeMenu() } })
watch(() => props.disabled, value => { if (value) open.value = false })
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('scroll', placeMenu, true); window.addEventListener('resize', placeMenu) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('scroll', placeMenu, true); window.removeEventListener('resize', placeMenu) })
</script>
<template>
  <div ref="root" class="config-picker" :class="{ 'picker-open': open, 'picker-up': upward, 'picker-disabled': disabled }" @keydown="keydown">
    <div class="picker-control">
      <input v-if="editable" :value="modelValue" :placeholder="placeholder" :aria-label="label" :disabled="disabled" role="combobox" :aria-controls="listId" :aria-expanded="open" aria-autocomplete="list" @input="input" @focus="all = true" />
      <button v-else type="button" class="picker-value" role="combobox" :disabled="disabled" :aria-controls="listId" :aria-expanded="open" :aria-label="label" @click="reveal"><span>{{ selected?.label || placeholder || '请选择' }}</span><small v-if="selected?.group">{{ selected.group }}</small></button>
      <button type="button" class="picker-arrow" :disabled="disabled" :aria-label="`展开${label}全部选项`" :aria-expanded="open" title="展开全部选项" @click="reveal"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg></button>
    </div>
    <div v-if="open" class="picker-menu" :style="{ maxHeight: `${menuHeight}px` }">
      <div v-if="groupTabs && groups.length > 1" class="picker-categories" role="tablist" :aria-label="`${label}分类`"><button v-for="group in groups" :key="group" type="button" role="tab" :aria-selected="activeGroup === group" :class="{ active: activeGroup === group }" @click="chooseGroup(group)">{{ group }}</button></div>
      <div :id="listId" role="listbox" :aria-label="`${label}选项`">
      <template v-for="(option,index) in filtered" :key="option.value">
        <small v-if="!groupTabs && option.group && (index === 0 || filtered[index-1]?.group !== option.group)" class="picker-group">{{ option.group }}</small>
        <button type="button" role="option" :aria-selected="modelValue === option.value" :class="{ selected: modelValue === option.value, highlighted: active === index }" @pointermove="active = index" @click="choose(option.value)"><span class="picker-option-copy">{{ option.label }}<small v-if="option.description">{{ option.description }}</small></span><code v-if="editable">{{ option.value }}</code><b v-else-if="modelValue === option.value">✓</b></button>
      </template>
      <p v-if="!filtered.length">{{ options.length ? '没有匹配项，可填写自定义 ID' : '该模型暂无可列出的预置 ID，请填写服务商提供的值' }}</p>
      </div>
    </div>
  </div>
</template>
