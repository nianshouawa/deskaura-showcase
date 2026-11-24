import type { Motion } from './api'

export const STANDBY_FACE_ABSENCE_MS = 10_000
export const STANDBY_INACTIVITY_MS = 60_000
export const STANDBY_IDLE_MS = 8_000
const STANDBY_ACTION_TIMEOUT_MS = 12_000
export const standbyLabels = {
  sleep: '打瞌睡', sing: '轻声哼唱', sway: '原地晃悠', daydream: '发呆',
  stretch: '伸懒腰', look_around: '环顾四周',
} as const
export type StandbyId = keyof typeof standbyLabels
export const standbyMotionIds = Object.keys(standbyLabels) as StandbyId[]
export const standbyLibraryOptions = [
  { value: 'gesture:idle', label: '自然待机', group: '待机动作' },
  ...standbyMotionIds.map(id => ({ value: `gesture:${id}`, label: standbyLabels[id], group: '待机动作' })),
]
export function standbyMotion(id: StandbyId, loop = true): Motion {
  const ident = `cloud_standby_${id}`
  return { id: ident, kind: 'hymotion', url: `/api/motion/library/${ident}`, duration: 8, loop }
}

/** Unknown/failed camera samples are not evidence that the user has left. */
export class StandbySchedule {
  private lastInteraction: number
  private absentSince: number | null = null
  private face: boolean | null = null
  private phase: 'action' | 'idle' | null = null
  private nextAt = 0
  private current?: StandbyId
  private previous?: StandbyId
  private paused = false
  constructor(now: number, private random = Math.random) { this.lastInteraction = now }
  get active() { return this.phase !== null }
  interaction(now: number) {
    this.lastInteraction = now
    if (this.face === false) this.absentSince = now
    this.phase = null
    this.current = undefined
  }
  observeFace(visible: boolean | null, now: number): boolean {
    const returned = visible === true && this.face === false
    if (visible === false && this.face !== false) this.absentSince = now
    if (visible !== false) this.absentSince = null
    this.face = visible
    if (returned) this.interaction(now)
    return returned
  }
  finish(motionId: string, now: number) {
    if (this.phase !== 'action' || motionId !== `cloud_standby_${this.current}`) return false
    this.phase = 'idle'
    this.nextAt = now + STANDBY_IDLE_MS
    return true
  }
  tick(now: number, enabled: boolean, busy: boolean): StandbyId | 'idle' | undefined {
    if (!enabled || busy) {
      this.paused = true
      this.interaction(now)
      return
    }
    if (this.paused) {
      this.paused = false
      this.interaction(now)
      return
    }
    const absent = this.absentSince !== null && now - this.absentSince >= STANDBY_FACE_ABSENCE_MS
    if (!absent && now - this.lastInteraction < STANDBY_INACTIVITY_MS) return
    if (this.phase !== null && now < this.nextAt) return
    if (this.phase === 'action') {
      // A failed download must also return to rest, never repeat the gesture.
      this.phase = 'idle'
      this.nextAt = now + STANDBY_IDLE_MS
      return 'idle'
    }
    const choices = standbyMotionIds.filter(id => id !== this.previous)
    const selected = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(this.random() * choices.length)))]!
    this.previous = selected
    this.phase = 'action'
    this.current = selected
    this.nextAt = now + STANDBY_ACTION_TIMEOUT_MS
    return selected
  }
}
