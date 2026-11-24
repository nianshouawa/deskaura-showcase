import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { VRMHumanoid, type VRMHumanBones } from '@pixiv/three-vrm'
import { AvatarMotionSafety, AvatarGroundAnchor, alignSwayFootTargets, boundedRootOffset, limitJointRotation, motionSafetyProfile, stabilizeBowLegs, stabilizeBowTargets } from './motionSafety'
import { prepareMotionTracks } from './motionPlayback'
import { smoothBone } from './motionPlayback'

function fixture(scale = 1, fingers = false) {
  const model = new THREE.Group()
  const nodes: Record<string, THREE.Object3D> = {}
  const add = (name: string, parent: string | undefined, x: number, y: number, z = 0) => {
    const node = new THREE.Bone(); node.name = name; node.position.set(x * scale, y * scale, z * scale)
    ;(parent ? nodes[parent]! : model).add(node); nodes[name] = node
  }
  add('hips', undefined, 0, 1); add('spine', 'hips', 0, .15); add('chest', 'spine', 0, .15)
  add('neck', 'chest', 0, .28); add('head', 'neck', 0, .1)
  for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
    add(side + 'Shoulder', 'chest', sign * .06, .2)
    add(side + 'UpperArm', side + 'Shoulder', sign * .12, 0)
    add(side + 'LowerArm', side + 'UpperArm', sign * .28, 0)
    add(side + 'Hand', side + 'LowerArm', sign * .26, 0)
    if (fingers) {
      add(side + 'MiddleProximal', side + 'Hand', sign * .06, 0)
      add(side + 'IndexProximal', side + 'Hand', sign * .06, 0, .02)
      add(side + 'LittleProximal', side + 'Hand', sign * .05, 0, -.02)
    }
    add(side + 'UpperLeg', 'hips', sign * .1, 0)
    add(side + 'LowerLeg', side + 'UpperLeg', 0, -.45)
    add(side + 'Foot', side + 'LowerLeg', 0, -.45)
    add(side + 'Toes', side + 'Foot', sign * .01, -.035, .09)
  }
  const rig = new VRMHumanoid(Object.fromEntries(Object.entries(nodes).map(([key, node]) => [key, { node }])) as VRMHumanBones)
  model.add(rig.normalizedHumanBonesRoot)
  return { model, rig }
}

