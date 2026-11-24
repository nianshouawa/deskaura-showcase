import { expect, it } from 'vitest'
import { bubblePages, streamingBubbleText } from './chatPresentation'
it('pages long passive bubbles without losing text or splitting unicode', () => {
  const text = '今天好开心😀。'.repeat(90)
  const pages = bubblePages(text)
  expect(pages.join('')).toBe(text)
  expect(pages.length).toBeGreaterThan(1)
  expect(pages.every(page => Array.from(page).length <= 110)).toBe(true)
  expect(bubblePages('   ')).toEqual([])
})
it('shows increments immediately and follows the current page during a long stream', () => {
  expect(streamingBubbleText('第一')).toBe('第一')
  expect(streamingBubbleText('第一句。')).toBe('第一句。')
  const value = '前面一页。'.repeat(25) + '新增😀文字'
  const pages = bubblePages(value)
  expect(streamingBubbleText(value)).toBe(`${pages[pages.length - 1]}\n${pages.length} / ${pages.length}`)
  expect(streamingBubbleText(value)).toContain('新增😀文字')
  expect(streamingBubbleText('')).toBe('')
})
