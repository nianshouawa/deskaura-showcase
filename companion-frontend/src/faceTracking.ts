import { CameraLease } from './mediaCapture'
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import wasmLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import faceModel from './assets/blaze_face_short_range.tflite?url'

export type FaceTarget = { x: number; y: number; visible: boolean; aspectRatio?: number; confidence?: number }
/** Camera use follows the selected target, but only for an applied, visible pet. */
export function faceTrackingAllowed(mode: 'mouse' | 'face' | 'auto', enabled: boolean,
  applied: boolean, loaded: boolean, visible: boolean): boolean {
  return enabled && applied && loaded && visible && (mode === 'face' || mode === 'auto')
}
/** BlazeFace's first two keypoints are the eyes. Aim at their midpoint instead
 * of the lower face-box centre; preserve the absolute camera ray so moving the
 * desktop avatar can be compensated later. No "first seated pose = zero" bias. */
export function normalizedFaceTarget(box: { originX: number; originY: number; width: number; height: number }, width: number, height: number,
  keypoints: readonly { x: number; y: number }[] = []): FaceTarget {
  if (![width, height, box.originX, box.originY, box.width, box.height].every(Number.isFinite) ||
      width <= 0 || height <= 0 || box.width <= 0 || box.height <= 0) return { x: 0, y: 0, visible: false }
  const eyes = keypoints.slice(0, 2)
  const hasEyes = eyes.length === 2 && eyes.every(eye => Number.isFinite(eye.x) && Number.isFinite(eye.y) &&
    eye.x >= 0 && eye.x <= 1 && eye.y >= 0 && eye.y <= 1)
  const x = hasEyes ? (eyes[0]!.x + eyes[1]!.x) / 2 : (box.originX + box.width / 2) / width
  // Without keypoints, the eyes are usually above the middle of a face box.
  const y = hasEyes ? (eyes[0]!.y + eyes[1]!.y) / 2 : (box.originY + box.height * .38) / height
  return { x: Math.max(-1, Math.min(1, 1 - x * 2)),
    y: Math.max(-1, Math.min(1, y * 2 - 1)), visible: true, aspectRatio: width / height }
}

/** Short, frame-rate-independent filtering, not a slow cursor-like drag. Hold
 * brief detector misses so a blink/fast turn does not reset the gaze to center. */
export class FaceTargetFilter {
  private target: FaceTarget = { x: 0, y: 0, visible: false }
  private updated = 0
  private seen = -Infinity
  update(target: FaceTarget, now: number): FaceTarget {
    if (!target.visible) {
      if (this.target.visible && now - this.seen < 180) return { ...this.target }
      this.target = { x: 0, y: 0, visible: false }; this.updated = now
      return { ...this.target }
    }
    const delta = Math.max(0, Math.min(.2, (now - this.updated) / 1000))
    const moving = Math.hypot(target.x - this.target.x, target.y - this.target.y) > .08
    const blend = this.target.visible ? 1 - Math.exp(-delta / (moving ? .16 : .22)) : 1
    this.target = { x: this.target.x + (target.x - this.target.x) * blend,
      y: this.target.y + (target.y - this.target.y) * blend, visible: true,
      ...(target.aspectRatio !== undefined ? { aspectRatio: target.aspectRatio } : {}) }
    this.updated = this.seen = now
    return { ...this.target }
  }
}

