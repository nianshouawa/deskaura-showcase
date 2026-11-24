<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue'

defineProps<{ label: string }>()
const root = ref<HTMLElement>()
const expanded = ref(false), overflowing = ref(false), height = ref(0)
let resize: ResizeObserver | undefined
let mutation: MutationObserver | undefined
let disposed = false, measuring = false, collapsedHeight = 0
function measure() {
  if (disposed || measuring) return
  const content = root.value?.querySelector<HTMLElement>('textarea,.mcp-service-list')
  if (!content) return
  measuring = true
  overflowing.value = content.scrollHeight > content.clientHeight + 1 || content.scrollWidth > content.clientWidth + 1
  if (content instanceof HTMLTextAreaElement) {
    if (!expanded.value) collapsedHeight = content.getBoundingClientRect().height
    // An off-screen copy avoids changing page layout, selection or scroll anchors.
    const probe = content.cloneNode(false) as HTMLTextAreaElement
    probe.value = content.value
    probe.tabIndex = -1
    probe.removeAttribute('id')
    probe.removeAttribute('autofocus')
    probe.setAttribute('aria-hidden', 'true')
    const style = getComputedStyle(content)
    probe.style.cssText = `position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:${style.width};height:0;min-height:0;max-height:none;overflow:hidden;`
    root.value!.appendChild(probe)
    const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    height.value = Math.max(collapsedHeight, Math.ceil(probe.scrollHeight + borders))
    probe.remove()
  }
  measuring = false
}
function changed() { void nextTick(measure) }
watch(expanded, changed)
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') {
    resize = new ResizeObserver(measure)
    if (root.value) resize.observe(root.value)
    const content = root.value?.firstElementChild
    if (content) resize.observe(content)
  }
  mutation = new MutationObserver(changed)
  if (root.value?.firstElementChild) mutation.observe(root.value.firstElementChild, { subtree: true, childList: true, characterData: true })
  measure()
})
onBeforeUnmount(() => { disposed = true; resize?.disconnect(); mutation?.disconnect() })
onUpdated(measure)
defineExpose({ measure })
</script>
<template>
  <div ref="root" class="expandable-content" :class="{ 'content-expanded': expanded }" :style="{ '--expanded-content-height': `${height}px` }" @input="changed">
    <slot />
    <button v-if="overflowing || expanded" type="button" class="content-expand-grip" :aria-label="`${expanded ? '收起' : '展开'}${label}`" :title="`${expanded ? '收起' : '展开'}${label}`" :aria-expanded="expanded" @pointerdown.prevent @click.prevent="expanded = !expanded"><span aria-hidden="true"></span></button>
  </div>
</template>
