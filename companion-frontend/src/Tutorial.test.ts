// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Tutorial from './Tutorial.vue'

const bridge = vi.hoisted(() => ({ desktop: false, invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: bridge.invoke }))
vi.mock('./tauri', () => ({ isTauri: () => bridge.desktop }))

describe('beginner usage guide', () => {
  beforeEach(() => {
    bridge.desktop = false
    bridge.invoke.mockReset().mockResolvedValue('已打开链接')
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('covers each module and the actual permissions instead of promising arbitrary execution', () => {
    const wrapper = mount(Tutorial, { attachTo: document.body })
    expect(wrapper.findAll('nav button')).toHaveLength(15)
    for (const id of ['persona', 'memory', 'brain', 'tools', 'vision', 'hearing', 'voice', 'motion']) {
      expect(wrapper.find(`#${id}`).exists()).toBe(true)
    }
    expect(wrapper.get('#local').text()).toContain('工作空间写入')
    expect(wrapper.get('#local').text()).toContain('不允许，没有可验证的系统隔离')
    expect(wrapper.get('#tools').text()).toContain('MCP(2/3)')
    expect(wrapper.get('#interaction').text()).toContain('约 8 秒')
    expect(wrapper.get('#data').text()).toContain('认证头与环境变量可能包含秘密')
    expect(wrapper.findAll('nav button').find(button => button.text().includes('手脚'))?.text()).toBe('07手脚')
    expect(wrapper.get('#tools h2').text()).toBe('手脚')
    expect(wrapper.find('.guide-brand img').exists()).toBe(false)
    expect(wrapper.get('.guide-brand > span').text()).toBe('DESKAURA GUIDE')
    expect(wrapper.get('.guide-brand > h1').text()).toBe('使用指南')
    expect(wrapper.get('#voice').text()).not.toContain('此项仍保留')
    expect(wrapper.get('#voice').text()).toContain('无需选择服务平台')
    wrapper.unmount()
  })

  it('searches the complete chapter text and resets to all chapters when cleared', async () => {
    const wrapper = mount(Tutorial, { attachTo: document.body })
    await flushPromises()
    await wrapper.get('input[type="search"]').setValue('Cherry')
    expect(wrapper.findAll('nav button')).toHaveLength(1)
    expect(wrapper.get('nav button').text()).toContain('语音')
    expect(wrapper.get('#brain').isVisible()).toBe(false)
    expect(wrapper.get('#voice').isVisible()).toBe(true)
    expect(wrapper.findAll('#voice mark.guide-search-match').length).toBeGreaterThan(0)
    expect(wrapper.findAll('#voice mark').every(mark => mark.text() === 'Cherry')).toBe(true)
    await wrapper.get('input[type="search"]').setValue('API')
    const originalLink = wrapper.get('a[href="https://platform.deepseek.com/"]').element
    expect(wrapper.findAll('mark.guide-search-match').length).toBeGreaterThan(10)
    await wrapper.get('input[type="search"]').setValue('语音')
    expect(wrapper.findAll('nav button mark.guide-search-match').length).toBeGreaterThan(0)
    await wrapper.get('input[type="search"]').setValue('不存在的测试关键词')
    expect(wrapper.findAll('nav button')).toHaveLength(0)
    expect(wrapper.get('[role="status"]').text()).toContain('找到 0 个相关章节')
    await wrapper.get('input[type="search"]').setValue('')
    expect(wrapper.findAll('nav button')).toHaveLength(15)
    expect(wrapper.find('mark.guide-search-match').exists()).toBe(false)
    expect(wrapper.get('a[href="https://platform.deepseek.com/"]').element).toBe(originalLink)
    wrapper.unmount()
  })

  it('uses the system browser for explicit desktop reference clicks', async () => {
    bridge.desktop = true
    const wrapper = mount(Tutorial)
    const anchor = wrapper.get('a[href="https://platform.deepseek.com/"]')
    await anchor.trigger('click')
    expect(bridge.invoke).toHaveBeenCalledWith('run_system_action', {
      actionType: 'open_url', param: 'https://platform.deepseek.com/',
    })
    bridge.invoke.mockRejectedValueOnce(new Error('browser unavailable'))
    await anchor.trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('默认浏览器')
    wrapper.unmount()
  })

  it('keeps browser preview links native and every reference on an official HTTPS site', async () => {
    const wrapper = mount(Tutorial)
    const hosts = new Set([
      'help.aliyun.com', 'bailian.console.aliyun.com', 'platform.deepseek.com',
      'api-docs.deepseek.com', 'console.volcengine.com', 'github.com',
      'ai.google.dev', 'hunyuan.tencent.com', 'console.cloud.tencent.com',
    ])
    for (const anchor of wrapper.findAll('a')) {
      const url = new URL(anchor.attributes('href')!)
      expect(url.protocol).toBe('https:')
      expect(hosts.has(url.hostname)).toBe(true)
      expect(anchor.attributes('target')).toBe('_blank')
      expect(anchor.attributes('rel')).toContain('noopener')
    }
    await wrapper.get('a').trigger('click')
    expect(bridge.invoke).not.toHaveBeenCalled()
    wrapper.unmount()
  })
})
