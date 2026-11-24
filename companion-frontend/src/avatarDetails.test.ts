import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind, VRMHumanoid, VRMLookAt, VRMLookAtBoneApplier, VRMLookAtExpressionApplier, VRMLookAtRangeMap, type VRMHumanBones } from '@pixiv/three-vrm'
import { AvatarCursorGaze, AvatarHeadGaze, AvatarFingerPose, configureAvatarGaze, gazeAngles, faceGazeAngles, gazeInputAngles } from './avatarDetails'

function gazeFixture(vrm0 = false, withNeck = false) {
  const root = new THREE.Group(), bones: Record<string, { node: THREE.Bone }> = {}
  const add = (name: string, parent: THREE.Object3D, x: number, y = 0, z = 0) => {
    const node = new THREE.Bone(); node.position.set(x, y, z); parent.add(node); bones[name] = { node }; return node
  }
  const hips = add('hips', root, 0, 1), spine = add('spine', hips, 0, .2)
  const head = withNeck ? add('head', add('neck', spine, 0, .3), 0, .1) : add('head', spine, 0, .4)
  add('leftEye', head, .03, .05, vrm0 ? -.06 : .06)
  add('rightEye', head, -.03, .05, vrm0 ? -.06 : .06)
  const rig = new VRMHumanoid(bones as unknown as VRMHumanBones)
  root.add(rig.normalizedHumanBonesRoot); root.updateMatrixWorld(true)
  // Same conservative authoring ranges as the user's Momo VRM.
  const applier = new VRMLookAtBoneApplier(rig, new VRMLookAtRangeMap(90, 8), new VRMLookAtRangeMap(90, 12),
    new VRMLookAtRangeMap(90, 10), new VRMLookAtRangeMap(90, 10))
  const lookAt = new VRMLookAt(rig, applier)
  lookAt.offsetFromHeadBone.y = .05
  if (vrm0) { lookAt.faceFront.set(0, 0, -1); applier.faceFront.set(0, 0, -1); root.rotation.y = Math.PI }
  root.updateMatrixWorld(true)
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 100)
  camera.position.set(0, 1.65, 3); camera.lookAt(0, 1.65, 0); camera.updateMatrixWorld(true)
  const rect = { left: 0, top: 0, width: 600, height: 600 }
  const gaze = new AvatarCursorGaze(lookAt)
  const run = (x: number, y: number) => {
    for (let frame = 0; frame < 120; frame++) {
      gaze.update({ x, y, at: frame * 1000 / 60 }, camera, rect, frame * 1000 / 60, 1 / 60)
      rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    }
    return ['leftEye', 'rightEye'].map(name => new THREE.Vector3(0, 0, vrm0 ? -1 : 1)
      .applyQuaternion(rig.getRawBoneNode(name as any)!.getWorldQuaternion(new THREE.Quaternion())))
  }
  return { lookAt, run, gaze, camera, rect, rig, root }
}

