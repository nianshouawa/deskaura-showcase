import type { ChatAttachment } from './chatAttachments'
import { invoke } from '@tauri-apps/api/core'
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalPosition, LogicalSize } from '@tauri-apps/api/dpi'

/** WebView2's source chooser is constrained by its owner window. Give it enough
 * room for source thumbnails, then restore only if the user did not resize it. */
async function fitScreenPicker(): Promise<() => Promise<void>> {
  if (!('__TAURI_INTERNALS__' in window)) return async () => {}
  try {
    const win = getCurrentWindow()
    if (win.label !== 'dialog' || await win.isMaximized()) return async () => {}
    const [size, position, scale, monitor] = await Promise.all([win.innerSize(), win.outerPosition(), win.scaleFactor(), currentMonitor()])
    if (!size || !position || !scale || !monitor) return async () => {}
    const area = monitor.workArea
    const width = Math.min(Math.max(920, size.width / scale), area.size.width / scale)
    const height = Math.min(Math.max(720, size.height / scale), area.size.height / scale)
    if (size.width / scale >= width && size.height / scale >= height) return async () => {}
    const x = Math.max(area.position.x / scale, Math.min(position.x / scale, (area.position.x + area.size.width) / scale - width))
    const y = Math.max(area.position.y / scale, Math.min(position.y / scale, (area.position.y + area.size.height) / scale - height))
    await win.setSize(new LogicalSize(width, height)); await win.setPosition(new LogicalPosition(x, y))
    return async () => {
      try {
        const current = await win.innerSize()
        const currentPosition = await win.outerPosition()
        if (Math.abs(current.width / scale - width) < 3 && Math.abs(current.height / scale - height) < 3 &&
            Math.abs(currentPosition.x / scale - x) < 3 && Math.abs(currentPosition.y / scale - y) < 3) {
          await win.setSize(size); await win.setPosition(position)
        }
      } catch { /* The user may close the dialog while the chooser is open. */ }
    }
  } catch { return async () => {} }
}

/** Local camera lease. Face detection and call preview use independent instances. */
export class CameraLease {
  stream?: MediaStream
  video?: HTMLVideoElement
  private revision = 0
  private deviceId = ''
  async start(deviceId = ''): Promise<HTMLVideoElement> {
    if (this.stream?.active && this.video && this.deviceId === deviceId) return this.video
    if (this.stream || this.video) this.stop()
    const revision = ++this.revision
    if ('__TAURI_INTERNALS__' in window) await invoke('prepare_camera_access')
    if (revision !== this.revision) throw new Error('摄像头请求已取消')
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 },
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' }) }, audio: false })
    if (revision !== this.revision) { stream.getTracks().forEach(t => t.stop()); throw new Error('摄像头请求已取消') }
    const video = document.createElement('video')
    video.muted = true; video.playsInline = true; video.srcObject = stream
    this.stream = stream; this.video = video; this.deviceId = deviceId
    try { await video.play() } catch (error) { this.stop(); throw error }
    if (revision !== this.revision) { stream.getTracks().forEach(t => t.stop()); throw new Error('摄像头请求已取消') }
    return video
  }
  stop() {
    this.revision++
    this.stream?.getTracks().forEach(t => t.stop())
    if (this.video) { this.video.pause(); this.video.srcObject = null }
    this.stream = undefined; this.video = undefined; this.deviceId = ''
  }
}

export function cameraFrame(video: HTMLVideoElement, name = '摄像头截图.jpg'): ChatAttachment {
  if (!video.videoWidth || !video.videoHeight) throw new Error('摄像头画面尚未准备好')
  const canvas = document.createElement('canvas'), ratio = Math.min(1, 1280 / video.videoWidth)
  canvas.width = Math.round(video.videoWidth * ratio); canvas.height = Math.round(video.videoHeight * ratio)
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取摄像头画面')
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
  return { name, kind: 'image', mime_type: 'image/jpeg', content: canvas.toDataURL('image/jpeg', .78) }
}

/** Screen capture always uses the browser/OS source picker, never a hidden desktop grab. */
export class ScreenLease {
  stream?: MediaStream
  video?: HTMLVideoElement
  private revision = 0
  async start(): Promise<void> {
    if (this.stream?.active) return
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('此运行环境不支持屏幕共享选择器')
    const revision = ++this.revision
    const restore = await fitScreenPicker()
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 5 }, audio: false }) }
    finally { await restore() }
    if (revision !== this.revision) { stream.getTracks().forEach(t => t.stop()); return }
    const video = document.createElement('video'); video.muted = true; video.srcObject = stream
    this.stream = stream; this.video = video
    try { await video.play() } catch (error) { this.stop(); throw error }
    if (revision !== this.revision) { stream.getTracks().forEach(t => t.stop()); throw new Error('屏幕共享请求已取消') }
    stream.getVideoTracks()[0]?.addEventListener('ended', () => this.stop(), { once: true })
  }
  frame(name = '屏幕截图.jpg') {
    if (!this.stream?.active || !this.video) throw new Error('请先选择要共享的屏幕或窗口')
    return cameraFrame(this.video, name)
  }
  stop() {
    this.revision++; this.stream?.getTracks().forEach(t => t.stop())
    if (this.video) { this.video.pause(); this.video.srcObject = null }
    this.stream = undefined; this.video = undefined
  }
}
