import { afterEach, describe, expect, it, vi } from 'vitest'
import { faceTrackingAllowed, FaceTargetFilter, normalizedFaceTarget } from './faceTracking'
import { CameraLease, ScreenLease } from './mediaCapture'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('local face target', () => {
  it('automatically starts face/auto only for an enabled, applied, visible character', () => {
    expect(faceTrackingAllowed('face', true, true, true, true)).toBe(true)
    expect(faceTrackingAllowed('auto', true, true, true, true)).toBe(true)
    expect(faceTrackingAllowed('mouse', true, true, true, true)).toBe(false)
    expect(faceTrackingAllowed('face', false, true, true, true)).toBe(false)
    expect(faceTrackingAllowed('face', true, false, true, true)).toBe(false)
    expect(faceTrackingAllowed('face', true, true, false, true)).toBe(false)
    expect(faceTrackingAllowed('face', true, true, true, false)).toBe(false)
  })
  it('uses the actual eye midpoint without zeroing a stable off-centre seated face', () => {
    const box = { originX: 10, originY: 20, width: 50, height: 60 }
    for (let frame = 0; frame < 15; frame++) {
      const target = normalizedFaceTarget(box, 100, 100, [{ x: .2, y: .32 }, { x: .4, y: .34 }])
      expect(target.x).toBeCloseTo(.4)
      expect(target.y).toBeCloseTo(-.34)
      expect(target.aspectRatio).toBe(1)
    }
  })
  it('mirrors horizontal face center and keeps vertical screen direction', () => {
    const upper = normalizedFaceTarget({ originX: 0, originY: 0, width: 20, height: 20 }, 100, 100)
    const lower = normalizedFaceTarget({ originX: 80, originY: 80, width: 20, height: 20 }, 100, 100)
    expect(upper.x).toBeCloseTo(.8); expect(upper.y).toBeCloseTo(-.848)
    expect(lower.x).toBeCloseTo(-.8); expect(lower.y).toBeCloseTo(.752)
    expect(lower).toMatchObject({ visible: true, aspectRatio: 1 })
    expect(normalizedFaceTarget({ originX: 0, originY: 0, width: 0, height: 0 }, 0, 0).visible).toBe(false)
  })
  it('uses a finite face-box fallback when eye keypoints are missing or corrupt', () => {
    const box = { originX: 10, originY: 20, width: 50, height: 60 }
    const fallback = normalizedFaceTarget(box, 640, 480)
    expect(normalizedFaceTarget(box, 640, 480, [{ x: NaN, y: .3 }, { x: .4, y: .3 }])).toEqual(fallback)
    expect(normalizedFaceTarget({ ...box, originX: NaN }, 640, 480).visible).toBe(false)
  })
  it('reacts within one detector frame and holds only brief missed detections', () => {
    const filter = new FaceTargetFilter()
    expect(filter.update({ x: 0, y: 0, visible: true }, 0)).toEqual({ x: 0, y: 0, visible: true })
    const moved = filter.update({ x: .5, y: -.4, visible: true }, 66)
    expect(moved.x).toBeGreaterThan(.12)
    expect(moved.x).toBeLessThan(.25)
    expect(moved.y).toBeLessThan(-.08)
    expect(filter.update({ x: 0, y: 0, visible: false }, 130)).toEqual(moved)
    expect(filter.update({ x: 0, y: 0, visible: false }, 270).visible).toBe(false)
    expect(filter.update({ x: -.7, y: .5, visible: true }, 336)).toEqual({ x: -.7, y: .5, visible: true })
  })
  it('does not acquire a camera until explicitly started', () => {
    const acquire = vi.fn(); vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: acquire } })
    new CameraLease(); expect(acquire).not.toHaveBeenCalled()
  })
  it('closes a late camera result after cancellation', async () => {
    vi.stubGlobal('window', {})
    const stop = vi.fn(); let resolve!: (value: unknown) => void
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: () => new Promise(r => { resolve = r }) } })
    const lease = new CameraLease(), pending = lease.start()
    lease.stop(); resolve({ getTracks: () => [{ stop }] })
    await expect(pending).rejects.toThrow('已取消'); expect(stop).toHaveBeenCalledOnce()
    expect(lease.stream).toBeUndefined()
  })
  it('does not silently use a desktop grab when display picker is unavailable', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} })
    await expect(new ScreenLease().start()).rejects.toThrow('不支持屏幕共享选择器')
  })
})
