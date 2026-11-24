import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AvatarClickInteraction } from './avatarInteraction'

describe('avatar body and chat gestures', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())
  const point = (x = 10, y = 10, button = 0) => ({ clientX: x, clientY: y, button, pointerId: 1 })
  const create = () => {
    const touch = vi.fn(), chat = vi.fn()
    return { touch, chat, clicks: new AvatarClickInteraction(p => p.x > 0 ? 'head' : undefined, touch, chat) }
  }
  it('single left click reacts once at the clicked body region', () => {
    const { touch, chat, clicks } = create()
    clicks.down(point()); clicks.up(point())
    expect(touch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(501)
    expect(touch).toHaveBeenCalledExactlyOnceWith('head')
    expect(chat).not.toHaveBeenCalled()
  })
  it('double left click opens chat without any touch reaction', () => {
    const { touch, chat, clicks } = create()
    clicks.down(point()); clicks.up(point())
    vi.advanceTimersByTime(200)
    clicks.down(point(12, 10)); clicks.up(point(12, 10))
    vi.advanceTimersByTime(600)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(touch).not.toHaveBeenCalled()
  })
  it('three separated private clicks invoke the special callback after two normal reactions', () => {
    const touch = vi.fn(), chat = vi.fn(), triple = vi.fn()
    const clicks = new AvatarClickInteraction(p => p.x > 0 ? 'private' : undefined, touch, chat, triple)
    for (let i = 0; i < 3; i++) { clicks.down(point(10 + i, 10)); clicks.up(point(10 + i, 10)); vi.advanceTimersByTime(520) }
    expect(triple).toHaveBeenCalledExactlyOnceWith('private')
    expect(chat).not.toHaveBeenCalled()
    expect(touch).toHaveBeenCalledTimes(2)
  })
  it('does not combine clicks from different body regions', () => {
    const touch = vi.fn(), chat = vi.fn(), triple = vi.fn()
    let region = 'private'
    const clicks = new AvatarClickInteraction(() => region, touch, chat, triple, 500, value => value === 'private')
    clicks.down(point()); clicks.up(point())
    region = 'head'
    clicks.down(point()); clicks.up(point())
    vi.advanceTimersByTime(600)
    region = 'private'
    clicks.down(point()); clicks.up(point()); vi.advanceTimersByTime(520)
    clicks.down(point()); clicks.up(point()); vi.advanceTimersByTime(520)
    expect(triple).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
    expect(touch.mock.calls).toEqual([['private'], ['head'], ['private'], ['private']])
  })
  it('keeps normal double-click chat immediate for non-private body regions', () => {
    const touch = vi.fn(), chat = vi.fn(), triple = vi.fn()
    const clicks = new AvatarClickInteraction(() => 'head', touch, chat, triple, 500, region => region === 'private')
    clicks.down(point()); clicks.up(point()); clicks.down(point()); clicks.up(point())
    expect(chat).toHaveBeenCalledOnce()
    expect(triple).not.toHaveBeenCalled()
  })
  it('a quick private double opens chat and resets the accumulated private count', () => {
    const touch = vi.fn(), chat = vi.fn(), triple = vi.fn()
    const clicks = new AvatarClickInteraction(() => 'private', touch, chat, triple)
    clicks.down(point()); clicks.up(point()); vi.advanceTimersByTime(520)
    clicks.down(point()); clicks.up(point()); vi.advanceTimersByTime(100)
    clicks.down(point(12, 10)); clicks.up(point(12, 10))
    expect(chat).toHaveBeenCalledTimes(1)
    expect(touch).toHaveBeenCalledTimes(1)
    for (let i = 0; i < 2; i++) { clicks.down(point(14 + i, 10)); clicks.up(point(14 + i, 10)); vi.advanceTimersByTime(520) }
    expect(triple).not.toHaveBeenCalled()
  })
  it('dragging, cancelled pointers and right clicks never react', () => {
    const { touch, chat, clicks } = create()
    clicks.down(point()); clicks.move(point(40)); clicks.up(point(40))
    clicks.down(point()); clicks.cancelPointer(); clicks.up(point())
    clicks.down(point(10, 10, 2)); clicks.up(point(10, 10, 2))
    clicks.down(point()); clicks.up(point(17))
    vi.advanceTimersByTime(600)
    expect(touch).not.toHaveBeenCalled()
    expect(chat).not.toHaveBeenCalled()
  })
  it('empty space is not treated as a body part or chat gesture', () => {
    const { touch, chat, clicks } = create()
    clicks.down(point(-10)); clicks.up(point(-10))
    clicks.down(point(-10)); clicks.up(point(-10))
    vi.advanceTimersByTime(600)
    expect(touch).not.toHaveBeenCalled(); expect(chat).not.toHaveBeenCalled()
  })
  it('disposal clears a pending body response', () => {
    const { touch, clicks } = create()
    clicks.down(point()); clicks.up(point()); clicks.dispose()
    vi.advanceTimersByTime(600)
    expect(touch).not.toHaveBeenCalled()
  })
})
