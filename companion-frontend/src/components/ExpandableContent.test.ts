// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ExpandableContent from './ExpandableContent.vue'
afterEach(() => vi.restoreAllMocks())

describe('overflow expansion', () => {
  it('shows an internal toggle only for overflowing content and keeps the editor mounted', async () => {
    const wrapper = mount(ExpandableContent, { props: { label: '角色设定' }, slots: { default: '<textarea>原有内容</textarea>' } })
    const editor = wrapper.get('textarea').element
    Object.defineProperties(editor, {
      scrollHeight: { configurable: true, value: 700 }, clientHeight: { configurable: true, value: 300 },
    })
    wrapper.vm.measure(); await flushPromises()
    await wrapper.get('[aria-label="展开角色设定"]').trigger('click')
    expect(wrapper.classes()).toContain('content-expanded')
    expect(wrapper.get('textarea').element).toBe(editor)
    expect(editor.value).toBe('原有内容')
    await wrapper.get('[aria-label="收起角色设定"]').trigger('click')
    expect(wrapper.classes()).not.toContain('content-expanded')
    Object.defineProperty(editor, 'scrollHeight', { value: 300 })
    wrapper.vm.measure(); await flushPromises()
    expect(wrapper.find('button').exists()).toBe(false)
    wrapper.unmount()
  })
  it('measures natural height rather than growing from its own expanded height', async () => {
    const wrapper = mount(ExpandableContent, { props: { label: '角色描述' }, slots: { default: '<textarea />' } })
    const editor = wrapper.get('textarea').element
    Object.defineProperty(editor, 'clientHeight', { configurable: true, value: 68 })
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLTextAreaElement) {
      return this === editor ? 500 : 160
    })
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({ height: 68 } as DOMRect)
    const attributes = new MutationObserver(() => {})
    const records: MutationRecord[] = []
    attributes.observe(editor, { attributes: true, attributeFilter: ['style'] })
    for (let index = 0; index < 10; index++) {
      wrapper.vm.measure(); await flushPromises()
    }
    expect(wrapper.attributes('style')).toContain('160px')
    expect(editor.hasAttribute('style')).toBe(false)
    records.push(...attributes.takeRecords())
    expect(records).toHaveLength(0)
    attributes.disconnect()
    expect(wrapper.get('button').classes()).toContain('content-expand-grip')
    expect(wrapper.find('svg').exists()).toBe(false)
    wrapper.unmount()
  })
  it('never expands below the collapsed editor size', async () => {
    const wrapper = mount(ExpandableContent, { props: { label: '角色设定' }, slots: { default: '<textarea />' } })
    const editor = wrapper.get('textarea').element
    vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue({ height: 334 } as DOMRect)
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(80)
    wrapper.vm.measure(); await flushPromises()
    expect(wrapper.attributes('style')).toContain('334px')
    wrapper.unmount()
  })
})
