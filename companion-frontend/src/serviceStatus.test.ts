import { afterEach, describe, expect, it, vi } from 'vitest'
import { getServicesStatus, activeConnectivityTest } from './api'

afterEach(() => vi.unstubAllGlobals())

describe('local services directory', () => {
  it('checks ASR and TTS independently and displays recognition before generation', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return { ok: true, json: async () => ({ detail: '配置齐全 · 尚未实际验证', provider_verified: false }) }
    }))
    const services = await getServicesStatus()
    expect(services.map(service => service.name)).toEqual(['对话模型', '语音识别', '语音合成', '动作模型', '记忆服务'])
    expect(calls).toContain('http://127.0.0.1:8000/api/audio/recognition/status')
    expect(calls).toContain('http://127.0.0.1:8000/api/audio/speech/status')
    expect(calls.every(url => !url.includes('cloud-test') && !url.endsWith('/audio/speech'))).toBe(true)
    expect(services[1].detail).toContain('尚未实际验证')
    expect(services.every(service => !service.running)).toBe(true)
  })
  it('keeps a closed but online service red and preserves its actual reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/recognition/status')) throw new Error('recognition unavailable')
      return { ok: true, json: async () => ({ detail: '已关闭' }) }
    }))
    const services = await getServicesStatus()
    expect(services[1]).toMatchObject({ running: false, section: 'settings-recognition' })
    expect(services[2]).toMatchObject({ online: true, running: false, detail: '已关闭', section: 'settings-speech' })
  })
  it.each(['enabled', 'configured', 'provider_verified', 'client_verified', 'verified'])('never shows green if %s failed', async missing => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, configured: true, provider_verified: true, client_verified: true, verified: true, [missing]: false }) })))
    const services = await getServicesStatus()
    expect(services[1].running).toBe(false)
    expect(services[2].running).toBe(false)
  })
  it('allows independently verified recognition and playback only after every stage passed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: true, configured: true, provider_verified: true, client_verified: true, verified: true }) })))
    const services = await getServicesStatus()
    expect(services[1].running).toBe(true)
    expect(services[2].running).toBe(true)
  })
  it('actively calls a short provider test and confirms reception without a chat session', async () => {
    const fetcher = vi.fn(async (url: string) => Response.json(url.endsWith('/receipt') ? { accepted: true } : { text: '连接正常', verification_id: 'token-for-config-not-secret' }))
    vi.stubGlobal('fetch', fetcher)
    expect(await activeConnectivityTest('recognition')).toBe('连接正常')
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['http://127.0.0.1:8000/api/connectivity/recognition/test', 'http://127.0.0.1:8000/api/connectivity/receipt'])
  })
  it('never accepts empty, demo-shaped or changed-configuration active checks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ text: '演示' })))
    await expect(activeConnectivityTest('chat')).rejects.toThrow('未返回有效结果')
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/receipt') ? { accepted: false } : { text: '有效', verification_id: 'new-token' })))
    await expect(activeConnectivityTest('chat')).rejects.toThrow('配置已改变')
  })
  it('verifies the online cloud even when the selected action mode is offline', async () => {
    const calls: string[] = []
    let sharedVerified = false
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      calls.push(url)
      if (url.endsWith('/motion/receipt')) {
        expect(JSON.parse(options!.body as string)).toEqual({ result_id: 'test-id', success: true })
        sharedVerified = true
        return Response.json({ accepted: true })
      }
      return Response.json(url.includes('/settings/model') ? { base_url: '', model: '', motion_mode: 'offline' }
        : url.endsWith('/motion/cloud-test') ? { verified: true, kind: 'hymotion', frames: 1, fps: 30, result_url: '/api/motion/result/test-id' }
        : url.includes('/motion/result/') ? { fps: 30, poses: [Array(66).fill(0)] }
        : url.endsWith('/motion/status') ? { configured: true, provider_verified: sharedVerified, client_verified: sharedVerified, verified: sharedVerified, client_attempted: sharedVerified, detail: '正常' }
        : url.includes('/memory/status') ? { memory_count: 0, relationship_level: 1 }
        : { status: 'ok' })
    }))
    const statuses = await getServicesStatus(undefined, true)
    expect(statuses.find(s => s.name === '动作模型')).toMatchObject({ running: true, state: 'normal' })
    expect(calls.filter(url => url.includes('/motion/library/'))).toHaveLength(0)
    expect(calls.some(url => /cloud-test/.test(url))).toBe(true)
    calls.length = 0
    expect((await getServicesStatus()).find(s => s.name === '动作模型')?.running).toBe(true)
    expect(calls.some(url => /cloud-test/.test(url))).toBe(false)
    expect(calls.some(url => /motion\/status/.test(url))).toBe(true)
    expect(calls.some(url => /receipt/.test(url))).toBe(false)
  })
  it('reads proof established by another window without needing a local detection first', async () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      return Response.json(url.endsWith('/motion/status') ? { configured: true, provider_verified: true, client_verified: true, verified: true, detail: '服务端已验证' } : {})
    }))
    expect((await getServicesStatus()).find(value => value.name === '动作模型')).toMatchObject({ running: true, state: 'normal', detail: '服务端已验证' })
    expect(calls.some(url => /cloud-test|receipt|motion\/library/.test(url))).toBe(false)
  })
  it.each(['configured', 'provider_verified', 'client_verified', 'verified'])('requires every shared motion evidence flag, including %s', async missing => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ configured: true, provider_verified: true, client_verified: true, verified: true, [missing]: false, detail: '链路异常' })))
    expect((await getServicesStatus()).find(value => value.name === '动作模型')).toMatchObject({ running: false, state: 'error', detail: '链路异常' })
  })
  it.each([{ poses: [] }, { poses: [Array(65).fill(0)] }, { poses: [Array(66).fill('bad')] }])('rejects malformed motion readback and reports a negative receipt', async ({ poses }) => {
    const receipts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/motion/receipt')) { receipts.push(JSON.parse(options!.body as string)); return Response.json({ accepted: false }) }
      return Response.json(url.endsWith('/motion/cloud-test') ? { verified: true, kind: 'hymotion', frames: 1, fps: 30, result_url: '/api/motion/result/invalid-result' }
        : url.includes('/motion/result/') ? { fps: 30, poses }
        : {})
    }))
    const status = (await getServicesStatus(undefined, true)).find(value => value.name === '动作模型')
    expect(status).toMatchObject({ running: false, state: 'error', detail: '回读骨骼数据无效' })
    expect(receipts).toEqual([{ result_id: 'invalid-result', success: false }])
  })
  it('does not turn green when the server rejects a stale readback receipt', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/motion/cloud-test') ? { verified: true, kind: 'hymotion', frames: 1, fps: 30, result_url: '/api/motion/result/stale-result' }
      : url.includes('/motion/result/') ? { fps: 30, poses: [Array(66).fill(0)] }
      : url.endsWith('/motion/receipt') ? { accepted: false }
      : {})))
    expect((await getServicesStatus(undefined, true)).find(value => value.name === '动作模型')).toMatchObject({ running: false, state: 'error', detail: '验证结果未确认或配置已改变' })
  })
  it('reports failed download as a negative receipt without an archive fallback', async () => {
    const receipts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/motion/receipt')) { receipts.push(JSON.parse(options!.body as string)); return Response.json({ accepted: false }) }
      if (url.includes('/motion/result/')) return new Response('', { status: 404 })
      return Response.json(url.endsWith('/motion/cloud-test') ? { verified: true, kind: 'hymotion', frames: 1, fps: 30, result_url: '/api/motion/result/lost-result' } : {})
    }))
    expect((await getServicesStatus(undefined, true)).find(value => value.name === '动作模型')).toMatchObject({ running: false, state: 'error' })
    expect(receipts).toEqual([{ result_id: 'lost-result', success: false }])
  })
  it('stays red if receipt transport fails after a valid generated result', async () => {
    const receipts: unknown[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      if (url.endsWith('/motion/receipt')) {
        const receipt = JSON.parse(options!.body as string); receipts.push(receipt)
        if (receipt.success) throw new Error('Receipt unavailable')
        return Response.json({ accepted: false })
      }
      return Response.json(url.endsWith('/motion/cloud-test') ? { verified: true, kind: 'hymotion', frames: 1, fps: 30, result_url: '/api/motion/result/network-result' }
        : url.includes('/motion/result/') ? { fps: 30, poses: [Array(66).fill(0)] }
        : {})
    }))
    expect((await getServicesStatus(undefined, true)).find(value => value.name === '动作模型')).toMatchObject({ running: false, state: 'error', detail: '异常：Receipt unavailable' })
    expect(receipts).toEqual([{ result_id: 'network-result', success: true }, { result_id: 'network-result', success: false }])
  })
})
