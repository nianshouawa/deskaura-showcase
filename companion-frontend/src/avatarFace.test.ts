import { describe, expect, it } from 'vitest'
import { VRMExpression, VRMExpressionManager } from '@pixiv/three-vrm'
import { AvatarFaceAnimation, motionFaceTargets } from './avatarFace'

describe('standby face animation', () => {
  it('keeps eyes closed throughout sleep rather than reopening between normal blinks', () => {
    for (const seconds of [0, .12, 1, 4.7, 8, 23]) expect(motionFaceTargets('cloud_standby_sleep', seconds).blink).toBe(.98)
  })
  it('animates humming vowels without TTS and gives real speech precedence', () => {
    const a = motionFaceTargets('cloud_standby_sing', 0)
    const b = motionFaceTargets('cloud_standby_sing', .2)
    expect(a.aa).toBeGreaterThan(.08)
    expect(b.oh).not.toBe(a.oh)
    expect(motionFaceTargets('cloud_standby_sing', 0, .5)).toMatchObject({ aa: .4, oh: .1 })
    expect(motionFaceTargets('cloud_idle', .7)).toMatchObject({ aa: 0, oh: 0 })
  })
  it('supports bilateral blink fallback and eases back to neutral after sleep', () => {
    const manager = new VRMExpressionManager()
    for (const name of ['blinkLeft', 'blinkRight', 'aa', 'oh']) manager.registerExpression(new VRMExpression(name))
    const animation = new AvatarFaceAnimation()
    for (let frame = 0; frame < 120; frame++) animation.update(manager, 'cloud_standby_sleep', 1, 1 / 60)
    expect(manager.getValue('blinkLeft')).toBeCloseTo(.98)
    expect(manager.getValue('blinkRight')).toBeCloseTo(.98)
    for (let frame = 0; frame < 120; frame++) animation.update(manager, 'cloud_idle', 1, 1 / 60)
    expect(manager.getValue('blinkLeft')).toBeLessThan(.01)
    expect(manager.getValue('aa')).toBe(0)
  })
})
