import { describe, expect, it } from 'vitest'
import { acceptsReplyMotion, endsThinkingPose, replyMotionCanEnd, textReplyHoldMs } from './replyLifecycle'

describe('speech-owned reply motion lifecycle', () => {
  it('keeps the loop through the last pending sentence and synthesis gap', () => {
    expect(replyMotionCanEnd(false, false, 1)).toBe(false)
    expect(replyMotionCanEnd(false, true, 0)).toBe(false)
    expect(replyMotionCanEnd(false, false, 2)).toBe(false)
    expect(replyMotionCanEnd(false, false, 0)).toBe(true)
  })
  it('does not end while further text can produce speech', () => {
    expect(replyMotionCanEnd(true, false, 0)).toBe(false)
  })
  it('a delayed thinking-off event cannot overwrite a reply pose', () => {
    expect(endsThinkingPose(true, 'cloud_emotion_nervous')).toBe(false)
    expect(endsThinkingPose(true, 'generated_123')).toBe(false)
    expect(endsThinkingPose(true, 'cloud_thinking_loop')).toBe(true)
    expect(endsThinkingPose(false, 'cloud_thinking_loop')).toBe(false)
  })
  it('uses bounded reading time only for muted text, not spoken replies', () => {
    expect(textReplyHoldMs(2)).toBe(2500)
    expect(textReplyHoldMs(50)).toBe(4750)
    expect(textReplyHoldMs(10000)).toBe(12000)
  })
  it('does not restart a cloud reply loop arriving after the entire speech queue', () => {
    expect(acceptsReplyMotion(true, false, false, 0, true, 0, 100)).toBe(false)
    expect(acceptsReplyMotion(true, true, false, 0, true, 0, 100)).toBe(true)
    expect(acceptsReplyMotion(true, false, true, 0, true, 0, 100)).toBe(true)
    expect(acceptsReplyMotion(true, false, false, 1, true, 0, 100)).toBe(true)
    expect(acceptsReplyMotion(false, false, false, 0, true, 0, 100)).toBe(true)
  })
  it('expires muted reply motion using text completion, not late generation', () => {
    expect(acceptsReplyMotion(true, false, false, 0, false, 3000, 2000)).toBe(true)
    expect(acceptsReplyMotion(true, false, false, 0, false, 3000, 4000)).toBe(false)
  })
})
