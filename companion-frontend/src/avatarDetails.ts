import * as THREE from 'three'
import { VRMLookAtBoneApplier, VRMLookAtExpressionApplier, VRMLookAtRangeMap, type VRM, type VRMHumanoid, type VRMLookAt } from '@pixiv/three-vrm'

export type AvatarGazeCapability = { mode: 'bone' | 'expression' | 'unsupported'; detail: string }

/** Check deformation, not just the presence of eye bones or an authored flag.
 * Some exports declare Bone look-at but leave both eye bones completely unweighted.
 */
export function configureAvatarGaze(vrm: Pick<VRM, 'humanoid' | 'lookAt' | 'expressionManager' | 'scene'>): AvatarGazeCapability {
  const lookAt = vrm.lookAt
  if (!lookAt) return { mode: 'unsupported', detail: '当前模型没有眼动控制器' }
  const eyes = ['leftEye', 'rightEye'].map(name => vrm.humanoid.getRawBoneNode(name as 'leftEye' | 'rightEye'))
  const weighted = new Set<THREE.Object3D>()
  vrm.scene.traverse(object => {
    const mesh = object as THREE.SkinnedMesh
    if (!mesh.isSkinnedMesh) return
    const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    if (!indices || !weights) return
    const eyeIndices = new Map<number, THREE.Object3D>()
    mesh.skeleton.bones.forEach((bone, i) => {
      // A mesh may be weighted to a child of an eye rather than the eye itself.
      for (let ancestor: THREE.Object3D | null = bone; ancestor; ancestor = ancestor.parent) {
        if (eyes.includes(ancestor)) { eyeIndices.set(i, ancestor); break }
      }
    })
    if (!eyeIndices.size) return
    for (let i = 0; i < indices.count; i++) for (let j = 0; j < indices.itemSize; j++) {
      const eye = eyeIndices.get(indices.getComponent(i, j))
      if (eye && weights.getComponent(i, j) > .001) weighted.add(eye)
    }
  })
  if (eyes.every(eye => !!eye && weighted.has(eye)) && lookAt.applier instanceof VRMLookAtBoneApplier) {
    return { mode: 'bone', detail: '眼动：眼球骨骼' }
  }
  const manager = vrm.expressionManager
  const hasDeformation = (name: string) => manager?.getExpression(name)?.binds.some(bind => {
    const morph = bind as { primitives?: THREE.Mesh[]; index?: number; weight?: number }
    if (!morph.primitives || morph.index === undefined || !morph.weight) return false
    return morph.primitives.some(mesh => {
      const attribute = mesh.geometry.morphAttributes.position?.[morph.index!]
      const base = mesh.geometry.getAttribute('position')
      if (!attribute || !base) return false
      for (let i = 0; i < attribute.count; i++) {
        const offset = new THREE.Vector3().fromBufferAttribute(attribute, i)
        if (!mesh.geometry.morphTargetsRelative) offset.sub(new THREE.Vector3().fromBufferAttribute(base, i))
        if (offset.lengthSq() > 1e-10) return true
      }
      return false
    })
  })
  if (manager && ['lookUp', 'lookDown', 'lookLeft', 'lookRight'].every(hasDeformation)) {
    // Expression ranges are weights (0..1), not the degrees of the discarded
    // bone ranges. Keep a little eyelid margin at the most extreme cursor edge.
    lookAt.applier = new VRMLookAtExpressionApplier(manager,
      new VRMLookAtRangeMap(90, .85), new VRMLookAtRangeMap(90, .85),
      new VRMLookAtRangeMap(90, .75), new VRMLookAtRangeMap(90, .75))
    return { mode: 'expression', detail: weighted.size ? '眼动：模型表情' : '眼动：模型表情（眼骨未绑定网格）' }
  }
  return { mode: 'unsupported', detail: '当前模型没有可变形的眼球骨骼或完整眼动表情' }
}

type Finger = { node: THREE.Object3D; rest: THREE.Quaternion; axis: THREE.Vector3; finger: string; segment: number; side: string; pointing?: THREE.Quaternion }

