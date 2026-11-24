import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { bellyReaction, bodyTouchRegion, privateTouchRegion, torsoTouchRegion } from './avatarBodyRegions'
import { AvatarClickInteraction } from './avatarInteraction'

describe('anatomical torso touch regions', () => {
  const hips = new THREE.Vector3(0, 1, 0)
  const chest = new THREE.Vector3(0, 1.4, 0)
  const neck = new THREE.Vector3(0, 1.6, 0)
  it('keeps belly separate from chest and groin', () => {
    expect(torsoTouchRegion(new THREE.Vector3(0, 1.02, .08), hips, chest, neck)).toBe('groin')
    for (const y of [1.08, 1.15, 1.25]) {
      expect(torsoTouchRegion(new THREE.Vector3(0, y, .1), hips, chest, neck)).toBe('belly')
    }
    expect(torsoTouchRegion(new THREE.Vector3(0, 1.4, .2), hips, chest, neck)).toBe('chest')
    expect(privateTouchRegion('belly')).toBe(false)
    expect(bellyReaction.text).toContain('肚子')
    expect(bellyReaction.clip).toBe('cloud_emotion_happy')
  })
  it('is invariant to model rotation, bend, scale and translation', () => {
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(2, 4, -1),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(.6, .7, .9)), new THREE.Vector3(2, 2, 2))
    for (const [y, expected] of [[1.02, 'groin'], [1.18, 'belly'], [1.4, 'chest']] as const) {
      expect(torsoTouchRegion(new THREE.Vector3(0, y, .1).applyMatrix4(transform),
        hips.clone().applyMatrix4(transform), chest.clone().applyMatrix4(transform),
        neck.clone().applyMatrix4(transform))).toBe(expected)
    }
  })
  it('does not treat the low chest-bone height on Momo as the breast boundary', () => {
    const pelvis = new THREE.Vector3(0, .901, 0)
    const ribs = new THREE.Vector3(0, 1.175, -.048)
    const neck = new THREE.Vector3(0, 1.442, -.03)
    expect(torsoTouchRegion(new THREE.Vector3(0, 1.17, -.11), pelvis, ribs, neck)).toBe('belly')
    expect(torsoTouchRegion(new THREE.Vector3(0, 1.34, -.23), pelvis, ribs, neck)).toBe('chest')
  })
  it('belly clicks reset private count and switching private parts starts over', () => {
    vi.useFakeTimers()
    try {
      let region = 'chest'
      const triple = vi.fn(), single = vi.fn()
      const clicks = new AvatarClickInteraction(() => region, single, vi.fn(), triple, 500, privateTouchRegion)
      const click = (value: string) => {
        region = value
        const event = { pointerId: 1, button: 0, clientX: 10, clientY: 10 }
        clicks.down(event); clicks.up(event); vi.advanceTimersByTime(510)
      }
      for (const value of ['chest', 'chest', 'belly', 'groin', 'groin', 'chest', 'chest']) click(value)
      expect(triple).not.toHaveBeenCalled()
      click('chest')
      expect(triple).toHaveBeenCalledExactlyOnceWith('chest')
      expect(single).toHaveBeenCalledWith('belly')
    } finally { vi.useRealTimers() }
  })
  it('recognizes thigh-weighted central pelvic clothing without claiming thighs or belly', () => {
    const pelvis = new THREE.Vector3(0, .901, .023)
    const ribs = new THREE.Vector3(0, 1.175, .071)
    const top = new THREE.Vector3(0, 1.442, .053)
    const left = new THREE.Vector3(.079, .965, .016), right = new THREE.Vector3(-.079, .965, .016)
    const classify = (region: string, point: THREE.Vector3) => bodyTouchRegion(region, point, pelvis, ribs, top, left, right)
    for (const y of [.88, .92, .96]) {
      expect(classify('leg', new THREE.Vector3(0, y, .1))).toBe('groin')
      expect(classify('leg', new THREE.Vector3(.1, y, .1))).toBe('leg')
    }
    expect(classify('torso', new THREE.Vector3(0, 1.06, .1))).toBe('belly')
    expect(classify('leg', new THREE.Vector3(0, .6, .1))).toBe('leg')
    expect(classify('hand', new THREE.Vector3(0, .92, .1))).toBe('hand')
    const transform = new THREE.Matrix4().compose(new THREE.Vector3(3, -2, 4),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(.4, 1.2, -.6)), new THREE.Vector3(2, 2, 2))
    const moved = [new THREE.Vector3(0, .92, .1), pelvis, ribs, top, left, right].map(v => v.clone().applyMatrix4(transform))
    expect(bodyTouchRegion('leg', moved[0], moved[1], moved[2], moved[3], moved[4], moved[5])).toBe('groin')
  })
})
