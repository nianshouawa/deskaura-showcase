import { describe, expect, it } from 'vitest'
import { CharacterStream } from './chatStreaming'

describe('character streaming', () => {
  it('reveals each character while retaining the complete provider text', async () => {
    const values: string[] = []
    const stream = new CharacterStream(value => values.push(value), 1)
    stream.push('你好')
    await stream.finish()
    expect(values[0]).toBe('你')
    expect(values.at(-1)).toBe('你好')
    expect(stream.value).toBe('你好')
  })
})