/** Small hand-pose overlay, measured in each avatar's rest-hand frame. */
export class AvatarFingerPose {
  private fingers: Finger[] = []
  constructor(humanoid: VRMHumanoid) {
    humanoid.normalizedHumanBonesRoot.updateWorldMatrix(true, true)
    for (const side of ['left', 'right']) {
      const hand = humanoid.getNormalizedBoneNode(`${side}Hand` as any)
      const middle = humanoid.getNormalizedBoneNode(`${side}MiddleProximal` as any)
      const index = humanoid.getNormalizedBoneNode(`${side}IndexProximal` as any)
      const little = humanoid.getNormalizedBoneNode(`${side}LittleProximal` as any)
      if (!hand || !middle || !index || !little) continue
      const origin = hand.getWorldPosition(new THREE.Vector3())
      const forward = middle.getWorldPosition(new THREE.Vector3()).sub(origin).normalize()
      const across = index.getWorldPosition(new THREE.Vector3()).sub(little.getWorldPosition(new THREE.Vector3())).normalize()
      const sign = side === 'left' ? 1 : -1
      // In a VRM T-pose palms face down. Index-to-little ordering mirrors
      // between hands; use anatomical side, not an arbitrary global axis.
      const palm = forward.clone().cross(across).multiplyScalar(sign).normalize()
      const worldAxis = forward.clone().cross(palm).normalize()
      for (const finger of ['Index', 'Middle', 'Ring', 'Little', 'Thumb']) {
        const parts = finger === 'Thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal']
        parts.forEach((part, segment) => {
          const node = humanoid.getNormalizedBoneNode(`${side}${finger}${part}` as any)
          if (!node?.parent) return
          const axis = worldAxis.clone().applyQuaternion(node.getWorldQuaternion(new THREE.Quaternion()).invert())
          let pointing: THREE.Quaternion | undefined
          if (finger === 'Thumb' && segment === 0) {
            const next = humanoid.getNormalizedBoneNode(`${side}ThumbProximal` as any)
            if (next) {
              // Thumb opposition is not the same hinge as the four fingers.
              // Aim its base across the palm before curling the distal joints;
              // applying their shared bend axis alone leaves a dangling thumb.
              const start = node.getWorldPosition(new THREE.Vector3())
              const direction = next.getWorldPosition(new THREE.Vector3()).sub(start).normalize()
              const desired = middle.getWorldPosition(new THREE.Vector3()).sub(start).normalize()
              const opposition = new THREE.Quaternion().setFromUnitVectors(direction, desired)
              opposition.rotateTowards(new THREE.Quaternion(), Math.max(0, opposition.angleTo(new THREE.Quaternion()) - THREE.MathUtils.degToRad(65)))
              pointing = node.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
                .multiply(opposition.multiply(node.getWorldQuaternion(new THREE.Quaternion()))).normalize()
            }
          }
          this.fingers.push({ node, rest: node.quaternion.clone(), axis, finger, segment, side, pointing })
        })
      }
    }
  }
  update(id: string, seconds: number, delta: number) {
    const open = /clap|wave|surprised|emotion_neutral|emotion_disgusted/.test(id)
    const cuteFist = /emotion_shy|emotion_affectionate/.test(id)
    const fist = /celebrate|emotion_happy/.test(id) || cuteFist
    const thinking = /think/.test(id)
    const pointing = id === 'cloud_point'
    for (const item of this.fingers) {
      const curl = open ? .025 : cuteFist ? 1.05 : fist ? .7 : thinking ? item.side === 'right' ? 1.05 : .13 : .13
      const variation = open || fist ? 0 : .025 * Math.sin(seconds * 1.5 + item.segment * .35)
      const relaxIndex = thinking && item.finger === 'Index' ? .8 : 1
      // The archived point is authored with the right arm. An open/relaxed
      // hand reads as reaching, not pointing: keep every index joint straight
      // and fold all four remaining digits, including the thumb. Do not apply
      // breathing variation to this held shape or the index visibly wobbles.
      const amount = pointing && item.side === 'right'
        ? item.finger === 'Index' ? 0 : item.finger === 'Thumb' ? [.55, .9, .7][item.segment]! : [1.2, 1.14, .84][item.segment]!
        : cuteFist && item.finger === 'Thumb' ? [.55, .9, .7][item.segment]!
        : (curl + variation) * relaxIndex * (item.finger === 'Thumb' ? .32 : 1) * [1, .85, .55][item.segment]!
      const goal = (pointing && item.side === 'right' || cuteFist) && item.pointing ? item.pointing
        : item.rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(item.axis, amount))
      item.node.quaternion.slerp(goal, 1 - Math.exp(-Math.max(0, delta) / .18))
    }
  }
}

/** Cursor offset is relative to the projected eyes, never the screen center. */
export function gazeAngles(x: number, y: number, eyeX: number, eyeY: number, width: number, height: number) {
  return {
    yaw: Math.tanh((x - eyeX) / Math.max(90, width * .2)) * 24,
    // VRMLookAt uses negative pitch for looking up.
    pitch: Math.tanh((y - eyeY) / Math.max(90, height * .22)) * 16,
  }
}

export type AvatarScreenFrame = {
  /** All values use the same CSS/logical pixel scale, including monitor origin. */
  windowLeft: number; windowTop: number
  left: number; top: number; width: number; height: number
}
export type FaceGazeGeometry = { eyeX: number; eyeY: number; screen: AvatarScreenFrame }

