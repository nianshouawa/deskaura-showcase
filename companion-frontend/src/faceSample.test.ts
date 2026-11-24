import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectFaceSample } from './faceTracking'

const sample = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), create: vi.fn(), detect: vi.fn(), close: vi.fn(),
}))
vi.mock('./mediaCapture', () => ({
  CameraLease: class { start = sample.start; stop = sample.stop },
}))
vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: vi.fn(async () => ({})) },
  FaceDetector: { createFromOptions: sample.create },
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { setTimeout })
  sample.start.mockResolvedValue({ videoWidth: 640, videoHeight: 480, readyState: 2 })
  sample.create.mockResolvedValue({ detect: sample.detect, close: sample.close })
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('one-shot camera face verification', () => {
  it('starts the selected camera before preparing detection and releases it on success', async () => {
    sample.detect.mockReturnValue({ detections: [{ categories: [{ score: .91 }] }] })
    await expect(detectFaceSample('saved-camera')).resolves.toEqual({ faces: 1, confidence: .91 })
    expect(sample.start).toHaveBeenCalledExactlyOnceWith('saved-camera')
    expect(sample.start.mock.invocationCallOrder[0]).toBeLessThan(sample.create.mock.invocationCallOrder[0]!)
    expect(sample.close).toHaveBeenCalledOnce()
    expect(sample.stop).toHaveBeenCalledOnce()
  })
  it('keeps looking when the first frame has no face instead of failing immediately', async () => {
    sample.detect.mockReturnValueOnce({ detections: [] }).mockReturnValue({ detections: [{ categories: [{ score: .8 }] }] })
    await expect(detectFaceSample()).resolves.toEqual({ faces: 1, confidence: .8 })
    expect(sample.detect).toHaveBeenCalledTimes(2)
    expect(sample.stop).toHaveBeenCalledOnce()
  })
  it('releases the camera when the detector cannot initialize', async () => {
    sample.create.mockRejectedValueOnce(new Error('detector failed'))
    await expect(detectFaceSample()).rejects.toThrow('detector failed')
    expect(sample.stop).toHaveBeenCalledOnce()
  })
  it('releases the device on cancellation during detection', async () => {
    const controller = new AbortController()
    sample.detect.mockImplementation(() => { controller.abort(); return { detections: [] } })
    await expect(detectFaceSample('', controller.signal)).rejects.toThrow('已取消')
    expect(sample.close).toHaveBeenCalledOnce()
    expect(sample.stop).toHaveBeenCalled()
  })
  it('fails with an actionable result and releases the device when no face appears', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', { setTimeout })
    sample.detect.mockReturnValue({ detections: [] })
    const pending = expect(detectFaceSample()).rejects.toThrow('没有检测到人脸')
    await vi.advanceTimersByTimeAsync(10200)
    await pending
    expect(sample.stop).toHaveBeenCalledOnce()
    expect(sample.close).toHaveBeenCalledOnce()
  })
})
