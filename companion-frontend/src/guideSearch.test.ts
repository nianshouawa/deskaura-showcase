// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clearGuideHighlights, highlightGuideMatches } from './guideSearch'

describe('guide search highlighting', () => {
  it('highlights every literal occurrence without replacing link elements or original text nodes', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p>API 地址与 api 模型 <a href="https://example.test">API 入口</a></p><code>API</code>'
    const link = root.querySelector('a'), original = root.querySelector('p')!.firstChild
    const content = root.textContent
    highlightGuideMatches(root, 'api')
    expect(root.querySelectorAll('mark')).toHaveLength(4)
    expect(root.querySelector('a')).toBe(link)
    expect(root.textContent).toBe(content)
    clearGuideHighlights(root)
    expect(root.querySelector('p')!.firstChild).toBe(original)
    expect(root.querySelector('mark')).toBeNull()
    expect(root.textContent).toBe(content)
  })
  it('matches Chinese, multiple words and regex punctuation safely without injecting HTML', () => {
    const root = document.createElement('div')
    root.textContent = '配置 API（v1） https://api.example/test <img> 配置'
    highlightGuideMatches(root, '配置 API（v1） <img>')
    expect(Array.from(root.querySelectorAll('mark')).map(mark => mark.textContent)).toEqual(['配置', 'API（v1）', '<img>', '配置'])
    expect(root.querySelector('img')).toBeNull()
    highlightGuideMatches(root, '')
    expect(root.querySelector('mark')).toBeNull()
  })
  it('leaves hidden sections and form controls untouched', () => {
    const root = document.createElement('div')
    root.innerHTML = '<section style="display:none">API</section><section>API</section><textarea>API</textarea>'
    highlightGuideMatches(root, 'API')
    expect(root.querySelectorAll('mark')).toHaveLength(1)
    expect(root.querySelector('textarea')!.value).toBe('API')
  })
})
