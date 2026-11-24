import { describe, expect, it } from 'vitest'
import { applicationButton } from './modelSelection'

describe('explicit desktop model application', () => {
  it('does not allow applying a missing or still-loading preview', () => {
    expect(applicationButton('', '', '', '')).toEqual({ label: '应用', disabled: true })
    expect(applicationButton('preview', '', '', '')).toEqual({ label: '应用', disabled: true })
  })
  it('allows a loaded selection without treating it as applied', () => {
    expect(applicationButton('preview', 'desktop', '', 'preview')).toEqual({ label: '应用', disabled: false })
    expect(applicationButton('desktop', 'desktop', '', 'desktop')).toEqual({ label: '取消应用', disabled: false })
  })
  it('keeps a desktop application exclusive even after selecting a different preview', () => {
    expect(applicationButton('new', '', 'new', 'new')).toEqual({ label: '应用中…', disabled: true })
    expect(applicationButton('other', '', 'new', 'other')).toEqual({ label: '应用', disabled: true })
  })
})
