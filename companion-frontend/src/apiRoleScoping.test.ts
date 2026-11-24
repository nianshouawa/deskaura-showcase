import { afterEach, describe, expect, it, vi } from 'vitest'
import { activeConnectivityTest, createSession, decideFile, deleteSession, getChatCapabilities, getModelSettings, getSession, listSessions, renameSession, sendChat, streamChat, transcribeAudio } from './api'

afterEach(() => vi.unstubAllGlobals())

function activeRole() {
  let role = 'alpha'
  vi.stubGlobal('localStorage', { getItem: () => role })
  return (next: string) => { role = next }
}

describe('runtime character request isolation', () => {
  it('uses the applied role for session, settings, capabilities and approval requests', async () => {
    activeRole()
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
      return Response.json({})
    })
    vi.stubGlobal('fetch', fetcher)
    await listSessions()
    await createSession()
    await getSession('one')
    await renameSession('one', 'renamed')
    await deleteSession('one')
    await decideFile('approval', 'one', false)
    await getModelSettings()
    await getChatCapabilities()
    expect(fetcher).toHaveBeenCalledTimes(8)
    expect(fetcher.mock.calls[0][0]).toContain('role_id=alpha')
  })

  it('preserves an explicitly selected role instead of the active desktop role', async () => {
    activeRole()
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'beta' })
      return Response.json({})
    }))
    await getModelSettings('beta')
    await listSessions('beta')
  })

  it('binds recognition and its receipt to the same role when the user switches roles', async () => {
    const switchRole = activeRole()
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
      if (url.endsWith('/transcribe')) {
        switchRole('beta')
        return Response.json({ text: '识别结果', verification_id: 'asr-proof' })
      }
      return Response.json({ accepted: true })
    })
    vi.stubGlobal('fetch', fetcher)
    expect(await transcribeAudio(new Blob(['wav']))).toBe('识别结果')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('binds active checks and their receipts to the original role', async () => {
    const switchRole = activeRole()
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
      if (url.endsWith('/test')) {
        switchRole('beta')
        return Response.json({ text: '正常', verification_id: 'brain-proof' })
      }
      return Response.json({ accepted: true })
    }))
    expect(await activeConnectivityTest('chat')).toBe('正常')
  })

  it.each(['send', 'stream'])('keeps %s chat and proof under the explicitly requested role', async mode => {
    const switchRole = activeRole()
    const reply = { text: '回复', demo_mode: false, verification_id: 'chat-proof', emotion: 'neutral',
      motion: { id: 'motion', kind: 'hymotion', url: '/clip', duration: 3 } }
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'beta' })
      if (url.endsWith('/receipt')) return Response.json({ accepted: true })
      expect(JSON.parse(options?.body as string).role_id).toBe('beta')
      switchRole('gamma')
      return mode === 'stream'
        ? new Response(`event: reply\ndata: ${JSON.stringify(reply)}\n\n`)
        : Response.json(reply)
    }))
    const result = mode === 'stream'
      ? await streamChat('消息', 'session', [], vi.fn(), undefined, undefined, 'beta')
      : await sendChat('消息', 'session', undefined, [], 'beta')
    expect(result.text).toBe('回复')
  })
})
