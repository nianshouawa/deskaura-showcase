import { describe, expect, it } from 'vitest'
import { gazeOptions, gazeSelectionPatch, selectedGaze } from './interactionSettings'

describe('independent standby and gaze settings', () => {
  it('offers off without discarding the previous gaze target', () => {
    const settings = { base_url: '', model: '', gaze_enabled: false, gaze_mode: 'mouse' as const, standby_enabled: true }
    expect(selectedGaze(settings)).toBe('off')
    expect(gazeOptions.map(item => item.value)).toEqual(['off', 'face', 'mouse', 'auto'])
    expect(gazeSelectionPatch('off')).toEqual({ gaze_enabled: false })
    expect(gazeSelectionPatch('face')).toEqual({ gaze_enabled: true, gaze_mode: 'face' })
    expect(gazeSelectionPatch('invalid')).toEqual({})
    expect(settings.standby_enabled).toBe(true)
  })
})
