import { describe, expect, it } from 'vitest'
import { RoleRequestScope } from './roleRequestScope'

describe('role history request lifetime', () => {
  it('rejects an old role response, including after switching back to that role', () => {
    const scope = new RoleRequestScope(), old = scope.capture('a')
    scope.invalidate()
    expect(scope.accepts(old, 'b')).toBe(false)
    scope.invalidate()
    expect(scope.accepts(old, 'a')).toBe(false)
    expect(scope.accepts(scope.capture('a'), 'a')).toBe(true)
  })
  it('does not let an old request finally unlock the new role request', async () => {
    const scope = new RoleRequestScope()
    let currentRole = 'a', busy = true, finish!: () => void
    const old = scope.capture(currentRole)
    const pending = new Promise<void>(resolve => { finish = resolve }).finally(() => {
      if (scope.accepts(old, currentRole)) busy = false
    })
    scope.invalidate(); currentRole = 'b'
    const next = scope.capture(currentRole)
    finish(); await pending
    expect(busy).toBe(true)
    expect(scope.accepts(next, currentRole)).toBe(true)
  })
})
