import { describe, expect, it } from 'vitest'
import { composerPresentation, messageDelivery } from './chatMessageFlow'

describe('chat and call message flow', () => {
  it('holds only one next message outside calls without replacing it', () => {
    expect(messageDelivery(false, false, false)).toBe('send')
    expect(messageDelivery(false, true, false)).toBe('queue')
    expect(messageDelivery(false, true, true)).toBe('full')
    expect(messageDelivery(false, false, true)).toBe('full')
  })

  it('never queues during a call, even when a reply is being generated or spoken', () => {
    expect(messageDelivery(true, true, false)).toBe('interrupt')
    expect(messageDelivery(true, true, true)).toBe('interrupt')
    expect(messageDelivery(true, false, false)).toBe('send')
  })

  it('uses the central square while the character speaks and restores the waveform for user speech', () => {
    expect(composerPresentation(true, true, false, true)).toBe('interrupt')
    expect(composerPresentation(true, true, false, false)).toBe('interrupt')
    expect(composerPresentation(true, true, true, true)).toBe('waveform')
    expect(composerPresentation(true, false, false, true)).toBe('waveform')
  })

  it('keeps ordinary typing and one-shot recording independent from reply output', () => {
    expect(composerPresentation(false, true, false, false)).toBe('text')
    expect(composerPresentation(false, true, true, true)).toBe('waveform')
    expect(composerPresentation(true, false, false, false)).toBe('text')
  })
})
