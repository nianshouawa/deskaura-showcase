/** Protocol-independent text framing. A chunk may split a UTF-8 code point or SSE line. */
export async function readEventStream(response: Response, onEvent: (event: string, data: unknown) => void, signal?: AbortSignal) {
  if (!response.body) throw new Error('回复流为空，请检查模型接口')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', event = 'message', data: string[] = []
  function dispatch() {
    if (data.length) {
      const payload = data.join('\n')
      if (payload !== '[DONE]') {
        try { onEvent(event, JSON.parse(payload)) }
        catch (error) { if (error instanceof SyntaxError) throw new Error('回复流格式无效'); throw error }
      }
    }
    event = 'message'; data = []
  }
  function consume(final = false) {
    let index: number
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1)
      if (!line) dispatch()
      else if (line.startsWith('event:')) event = line.slice(6).trim()
      else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    if (final) { if (buffer.startsWith('data:')) data.push(buffer.slice(5).trimStart()); dispatch() }
  }
  try {
    while (true) {
      signal?.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      buffer += decoder.decode(part.value, { stream: true }); consume()
    }
    buffer += decoder.decode(); consume(true)
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Emit complete sentences early, retaining trailing text until the next delta. */
export class SpeechSentenceBuffer {
  private buffer = ''
  private inCode = false
  constructor(private emit: (sentence: string) => void) {}
  push(delta: string) {
    this.buffer += delta
    let boundary: number
    while ((boundary = this.boundary()) >= 0) {
      const part = this.buffer.slice(0, boundary + 1); this.buffer = this.buffer.slice(boundary + 1)
      this.deliver(part)
    }
    // Long unpunctuated paragraphs must not hold speech until the whole answer.
    while (this.buffer.length > 72) {
      const space = Math.max(this.buffer.lastIndexOf(' ', 48), this.buffer.lastIndexOf('，', 48), this.buffer.lastIndexOf('、', 48))
      const end = space > 24 ? space + 1 : 56
      this.deliver(this.buffer.slice(0, end)); this.buffer = this.buffer.slice(end)
    }
  }
  private boundary() {
    for (let i = 0; i < this.buffer.length; i++) {
      const c = this.buffer[i]!
      if (/[。！？!?；;\n]/.test(c) || c === '.' && /\s/.test(this.buffer[i + 1] || '')) return i
    }
    return -1
  }
  private deliver(value: string) {
    // Do not read raw fenced source code aloud.
    const parts = value.split('```')
    const audible: string[] = []
    parts.forEach((part, index) => { if (index) this.inCode = !this.inCode; if (!this.inCode) audible.push(part) })
    const cleaned = audible.join('').replace(/[*#`_]/g, '').trim()
    if (cleaned && /[\p{L}\p{N}]/u.test(cleaned)) this.emit(cleaned)
  }
  finish() { if (this.buffer.trim()) this.deliver(this.buffer); this.buffer = '' }
}

/** Reveal provider deltas one character at a time without delaying networking. */
export class CharacterStream {
  private target = ''
  private shown = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private waiters: Array<() => void> = []
  constructor(private update: (value: string) => void, private interval = 18) {}
  get value() { return this.shown }
  push(value: string) {
    if (!value) return
    this.target += value
    if (this.timer === undefined) this.tick()
  }
  async finish(): Promise<void> {
    if (this.shown === this.target) return
    await new Promise<void>(resolve => this.waiters.push(resolve))
    if (this.timer === undefined && this.shown !== this.target) {
      await this.finish()
    }
  }
  clear() {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    this.target = ''
    this.shown = ''
    const waiters = this.waiters.splice(0)
    waiters.forEach(resolve => resolve())
  }
  private tick = () => {
    this.timer = undefined
    if (this.shown.length >= this.target.length) {
      const waiters = this.waiters.splice(0)
      waiters.forEach(resolve => resolve())
      return
    }
    const backlog = this.target.length - this.shown.length
    const count = backlog > 96 ? 4 : backlog > 36 ? 2 : 1
    this.shown = this.target.slice(0, this.shown.length + count)
    this.update(this.shown)
    this.timer = setTimeout(this.tick, this.interval)
  }
}

/** Serial playback with cancellation: new sentences never cut off the previous one. */
export class SentenceAudioQueue {
  private queue: string[] = []
  private revision = 0
  private working = false
  private paused = false
  constructor(private play: (value: string) => Promise<void>, private pending: (count: number) => void) {}
  enqueue(value: string) { if (!value.trim()) return; this.queue.push(value); this.notify(); void this.drain() }
  /** Keep incremental sentences pending until the freshly generated motion is ready. */
  pause() { this.paused = true }
  resume() { this.paused = false; void this.drain() }
  clear() { this.revision++; this.queue = []; this.working = false; this.paused = false; this.notify() }
  private notify() { this.pending(this.queue.length + Number(this.working)) }
  private async drain() {
    if (this.paused || this.working || !this.queue.length) return
    const revision = this.revision
    this.working = true; this.notify()
    try {
      while (revision === this.revision && !this.paused && this.queue.length) {
        const sentence = this.queue.shift()!; this.notify()
        try { await this.play(sentence) } catch { /* Audio errors are surfaced by the player; text continues. */ }
      }
    } finally { if (revision === this.revision) { this.working = false; this.notify() } }
  }
}
