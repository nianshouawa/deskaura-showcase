// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CameraLease, ScreenLease } from './mediaCapture'

const state = vi.hoisted(() => ({ win: { label: 'dialog', isMaximized: vi.fn(), innerSize: vi.fn(), outerPosition: vi.fn(), scaleFactor: vi.fn(), setSize: vi.fn(), setPosition: vi.fn() }, monitor: vi.fn(), capture: vi.fn(), stop: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => state.win, currentMonitor: state.monitor }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(window, { __TAURI_INTERNALS__: {} })
  state.win.isMaximized.mockResolvedValue(false)
  state.win.scaleFactor.mockResolvedValue(1)
  state.win.innerSize.mockResolvedValueOnce({ width: 460, height: 680 }).mockResolvedValue({ width: 920, height: 720 })
  state.win.outerPosition.mockResolvedValueOnce({ x: 900, y: 20 }).mockResolvedValue({ x: 900, y: 20 })
  state.monitor.mockResolvedValue({ workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } })
  state.win.setSize.mockResolvedValue(undefined); state.win.setPosition.mockResolvedValue(undefined)
  const track = { stop: state.stop, addEventListener: vi.fn() }
  state.capture.mockResolvedValue({ active: true, getTracks: () => [track], getVideoTracks: () => [track] })
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: state.capture } })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(() => { delete (window as any).__TAURI_INTERNALS__; vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('screen source picker window', () => {
  it('enlarges the owner before the picker and restores after selecting', async () => {
    const screen = new ScreenLease()
    await screen.start()
    expect(state.win.setSize.mock.calls.map(call => call[0])).toEqual([{ type: 'Logical', width: 920, height: 720 }, { width: 460, height: 680 }])
    expect(state.win.setSize.mock.invocationCallOrder[0]).toBeLessThan(state.capture.mock.invocationCallOrder[0]!)
    expect(state.capture).toHaveBeenCalledWith({ video: { frameRate: 5 }, audio: false })
    screen.stop(); expect(state.stop).toHaveBeenCalled()
  })
  it('restores after cancellation and never acquires a hidden replacement source', async () => {
    state.capture.mockRejectedValueOnce(new DOMException('cancelled', 'NotAllowedError'))
    await expect(new ScreenLease().start()).rejects.toThrow('cancelled')
    expect(state.win.setSize).toHaveBeenCalledTimes(2)
    expect(state.capture).toHaveBeenCalledOnce()
  })
  it('respects a user resize while the picker is open', async () => {
    state.win.innerSize.mockReset().mockResolvedValueOnce({ width: 460, height: 680 }).mockResolvedValue({ width: 1000, height: 800 })
    const screen = new ScreenLease(); await screen.start()
    expect(state.win.setSize).toHaveBeenCalledTimes(1)
    screen.stop()
  })
})

describe('selected camera lease', () => {
  it('opens the selected physical camera instead of silently choosing another device', async () => {
    const acquire = vi.fn().mockResolvedValue({ active: true, getTracks: () => [{ stop: state.stop }] })
    Object.assign(navigator.mediaDevices, { getUserMedia: acquire })
    const camera = new CameraLease()
    await camera.start('selected-camera')
    expect(acquire).toHaveBeenCalledWith({ video: { width: { ideal: 640 }, height: { ideal: 480 },
      deviceId: { exact: 'selected-camera' } }, audio: false })
    camera.stop()
    expect(state.stop).toHaveBeenCalledOnce()
  })
  it('reports a missing selected camera without acquiring a fallback device', async () => {
    const acquire = vi.fn().mockRejectedValue(new DOMException('Selected camera is not connected', 'NotFoundError'))
    Object.assign(navigator.mediaDevices, { getUserMedia: acquire })
    await expect(new CameraLease().start('missing-camera')).rejects.toThrow('not connected')
    expect(acquire).toHaveBeenCalledOnce()
  })
  it('releases the previous camera before applying a different device selection', async () => {
    const firstStop = vi.fn(), secondStop = vi.fn()
    const acquire = vi.fn().mockResolvedValueOnce({ active: true, getTracks: () => [{ stop: firstStop }] })
      .mockResolvedValueOnce({ active: true, getTracks: () => [{ stop: secondStop }] })
    Object.assign(navigator.mediaDevices, { getUserMedia: acquire })
    const camera = new CameraLease()
    await camera.start('one')
    await camera.start('one')
    expect(acquire).toHaveBeenCalledOnce()
    await camera.start('two')
    expect(firstStop).toHaveBeenCalledOnce()
    expect(acquire).toHaveBeenCalledTimes(2)
    expect(secondStop).not.toHaveBeenCalled()
    camera.stop()
    expect(secondStop).toHaveBeenCalledOnce()
  })
})
