import { describe, expect, it, vi } from 'vitest'
import { readEventStream, SentenceAudioQueue, SpeechSentenceBuffer } from './chatStreaming'

describe('incremental chat and speech', () => {
  it('handles chunked UTF-8 SSE without displaying JSON framing', async () => {
    const bytes = new TextEncoder().encode('event: delta\r\ndata: {"text":"你好"}\r\n\r\nevent: reply\ndata: {"text":"你好。"}\n\n')
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < bytes.length; i += 2) controller.enqueue(bytes.slice(i, i + 2)); controller.close() } })
    const received: unknown[] = []
    await readEventStream(new Response(stream), (event, data) => received.push([event, data]))
    expect(received).toEqual([['delta', { text: '你好' }], ['reply', { text: '你好。' }]])
  })
  it('delivers an increment while the response stream is still open', async () => {
    let writer!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({ start(controller) { writer = controller } })
    const received = vi.fn()
    const pending = readEventStream(new Response(stream), received)
    writer.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"第一句。"}\n\n'))
    await Promise.resolve(); await Promise.resolve()
    expect(received).toHaveBeenCalledWith('delta', { text: '第一句。' })
    writer.close(); await pending
  })
  it('surfaces malformed frames and closes the stream', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ start(writer) { writer.enqueue(new TextEncoder().encode('event: delta\ndata: not-json\n\n')) }, cancel })
    await expect(readEventStream(new Response(stream), vi.fn())).rejects.toThrow('回复流格式无效')
    expect(cancel).toHaveBeenCalledOnce()
  })
  it('starts the first sentence before the final reply and flushes the tail once', () => {
    const speak = vi.fn(), sentences = new SpeechSentenceBuffer(speak)
    sentences.push('这是第一'); expect(speak).not.toHaveBeenCalled()
    sentences.push('句。第二句'); expect(speak).toHaveBeenCalledWith('这是第一句。')
    sentences.finish(); sentences.finish()
    expect(speak.mock.calls.map(call => call[0])).toEqual(['这是第一句。', '第二句'])
  })
  it('never speaks fenced code or protocol fields', () => {
    const speak = vi.fn(), sentences = new SpeechSentenceBuffer(speak)
    sentences.push('这里是说明。\n```python\nprint("secret-looking data")\n```\n完成。')
    sentences.finish()
    expect(speak.mock.calls.map(call => call[0])).toEqual(['这里是说明。', '完成。'])
  })
  it('does not cut off an earlier sentence and clears stale waiting speech on interruption', async () => {
    let complete!: () => void
    const play = vi.fn((_value: string) => new Promise<void>(resolve => { complete = resolve })), pending = vi.fn()
    const queue = new SentenceAudioQueue(play, pending)
    queue.enqueue('一'); queue.enqueue('二'); expect(play).toHaveBeenCalledTimes(1)
    complete(); await Promise.resolve(); await Promise.resolve()
    expect(play.mock.calls.map(call => call[0])).toEqual(['一', '二'])
    queue.enqueue('三'); queue.clear(); complete(); await Promise.resolve(); await Promise.resolve()
    expect(play).toHaveBeenCalledTimes(2); expect(pending).toHaveBeenLastCalledWith(0)
  })
  it('holds incremental speech until motion readiness, then plays the sentences in order', async () => {
    const play = vi.fn(async (_value: string) => {}), pending = vi.fn()
    const queue = new SentenceAudioQueue(play, pending)
    queue.pause(); queue.enqueue('第一句。'); queue.enqueue('第二句。')
    expect(play).not.toHaveBeenCalled()
    expect(pending).toHaveBeenLastCalledWith(2)
    queue.resume()
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(play.mock.calls.map(call => call[0])).toEqual(['第一句。', '第二句。'])
    expect(pending).toHaveBeenLastCalledWith(0)
  })
  it('cannot release cancelled held sentences into the next turn', async () => {
    const play = vi.fn(async (_value: string) => {}), queue = new SentenceAudioQueue(play, vi.fn())
    queue.pause(); queue.enqueue('旧回复。'); queue.clear()
    queue.pause(); queue.enqueue('新回复。'); queue.resume()
    await Promise.resolve(); await Promise.resolve()
    expect(play.mock.calls.map(call => call[0])).toEqual(['新回复。'])
  })
})
