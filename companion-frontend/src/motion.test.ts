import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { smplAxisAngleToLocal } from './motion'

describe('SMPL → VRM retarget', () => {
  const identity = new THREE.Quaternion()

  it('passes a zero rotation through as the rest pose', () => {
    const q = smplAxisAngleToLocal([0, 0, 0], identity, true)
    expect(q.angleTo(identity)).toBeLessThan(1e-6)
  })

  it('keeps the rotation unchanged for VRM 1.0 (no flip)', () => {
    const q = smplAxisAngleToLocal([0, 0, 0.5], identity, false)
    const axis = new THREE.Vector3(0, 0, 1)
    expect(q.angleTo(new THREE.Quaternion().setFromAxisAngle(axis, 0.5))).toBeLessThan(1e-6)
  })

  it('mirrors the axis for VRM 0.x (180° yaw basis change)', () => {
    // 绕 +Z 的旋转经 180° 偏航共轭后，等价于绕 -Z 的同角度旋转
    const q = smplAxisAngleToLocal([0, 0, 0.5], identity, true)
    const expected = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), 0.5)
    expect(q.angleTo(expected)).toBeLessThan(1e-6)
    // 绕 Y（垂直轴）的旋转不受影响
    const qy = smplAxisAngleToLocal([0, 0.4, 0], identity, true)
    const expectedY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4)
    expect(qy.angleTo(expectedY)).toBeLessThan(1e-6)
  })

  it('applies the rotation on top of a non-identity rest pose', () => {
    const rest = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.3)
    const q = smplAxisAngleToLocal([0.2, 0, 0], rest, false)
    const expected = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2)
      .multiply(rest)
    expect(q.angleTo(expected)).toBeLessThan(1e-6)
  })
})
