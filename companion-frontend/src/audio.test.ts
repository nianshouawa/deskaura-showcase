import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReplyAudioPlayer } from './audio'
const players: FakeAudio[] = []
class FakeAudio {
  muted = false
  src = ''; onplaying?: () => void; onended?: () => void; onerror?: () => void
  pause = vi.fn(); load = vi.fn(); removeAttribute = vi.fn()
  play = vi.fn(async () => { this.onplaying?.() })
  constructor() { players.push(this) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); players.length = 0 })
describe('reply API audio', () => {
  it('buffers unsupported streaming, starts playback and releases resources', async () => {
    vi.stubGlobal('MediaSource', undefined); vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async () => new Response('MP3', { headers: { 'Content-Type': 'audio/mpeg' } }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const state = vi.fn(), player = new ReplyAudioPlayer()
    await player.play('你好', state)
    expect(state).toHaveBeenCalledWith('正在播放语音', true)
    expect(players[0].play).toHaveBeenCalledOnce()
    player.stop()
    expect(revoke).toHaveBeenCalledWith('blob:audio')
    expect(players[0].pause).toHaveBeenCalledOnce()
  })
  it('aborts pending generation without stale playback', async () => {
    let signal: AbortSignal | undefined
    vi.stubGlobal('fetch', vi.fn((_url, options) => {
      signal = options.signal
      return new Promise((_resolve, reject) => signal!.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))))
    }))
    const player = new ReplyAudioPlayer(), state = vi.fn()
    const pending = player.play('hello', state); player.stop(); await pending
    expect(signal?.aborted).toBe(true); expect(state).toHaveBeenCalledTimes(1)
  })
  it('keeps audio errors separate from dialogue', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('failure', { status: 502 })))
    const state = vi.fn(); await new ReplyAudioPlayer().play('hello', state)
    expect(state).toHaveBeenLastCalledWith('语音请求失败（502）', false)
  })
  it('shows provider diagnostics and never tries to decode an error as audio', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ detail: '当前音色需要付费套餐，请选 af_aoede' }, { status: 502 })))
    const state = vi.fn(); await new ReplyAudioPlayer().play('hello', state)
    expect(state).toHaveBeenLastCalledWith('当前音色需要付费套餐，请选 af_aoede', false)
    expect(players).toHaveLength(0)
  })
  it('previews unsaved fields and replays cached replies without another paid request', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async (_url: string | URL | Request, _options?: RequestInit) => new Response('RIFF-WAVE', { headers: { 'Content-Type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer(), state = vi.fn()
    await player.play('hello', state, { preview: { base_url: '', model: '', audio_voice: 'af_aoede' } })
    expect(fetcher.mock.calls[0]![0]).toContain('/api/audio/preview')
    expect(JSON.parse((fetcher.mock.calls[0]![1] as RequestInit).body as string).audio_voice).toBe('af_aoede')
    await player.play('reply', state); players[1].onended?.(); await player.play('reply', state)
    expect(fetcher).toHaveBeenCalledTimes(2)
    player.stop()
  })
  it('confirms playback only on ended, never just onplaying', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async (url: string) => url.includes('/receipt') ? Response.json({ accepted: true }) : new Response('WAV', { headers: { 'Content-Type': 'audio/wav', 'X-DeskAura-Verification': 'random-proof-not-key' } }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer()
    await player.play('test', vi.fn())
    expect(fetcher).toHaveBeenCalledTimes(1)
    players[0].onended?.()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(fetcher.mock.calls[1][0]).toContain('/connectivity/receipt')
  })
  it('one-click detection waits for playback and receipt, rejecting decode failures', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async (url: string) => url.includes('/receipt') ? Response.json({ accepted: true }) : new Response('WAV', { headers: { 'Content-Type': 'audio/wav', 'X-DeskAura-Verification': 'random-proof-not-key' } }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer(), ended = vi.fn()
    const pending = player.verify().then(ended)
    await vi.waitFor(() => expect(players).toHaveLength(1))
    expect(ended).not.toHaveBeenCalled()
    players[0].onended?.()
    await pending
    expect(ended).toHaveBeenCalledOnce()
    const failed = player.verify()
    await vi.waitFor(() => expect(players).toHaveLength(2))
    players[1].onerror?.()
    await expect(failed).rejects.toThrow('音频解码失败')
  })
  it('checks synthesis and decode silently on save without announcing the diagnostic', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('WAV', { headers: { 'Content-Type': 'audio/wav' } })))
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer(), pending = player.verify('连接检测', { silent: true })
    await vi.waitFor(() => expect(players).toHaveLength(1))
    expect(players[0].muted).toBe(true)
    players[0].onended?.(); await pending
    player.dispose()
  })
  it('never reuses another character’s cached voice for identical text', async () => {
    vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async (_url: string, _options?: RequestInit) => new Response('WAV', { headers: { 'Content-Type': 'audio/wav' } }))
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer()
    await player.play('same reply', vi.fn(), { roleId: 'alpha' })
    await players[0].onended?.()
    await player.play('same reply', vi.fn(), { roleId: 'alpha' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    await players[1].onended?.()
    await player.play('same reply', vi.fn(), { roleId: 'beta' })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
    expect(fetcher.mock.calls[1][1]?.headers).toMatchObject({ 'X-DeskAura-Role': 'beta' })
    player.dispose()
  })
  it('keeps playback receipts and failures on the role captured before a role switch', async () => {
    let active = 'alpha'
    vi.stubGlobal('localStorage', { getItem: () => active })
    vi.stubGlobal('Audio', FakeAudio)
    const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
      return url.includes('/receipt') || url.includes('/failure')
        ? Response.json({ accepted: true })
        : new Response('WAV', { headers: { 'Content-Type': 'audio/wav', 'X-DeskAura-Verification': 'audio-proof' } })
    })
    vi.stubGlobal('fetch', fetcher)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audio')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const player = new ReplyAudioPlayer()
    await player.play('reply', vi.fn())
    active = 'beta'
    players[0].onerror?.()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    player.dispose()
  })
})
