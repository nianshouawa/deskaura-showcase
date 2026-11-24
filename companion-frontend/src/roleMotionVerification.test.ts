import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { verifyRoleMotion } from './roleMotionVerification'

vi.mock('./fbxMotion', () => ({ parseTencentFbxMotion: vi.fn(() => ({ poses: [[0, 0, 0]], fps: 30 })) }))

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.unstubAllGlobals())

describe('role motion verification', () => {
  it('accepts Tencent cached FBX only after parsing and an accepted receipt', async () => {
    const requests: Array<[string, RequestInit | undefined]> = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      requests.push([url, options])
      if (url.endsWith('/cloud-test')) return Response.json({ verified: true, kind: 'fbx', result_url: '/api/motion/fbx/test-id' })
      if (url.endsWith('/receipt')) return Response.json({ accepted: true })
      return new Response(new ArrayBuffer(4))
    }))
    await verifyRoleMotion('role-alpha')
    expect(requests.map(([url]) => url)).toEqual([
      'http://127.0.0.1:8002/api/motion/cloud-test',
      'http://127.0.0.1:8002/api/motion/fbx/test-id',
      'http://127.0.0.1:8002/api/motion/receipt',
    ])
    expect(requests.every(([, options]) => (options?.headers as Record<string, string>)['X-DeskAura-Role'] === 'role-alpha')).toBe(true)
    expect(JSON.parse(requests[2]![1]!.body as string)).toEqual({ result_id: 'test-id', success: true })
  })
  it('rejects invalid bone data and reports a failed client receipt', async () => {
    const fetcher = vi.fn(async (url: string, _options?: RequestInit) => {
      if (url.endsWith('/cloud-test')) return Response.json({ verified: true, kind: 'hymotion', result_url: '/api/motion/result/test-id' })
      if (url.endsWith('/receipt')) return Response.json({ accepted: true })
      return Response.json({ fps: 30, poses: [[0, 0, 0]] })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(verifyRoleMotion('role-alpha')).rejects.toThrow('回读骨骼数据无效')
    expect(JSON.parse(fetcher.mock.calls[2]![1]!.body as string)).toEqual({ result_id: 'test-id', success: false })
  })
  it('never accepts remote or arbitrary result URLs', async () => {
    const fetcher = vi.fn(async () => Response.json({ verified: true, kind: 'fbx', result_url: 'https://example.invalid/result.fbx' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(verifyRoleMotion('role-alpha')).rejects.toThrow('动作接口未返回可验证结果')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('fails if configuration changes before client receipt is accepted', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/cloud-test')) return Response.json({ verified: true, kind: 'hymotion', result_url: '/api/motion/result/test-id' })
      if (url.endsWith('/receipt')) return Response.json({ accepted: false })
      return Response.json({ fps: 30, poses: [Array(156).fill(0)] })
    }))
    await expect(verifyRoleMotion('role-alpha')).rejects.toThrow('验证结果已失效')
  })
})
