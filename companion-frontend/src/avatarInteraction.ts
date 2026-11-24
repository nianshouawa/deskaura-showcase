type PointerSample = { pointerId: number; button: number; clientX: number; clientY: number }
type Point = { x: number; y: number }

/** Resolve single/double/triple sequences without overlapping reactions. */
export class AvatarClickInteraction<T> {
  private pressed?: Point & { pointerId: number; dragged: boolean }
  private pending?: Point & { at: number; value: T; timer: ReturnType<typeof setTimeout> }
  private triple?: (value: T) => void
  private tripleCount = 0
  private tripleValue?: T
  private delay: number

  constructor(private hitTest: (point: Point) => T | undefined,
    private single: (value: T) => void, private double: () => void,
    tripleOrDelay?: ((value: T) => void) | number, delay = 500,
    private acceptsTriple: (value: T) => boolean = () => true) {
    this.triple = typeof tripleOrDelay === 'function' ? tripleOrDelay : undefined
    this.delay = typeof tripleOrDelay === 'number' ? tripleOrDelay : delay
  }

  private deliverSingle(value: T) {
    if (!this.acceptsTriple(value)) {
      this.tripleCount = 0
      this.tripleValue = undefined
      this.single(value)
      return
    }
    if (this.tripleValue !== value) this.tripleCount = 0
    this.tripleValue = value
    this.tripleCount += 1
    if (this.tripleCount >= 3) {
      this.tripleCount = 0
      this.triple?.(value)
      return
    }
    this.single(value)
  }

  down(event: PointerSample) {
    if (event.button !== 0) return
    this.pressed = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, dragged: false }
  }

  move(event: PointerSample) {
    const press = this.pressed
    if (!press || event.pointerId !== press.pointerId) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 4) {
      press.dragged = true
      this.clearPending()
    }
  }

  up(event: PointerSample) {
    const press = this.pressed
    this.pressed = undefined
    if (!press || event.pointerId !== press.pointerId || event.button !== 0 || press.dragged ||
      Math.hypot(event.clientX - press.x, event.clientY - press.y) >= 4) return
    const point = { x: event.clientX, y: event.clientY }
    const value = this.hitTest(point)
    if (value === undefined) return
    const previous = this.pending
    const now = performance.now()
    if (previous && previous.value === value && now - previous.at <= this.delay && Math.hypot(point.x - previous.x, point.y - previous.y) < 12) {
      this.clearPending()
      this.tripleCount = 0
      this.double()
      return
    }
    if (previous) { this.clearPending(); this.deliverSingle(previous.value) }
    const timer = setTimeout(() => {
      if (this.pending?.timer !== timer) return
      this.pending = undefined
      this.deliverSingle(value)
    }, this.delay)
    this.pending = { ...point, at: now, value, timer }
  }

  cancelPointer() { this.pressed = undefined }

  dispose() { this.cancelPointer(); this.clearPending(); this.tripleCount = 0 }

  private clearPending() {
    if (this.pending) clearTimeout(this.pending.timer)
    this.pending = undefined
  }
}
