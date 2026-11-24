// @vitest-environment jsdom
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import AvatarStage from './AvatarStage.vue'

const state = vi.hoisted(() => ({
  load: vi.fn(), fetch: vi.fn(), dispose: vi.fn(),
}))
vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof import('three')>()
  return { ...actual, WebGLRenderer: class {
    domElement?: HTMLCanvasElement
    constructor(options: { canvas: HTMLCanvasElement }) { this.domElement = options.canvas }
    setPixelRatio() {}
    setSize() {}
    render() {}
    getContext() { return { drawingBufferWidth: 256, drawingBufferHeight: 256 } }
    getRenderTarget() { return null }
    setRenderTarget() {}
    readRenderTargetPixels(_target: unknown, _x: number, _y: number, _width: number, _height: number, pixels: Uint8Array) { pixels.fill(0) }
    dispose = state.dispose
  } }
})
vi.mock('../modelScene', () => ({ loadModelScene: state.load }))
vi.mock('../motionSafety', async importOriginal => ({
  ...await importOriginal<typeof import('../motionSafety')>(),
  AvatarMotionSafety: class {},
}))
vi.mock('../avatarDetails', async importOriginal => ({
  ...await importOriginal<typeof import('../avatarDetails')>(),
  AvatarHeadGaze: class {},
  AvatarFingerPose: class {},
}))
vi.mock('../tauri', () => ({ getCursorPos: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: vi.fn() }))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  const root = new THREE.Group()
  const humanoid = {
    getNormalizedBoneNode: () => undefined,
    normalizedHumanBonesRoot: root,
    update: vi.fn(),
  }
  state.load.mockResolvedValue({ root, humanoid, capability: '测试模型' })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
    callback.name === 'loop' ? 1 : setTimeout(() => callback(0), 0) as unknown as number)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  state.fetch.mockImplementation((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
  }))
  vi.stubGlobal('fetch', state.fetch)
})
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals() })

async function loadedStage() {
  const wrapper = mount(AvatarStage)
  await (wrapper.vm as unknown as { loadUrl: (url: string) => Promise<void> }).loadUrl('http://localhost/avatar')
  await flushPromises()
  expect(state.fetch).toHaveBeenCalledOnce()
  return wrapper
}
describe('avatar motion resource lifetime', () => {
  it('shows a neutral cursor for a static preview', async () => {
    const wrapper = mount(AvatarStage, { props: { preview: true } })
    await flushPromises()
    expect(wrapper.get('canvas').element.style.cursor).toBe('default')
    wrapper.unmount()
  })
  it('cancels a pending old clip when another motion supersedes it', async () => {
    const wrapper = await loadedStage()
    const idleSignal = state.fetch.mock.calls[0]![1]!.signal as AbortSignal
    await wrapper.setProps({ motion: {
      id: 'cloud_wave', kind: 'hymotion', url: '/api/motion/library/cloud_wave', duration: 4, loop: false,
    } })
    expect(idleSignal.aborted).toBe(true)
    expect(state.fetch).toHaveBeenCalledTimes(2)
    const currentSignal = state.fetch.mock.calls[1]![1]!.signal as AbortSignal
    wrapper.unmount()
    expect(currentSignal.aborted).toBe(true)
    expect(state.dispose).toHaveBeenCalledOnce()
  })
  it('does not report an aborted FBX download as a verification failure', async () => {
    const wrapper = await loadedStage()
    await wrapper.setProps({ motion: {
      id: 'generated-fbx', kind: 'fbx', url: '/api/motion/fbx/result-one', duration: 4,
    } })
    wrapper.unmount()
    await flushPromises()
    expect(state.fetch.mock.calls.some(([url]) => String(url).endsWith('/receipt'))).toBe(false)
  })
})
