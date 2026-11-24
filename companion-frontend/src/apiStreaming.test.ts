import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from './api'

afterEach(() => vi.unstubAllGlobals())
const final = { text: '你好。', emotion: 'neutral', motion: { id: 'cloud_emotion_neutral', kind: 'hymotion', url: '/clip', duration: 3 }, demo_mode: true }

describe('chat stream protocol', () => {
  it('requests SSE and renders only text increments, retaining authoritative motion', async () => {
    const fetcher = vi.fn(async () => new Response('event: delta\ndata: {"text":"你好"}\n\nevent: delta\ndata: {"text":"。"}\n\nevent: reply\ndata: ' + JSON.stringify(final) + '\n\n', { headers: { 'Content-Type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetcher)
    const delta = vi.fn(), result = await streamChat('你好', 'session', [], delta)
    expect(delta.mock.calls.map(call => call[0])).toEqual(['你好', '。'])
    expect(result.motion.id).toBe('cloud_emotion_neutral')
    expect(fetcher.mock.calls).toHaveLength(1)
    const options = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(options.headers).toMatchObject({ Accept: 'text/event-stream' })
    expect(JSON.parse(options.body as string)).toMatchObject({ message: '你好', session_id: 'session', attachments: [] })
  })
  it('does not accept a truncated reply as complete', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: delta\ndata: {"text":"开头"}\n\n')))
    await expect(streamChat('你好', 'session', [], vi.fn())).rejects.toThrow('回复未完成')
  })
  it('flushes the text tail before the slow cloud motion result without speaking twice', async () => {
    const progress = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: delta\ndata: {"text":"你好。"}\n\nevent: text_done\ndata: {}\n\nevent: motion\ndata: ' + JSON.stringify({ motion: final.motion, emotion: final.emotion }) + '\n\nevent: reply\ndata: ' + JSON.stringify(final) + '\n\n')))
    const delta = vi.fn()
    const result = await streamChat('你好', 'session', [], delta, undefined, progress)
    expect(delta).toHaveBeenCalledTimes(1)
    expect(progress.mock.calls[0]).toEqual([{ type: 'text_done' }])
    expect(progress.mock.calls[1][0]).toMatchObject({ type: 'motion', motion: final.motion })
    expect(result).toEqual(final)
  })
  it('preserves safe stream errors instead of showing a fabricated success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('event: error\ndata: {"detail":"模型连接超时"}\n\n')))
    await expect(streamChat('你好', 'session', [], vi.fn())).rejects.toThrow('模型连接超时')
  })
})
