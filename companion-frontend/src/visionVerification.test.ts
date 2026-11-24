import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyFaceDetection } from './api'

afterEach(() => vi.unstubAllGlobals())
describe('live camera verification', () => {
  it('binds the camera proof and receipt to the character that produced the frame', async () => {
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'momo' })
      return Response.json(url.endsWith('/receipt') ? { accepted: true }
        : { text: '检测到人脸', verification_id: 'camera-proof' })
    })
    vi.stubGlobal('fetch', fetcher)
    await verifyFaceDetection({ faces: 1, confidence: .91 }, 'momo', 'camera-a')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual({
      faces: 1, confidence: .91, camera_id: 'camera-a',
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('never claims success if the saved camera changed before receipt confirmation', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(
      url.endsWith('/receipt') ? { accepted: false } : { text: '人脸', verification_id: 'old-proof' },
    )))
    await expect(verifyFaceDetection({ faces: 1, confidence: .9 }, 'momo', '')).rejects.toThrow('视觉检测未完成')
  })
})