describe('avatar-sized motion guards', () => {
  it('allows wide overhead standby stretches without widening quiet standby limits', () => {
    expect(motionSafetyProfile('cloud_standby_stretch')).toBe('gesture')
    expect(motionSafetyProfile('cloud_standby_sleep')).toBe('conversation')
  })
  it('supports an aliased quaternion goal without discarding the sampled rotation', () => {
    const rest = new THREE.Quaternion().setFromEuler(new THREE.Euler(.1, 0, -.1))
    const source = rest.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(.15, -.1, .1)))
    const separate = limitJointRotation('head', source, rest, false, 'conversation')
    const aliased = source.clone()
    limitJointRotation('head', aliased, rest, false, 'conversation', aliased)
    expect(aliased.angleTo(separate)).toBeLessThan(1e-6)
    expect(aliased.angleTo(rest)).toBeGreaterThan(.1)
  })
  it('preserves celebration hops, squat knees and bounded vertical root movement', () => {
    const knee = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(70))
    expect(limitJointRotation('leftLowerLeg', knee, new THREE.Quaternion(), false, 'celebrate').angleTo(knee)).toBeLessThan(1e-6)
    const jump = boundedRootOffset(new THREE.Vector3(2, 2, 2), 1.7, 'celebrate')
    expect(jump.y).toBeCloseTo(1.7 * .14)
    expect(Math.hypot(jump.x, jump.z)).toBeCloseTo(1.7 * .018)
    expect(motionSafetyProfile('cloud_emotion_tired')).toBe('fatigue')
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    let planted = 0
    internal.groundAnchor.apply = () => { planted++ }
    safety.apply(1 / 60, 'celebrate', 1, 'fluent')
    expect(planted).toBe(0)
    safety.apply(1 / 60, 'conversation', 1, 'fluent')
    expect(planted).toBe(1)
  })
  it('keeps a stationary foot centroid and floor height through pelvis bends, including scaled rotated parents', () => {
    const { model, rig } = fixture()
    model.rotation.y = 1.3
    model.position.set(2, 3, -4)
    model.scale.setScalar(.8)
    model.updateMatrixWorld(true)
    const anchor = new AvatarGroundAnchor(rig)
    const internal = anchor as any
    const reference = internal.reference.clone()
    const hips = rig.getNormalizedBoneNode('hips')!
    for (const weight of [0, .25, 1]) {
      hips.position.set(.06, .85, .08)
      hips.quaternion.setFromEuler(new THREE.Euler(.4, .1, .07))
      const previous = internal.measure()
      anchor.apply(weight)
      expect(internal.measure().distanceTo(previous.clone().lerp(reference, weight))).toBeLessThan(1e-6)
    }
  })
  it('separates coincident wrists and palm centers symmetrically without requiring crossed hands to change sides', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const arms = internal.arms
    // Geometry-only contact regression: the contact target builder must resolve
    // zero-distance pairs finitely, without a random normal that alternates.
    for (const arm of arms) {
      arm.hand.getWorldPosition = (target: THREE.Vector3) => target.set(0, 1.1, .35)
    }
    internal.prepareHandTargets('conversation')
    const [left, right] = arms.map((arm: any) => internal.handTargets.get(arm))
    expect(left.distanceTo(right)).toBeGreaterThan(safety.height * .034)
    expect(left.clone().add(right).multiplyScalar(.5).distanceTo(new THREE.Vector3(0, 1.1, .35))).toBeLessThan(1e-6)
    for (const value of [left, right]) expect(value.toArray().every(Number.isFinite)).toBe(true)
    // Widely crossed hands are a valid folded pose, not automatically forced to
    // their anatomical half of the torso just to satisfy a hand-side heuristic.
    arms[0].hand.getWorldPosition = (target: THREE.Vector3) => target.set(-.2, 1.1, .35)
    arms[1].hand.getWorldPosition = (target: THREE.Vector3) => target.set(.2, 1.1, .35)
    internal.prepareHandTargets('conversation')
    expect(internal.handTargets.size).toBe(0)
  })
  it('updates the skin bind inverse after a VRM0-style model rotation', () => {
    const { model, rig } = fixture()
    const geometry = new THREE.BufferGeometry()
    const vertices: number[] = []
    for (let i = 0; i < 120; i++) vertices.push((i % 2 ? 1 : -1) * .1, 1.3, .22 + (i % 3) * .005)
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(Array(120).fill([0, 0, 0, 0]).flat(), 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(Array(120).fill([1, 0, 0, 0]).flat(), 4))
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
    model.add(mesh)
    mesh.bind(new THREE.Skeleton([rig.getRawBoneNode('chest')! as THREE.Bone]))
    const initial = new AvatarMotionSafety(rig, model)
    model.rotation.y = Math.PI
    // Match production: world transforms may change without refreshing the
    // SkinnedMesh bindMatrixInverse. The constructor must refresh it itself.
    model.updateWorldMatrix(true, true)
    const rotated = new AvatarMotionSafety(rig, model)
    initial.slices.forEach((slice, i) => {
      expect(rotated.slices[i]!.z).toBeCloseTo(slice.z, 7)
      expect(rotated.slices[i]!.rx).toBeCloseTo(slice.rx, 7)
    })
  })
  it('preserves a natural lowered arm, not a scaled T-pose', () => {
    const arm = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI * 70 / 180)
    const result = limitJointRotation('leftUpperArm', arm, new THREE.Quaternion(), false, 'conversation')
    expect(result.angleTo(arm)).toBeLessThan(1e-6)
  })
  it('uses the same anatomical limits for flipped VRM0 and VRM1 rigs', () => {
    const rest = new THREE.Quaternion(), flip = new THREE.Quaternion(0, 1, 0, 0)
    for (const bone of ['head', 'neck', 'hips', 'leftHand', 'rightUpperArm', 'leftLowerArm']) {
      const input = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.8, 1.4, -.9))
      const expected = limitJointRotation(bone, input, rest, false, 'conversation')
      const flipped = input.clone().premultiply(flip).multiply(flip)
      const actual = limitJointRotation(bone, flipped, rest, true, 'conversation').premultiply(flip).multiply(flip)
      expect(actual.angleTo(expected)).toBeLessThan(1e-6)
    }
  })
  it('caps neck/head and torso independently of frame rate', () => {
    const input = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.3, .7, .5))
    const output = new THREE.Euler().setFromQuaternion(limitJointRotation('head', input, new THREE.Quaternion(), false, 'conversation'))
    expect(Math.abs(output.x)).toBeLessThanOrEqual(20 * Math.PI / 180 + 1e-6)
    expect(Math.abs(output.y)).toBeLessThanOrEqual(30 * Math.PI / 180 + 1e-6)
    expect(Math.abs(output.z)).toBeLessThanOrEqual(16 * Math.PI / 180 + 1e-6)
  })
  it('rescales and bounds root displacement even for tiny imported rigs', () => {
    for (const height of [.017, 1.7, 170]) {
      const offset = boundedRootOffset(new THREE.Vector3(20, -20, 20), height, 'conversation')
      expect(Math.hypot(offset.x, offset.z) / height).toBeCloseTo(.018)
      expect(offset.y / height).toBeCloseTo(-.025)
      expect(offset.z / offset.x).toBeCloseTo(1)
    }
    expect(motionSafetyProfile('cloud_bow')).toBe('bow')
    expect(motionSafetyProfile('cloud_emotion_happy')).toBe('conversation')
  })
  it('settles a large gesture into conversation without clamping the entry pose', () => {
    const rest = new THREE.Quaternion()
    const displayed = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.5)
    const previous = displayed.clone()
    const target = limitJointRotation('leftUpperArm', displayed, rest, false, 'conversation')
    expect(previous.angleTo(target)).toBeGreaterThan(.5)
    smoothBone(displayed, target, 'leftUpperArm', 1 / 60)
    expect(previous.angleTo(displayed)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(7) + 1e-6)
    for (let i = 0; i < 180; i++) smoothBone(displayed, target, 'leftUpperArm', 1 / 60)
    expect(displayed.angleTo(target)).toBeLessThan(1e-6)
  })
  it('accumulates a missing upperChest into both shoulder and neck chains', () => {
    const rest = new Map(['chest', 'leftShoulder', 'rightShoulder', 'neck', 'head'].map(name => [name, new THREE.Quaternion()]))
    const row = Array(156).fill(0); row[9 * 3] = .3; row[12 * 3 + 1] = .2
    const tracks = prepareMotionTracks([row, row], rest, false)
    const missing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .3)
    expect(tracks.get('leftShoulder')![0]!.angleTo(missing)).toBeLessThan(1e-6)
    expect(tracks.get('rightShoulder')![0]!.angleTo(missing)).toBeLessThan(1e-6)
    const neck = missing.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .2))
    expect(tracks.get('neck')![0]!.angleTo(neck)).toBeLessThan(1e-6)
    // head has a mapped neck parent, so it must not receive the missing bone twice.
    expect(tracks.get('head')![0]!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
  })
  it('uses body geometry size and keeps IK finite at folded/straight arms', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    expect(safety.slices.length).toBe(16)
    expect(safety.height).toBeGreaterThan(1.5)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    bone('leftUpperArm').quaternion.setFromEuler(new THREE.Euler(0, -.5, -1.3))
    bone('leftLowerArm').quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
    for (let i = 0; i < 20; i++) {
      safety.apply()
      for (const name of ['leftUpperArm', 'leftLowerArm', 'leftHand']) {
        expect(bone(name).quaternion.toArray().every(Number.isFinite)).toBe(true)
        expect(bone(name).quaternion.length()).toBeCloseTo(1)
      }
    }
  })
  it('keeps hands and forearms outside the avatar envelope without stretching bones', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const length = (a: string, b: string) => bone(a).getWorldPosition(new THREE.Vector3()).distanceTo(bone(b).getWorldPosition(new THREE.Vector3()))
    const upperLength = length('leftUpperArm', 'leftLowerArm')
    const lowerLength = length('leftLowerArm', 'leftHand')
    bone('leftUpperArm').quaternion.setFromEuler(new THREE.Euler(0, -.5, -1.3))
    bone('leftLowerArm').quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
    safety.apply()
    expect(length('leftUpperArm', 'leftLowerArm')).toBeCloseTo(upperLength, 8)
    expect(length('leftLowerArm', 'leftHand')).toBeCloseTo(lowerLength, 8)
    // The signed separation audit uses the same reference envelope, not a fake
    // zero-collision result that ignores the changed forearm pose.
    const internal = safety as any
    const elbow = bone('leftLowerArm').getWorldPosition(new THREE.Vector3())
    const hand = bone('leftHand').getWorldPosition(new THREE.Vector3())
    for (const weight of [0, .25, .5, .75, 1]) {
      expect(internal.penetration(elbow.clone().lerp(hand, weight))).toBeLessThan(.035)
    }
  })
  it('ignores tiny padded-clearance noise but still corrects meaningful torso overlap', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    safety.apply()
    const internal = safety as any
    const shape = internal.slice(1.3)
    const pointAt = (ratio: number) => new THREE.Vector3(shape.x, shape.y, shape.z + (shape.rz + internal.padding) * ratio)
      .applyMatrix4(internal.bodyToWorld)
    for (const ratio of [.986, .99, 1, 1.014]) {
      const point = pointAt(ratio), previous = point.clone()
      expect(internal.project(point, 1, true)).toBe(false)
      expect(point.distanceTo(previous)).toBe(0)
      expect(internal.penetration(point)).toBe(0)
    }
    const overlap = pointAt(.9)
    expect(internal.penetration(overlap)).toBeGreaterThan(.08)
    expect(internal.project(overlap, 1, true)).toBe(true)
    expect(internal.penetration(overlap)).toBe(0)
  })
  it('does not under-fit the front corners of a deep chest with a thin ellipse', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    for (const slice of safety.slices) if (Math.abs(slice.y - internal.torsoRest.y) < safety.height * .11) slice.rz = safety.height * .115
    safety.apply()
    const shape = internal.slice(internal.torsoRest.y)
    expect(internal.contactPower(shape)).toBe(4)
    const corner = new THREE.Vector3(shape.x + (shape.rx + internal.padding) * .7, shape.y,
      shape.z + (shape.rz + internal.padding) * .8).applyMatrix4(internal.bodyToWorld)
    // An ellipse would call sqrt(.7²+.8²)>1 clear even though an actual broad
    // chest front can occupy this corner. The rounded contact band catches it.
    expect(internal.penetration(corner)).toBeGreaterThan(.04)
    expect(internal.project(corner, 1, true)).toBe(true)
    expect(internal.penetration(corner)).toBe(0)
  })
  it('bounds corrected output on contact changes at 30/60/120 Hz', () => {
    for (const fps of [30, 60, 120]) {
      const { model, rig } = fixture()
      const safety = new AvatarMotionSafety(rig, model)
      const names = ['leftUpperArm', 'leftLowerArm', 'leftHand']
      const previous = new Map<string, THREE.Quaternion>()
      for (let frame = 0; frame < 30; frame++) {
        const upper = rig.getNormalizedBoneNode('leftUpperArm')!
        const lower = rig.getNormalizedBoneNode('leftLowerArm')!
        upper.quaternion.setFromEuler(new THREE.Euler(0, frame % 2 ? -.5 : .5, -1.3))
        lower.quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
        safety.apply(1 / fps)
        for (const name of names) {
          const q = rig.getNormalizedBoneNode(name as any)!.quaternion
          if (previous.has(name)) expect(q.angleTo(previous.get(name)!)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(name.endsWith('Hand') ? 180 : 240) / fps + 1e-6)
          previous.set(name, q.clone())
        }
      }
    }
  })
  it('settles a stationary contacting pose without frame-to-frame chatter', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    let previous = new THREE.Quaternion(), lastStep = 0
    for (let frame = 0; frame < 240; frame++) {
      rig.getNormalizedBoneNode('leftUpperArm')!.quaternion.setFromEuler(new THREE.Euler(0, -.5, -1.3))
      rig.getNormalizedBoneNode('leftLowerArm')!.quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
      rig.getNormalizedBoneNode('leftHand')!.quaternion.identity()
      safety.apply(1 / 60)
      const rotation = rig.getNormalizedBoneNode('leftLowerArm')!.quaternion
      lastStep = previous.angleTo(rotation)
      previous.copy(rotation)
      if (frame > 200) expect(lastStep).toBeLessThan(THREE.MathUtils.degToRad(.15))
    }
  })
  it('damps alternating thinking contact corrections with a stricter output speed', () => {
    expect(motionSafetyProfile('cloud_thinking_loop')).toBe('thinking')
    expect(motionSafetyProfile('cloud_think')).toBe('thinking')
    for (const fps of [30, 60, 120]) {
      const { model, rig } = fixture()
      const safety = new AvatarMotionSafety(rig, model)
      const previous = new Map<string, THREE.Quaternion>()
      for (let frame = 0; frame < 80; frame++) {
        rig.getNormalizedBoneNode('leftUpperArm')!.quaternion.setFromEuler(new THREE.Euler(0, frame % 2 ? -.5 : .5, -1.3))
        rig.getNormalizedBoneNode('leftLowerArm')!.quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
        safety.apply(1 / fps, 'thinking')
        for (const name of ['leftUpperArm', 'leftLowerArm', 'leftHand'] as const) {
          const q = rig.getNormalizedBoneNode(name)!.quaternion
          if (previous.has(name)) expect(q.angleTo(previous.get(name)!)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(name.endsWith('Hand') ? 90 : 120) / fps + 1e-6)
          previous.set(name, q.clone())
        }
      }
    }
  })
  it('uses a steady chin target without torso-plane searches or extreme wrist bends in fluent mode', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    bone('leftUpperArm').quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.3)
    bone('rightUpperArm').quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.3)
    const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
    const source = new Map(names.map(name => [name, bone(name).quaternion.clone()]))
    const previous = new Map<string, THREE.Quaternion>()
    // A large/deep torso must not trigger competing collision solutions under
    // the desktop's explicitly selected fluid policy. Clipping is permitted.
    internal.project = () => { throw new Error('Unexpected torso projection') }
    internal.penetration = () => { throw new Error('Unexpected collision search') }
    for (let frame = 0; frame < 300; frame++) {
      for (const [name, q] of source) bone(name).quaternion.copy(q)
      safety.apply(1 / 60, 'thinking', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
      for (const name of names) {
        const q = bone(name).quaternion
        if (previous.has(name)) expect(q.angleTo(previous.get(name)!)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(name.endsWith('Hand') ? 90 : 120) / 60 + 1e-6)
        previous.set(name, q.clone())
      }
      expect(bone('rightHand').quaternion.angleTo(source.get('rightHand')!)).toBeLessThan(1e-6)
    }
    const target = bone('head').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      .add(new THREE.Vector3(-safety.height * .018, -safety.height * .062, internal.forwardSign * safety.height * .065))
      .applyMatrix4(internal.bodyToWorld)
    expect(bone('rightHand').getWorldPosition(new THREE.Vector3()).distanceTo(target)).toBeLessThan(.002)
    const waist = new THREE.Vector3(safety.height * .115, internal.torsoRest.y - safety.height * .06,
      internal.torsoRest.z + internal.forwardSign * safety.height * .025).applyMatrix4(internal.bodyToWorld)
    expect(bone('leftHand').getWorldPosition(new THREE.Vector3()).distanceTo(waist)).toBeLessThan(.002)
    const elbow = bone('rightLowerArm').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
    expect(elbow.x).toBeLessThan(-safety.height * .08)
  })
  it('presents separated upward palms with bent elbows instead of crossed wrists', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
    const source = new Map(names.map(name => [name, bone(name).quaternion.clone()]))
    expect(motionSafetyProfile('cloud_emotion_neutral')).toBe('presenter')
    for (let frame = 0; frame < 300; frame++) {
      for (const [name, q] of source) bone(name).quaternion.copy(q)
      safety.apply(1 / 60, 'presenter', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    const left = bone('leftHand').getWorldPosition(new THREE.Vector3()), right = bone('rightHand').getWorldPosition(new THREE.Vector3())
    expect(left.x).toBeGreaterThan(safety.height * .14)
    expect(right.x).toBeLessThan(-safety.height * .14)
    expect(left.distanceTo(right)).toBeGreaterThan(safety.height * .3)
    for (const side of ['left', 'right']) {
      const wrist = bone(side + 'Hand').getWorldPosition(new THREE.Vector3())
      const shoulder = bone(side + 'UpperArm').getWorldPosition(new THREE.Vector3())
      expect(wrist.z - shoulder.z).toBeGreaterThan(safety.height * .16)
      expect(bone(side + 'LowerArm').quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.3)
      const arm = (safety as any).arms.find((a: any) => a.upper === bone(side + 'UpperArm'))
      const world = bone(side + 'Hand').getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
      const across = new THREE.Vector3(0, 1, 0).applyQuaternion(world)
      const finger = new THREE.Vector3(1, 0, 0).applyQuaternion(world)
      const palm = finger.cross(across).multiplyScalar(side === 'left' ? 1 : -1)
      expect(palm.y).toBeGreaterThan(.65)
    }
  })
  it('settles requested semantic hand poses without collision-plane hunting or output snaps', () => {
    for (const [id, profile] of [['cloud_emotion_nervous', 'nervous'], ['cloud_emotion_shy', 'shy'], ['cloud_emotion_affectionate', 'affectionate']] as const) {
      expect(motionSafetyProfile(id)).toBe(profile)
      const { model, rig } = fixture(1, true)
      const safety = new AvatarMotionSafety(rig, model), internal = safety as any
      const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
      // Deliberately different source poses must settle into the requested
      // abdominal hand stack, chest fists and cheek paws, without contact search.
      bone('leftUpperArm').quaternion.setFromEuler(new THREE.Euler(.1, -.1, -1.2))
      bone('rightUpperArm').quaternion.setFromEuler(new THREE.Euler(.1, .1, 1.2))
      bone('leftLowerArm').quaternion.setFromEuler(new THREE.Euler(.08, -.2, -.15))
      bone('rightLowerArm').quaternion.setFromEuler(new THREE.Euler(.08, .2, .15))
      const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      const source = new Map(names.map(name => [name, bone(name).quaternion.clone()]))
      internal.project = () => { throw new Error('Semantic replies must not hunt chest collision planes') }
      internal.penetration = () => { throw new Error('Semantic replies must not hunt chest collision planes') }
      const previous = new Map<string, THREE.Quaternion>()
      for (let frame = 0; frame < 240; frame++) {
        for (const [name, value] of source) bone(name).quaternion.copy(value)
        safety.apply(1 / 60, profile, THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
        for (const name of names) {
          const value = bone(name).quaternion
          if (previous.has(name)) expect(value.angleTo(previous.get(name)!)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(name.endsWith('Hand') ? 180 : 240) / 60 + 1e-6)
          previous.set(name, value.clone())
        }
      }
      const left = bone('leftHand').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      const right = bone('rightHand').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      if (profile === 'nervous') {
        expect(left.y).toBeGreaterThan(right.y + safety.height * .01)
        expect(Math.abs(left.x - right.x)).toBeLessThan(safety.height * .07)
        expect(left.y).toBeLessThan(internal.torsoRest.y - safety.height * .08)
      } else if (profile === 'shy') {
        expect(left.y).toBeGreaterThan(internal.torsoRest.y + safety.height * .04)
        expect(Math.abs(left.x - right.x)).toBeGreaterThan(safety.height * .1)
      } else {
        const head = bone('head').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
        expect(Math.abs(left.y - head.y)).toBeLessThan(safety.height * .06)
        expect(Math.abs(right.y - head.y)).toBeLessThan(safety.height * .06)
        expect(left.x).toBeGreaterThan(head.x)
        expect(right.x).toBeLessThan(head.x)
      }
    }
  })
  it('places the thinking left hand on the waist but preserves the pointing support arm', () => {
    for (const profile of ['thinking', 'point'] as const) {
      const { model, rig } = fixture(1, true)
      const safety = new AvatarMotionSafety(rig, model), internal = safety as any
      const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
      const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      const source = new Map(names.map(name => [name, bone(name).quaternion.clone()]))
      for (let frame = 0; frame < 300; frame++) {
        for (const [name, value] of source) bone(name).quaternion.copy(value)
        safety.apply(1 / 60, profile, THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
      }
      if (profile === 'thinking') {
        const arm = internal.arms[0]
        const frame = bone('leftHand').getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
        const finger = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
        const across = new THREE.Vector3(0, 1, 0).applyQuaternion(frame)
        expect(finger.cross(across).toArray().every(Number.isFinite)).toBe(true)
        const supportingWrist = bone('leftHand').getWorldPosition(new THREE.Vector3())
        const supportingElbow = bone('leftLowerArm').getWorldPosition(new THREE.Vector3())
        expect(supportingWrist.x).toBeCloseTo(safety.height * .115, 3)
        expect(supportingElbow.x).toBeGreaterThan(supportingWrist.x)
        const elbow = bone('rightLowerArm').getWorldPosition(new THREE.Vector3())
        const shoulder = bone('rightUpperArm').getWorldPosition(new THREE.Vector3())
        expect(elbow.y).toBeLessThan(shoulder.y - safety.height * .005)
      } else {
        expect(motionSafetyProfile('cloud_point')).toBe('point')
        for (const name of ['leftUpperArm', 'leftLowerArm', 'leftHand']) {
          expect(bone(name).quaternion.angleTo(source.get(name)!)).toBeLessThan(1e-6)
        }
      }
    }
  })
  it.each([false, true])('relaxes only the thinking right wrist while retaining the solved joints on flipped=%s', flipped => {
    const { model, rig } = fixture(1, true)
    if (flipped) {
      const flip = new THREE.Quaternion(0, 1, 0, 0)
      for (const bone of Object.values(rig.normalizedHumanBones)) bone.node.position.applyQuaternion(flip)
    }
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const right = internal.arms.find((arm: any) => arm.side !== internal.forwardSign)
    const names = Object.keys(rig.normalizedHumanBones).filter(name => name !== 'rightHand')
    const rotations = new Map<string, THREE.Quaternion>()
    let originalWrist = new THREE.Quaternion()
    const orient = internal.orientSemanticPalm.bind(internal)
    internal.orientSemanticPalm = (arm: any, ...args: unknown[]) => {
      orient(arm, ...args)
      if (arm !== right) return
      originalWrist.copy(arm.hand.quaternion)
      for (const name of names) rotations.set(name, rig.getNormalizedBoneNode(name as any)!.quaternion.clone())
    }
    safety.apply(1 / 60, 'thinking', 1, 'fluent')
    expect(originalWrist.angleTo(right.handRest)).toBeGreaterThan(.05)
    expect(right.hand.quaternion.angleTo(right.handRest)).toBeLessThan(1e-6)
    for (const name of names) {
      expect(rig.getNormalizedBoneNode(name as any)!.quaternion.angleTo(rotations.get(name)!)).toBeLessThan(1e-6)
    }
    const forearm = right.hand.position.clone().normalize().applyQuaternion(right.lower.getWorldQuaternion(new THREE.Quaternion()))
    const hand = right.hand.position.clone().normalize().applyQuaternion(right.hand.getWorldQuaternion(new THREE.Quaternion()))
    expect(hand.dot(forearm)).toBeGreaterThan(.999)
  })
  it('solves semantic elbows in one anatomical hinge plane rather than independent shortest arcs', () => {
    for (const flipped of [false, true]) {
      const { model, rig } = fixture(1, true)
      if (flipped) {
        // VRM0 normalized rest uses a 180-degree basis change, including the
        // hand/finger offsets, not merely a rotated scene parent.
        const flip = new THREE.Quaternion(0, 1, 0, 0)
        for (const bone of Object.values(rig.normalizedHumanBones)) bone.node.position.applyQuaternion(flip)
      }
      const safety = new AvatarMotionSafety(rig, model), internal = safety as any
      internal.bodyToWorld.identity(); internal.inverseTorso.identity()
      for (const arm of internal.arms) {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const elbow = shoulder.clone().add(new THREE.Vector3(arm.side * .15, -.19, .1))
        const wrist = elbow.clone().add(new THREE.Vector3(-arm.side * .07, .14, .18))
        // solveArm only changes directions; the runtime two-bone geometry
        // already puts these points exactly at the avatar's segment lengths.
        internal.solveArm(arm, elbow, wrist)
        const upper = arm.lower.getWorldPosition(new THREE.Vector3()).sub(shoulder).normalize()
        const lower = arm.hand.getWorldPosition(new THREE.Vector3()).sub(arm.lower.getWorldPosition(new THREE.Vector3())).normalize()
        const normal = upper.clone().cross(lower).normalize()
        const hinge = new THREE.Vector3(0, arm.side === internal.forwardSign ? -1 : 1, 0)
        const upperAxis = hinge.clone().applyQuaternion(arm.upper.getWorldQuaternion(new THREE.Quaternion()))
        const lowerAxis = hinge.clone().applyQuaternion(arm.lower.getWorldQuaternion(new THREE.Quaternion()))
        expect(upperAxis.dot(normal)).toBeGreaterThan(.999)
        expect(lowerAxis.dot(normal)).toBeGreaterThan(.999)
        const before = arm.lower.quaternion.clone()
        internal.orientSemanticPalm(arm, new THREE.Vector3(arm.side * .1, .2, 1), new THREE.Vector3(arm.side, 0, 0), 55, 35)
        expect(before.angleTo(arm.lower.quaternion)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(45) + 1e-6)
      }
    }
  })
  it('lets both tired arms hang with gravity instead of folding into a bent chest', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
    const source = new Map(names.map(name => [name, bone(name).quaternion.clone()]))
    internal.project = () => { throw new Error('Tired arms must not hunt chest planes') }
    for (let frame = 0; frame < 300; frame++) {
      bone('spine').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), .2)
      bone('chest').quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), .24)
      for (const [name, value] of source) bone(name).quaternion.copy(value)
      safety.apply(1 / 60, 'fatigue', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const wrist = bone(side + 'Hand').getWorldPosition(new THREE.Vector3())
      const shoulder = bone(side + 'UpperArm').getWorldPosition(new THREE.Vector3())
      expect(wrist.y).toBeLessThan(shoulder.y - .45)
      expect(wrist.x * sign).toBeGreaterThan(.16)
      expect(Math.abs(wrist.z - shoulder.z)).toBeLessThan(.06)
      const elbow = bone(side + 'LowerArm').getWorldPosition(new THREE.Vector3())
      const upper = elbow.clone().sub(shoulder).normalize(), lower = wrist.clone().sub(elbow).normalize()
      expect(upper.dot(lower)).toBeGreaterThan(.995)
    }
  })
  it('moves the waving left wrist forward away from the back of the hip', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const source = new Map(['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      .map(name => [name, bone(name).quaternion.clone()]))
    for (let frame = 0; frame < 300; frame++) {
      for (const [name, rotation] of source) bone(name).quaternion.copy(rotation)
      safety.apply(1 / 60, 'wave', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    const wrist = bone('leftHand').getWorldPosition(new THREE.Vector3())
    const shoulder = bone('leftUpperArm').getWorldPosition(new THREE.Vector3())
    expect(wrist.z - shoulder.z).toBeGreaterThan(safety.height * .075)
    expect(wrist.x - shoulder.x).toBeGreaterThan(safety.height * .06)
  })
  it('lowers the pointing wrist slightly below shoulder level', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const source = new Map(['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      .map(name => [name, bone(name).quaternion.clone()]))
    for (let frame = 0; frame < 300; frame++) {
      for (const [name, rotation] of source) bone(name).quaternion.copy(rotation)
      safety.apply(1 / 60, 'point', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    const wrist = bone('rightHand').getWorldPosition(new THREE.Vector3())
    const shoulder = bone('rightUpperArm').getWorldPosition(new THREE.Vector3())
    expect(wrist.y).toBeLessThan(shoulder.y - safety.height * .06)
    expect(wrist.y).toBeGreaterThan(shoulder.y - safety.height * .21)
  })
  it('places angry hands on both waist sides with elbows out', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const source = new Map(['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      .map(name => [name, bone(name).quaternion.clone()]))
    for (let frame = 0; frame < 300; frame++) {
      for (const [name, rotation] of source) bone(name).quaternion.copy(rotation)
      safety.apply(1 / 60, 'angry', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const hand = bone(side + 'Hand').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      const elbow = bone(side + 'LowerArm').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      expect(hand.x * sign).toBeCloseTo(safety.height * .115, 3)
      expect(hand.y).toBeCloseTo(internal.torsoRest.y - safety.height * .06, 3)
      expect(elbow.x * sign).toBeGreaterThan(hand.x * sign + safety.height * .04)
    }
  })
  it('extends disgusted arms nearly straight forward with separated outward palms', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const source = new Map(internal.arms.flatMap((arm: any) =>
      [arm.upper, arm.lower, arm.hand].map(node => [node, node.quaternion.clone()])))
    for (let frame = 0; frame < 300; frame++) {
      for (const [node, rotation] of source) (node as THREE.Object3D).quaternion.copy(rotation as THREE.Quaternion)
      safety.apply(1 / 60, 'disgusted', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
    }
    for (const arm of internal.arms) {
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3())
      const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
      expect(wrist.z - shoulder.z).toBeGreaterThan((arm.length1 + arm.length2) * .97)
      expect(elbow.clone().sub(shoulder).normalize().dot(wrist.clone().sub(elbow).normalize())).toBeGreaterThan(.995)
      const frame = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
      const normal = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
        .cross(new THREE.Vector3(0, 1, 0).applyQuaternion(frame)).multiplyScalar(arm.side / internal.forwardSign)
      expect(normal.z).toBeGreaterThan(.6)
    }
  })
  it('keeps affectionate fists beside both cheeks and continuously changes wrist pose', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const source = new Map(internal.arms.flatMap((arm: any) =>
      [arm.upper, arm.lower, arm.hand].map(node => [node, node.quaternion.clone()])))
    let first: THREE.Quaternion | undefined, largest = 0
    for (let frame = 0; frame < 420; frame++) {
      for (const [node, rotation] of source) (node as THREE.Object3D).quaternion.copy(rotation as THREE.Quaternion)
      safety.apply(1 / 60, 'affectionate', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
      if (frame === 240) first = internal.arms[0].hand.quaternion.clone()
      if (first) largest = Math.max(largest, first.angleTo(internal.arms[0].hand.quaternion))
    }
    expect(largest).toBeGreaterThan(.1)
    const head = rig.getNormalizedBoneNode('head')!.getWorldPosition(new THREE.Vector3())
    for (const arm of internal.arms) {
      const hand = arm.hand.getWorldPosition(new THREE.Vector3())
      expect(Math.abs(hand.y - head.y)).toBeLessThan(safety.height * .06)
      expect((hand.x - head.x) * arm.side).toBeGreaterThan(safety.height * .08)
      const frame = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
      const normal = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
        .cross(new THREE.Vector3(0, 1, 0).applyQuaternion(frame)).multiplyScalar(arm.side / internal.forwardSign)
      expect(normal.z).toBeGreaterThan(.7)
    }
  })
  it.each([false, true])('keeps both palms forward with anatomical handedness on flipped=%s rigs', flipped => {
    for (const profile of ['disgusted', 'affectionate'] as const) {
      const { model, rig } = fixture(1, true)
      if (flipped) {
        const basis = new THREE.Quaternion(0, 1, 0, 0)
        for (const bone of Object.values(rig.normalizedHumanBones)) bone.node.position.applyQuaternion(basis)
        model.rotation.y = Math.PI
      }
      const safety = new AvatarMotionSafety(rig, model), internal = safety as any
      const source = new Map<THREE.Object3D, THREE.Quaternion>(internal.arms.flatMap((arm: any) =>
        [arm.upper, arm.lower, arm.hand].map(node => [node, node.quaternion.clone()])))
      let minimum = 1
      for (let frame = 0; frame < 480; frame++) {
        for (const [node, rotation] of source) node.quaternion.copy(rotation)
        safety.apply(1 / 60, profile, THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
        if (frame < 120) continue
        const forward = new THREE.Vector3(0, 0, internal.forwardSign).transformDirection(internal.bodyToWorld)
        for (const arm of internal.arms) {
          const handFrame = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
          const palm = new THREE.Vector3(1, 0, 0).applyQuaternion(handFrame)
            .cross(new THREE.Vector3(0, 1, 0).applyQuaternion(handFrame))
            .multiplyScalar(arm.side / internal.forwardSign).normalize()
          minimum = Math.min(minimum, palm.dot(forward))
        }
      }
      expect(minimum).toBeGreaterThan(.8)
    }
  })
  it.each([false, true])('restores the earlier abdominal stack with the left hand above the right on flipped=%s', flipped => {
    const { model, rig } = fixture(1, true)
    if (flipped) {
      const basis = new THREE.Quaternion(0, 1, 0, 0)
      for (const bone of Object.values(rig.normalizedHumanBones)) bone.node.position.applyQuaternion(basis)
      model.rotation.y = Math.PI
    }
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const source = new Map<THREE.Object3D, THREE.Quaternion>(internal.arms.flatMap((arm: any) =>
      [arm.upper, arm.lower, arm.hand].map(node => [node, node.quaternion.clone()])))
    for (let frame = 0; frame < 360; frame++) {
      for (const [node, rotation] of source) node.quaternion.copy(rotation)
      safety.apply(1 / 60, 'nervous', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
      if (frame < 120) continue
      const inward = new THREE.Vector3(0, 0, -internal.forwardSign).transformDirection(internal.bodyToWorld)
      for (const arm of internal.arms) {
        const handFrame = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
        const palm = new THREE.Vector3(1, 0, 0).applyQuaternion(handFrame)
          .cross(new THREE.Vector3(0, 1, 0).applyQuaternion(handFrame))
          .multiplyScalar(arm.side / internal.forwardSign).normalize()
        expect(palm.dot(inward)).toBeGreaterThan(.85)
      }
    }
    const left = rig.getNormalizedBoneNode('leftHand')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
    const right = rig.getNormalizedBoneNode('rightHand')!.getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
    expect(left.y).toBeGreaterThan(right.y + safety.height * .01)
    expect(Math.abs(right.x - left.x)).toBeLessThan(safety.height * .07)
    expect(left.y).toBeLessThan(internal.torsoRest.y - safety.height * .08)
    expect(left.y).toBeCloseTo(internal.torsoRest.y - safety.height * .084, 3)
    expect(right.y).toBeCloseTo(internal.torsoRest.y - safety.height * .10, 3)
  })
  it('corrects sway thigh outward rotation while retaining the narrowed stance', () => {
    const basis = new THREE.Quaternion(0, 1, 0, 0)
    for (const flip of [false, true]) for (const bone of ['leftUpperLeg', 'rightUpperLeg']) {
      const source = new THREE.Quaternion().setFromEuler(new THREE.Euler(.12, .3, bone.startsWith('left') ? .2 : -.2))
      if (flip) source.premultiply(basis).multiply(basis)
      const result = limitJointRotation(bone, source, new THREE.Quaternion(), flip, 'turning')
      if (flip) result.premultiply(basis).multiply(basis)
      const angles = new THREE.Euler().setFromQuaternion(result)
      expect(Math.abs(angles.z)).toBeCloseTo(THREE.MathUtils.degToRad(4), 5)
      expect(angles.y).toBeCloseTo(THREE.MathUtils.degToRad(3), 5)
      expect(angles.x).toBeCloseTo(.12, 5)
    }
  })
  it.each([false, true])('aligns both sway toe directions with the pelvis without changing leg spacing on flipped=%s', flipped => {
    const { rig } = fixture()
    if (flipped) {
      const basis = new THREE.Quaternion(0, 1, 0, 0)
      for (const bone of Object.values(rig.normalizedHumanBones)) bone.node.position.applyQuaternion(basis)
    }
    const targets = new Map(Object.entries(rig.normalizedHumanBones).map(([name, bone]) =>
      [name, bone.node.quaternion.clone()]))
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      targets.get(`${side}UpperLeg`)!.setFromEuler(new THREE.Euler(.15, sign * .2, sign * .1))
      targets.get(`${side}LowerLeg`)!.setFromEuler(new THREE.Euler(.2, sign * .04, .02))
      targets.get(`${side}Foot`)!.setFromEuler(new THREE.Euler(.1, sign * .4, .02))
    }
    const originals = new Map([...targets].map(([name, q]) => [name, q.clone()]))
    alignSwayFootTargets(targets, rig)
    for (const side of ['left', 'right'] as const) {
      const footRotation = targets.get(`${side}UpperLeg`)!.clone().multiply(targets.get(`${side}LowerLeg`)!)
        .multiply(targets.get(`${side}Foot`)!)
      const direction = rig.getNormalizedBoneNode(`${side}Toes`)!.position.clone().applyQuaternion(footRotation)
      expect(Math.abs(direction.x)).toBeLessThan(1e-6)
      expect(direction.z * (flipped ? -1 : 1)).toBeGreaterThan(0)
    }
    for (const [name, q] of targets) if (!name.endsWith('Foot')) expect(q.angleTo(originals.get(name)!)).toBeLessThan(1e-6)
  })
  it('separates converging palm proxies even when the wrist joints are apart, without torso projection', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const wrists = [new THREE.Vector3(.07, 1.1, .4), new THREE.Vector3(-.07, 1.1, .4)]
    // Outstretched fingers meet at the middle even though the wrists themselves
    // are comfortably separated. A wrist-only test missed these intersections.
    for (const side of ['left', 'right']) {
      rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!.getWorldPosition = (v: THREE.Vector3) => v.set(0, 1.1, .4)
    }
    internal.project = () => { throw new Error('Unexpected torso collision search') }
    const goals = internal.fluentHandSeparation(wrists) as THREE.Vector3[]
    expect(goals[0]!.x).toBeGreaterThan(wrists[0]!.x)
    expect(goals[1]!.x).toBeLessThan(wrists[1]!.x)
    expect(goals[0]!.clone().add(goals[1]!).multiplyScalar(.5).distanceTo(new THREE.Vector3(0, 1.1, .4))).toBeLessThan(1e-6)
    expect(wrists[0]!.distanceTo(wrists[1]!)).toBeCloseTo(.14)
  })
  it('does not swivel the elbow plane before a fluent semantic entry has started', () => {
    for (const profile of ['thinking', 'clap'] as const) {
      const { model, rig } = fixture(1, true)
      const safety = new AvatarMotionSafety(rig, model)
      const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
      const names = ['leftUpperArm', 'leftLowerArm', 'leftHand', 'rightUpperArm', 'rightLowerArm', 'rightHand']
      bone('rightUpperArm').quaternion.setFromEuler(new THREE.Euler(.3, -.6, 1.2))
      bone('rightLowerArm').quaternion.setFromEuler(new THREE.Euler(.2, .4, -.6))
      bone('rightHand').quaternion.setFromEuler(new THREE.Euler(.2, -.1, .1))
      const before = names.map(name => bone(name).quaternion.clone())
      safety.apply(1 / 60, profile, 0, 'fluent')
      for (const [i, name] of names.entries()) expect(bone(name).quaternion.angleTo(before[i]!)).toBeLessThan(1e-6)
    }
  })
  it('preserves an ordinary overlapping source trajectory instead of forcing chest avoidance in fluent mode', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model), internal = safety as any
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    bone('leftUpperArm').quaternion.setFromEuler(new THREE.Euler(0, -.5, -1.3))
    bone('leftLowerArm').quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
    const before = ['leftUpperArm', 'leftLowerArm', 'leftHand'].map(name => bone(name).quaternion.clone())
    internal.project = () => { throw new Error('Unexpected torso projection') }
    internal.prepareHandTargets = () => { throw new Error('Unexpected clearance target') }
    safety.apply(1 / 60, 'conversation', 1, 'fluent')
    for (const [i, name] of ['leftUpperArm', 'leftLowerArm', 'leftHand'].entries()) expect(bone(name).quaternion.angleTo(before[i]!)).toBeLessThan(1e-6)
  })
  it('filters tiny contact-plane noise while following a slow intended arm movement', () => {
    for (const fps of [30, 60, 120]) {
      const { model, rig } = fixture()
      const safety = new AvatarMotionSafety(rig, model)
      const internal = safety as any, arm = internal.arms[0]
      const axis = new THREE.Vector3(0, 1, 0)
      let previous = new THREE.Quaternion(), maxStep = 0
      const sourceWrist = arm.hand.getWorldPosition(new THREE.Vector3())
      const sourceElbow = arm.lower.getWorldPosition(new THREE.Vector3())
      for (let frame = 0; frame < fps * 2; frame++) {
        const intentional = frame / fps * THREE.MathUtils.degToRad(4)
        arm.lower.quaternion.setFromAxisAngle(axis, intentional + (frame % 2 ? 1 : -1) * THREE.MathUtils.degToRad(.7))
        internal.remember(arm, 1 / fps, sourceWrist, sourceElbow, 'thinking')
        if (frame > fps) maxStep = Math.max(maxStep, previous.angleTo(arm.lower.quaternion))
        previous.copy(arm.lower.quaternion)
      }
      expect(maxStep).toBeLessThan(THREE.MathUtils.degToRad(4 / fps + .14))
      expect(previous.angleTo(new THREE.Quaternion())).toBeGreaterThan(THREE.MathUtils.degToRad(6))
    }
  })
  it('preserves a celebration lift instead of clipping it to conversation range', () => {
    const input = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), .8)
    const rest = new THREE.Quaternion()
    const gesture = limitJointRotation('leftUpperArm', input, rest, false, motionSafetyProfile('cloud_celebrate'))
    const reply = limitJointRotation('leftUpperArm', input, rest, false, 'conversation')
    expect(gesture.angleTo(input)).toBeLessThan(.001)
    expect(reply.angleTo(input)).toBeGreaterThan(.3)
    expect(motionSafetyProfile('cloud_clap')).toBe('clap')
    expect(motionSafetyProfile('cloud_nod')).toBe('nod')
  })
  it('opens raised cheering arms as whole chains without twisting elbows or wrists', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    safety.apply(1 / 60, 'celebrate', 0, 'fluent')
    const internal = safety as any
    for (const arm of internal.arms) {
      arm.upper.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), arm.side * 1.35)
      arm.lower.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), arm.side * .12)
      arm.hand.quaternion.setFromEuler(new THREE.Euler(.1, .06, -.04))
      arm.upper.updateWorldMatrix(true, true)
    }
    const before = internal.arms.map((arm: any) => ({
      lower: arm.lower.quaternion.clone(), hand: arm.hand.quaternion.clone(),
      wrist: arm.hand.getWorldPosition(new THREE.Vector3()), upper: arm.upper.quaternion.clone(),
    }))
    internal.spreadRaisedCelebrationArms(1)
    for (const [i, arm] of internal.arms.entries()) {
      const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
      expect(wrist.x * arm.side).toBeGreaterThan(before[i].wrist.x * arm.side)
      expect(arm.lower.quaternion.angleTo(before[i].lower)).toBeLessThan(1e-6)
      expect(arm.hand.quaternion.angleTo(before[i].hand)).toBeLessThan(1e-6)
      expect(arm.upper.quaternion.angleTo(before[i].upper)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(32) + 1e-6)
    }
  })
  it('counter-rotates legs during a waist bow without bending the knees', () => {
    const { rig } = fixture()
    const rest = new Map(Object.entries(rig.normalizedHumanBones).map(([name, bone]) => [name, bone.node.quaternion.clone()]))
    rig.getNormalizedBoneNode('hips')!.quaternion.setFromEuler(new THREE.Euler(.5, .05, -.03))
    rig.getNormalizedBoneNode('leftLowerLeg')!.quaternion.setFromEuler(new THREE.Euler(.4, 0, 0))
    stabilizeBowLegs(rig, rest)
    rig.normalizedHumanBonesRoot.updateWorldMatrix(true, true)
    expect(rig.getNormalizedBoneNode('leftUpperLeg')!.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    expect(rig.getNormalizedBoneNode('leftLowerLeg')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    expect(boundedRootOffset(new THREE.Vector3(0, -.4, .3), 1.7, 'bow').length()).toBe(0)
  })
  it('blends bow leg compensation from the displayed stance without a first-frame snap at 30/60/120 Hz', () => {
    for (const fps of [30, 60, 120]) {
      const { rig } = fixture()
      const names = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot']
      const rest = new Map(names.map(name => [name, rig.getNormalizedBoneNode(name as any)!.quaternion.clone()]))
      const entry = new Map([...rest].map(([name, value]) => [name, value.clone()]))
      entry.get('leftUpperLeg')!.setFromEuler(new THREE.Euler(-.12, 0, -.08))
      entry.get('rightUpperLeg')!.setFromEuler(new THREE.Euler(-.12, 0, .08))
      entry.get('leftLowerLeg')!.setFromEuler(new THREE.Euler(.2, 0, 0))
      entry.get('rightLowerLeg')!.setFromEuler(new THREE.Euler(.2, 0, 0))
      const filtered = new Map([...entry].map(([name, value]) => [name, value.clone()]))
      const targets = new Map([...rest].map(([name, value]) => [name, value.clone()]))
      for (let frame = 0; frame <= fps * 2; frame++) {
        targets.get('hips')!.setFromEuler(new THREE.Euler(.5, 0, 0))
        // A very wide/squatting generated pose must not leak into the bow goal.
        targets.get('leftUpperLeg')!.setFromEuler(new THREE.Euler(-.6, 0, -.5))
        targets.get('rightUpperLeg')!.setFromEuler(new THREE.Euler(-.6, 0, .5))
        targets.get('leftLowerLeg')!.setFromEuler(new THREE.Euler(.7, 0, 0))
        targets.get('rightLowerLeg')!.setFromEuler(new THREE.Euler(.7, 0, 0))
        stabilizeBowTargets(targets, rest)
        const blend = THREE.MathUtils.smoothstep(frame / fps, 0, .8)
        for (const name of names) {
          const current = filtered.get(name)!, before = current.clone()
          const goal = targets.get(name)!.clone().slerp(entry.get(name)!, 1 - blend)
          smoothBone(current, goal, name, 1 / fps)
          expect(current.angleTo(before)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(180) / fps + 1e-6)
          if (!frame) expect(current.angleTo(entry.get(name)!)).toBeLessThan(1e-6)
          rig.getNormalizedBoneNode(name as any)!.quaternion.copy(current)
        }
        for (const name of ['leftUpperLeg', 'rightUpperLeg']) {
          expect(Math.abs(new THREE.Euler().setFromQuaternion(filtered.get(name)!).z)).toBeLessThanOrEqual(.081)
        }
      }
      rig.normalizedHumanBonesRoot.updateWorldMatrix(true, true)
      for (const side of ['left', 'right'] as const) {
        expect(rig.getNormalizedBoneNode(`${side}UpperLeg`)!.getWorldQuaternion(new THREE.Quaternion()).angleTo(new THREE.Quaternion())).toBeLessThan(.001)
        expect(rig.getNormalizedBoneNode(`${side}LowerLeg`)!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.001)
      }
    }
  })
  it('preserves a generated step and coordinated counter-bend instead of a tipping torso', () => {
    const profile = motionSafetyProfile('7b00d668-3d7c-4815-9f19-6258a154c538')
    expect(profile).toBe('generated')
    const bend = new THREE.Quaternion().setFromEuler(new THREE.Euler(.55, .1, .04))
    const compensation = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.55, -.1, -.04))
    expect(limitJointRotation('hips', bend, new THREE.Quaternion(), false, profile).angleTo(bend)).toBeLessThan(1e-6)
    expect(limitJointRotation('leftUpperLeg', compensation, new THREE.Quaternion(), false, profile).angleTo(compensation)).toBeLessThan(1e-6)
    const source = new THREE.Vector3(.08, -.04, .16)
    const offset = boundedRootOffset(source.clone(), 1.7, profile)
    expect(offset.distanceTo(source)).toBeLessThan(1e-6)
    const capped = boundedRootOffset(new THREE.Vector3(5, 0, 2), 1.7, profile)
    expect(Math.hypot(capped.x, capped.z)).toBeCloseTo(1.7 * .12)
    expect(capped.x / capped.z).toBeCloseTo(2.5)
  })
  it('suppresses bow sideways twisting while retaining forward waist flexion', () => {
    const input = new THREE.Quaternion().setFromEuler(new THREE.Euler(.5, .3, .25))
    const output = new THREE.Euler().setFromQuaternion(limitJointRotation('hips', input, new THREE.Quaternion(), false, 'bow'))
    expect(output.x).toBeCloseTo(.5)
    expect(Math.abs(output.y)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(3) + 1e-6)
    expect(Math.abs(output.z)).toBeLessThanOrEqual(THREE.MathUtils.degToRad(3) + 1e-6)
  })
  it('transports a contact correction with the source instead of pinning wrists', () => {
    const { model, rig } = fixture()
    const safety = new AvatarMotionSafety(rig, model)
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    const start = new THREE.Vector3(), end = new THREE.Vector3()
    for (let frame = 0; frame < 120; frame++) {
      bone('leftUpperArm').quaternion.setFromEuler(new THREE.Euler(0, -.5, -1.3 + frame / 120 * .4))
      bone('leftLowerArm').quaternion.setFromEuler(new THREE.Euler(.2, -1.5, -.5))
      bone('leftHand').quaternion.identity()
      safety.apply(1 / 60)
      if (frame === 30) bone('leftHand').getWorldPosition(start)
      if (frame === 119) bone('leftHand').getWorldPosition(end)
    }
    expect(start.distanceTo(end)).toBeGreaterThan(safety.height * .025)
  })
  it('keeps claps on the correct sides while preserving opening and aligning palms', () => {
    const { model, rig } = fixture(1, true)
    const safety = new AvatarMotionSafety(rig, model)
    const internal = safety as any
    const bone = (name: string) => rig.getNormalizedBoneNode(name as any)!
    let smallest = Infinity, largest = 0
    for (let frame = 0; frame < 180; frame++) {
      // Solve a repeatable input reach. Contact/opening are supplied here by the
      // test, not added as animation keyframes by the playback code.
      for (const arm of internal.arms) {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const half = .025 + (.5 + .5 * Math.sin(frame / 12)) * .06
        const wrist = new THREE.Vector3(arm.side * half, 1.48, .4)
        const direction = wrist.clone().sub(shoulder).normalize()
        const distance = shoulder.distanceTo(wrist)
        const along = (arm.length1 ** 2 - arm.length2 ** 2 + distance ** 2) / (2 * distance)
        const pole = new THREE.Vector3(arm.side, -.7, 0)
        pole.addScaledVector(direction, -pole.dot(direction)).normalize()
        const elbow = shoulder.clone().addScaledVector(direction, along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, arm.length1 ** 2 - along ** 2)))
        internal.aim(arm.upper, arm.lower, elbow)
        internal.aim(arm.lower, arm.hand, wrist)
        arm.hand.quaternion.identity()
      }
      safety.apply(1 / 60, 'clap')
      if (frame < 60) continue
      const left = bone('leftHand').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      const right = bone('rightHand').getWorldPosition(new THREE.Vector3()).applyMatrix4(internal.inverseTorso)
      expect(left.x).toBeGreaterThan(right.x)
      expect(Math.abs(left.y - right.y)).toBeLessThan(.025)
      expect(Math.abs(left.z - right.z)).toBeLessThan(.025)
      const gap = left.distanceTo(right)
      smallest = Math.min(smallest, gap); largest = Math.max(largest, gap)
      for (const side of ['left', 'right']) {
        const finger = bone(side + 'MiddleProximal').getWorldPosition(new THREE.Vector3())
          .sub(bone(side + 'Hand').getWorldPosition(new THREE.Vector3())).normalize()
        expect(finger.y).toBeGreaterThan(.8)
      }
    }
    expect(smallest).toBeLessThan(.075)
    expect(largest - smallest).toBeGreaterThan(.05)
  })
})
