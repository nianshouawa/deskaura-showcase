// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ThinkingBubble from './ThinkingBubble.vue'

describe('passive thought cloud', () => {
  it('renders small, medium and cloud stages without text or interactive elements', () => {
    const wrapper = mount(ThinkingBubble, { attrs: { style: { left: '200px', top: '160px' } } })
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.attributes('style')).toContain('left: 200px')
    expect(wrapper.find('.thought-small').exists()).toBe(true)
    expect(wrapper.find('.thought-medium').exists()).toBe(true)
    expect(wrapper.find('.thought-large').exists()).toBe(true)
    expect(wrapper.text()).toBe('')
    expect(wrapper.findAll('button, input, a')).toHaveLength(0)
  })
})
