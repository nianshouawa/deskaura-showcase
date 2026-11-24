/** A sentence finishing is not the same as an entire spoken turn finishing. */
export function replyMotionCanEnd(streaming: boolean, audioBusy: boolean, pendingSentences: number) {
  return !streaming && !audioBusy && pendingSentences === 0
}

/** Muted replies have no playback-ended event, so keep a bounded reading hold. */
export function textReplyHoldMs(length: number) {
  return Math.min(12000, Math.max(2500, length * 95))
}

/** A late thinking=false event must never cancel an already installed reply. */
export function endsThinkingPose(wasThinking: boolean, motionId: string) {
  return wasThinking && motionId === 'cloud_thinking_loop'
}

/** Cloud generation can finish after the spoken turn. Never restart a reply
 * loop at that point; independent gestures are still allowed to perform once. */
export function acceptsReplyMotion(speechBound: boolean, streaming: boolean, audioBusy: boolean,
  pendingSentences: number, spoken: boolean, readingUntil: number, now: number) {
  if (!speechBound) return true
  return spoken ? !replyMotionCanEnd(streaming, audioBusy, pendingSentences) : streaming || readingUntil > now
}
