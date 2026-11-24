import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { decodeTencentFbxSkeleton, TENCENT_SMPL_JOINTS } from './fbxMotion'

function fixture() {
  const root = new THREE.Group()
  for (const name of TENCENT_SMPL_JOINTS) {
    const bone = new THREE.Bone()
    bone.name = name
    if (name === 'Head') bone.position.y = 100
    if (name === 'L_Shoulder') bone.position.set(20, 60, 0)
    if (name === 'R_Shoulder') bone.position.set(-20, 60, 0)
    root.add(bone)
  }
  const tracks = TENCENT_SMPL_JOINTS.map(name => new THREE.QuaternionKeyframeTrack(
    name + '.quaternion', [0, 1 / 30, 2 / 30], name === 'R_Elbow'
      ? [0, 0, 0, 1, 0, Math.sin(.2), 0, Math.cos(.2), 0, Math.sin(.4), 0, Math.cos(.4)]
      : [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]))
  root.animations = [new THREE.AnimationClip('generated', -1, [
    ...tracks,
    new THREE.VectorKeyframeTrack('Pelvis.position', [0, 1 / 30, 2 / 30], [0, 100, 0, 1, 100, 0, 2, 100, 0]),
  ])]
  return root
}

describe('Tencent FBX canonicalization', () => {
  it('accepts exact duplicate FBX keys but rejects conflicting keys at the same time', () => {
    const root = fixture(), clip = root.animations[0]!
    clip.tracks[0] = new THREE.QuaternionKeyframeTrack('Pelvis.quaternion', [0, 0, 1 / 30, 2 / 30],
      [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1])
    expect(decodeTencentFbxSkeleton(root).poses).toHaveLength(3)
    clip.tracks[0]!.values[4] = .1
    expect(() => decodeTencentFbxSkeleton(root)).toThrow('轨道数据')
  })
  it('converts verified SMPL-H quaternion tracks into 52-joint axis-angle frames', () => {
    const data = decodeTencentFbxSkeleton(fixture())
    expect(data.fps).toBe(30)
    expect(data.poses).toHaveLength(3)
    expect(data.poses[2]).toHaveLength(156)
    expect(data.poses[2]![19 * 3 + 1]).toBeCloseTo(.8, 5)
    expect(data.trans[2]![0]).toBeCloseTo(.02)
    expect(data.trans[0]![1]).toBeCloseTo(1)
  })

  it('fails closed for missing bones, malformed tracks and incompatible rest pose', () => {
    const missing = fixture()
    missing.remove(missing.getObjectByName('Head')!)
    expect(() => decodeTencentFbxSkeleton(missing)).toThrow('SMPL-H')
    const invalid = fixture()
    invalid.animations[0]!.tracks[0]!.values[0] = NaN
    expect(() => decodeTencentFbxSkeleton(invalid)).toThrow('轨道数据')
    const rotated = fixture()
    rotated.getObjectByName('L_Hip')!.rotation.x = .4
    expect(() => decodeTencentFbxSkeleton(rotated)).toThrow('基准姿态')
  })

  it('rejects an export whose character-left/right orientation was mirrored', () => {
    const mirrored = fixture()
    mirrored.getObjectByName('L_Shoulder')!.position.x = -20
    expect(() => decodeTencentFbxSkeleton(mirrored)).toThrow('坐标方向')
  })
})
