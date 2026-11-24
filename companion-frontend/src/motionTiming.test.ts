import { describe, expect, it } from 'vitest'
import { motionPlaybackTiming } from './motionTiming'

describe('native duration and local gesture timing', () => {
  it('never retimes native cloud prediction using a conversation duration', () => {
    expect(motionPlaybackTiming(6, 2)).toEqual({ duration: 6, sampleScale: 1 })
    expect(motionPlaybackTiming(6, 2, 'native')).toEqual({ duration: 6, sampleScale: 1 })
  })
  it('plays the complete local common gesture within its semantic selected duration', () => {
    expect(motionPlaybackTiming(5, 4, 'local_selection')).toEqual({ duration: 4, sampleScale: 1.25 })
    expect(motionPlaybackTiming(5, 10, 'local_selection')).toEqual({ duration: 10, sampleScale: .5 })
  })
  it('ignores invalid selection and never divides by a zero-length clip', () => {
    expect(motionPlaybackTiming(5, NaN, 'local_selection')).toEqual({ duration: 5, sampleScale: 1 })
    expect(motionPlaybackTiming(0, 0).sampleScale).toBe(1)
  })
})