describe('avatar detail overlays', () => {
  it('maps webcam rays continuously without the previous exaggerated near-centre head response', () => {
    const center = faceGazeAngles({ x: 0, y: 0 })
    expect(center).toEqual({ yaw: 0, pitch: 0 })
    const small = faceGazeAngles({ x: .15, y: -.15 })
    expect(small.yaw).toBeGreaterThan(2)
    expect(small.yaw).toBeLessThan(4)
    expect(small.pitch).toBeLessThan(-1)
    expect(small.pitch).toBeGreaterThan(-3)
    const extreme = faceGazeAngles({ x: 9, y: -9 })
    expect(extreme.yaw).toBeLessThanOrEqual(24)
    expect(extreme.pitch).toBeGreaterThanOrEqual(-16)
  })
  it('combines the camera face ray with the avatar eye position on the actual display', () => {
    const screen = { windowLeft: 0, windowTop: 0, left: 0, top: 0, width: 1920, height: 1080 }
    const face = { x: 0, y: 0 }
    const left = faceGazeAngles(face, { eyeX: 320, eyeY: 400, screen })
    const middle = faceGazeAngles(face, { eyeX: 960, eyeY: 400, screen })
    const right = faceGazeAngles(face, { eyeX: 1600, eyeY: 400, screen })
    expect(left.yaw).toBeGreaterThan(10)
    expect(middle.yaw).toBe(0)
    expect(right.yaw).toBeLessThan(-10)
    expect(left.yaw).toBeCloseTo(-right.yaw)
    // A laptop webcam is above the display; a lower avatar looks up more.
    expect(faceGazeAngles(face, { eyeX: 960, eyeY: 800, screen }).pitch).toBeLessThan(middle.pitch)
    expect(faceGazeAngles(face, { eyeX: 960, eyeY: 540, screen })).toEqual({ yaw: 0, pitch: 0 })
    expect(faceGazeAngles(face, { eyeX: 960, eyeY: 400, screen }).pitch).toBeGreaterThan(0)
    expect(faceGazeAngles(face, { eyeX: 960, eyeY: 760, screen }).pitch).toBeLessThan(0)
    const shifted = { ...screen, left: -1920, top: 200 }
    expect(faceGazeAngles(face, { eyeX: 1600 - 1920, eyeY: 600, screen: shifted })).toEqual(right)
    const extreme = faceGazeAngles({ x: 1e9, y: -1e9 }, { eyeX: 1e9, eyeY: 1e9, screen })
    expect(extreme).toEqual({ yaw: -22, pitch: -14 })
    expect(faceGazeAngles({ x: NaN, y: Infinity })).toEqual({ yaw: 0, pitch: 0 })
  })
  it('starts a visible head response within 150ms without moving the hips', () => {
    const { rig, camera } = gazeFixture(false, true)
    const overlay = new AvatarHeadGaze(rig), hips = rig.getNormalizedBoneNode('hips')!
    const base = hips.quaternion.clone()
    for (let frame = 0; frame < 9; frame++) {
      overlay.restore()
      overlay.update(faceGazeAngles({ x: .25, y: -.2 }), camera, 1 / 60, 'face')
    }
    const turned = rig.getNormalizedBoneNode('head')!.quaternion.angleTo(new THREE.Quaternion())
      + rig.getNormalizedBoneNode('neck')!.quaternion.angleTo(new THREE.Quaternion())
    expect(turned).toBeGreaterThan(THREE.MathUtils.degToRad(.12))
    expect(hips.quaternion.angleTo(base)).toBeLessThan(1e-6)
  })
  it('keeps face tracking head motion subtle so eyes retain the target', () => {
    const { rig, camera } = gazeFixture(false, true)
    const overlay = new AvatarHeadGaze(rig)
    for (let frame = 0; frame < 180; frame++) {
      overlay.restore()
      overlay.update(faceGazeAngles({ x: .8, y: -.7 }), camera, 1 / 60, 'face')
    }
    const head = rig.getNormalizedBoneNode('head')!
    const neck = rig.getNormalizedBoneNode('neck')!
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(THREE.MathUtils.degToRad(3.3))
    expect(neck.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(THREE.MathUtils.degToRad(1.5))
  })
  for (const vrm0 of [false, true]) it(`shares gaze between separate head/neck joints on VRM ${vrm0 ? '0' : '1'} and recenters when the face is lost`, () => {
    const { rig, root, lookAt, gaze, camera, rect } = gazeFixture(vrm0, true)
    const head = rig.getNormalizedBoneNode('head')!, neck = rig.getNormalizedBoneNode('neck')!
    const overlay = new AvatarHeadGaze(rig)
    for (let frame = 0; frame < 180; frame++) {
      overlay.restore()
      gaze.update({ x: 0, y: 0, at: frame * 1000 / 60 }, camera, rect, frame * 1000 / 60, 1 / 60, 'face', { x: 1, y: -.5, visible: true }, overlay)
      rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    }
    const headAngle = head.quaternion.angleTo(new THREE.Quaternion()), neckAngle = neck.quaternion.angleTo(new THREE.Quaternion())
    expect(headAngle).toBeGreaterThan(neckAngle)
    expect(neckAngle).toBeGreaterThan(.01)
    expect(headAngle + neckAngle).toBeLessThan(THREE.MathUtils.degToRad(19))
    const forward = new THREE.Vector3(0, 0, vrm0 ? -1 : 1).applyQuaternion(rig.getRawBoneNode('head')!.getWorldQuaternion(new THREE.Quaternion()))
    expect(forward.x).toBeGreaterThan(.02)
    expect(forward.y).toBeGreaterThan(.01)
    for (let frame = 0; frame < 240; frame++) {
      overlay.restore()
      // Fresh offscreen cursor samples must not secretly take over face mode.
      gaze.update({ x: 10000, y: -10000, at: frame * 1000 / 60 }, camera, rect, frame * 1000 / 60, 1 / 60, 'face', { x: 1, y: -.5, visible: false }, overlay)
    }
    expect(head.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.0001)
    expect(neck.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.0001)
    expect(Math.abs(lookAt.yaw) + Math.abs(lookAt.pitch)).toBeLessThan(.0001)
  })
  it('turns head and eyes independently toward a face, without accumulating into the authored base or hips', () => {
    const { rig, root, lookAt, gaze, camera, rect } = gazeFixture(true)
    const head = rig.getNormalizedBoneNode('head')!, hips = rig.getNormalizedBoneNode('hips')!
    const base = head.quaternion.clone(), hipBase = hips.quaternion.clone()
    const overlay = new AvatarHeadGaze(rig)
    for (let i = 0; i < 240; i++) {
      overlay.restore()
      head.quaternion.copy(base)
      gaze.update({ x: 0, y: 0, at: -Infinity }, camera, rect, i * 1000 / 60, 1 / 60, 'face', { x: .8, y: -.5, visible: true }, overlay)
      rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    }
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rig.getRawBoneNode('head')!.getWorldQuaternion(new THREE.Quaternion()))
    expect(forward.x).toBeGreaterThan(.02)
    expect(forward.y).toBeGreaterThan(.01)
    expect(hips.quaternion.angleTo(hipBase)).toBeLessThan(1e-6)
    expect(head.quaternion.angleTo(base)).toBeLessThan(THREE.MathUtils.degToRad(19))
    expect(Math.abs(lookAt.yaw)).toBeGreaterThan(1)
    overlay.restore(); expect(head.quaternion.angleTo(base)).toBeLessThan(1e-6)
    for (let i = 0; i < 240; i++) {
      overlay.restore()
      gaze.update({ x: 590, y: 0, at: i * 1000 / 60 }, camera, rect, i * 1000 / 60, 1 / 60, 'none', undefined, overlay)
    }
    expect(head.quaternion.angleTo(base)).toBeLessThan(.0001)
    expect(Math.abs(lookAt.yaw)).toBeLessThan(.0001)
  })
  for (const vrm0 of [false, true]) it(`follows the detected face with subtle head motion on VRM ${vrm0 ? '0' : '1'}`, () => {
    const { rig, root, lookAt, gaze, camera, rect } = gazeFixture(vrm0, true)
    const overlay = new AvatarHeadGaze(rig)
    for (const side of [-1, 1]) {
      for (let frame = 0; frame < 180; frame++) {
        overlay.restore()
        gaze.update({ x: 0, y: 0, at: -Infinity }, camera, rect, frame * 1000 / 60, 1 / 60, 'face',
          { x: side * .7, y: 0, visible: true }, overlay)
        rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
      }
      const eye = rig.getRawBoneNode('leftEye')!
      const direction = new THREE.Vector3(0, 0, vrm0 ? -1 : 1).applyQuaternion(eye.getWorldQuaternion(new THREE.Quaternion()))
      expect(direction.x * side).toBeGreaterThan(.05)
      expect(rig.getNormalizedBoneNode('head')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(THREE.MathUtils.degToRad(4))
      expect(Math.abs(lookAt.yaw)).toBeGreaterThan(1)
    }
  })
  it('falls back to real eye morphs when exported eye bones do not deform any vertices', () => {
    const { rig, root, lookAt, gaze, camera, rect } = gazeFixture(true)
    const expressions = new VRMExpressionManager()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
    geometry.morphTargetsRelative = true
    geometry.morphAttributes.position = [[0, .01, 0], [0, -.01, 0], [-.01, 0, 0], [.01, 0, 0]]
      .map(values => new THREE.Float32BufferAttribute(values, 3))
    const mesh = new THREE.Mesh(geometry); mesh.updateMorphTargets(); root.add(mesh)
    for (const [index, name] of ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].entries()) {
      const expression = new VRMExpression(name)
      expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index, weight: 1 }))
      expressions.registerExpression(expression)
    }
    const result = configureAvatarGaze({ humanoid: rig, scene: root, lookAt, expressionManager: expressions })
    expect(result.mode).toBe('expression')
    expect(lookAt.applier).toBeInstanceOf(VRMLookAtExpressionApplier)
    for (const [x, y, axis, sign] of [[590, 300, 'x', 1], [10, 300, 'x', -1], [300, 10, 'y', 1], [300, 590, 'y', -1]] as const) {
      for (let i = 0; i < 120; i++) {
        gaze.update({ x, y, at: i * 1000 / 60 }, camera, rect, i * 1000 / 60, 1 / 60)
        rig.update(); lookAt.update(1 / 60); expressions.update(); root.updateMatrixWorld(true)
      }
      expect(mesh.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)[axis] * sign).toBeGreaterThan(.004)
    }
  })

  it('reports unsupported instead of pretending unweighted bones or empty morphs can move eyes', () => {
    const { rig, root, lookAt } = gazeFixture()
    const expressions = new VRMExpressionManager()
    for (const name of ['lookUp', 'lookDown', 'lookLeft', 'lookRight']) expressions.registerExpression(new VRMExpression(name))
    expect(configureAvatarGaze({ humanoid: rig, scene: root, lookAt, expressionManager: expressions }).mode).toBe('unsupported')
  })

  it('keeps authored bone gaze when both eye bones genuinely deform the mesh', () => {
    const { rig, root, lookAt } = gazeFixture()
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0], 4))
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0], 4))
    const mesh = new THREE.SkinnedMesh(geometry)
    mesh.bind(new THREE.Skeleton([rig.getRawBoneNode('leftEye')!, rig.getRawBoneNode('rightEye')!] as THREE.Bone[]))
    root.add(mesh)
    expect(configureAvatarGaze({ humanoid: rig, scene: root, lookAt }).mode).toBe('bone')
    expect(lookAt.applier).toBeInstanceOf(VRMLookAtBoneApplier)
  })

  it('anchors gaze at the eyes, tracks all directions and bounds extreme cursor positions', () => {
    expect(gazeAngles(310, 180, 310, 180, 1920, 1080)).toEqual({ yaw: 0, pitch: 0 })
    expect(gazeAngles(410, 80, 310, 180, 1920, 1080).yaw).toBeGreaterThan(0)
    expect(gazeAngles(410, 80, 310, 180, 1920, 1080).pitch).toBeLessThan(0)
    expect(gazeAngles(210, 280, 310, 180, 1920, 1080).yaw).toBeLessThan(0)
    expect(gazeAngles(210, 280, 310, 180, 1920, 1080).pitch).toBeGreaterThan(0)
    const distant = gazeAngles(1e8, -1e8, 310, 180, 0, 0)
    expect(distant).toEqual({ yaw: 24, pitch: -16 })
    expect(gazeAngles(410, 280, 310, 180, 1920, 1080)).toEqual(gazeAngles(1410, 1280, 1310, 1180, 1920, 1080))
  })

  for (const vrm0 of [false, true]) it(`visibly rotates actual VRM ${vrm0 ? '0' : '1'} eyes toward the cursor in all directions`, () => {
    const { run } = gazeFixture(vrm0)
    for (const direction of run(590, 300)) expect(direction.x).toBeGreaterThan(.1)
    for (const direction of run(10, 300)) expect(direction.x).toBeLessThan(-.1)
    for (const direction of run(300, 10)) expect(direction.y).toBeGreaterThan(.12)
    for (const direction of run(300, 590)) expect(direction.y).toBeLessThan(-.12)
    for (const direction of run(300, 300)) {
      expect(Math.abs(direction.x)).toBeLessThan(.001)
      expect(Math.abs(direction.y)).toBeLessThan(.001)
    }
  })

  it('uses the authoring input domain without increasing authored eye rotation limits', () => {
    const { lookAt, rig, root } = gazeFixture()
    expect(gazeInputAngles(lookAt, 24, -16)).toEqual({ yaw: 90, pitch: -90 })
    const goal = gazeInputAngles(lookAt, 1e6, 1e6)
    lookAt.yaw = goal.yaw; lookAt.pitch = goal.pitch; rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    const eye = rig.getRawBoneNode('leftEye')!
    expect(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(eye.quaternion, 'YXZ').y)).toBeCloseTo(12)
    expect(THREE.MathUtils.radToDeg(new THREE.Euler().setFromQuaternion(eye.quaternion, 'YXZ').x)).toBeCloseTo(10)
  })

  it('anchors neutral gaze at projected eyes after camera panning, not at the canvas or camera center', () => {
    const { lookAt, gaze, camera, rect, rig, root } = gazeFixture(true)
    camera.position.set(.2, 1.2, 3); camera.lookAt(.2, 1.2, 0)
    camera.setViewOffset(600, 600, -100, 30, 600, 600)
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix()
    const eye = lookAt.getLookAtWorldPosition(new THREE.Vector3()).project(camera)
    const cursor = { x: (eye.x + 1) * 300, y: (1 - eye.y) * 300, at: 0 }
    for (let frame = 0; frame < 120; frame++) {
      gaze.update({ ...cursor, at: frame * 1000 / 60 }, camera, rect, frame * 1000 / 60, 1 / 60)
      rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    }
    expect(lookAt.yaw).toBeCloseTo(0, 4)
    expect(lookAt.pitch).toBeCloseTo(0, 4)
  })

  it('compensates for a turning head and eases back to neutral after the cursor stops reporting', () => {
    const { lookAt, gaze, camera, rect, rig, root } = gazeFixture(true)
    rig.getNormalizedBoneNode('head')!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .15)
    for (let frame = 0; frame < 120; frame++) {
      gaze.update({ x: 590, y: 300, at: frame * 1000 / 60 }, camera, rect, frame * 1000 / 60, 1 / 60)
      rig.update(); lookAt.update(1 / 60); root.updateMatrixWorld(true)
    }
    expect(lookAt.yaw).toBeGreaterThan(30)
    const previous = lookAt.yaw
    gaze.update({ x: 590, y: 300, at: 0 }, camera, rect, 4000, 1 / 60)
    expect(lookAt.yaw).toBeGreaterThan(0)
    expect(lookAt.yaw).toBeLessThan(previous)
    for (let i = 0; i < 120; i++) gaze.update({ x: 590, y: 300, at: 0 }, camera, rect, 4000 + i * 1000 / 60, 1 / 60)
    expect(lookAt.yaw).toBeCloseTo(0, 4)
    expect(lookAt.pitch).toBeCloseTo(0, 4)
  })

  it('curls both mirrored hands toward the palm without accumulating rotations', () => {
    const root = new THREE.Group(), bones: Record<string, { node: THREE.Bone }> = {}
    const add = (name: string, parent: THREE.Object3D, x: number, y = 0, z = 0) => {
      const node = new THREE.Bone(); node.position.set(x, y, z); parent.add(node); bones[name] = { node }; return node
    }
    const hips = add('hips', root, 0, 1), spine = add('spine', hips, 0, .2)
    const head = add('head', spine, 0, .4); add('neck', spine, 0, .3)
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const upper = add(side + 'UpperArm', spine, sign * .15, .2)
      const lower = add(side + 'LowerArm', upper, sign * .25)
      const hand = add(side + 'Hand', lower, sign * .25)
      for (const [finger, z] of [['Index', .02], ['Middle', 0], ['Ring', -.01], ['Little', -.02]] as const) {
        const proximal = add(side + finger + 'Proximal', hand, sign * .06, 0, z)
        const middle = add(side + finger + 'Intermediate', proximal, sign * .025)
        add(side + finger + 'Distal', middle, sign * .02)
      }
      const thumb = add(side + 'ThumbMetacarpal', hand, sign * .035, 0, .035)
      const thumbBase = add(side + 'ThumbProximal', thumb, sign * .025)
      add(side + 'ThumbDistal', thumbBase, sign * .02)
      const leg = add(side + 'UpperLeg', hips, sign * .1)
      const knee = add(side + 'LowerLeg', leg, 0, -.4); add(side + 'Foot', knee, 0, -.4)
    }
    expect(head).toBeDefined()
    const rig = new VRMHumanoid(bones as unknown as VRMHumanBones); root.add(rig.normalizedHumanBonesRoot)
    const fingers = new AvatarFingerPose(rig)
    for (let i = 0; i < 180; i++) fingers.update('cloud_celebrate', i / 60, 1 / 60)
    root.updateMatrixWorld(true)
    for (const side of ['left', 'right']) {
      const base = rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!
      const tip = rig.getNormalizedBoneNode(`${side}MiddleDistal` as any)!
      expect(tip.getWorldPosition(new THREE.Vector3()).y).toBeLessThan(base.getWorldPosition(new THREE.Vector3()).y - .01)
      expect(base.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(.7, 4)
    }
    for (let i = 0; i < 180; i++) fingers.update('cloud_wave', i / 60, 1 / 60)
    for (const side of ['left', 'right']) {
      const base = rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!
      expect(base.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.03)
    }
    for (let i = 0; i < 180; i++) fingers.update('cloud_thinking_loop', i / 60, 1 / 60)
    expect(rig.getNormalizedBoneNode('rightMiddleProximal')!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(1)
    expect(rig.getNormalizedBoneNode('leftMiddleProximal')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.16)
    for (let i = 0; i < 180; i++) fingers.update('cloud_emotion_neutral', i / 60, 1 / 60)
    for (const side of ['left', 'right']) expect(rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.03)
    for (let i = 0; i < 240; i++) fingers.update('cloud_point', i / 60, 1 / 60)
    for (const part of ['Proximal', 'Intermediate', 'Distal']) {
      expect(rig.getNormalizedBoneNode(`rightIndex${part}` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.0001)
    }
    for (const finger of ['Middle', 'Ring', 'Little']) {
      expect(rig.getNormalizedBoneNode(`right${finger}Proximal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(1.2, 4)
      expect(rig.getNormalizedBoneNode(`right${finger}Intermediate` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(1.14, 4)
      expect(rig.getNormalizedBoneNode(`right${finger}Distal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(.84, 4)
    }
    expect(rig.getNormalizedBoneNode('rightThumbProximal')!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(.9, 4)
    expect(rig.getNormalizedBoneNode('rightThumbMetacarpal')!.quaternion.angleTo(new THREE.Quaternion())).toBeGreaterThan(.6)
    expect(rig.getNormalizedBoneNode('rightThumbMetacarpal')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(THREE.MathUtils.degToRad(65.01))
    expect(rig.getNormalizedBoneNode('leftMiddleProximal')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.16)
    const held = rig.getNormalizedBoneNode('rightMiddleProximal')!.quaternion.clone()
    for (let i = 0; i < 240; i++) fingers.update('cloud_point', 100 + i / 60, 1 / 60)
    expect(rig.getNormalizedBoneNode('rightMiddleProximal')!.quaternion.angleTo(held)).toBeLessThan(.0001)
    for (let i = 0; i < 180; i++) fingers.update('cloud_wave', i / 60, 1 / 60)
    expect(rig.getNormalizedBoneNode('rightMiddleProximal')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.03)
    expect(rig.getNormalizedBoneNode('rightThumbMetacarpal')!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.02)
    for (const id of ['cloud_emotion_shy', 'cloud_emotion_affectionate']) {
      for (let i = 0; i < 180; i++) fingers.update(id, i / 60, 1 / 60)
      for (const side of ['left', 'right']) {
        expect(rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(1.05, 4)
        expect(rig.getNormalizedBoneNode(`${side}ThumbProximal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(.9, 4)
      }
    }
    for (let i = 0; i < 180; i++) fingers.update('cloud_emotion_disgusted', i / 60, 1 / 60)
    for (const side of ['left', 'right']) expect(rig.getNormalizedBoneNode(`${side}MiddleProximal` as any)!.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(.03)
  })
})
