import { afterEach, describe, expect, it, vi } from 'vitest'
import { localFetch } from './localFetch'

afterEach(() => vi.unstubAllGlobals())
describe('local service transport errors', () => {
  it('explains a dropped motion service connection without retrying a paid test', async () => {
    const fetcher = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    vi.stubGlobal('fetch', fetcher)
    await expect(localFetch('http://127.0.0.1:8002/api/motion/cloud-test', { method: 'POST' }))
      .rejects.toThrow('无法连接动作服务')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('distinguishes timeout from explicit cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const timeout = new AbortController()
    timeout.abort(new DOMException('timeout', 'TimeoutError'))
    await expect(localFetch('/api/modules/tools/status', { signal: timeout.signal })).rejects.toThrow('请求超时')
    const cancel = new AbortController()
    cancel.abort()
    await expect(localFetch('/api/modules/vision/test', { signal: cancel.signal })).rejects.toThrow('操作已取消')
  })
  it('preserves HTTP failures and never disguises a provider rejection as connectivity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: '密钥无效' }, { status: 401 })))
    const response = await localFetch('/api/test')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ detail: '密钥无效' })
  })
})