/** Open the selected camera immediately, detect one face frame, then release it. */
export async function detectFaceSample(deviceId = '', signal?: AbortSignal): Promise<{ faces: number; confidence: number }> {
  const camera = new CameraLease()
  let detector: FaceDetector | undefined
  const abort = () => { camera.stop() }
  const cancelled = () => {
    if (signal?.aborted) throw new Error('视觉检测已取消')
  }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    cancelled()
    const video = await camera.start(deviceId)
    cancelled()
    const deadline = performance.now() + 8000
    while ((!video.videoWidth || !video.videoHeight || video.readyState < 2) && performance.now() < deadline) {
      cancelled()
      await new Promise(resolve => window.setTimeout(resolve, 80))
    }
    if (!video.videoWidth || !video.videoHeight || video.readyState < 2) throw new Error('摄像头没有返回有效画面')
    const files = await FilesetResolver.forVisionTasks()
    files.wasmLoaderPath = wasmLoader; files.wasmBinaryPath = wasmBinary
    detector = await FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: faceModel }, runningMode: 'IMAGE',
      minDetectionConfidence: .45,
    })
    cancelled()
    const faceDeadline = performance.now() + 10000
    do {
      cancelled()
      const detections = detector.detect(video).detections
      if (detections.length) {
        const confidence = detections.reduce((highest, item) =>
          Math.max(highest, item.categories?.[0]?.score ?? 0), 0)
        return { faces: detections.length, confidence: Math.min(1, Math.max(0, confidence)) }
      }
      await new Promise(resolve => window.setTimeout(resolve, 120))
    } while (performance.now() < faceDeadline)
    throw new Error('摄像头已打开，但没有检测到人脸，请正对摄像头后重试')
  } finally {
    signal?.removeEventListener('abort', abort)
    detector?.close()
    camera.stop()
  }
}

/** Bundled offline detector: no CDN, no face images sent to the backend. */
export class FaceTracker {
  private camera = new CameraLease()
  private detector?: FaceDetector
  private timer?: number
  private revision = 0
  private starting = false
  get active() { return this.starting || this.timer !== undefined }
  async start(update: (target: FaceTarget) => void, status: (text: string) => void, deviceId = '', unavailable = () => {}) {
    if (this.active) return
    this.stop(); const revision = this.revision; this.starting = true
    try {
      status('正在准备人脸检测…')
      const video = await this.camera.start(deviceId)
      if (revision !== this.revision) return
      const files = await FilesetResolver.forVisionTasks()
      files.wasmLoaderPath = wasmLoader; files.wasmBinaryPath = wasmBinary
      const detector = await FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: faceModel }, runningMode: 'VIDEO', minDetectionConfidence: .6 })
      if (revision !== this.revision) { detector.close(); return }
      this.detector = detector
      let failures = 0, videoTime = -1
      const filter = new FaceTargetFilter()
      this.timer = window.setInterval(() => {
        try {
          if (!this.camera.stream?.active) { this.stop(); update({ x: 0, y: 0, visible: false }); unavailable(); status('摄像头已断开'); return }
          if (!video.videoWidth || !video.videoHeight || video.currentTime === videoTime) return
          videoTime = video.currentTime
          const now = performance.now()
          const found = detector.detectForVideo(video, now).detections
            .filter(d => d.boundingBox).sort((a, b) => b.boundingBox!.width * b.boundingBox!.height - a.boundingBox!.width * a.boundingBox!.height)[0]
          const target = { ...filter.update(found?.boundingBox ? normalizedFaceTarget(found.boundingBox, video.videoWidth, video.videoHeight, found.keypoints) : { x: 0, y: 0, visible: false }, now),
            confidence: found?.categories?.[0]?.score ?? 0 }
          update(target)
          status(target.visible ? '人脸追随中' : '未检测到人脸'); failures = 0
        } catch { if (++failures >= 3) { this.stop(); update({ x: 0, y: 0, visible: false }); unavailable(); status('人脸检测失败，请重新开启') } }
      }, 66)
    } catch (error) {
      if (revision === this.revision) { this.stop(); status(error instanceof Error ? error.message : typeof error === 'string' ? error : '无法开启摄像头'); update({ x: 0, y: 0, visible: false }); unavailable() }
    } finally { if (revision === this.revision) this.starting = false }
  }
  stop() { this.revision++; this.starting = false; clearInterval(this.timer); this.timer = undefined; this.camera.stop(); this.detector?.close(); this.detector = undefined }
}