/** Map the user's face from the camera frame onto the display plane, then aim
 * from the avatar's projected eyes toward that screen point. A centred face
 * therefore targets the display centre instead of the physical webcam. */
export function faceGazeAngles(face: Pick<AvatarFaceTarget, 'x' | 'y' | 'aspectRatio'>, geometry?: FaceGazeGeometry) {
  const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback
  const x = THREE.MathUtils.clamp(finite(face.x), -1, 1)
  const y = THREE.MathUtils.clamp(finite(face.y), -1, 1)
  const aspect = THREE.MathUtils.clamp(finite(face.aspectRatio ?? 4 / 3, 4 / 3), .5, 2.5)
  if (geometry) {
    const { screen } = geometry
    if ([screen.left, screen.top, screen.width, screen.height, geometry.eyeX, geometry.eyeY].every(Number.isFinite) &&
        screen.width > 0 && screen.height > 0) {
      // A modest mapping keeps small webcam movements useful while preserving
      // a stable centre dead zone; portrait camera aspect only refines it.
      const horizontalReach = screen.width * .24 * THREE.MathUtils.clamp(aspect / (4 / 3), .8, 1.2)
      const verticalReach = screen.height * .20
      const targetX = screen.left + screen.width / 2 + x * horizontalReach
      const targetY = screen.top + screen.height / 2 + y * verticalReach
      const distance = Math.max(screen.width, screen.height) * 1.15
      return {
        yaw: THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan2(targetX - geometry.eyeX, distance)), -22, 22),
        pitch: THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(Math.atan2(targetY - geometry.eyeY, distance)), -14, 14),
      }
    }
  }
  return {
    yaw: THREE.MathUtils.clamp(x * 18, -22, 22),
    pitch: THREE.MathUtils.clamp(y * 12, -14, 14),
  }
}

type GazeRanges = {
  rangeMapHorizontalInner?: VRMLookAtRangeMap
  rangeMapHorizontalOuter?: VRMLookAtRangeMap
  rangeMapVerticalDown?: VRMLookAtRangeMap
  rangeMapVerticalUp?: VRMLookAtRangeMap
}

/** Use the avatar's input domain, not degrees already reduced by its range maps. */
export function gazeInputAngles(lookAt: VRMLookAt, yaw: number, pitch: number) {
  const ranges = lookAt.applier as typeof lookAt.applier & GazeRanges
  const limit = (maps: (VRMLookAtRangeMap | undefined)[], fallback: number, outputLimit: number) => {
    const values = maps.filter((map): map is VRMLookAtRangeMap => !!map && Number.isFinite(map.inputMaxValue) && map.inputMaxValue > 0)
    if (!values.length) return fallback
    return Math.min(...values.map(map => map.inputMaxValue * Math.min(1, outputLimit / Math.max(.001, map.outputScale))))
  }
  const horizontal = limit([ranges.rangeMapHorizontalInner, ranges.rangeMapHorizontalOuter], 24, 20)
  const vertical = limit([ranges.rangeMapVerticalDown, ranges.rangeMapVerticalUp], 16, 14)
  return {
    yaw: THREE.MathUtils.clamp(yaw / 24, -1, 1) * horizontal,
    pitch: THREE.MathUtils.clamp(pitch / 16, -1, 1) * vertical,
  }
}

/** Camera-aware head/eye targets; authored eye deformation limits stay intact. */
export type AvatarFaceTarget = { x: number; y: number; visible: boolean; aspectRatio?: number }
export type AvatarGazeMode = 'mouse' | 'face' | 'none'

/** Neck and head receive their own slower, bounded additive rotations. The base
 * animation is restored before the next source frame so the overlay cannot
 * accumulate or rotate the whole avatar. Eyes then solve the remaining angle. */
export class AvatarHeadGaze {
  private yaw = 0
  private pitch = 0
  private base = new Map<THREE.Object3D, THREE.Quaternion>()
  constructor(private humanoid: VRMHumanoid) {}
  restore() {
    for (const [node, rotation] of this.base) node.quaternion.copy(rotation)
    this.base.clear()
  }
  update(angles: { yaw: number; pitch: number }, camera: THREE.PerspectiveCamera, delta: number, mode: AvatarGazeMode = 'mouse') {
    this.restore()
    const face = mode === 'face'
    // Face contact uses a smaller/slower head contribution than pointing at a
    // mouse. The eyes retain the rest of the direction, rather than locking.
    this.yaw = THREE.MathUtils.damp(this.yaw, THREE.MathUtils.clamp(angles.yaw * (face ? .14 : .22), face ? -3.2 : -6, face ? 3.2 : 6), face ? 2.2 : 3.8, delta)
    this.pitch = THREE.MathUtils.damp(this.pitch, THREE.MathUtils.clamp(angles.pitch * (face ? .11 : .17), face ? -1.8 : -3, face ? 1.8 : 3), face ? 2.2 : 3.8, delta)
    const neck = this.humanoid.getNormalizedBoneNode('neck'), head = this.humanoid.getNormalizedBoneNode('head')
    camera.updateWorldMatrix(true, false)
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize()
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize()
    for (const [node, weight] of [[neck, neck ? .3 : 0], [head, neck ? .7 : 1]] as const) {
      if (!node?.parent || !weight) continue
      this.base.set(node, node.quaternion.clone())
      node.updateWorldMatrix(true, false)
      const correction = new THREE.Quaternion().setFromAxisAngle(up, THREE.MathUtils.degToRad(this.yaw * weight))
        .multiply(new THREE.Quaternion().setFromAxisAngle(right, THREE.MathUtils.degToRad(this.pitch * weight)))
      const world = node.getWorldQuaternion(new THREE.Quaternion()).premultiply(correction)
      node.quaternion.copy(node.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world)).normalize()
      node.updateWorldMatrix(false, true)
    }
  }
}

export class AvatarCursorGaze {
  private yaw = 0
  private pitch = 0
  private origin = new THREE.Vector3()
  private projected = new THREE.Vector3()
  private target = new THREE.Vector3()
  private forward = new THREE.Vector3()
  private right = new THREE.Vector3()
  private up = new THREE.Vector3()

  constructor(private lookAt: VRMLookAt) {
    lookAt.autoUpdate = false
    lookAt.reset()
  }

  update(cursor: { x: number; y: number; at: number }, camera: THREE.PerspectiveCamera,
    rect: { left: number; top: number; width: number; height: number }, now: number, delta: number,
    mode: AvatarGazeMode = 'mouse', face?: AvatarFaceTarget, head?: AvatarHeadGaze, screen?: AvatarScreenFrame) {
    let goal = { yaw: 0, pitch: 0 }
    let angles = { yaw: 0, pitch: 0 }
    const visible = mode === 'face' ? face?.visible === true : mode === 'mouse' && now - cursor.at < 1000
    if (visible && rect.width > 0 && rect.height > 0) {
      // Raw head transforms must reflect this frame's normalized motion before
      // lookAt() accounts for head turns and the VRM 0 / VRM 1 facing direction.
      this.lookAt.humanoid.update()
      this.lookAt.humanoid.getRawBoneNode('head')?.updateWorldMatrix(true, false)
      camera.updateWorldMatrix(true, false)
      this.lookAt.getLookAtWorldPosition(this.origin)
      this.projected.copy(this.origin).project(camera)
      const eyeX = rect.left + (this.projected.x + 1) * rect.width / 2
      const eyeY = rect.top + (1 - this.projected.y) * rect.height / 2
      if (mode === 'face' && face) {
        const faceX = THREE.MathUtils.clamp(face.x, -1, 1)
        const faceY = THREE.MathUtils.clamp(face.y, -1, 1)
        angles = gazeAngles(
          eyeX + faceX * rect.width * .28, eyeY + faceY * rect.height * .22,
          eyeX, eyeY, rect.width, rect.height,
        )
      } else {
        angles = gazeAngles(cursor.x, cursor.y, eyeX, eyeY, rect.width, rect.height)
      }
      // Translation/panning must not add an unrelated vertical eye offset.
      // Camera-local +Z points toward the viewer even when orbiting the avatar.
      this.forward.setFromMatrixColumn(camera.matrixWorld, 2).normalize()
      this.right.setFromMatrixColumn(camera.matrixWorld, 0).normalize()
      this.up.setFromMatrixColumn(camera.matrixWorld, 1).normalize()
      this.target.copy(this.origin).addScaledVector(this.forward, .8)
        .addScaledVector(this.right, Math.tan(THREE.MathUtils.degToRad(angles.yaw)) * .8)
        .addScaledVector(this.up, -Math.tan(THREE.MathUtils.degToRad(angles.pitch)) * .8)
    }
    head?.update(angles, camera, delta, mode)
    if (visible) {
      // Re-evaluate after the slower head turn so eyes only carry the residual.
      this.lookAt.humanoid.update()
      this.lookAt.humanoid.getRawBoneNode('head')?.updateWorldMatrix(true, false)
      this.lookAt.lookAt(this.target)
      goal = gazeInputAngles(this.lookAt, this.lookAt.yaw, this.lookAt.pitch)
    }
    this.yaw = THREE.MathUtils.damp(this.yaw, goal.yaw, mode === 'face' ? 7 : 12, delta)
    this.pitch = THREE.MathUtils.damp(this.pitch, goal.pitch, mode === 'face' ? 7 : 12, delta)
    this.lookAt.yaw = this.yaw
    this.lookAt.pitch = this.pitch
  }
}
