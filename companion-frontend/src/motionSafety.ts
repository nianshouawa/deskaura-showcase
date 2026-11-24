import * as THREE from 'three'
import type { VRMHumanoid } from '@pixiv/three-vrm'

export type SafetyProfile = 'conversation' | 'presenter' | 'thinking' | 'angry' | 'nervous' | 'shy' | 'affectionate' | 'disgusted' | 'fearful' | 'turning' | 'looking' | 'fatigue' | 'point' | 'wave' | 'gesture' | 'bow' | 'nod' | 'clap' | 'celebrate' | 'generated'
const identity = new THREE.Quaternion()
const flipBasis = new THREE.Quaternion(0, 1, 0, 0)
const radians = THREE.MathUtils.degToRad
const clamp = THREE.MathUtils.clamp

export function motionSafetyProfile(id: string): SafetyProfile {
  if (id === 'cloud_standby_stretch') return 'gesture'
  if (id === 'cloud_standby_sway') return 'turning'
  if (id === 'cloud_standby_look_around') return 'looking'
  if (id === 'cloud_thinking_loop' || id === 'cloud_think') return 'thinking'
  if (id === 'cloud_emotion_neutral') return 'presenter'
  if (id === 'cloud_emotion_angry') return 'angry'
  if (id === 'cloud_emotion_disgusted') return 'disgusted'
  if (id === 'cloud_emotion_fearful') return 'fearful'
  if (id === 'cloud_emotion_nervous') return 'nervous'
  if (id === 'cloud_emotion_shy') return 'shy'
  if (id === 'cloud_emotion_affectionate') return 'affectionate'
  if (id === 'cloud_emotion_tired') return 'fatigue'
  if (id === 'cloud_point') return 'point'
  if (id === 'cloud_wave') return 'wave'
  if (id === 'cloud_bow') return 'bow'
  if (id === 'cloud_nod') return 'nod'
  if (id === 'cloud_clap') return 'clap'
  if (id === 'cloud_celebrate') return 'celebrate'
  // Live task IDs must not inherit reply limits: suppressing a requested step's
  // legs/translation but leaving its pelvis rotation makes the whole body tip.
  if (!id.startsWith('cloud_')) return 'generated'
  return /^cloud_(wave|point|shrug)$/.test(id) ? 'gesture' : 'conversation'
}

function limitSwingTwist(q: THREE.Quaternion, twistDegrees: number, swingDegrees: number) {
  // Arms are X-aligned in normalized T-pose. Unlike component-wise axis-angle
  // clamping, swing/twist decomposition respects the actual rotation manifold.
  const twist = new THREE.Quaternion(q.x, 0, 0, q.w)
  if (twist.lengthSq() < 1e-10) twist.identity(); else twist.normalize()
  const swing = q.clone().multiply(twist.clone().invert())
  twist.rotateTowards(identity, Math.max(0, twist.angleTo(identity) - radians(twistDegrees)))
  swing.rotateTowards(identity, Math.max(0, swing.angleTo(identity) - radians(swingDegrees)))
  return q.copy(swing).multiply(twist).normalize()
}

/** Absolute anatomical guard in canonical (+X left, +Z forward) normalized axes.
 * Never scale all rotations toward T-pose: that lifts resting arms sideways. */
export function limitJointRotation(bone: string, rotation: THREE.Quaternion, rest: THREE.Quaternion,
  flip: boolean, profile: SafetyProfile, target = new THREE.Quaternion()) {
  // Callers may sample and constrain into the same scratch quaternion. Copying
  // rest into it first discarded the sampled motion in visual review tools.
  const inverseRest = rest.clone().invert()
  target.copy(rotation).premultiply(inverseRest)
  if (flip) target.premultiply(flipBasis).multiply(flipBasis)
  if (/UpperArm$/.test(bone)) {
    const neutral = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), radians(bone.startsWith('left') ? -70 : 70))
    const relative = neutral.clone().invert().multiply(target)
    const maximum = radians(['conversation', 'presenter', 'thinking', 'nod', 'bow'].includes(profile) ? 95 : 155)
    relative.rotateTowards(identity, Math.max(0, relative.angleTo(identity) - maximum))
    target.copy(neutral).multiply(relative)
    limitSwingTwist(target, 100, profile === 'celebrate' || profile === 'gesture' || profile === 'wave' || profile === 'generated' ? 175 : 145)
  } else if (/LowerArm$/.test(bone)) {
    limitSwingTwist(target, 115, 145)
  } else if (/Hand$/.test(bone)) {
    limitSwingTwist(target, 80, profile === 'clap' ? 65 : 50)
  } else {
    const limits: Record<string, [number, number, number]> = {
      hips: [profile === 'bow' || profile === 'fatigue' ? 32 : profile === 'generated' ? 42 : 9, profile === 'bow' || profile === 'fatigue' ? 3 : profile === 'generated' ? 30 : 12, profile === 'bow' || profile === 'fatigue' ? 3 : profile === 'generated' ? 12 : 7],
      spine: [profile === 'fatigue' ? 18 : profile === 'bow' ? 14 : profile === 'generated' ? 20 : 8, profile === 'generated' ? 20 : 10, 7],
      chest: [profile === 'fatigue' ? 20 : profile === 'bow' ? 16 : profile === 'generated' ? 20 : 9, profile === 'generated' ? 20 : 12, 8],
      upperChest: [profile === 'bow' ? 12 : profile === 'generated' ? 16 : 8, profile === 'generated' ? 16 : 10, 7],
      neck: [profile === 'looking' ? 20 : 12, profile === 'looking' ? 35 : 22, 10],
      head: [profile === 'looking' ? 26 : 20, profile === 'looking' ? 45 : 30, 16],
    }
    if (profile === 'turning') {
      limits.hips = [7, 38, 6]
      limits.spine = [8, 18, 7]
      limits.chest = [9, 20, 8]
    }
    if (profile === 'nervous') {
      limits.neck = [5, 15, 8]
      limits.head = [9, 20, 10]
    }
    let limit = limits[bone]
    if (/Shoulder$/.test(bone)) limit = profile === 'celebrate' || profile === 'gesture' || profile === 'wave' || profile === 'generated' ? [20, 25, 25] : [15, 20, 15]
    if (/UpperLeg$/.test(bone)) limit = profile === 'turning' ? [12, 3, 4] : profile === 'nod' ? [2, 3, 2] : profile === 'bow' || profile === 'fatigue' ? [48, 10, 3] : profile === 'generated' ? [85, 30, 30] : profile === 'celebrate' ? [48, 16, 14] : [6, 6, 4]
    if (/LowerLeg$/.test(bone)) limit = [profile === 'nod' ? 5 : profile === 'generated' ? 115 : profile === 'celebrate' ? 95 : 28, profile === 'turning' ? 3 : 5, 5]
    if (/Foot$/.test(bone)) limit = profile === 'turning' ? [15, 24, 9] : profile === 'generated' || profile === 'celebrate' ? [40, 20, 15] : [15, 7, 7]
    if (/Toes$/.test(bone)) limit = [12, 5, 5]
    if (limit) {
      const angles = new THREE.Euler().setFromQuaternion(target, 'XYZ')
      angles.set(...[angles.x, angles.y, angles.z].map((value, i) => clamp(value, -radians(limit![i]!), radians(limit![i]!))) as [number, number, number])
      // Knees bend forward, never into a backwards hyperextension.
      if (/LowerLeg$/.test(bone)) angles.x = Math.max(0, angles.x)
      target.setFromEuler(angles)
    }
  }
  if (flip) target.premultiply(flipBasis).multiply(flipBasis)
  return target.premultiply(rest).normalize()
}

/** Source metres must follow avatar stature and stay inside a desktop-sized area. */
export function boundedRootOffset(offset: THREE.Vector3, height: number, profile: SafetyProfile) {
  if (profile === 'bow') return offset.set(0, 0, 0) // waist hinge, not source squat/translation
  const scale = height / 1.7
  offset.multiplyScalar(scale)
  const maximum = height * (profile === 'generated' ? .12 : .018)
  // Radial bounds preserve a step's direction instead of saturating both axes
  // into the same diagonal. Live motion gets a small but usable movement area.
  const horizontal = Math.hypot(offset.x, offset.z)
  if (horizontal > maximum) { offset.x *= maximum / horizontal; offset.z *= maximum / horizontal }
  offset.y = clamp(offset.y, -height * (profile === 'generated' ? .12 : profile === 'celebrate' ? .09 : .025), height * (profile === 'generated' ? .08 : profile === 'celebrate' ? .14 : .02))
  return offset
}

/** Build the in-place bow GOAL before entry blending/velocity filtering. Writing
 * these rotations over the displayed pose afterwards snapped the legs on entry. */
export function stabilizeBowTargets(targets: Map<string, THREE.Quaternion>, rest: Map<string, THREE.Quaternion>) {
  const hips = targets.get('hips')
  if (!hips) return
  const inverse = hips.clone().invert().multiply(rest.get('hips') || identity)
  for (const side of ['left', 'right']) {
    const thigh = targets.get(`${side}UpperLeg`)
    if (thigh) thigh.copy(inverse).multiply(rest.get(`${side}UpperLeg`) || identity)
    for (const part of ['LowerLeg', 'Foot', 'Toes']) {
      targets.get(`${side}${part}`)?.copy(rest.get(`${side}${part}`) || identity)
    }
  }
}

/** Direct-pose helper for independent diagnostics; runtime uses goal blending. */
export function stabilizeBowLegs(humanoid: VRMHumanoid, rest: Map<string, THREE.Quaternion>) {
  const targets = new Map(Object.entries(humanoid.normalizedHumanBones).map(([name, bone]) => [name, bone.node.quaternion.clone()]))
  stabilizeBowTargets(targets, rest)
  for (const [name, rotation] of targets) humanoid.getNormalizedBoneNode(name as any)?.quaternion.copy(rotation)
}

/** Align toe direction in the pelvis frame, without moving feet closer together
 * or cancelling the generated pelvis turn. This is a sampled goal, before blend. */
export function alignSwayFootTargets(targets: Map<string, THREE.Quaternion>, humanoid: VRMHumanoid) {
  const facing = Math.sign(humanoid.getNormalizedBoneNode('leftUpperLeg')?.position.x || 1)
  for (const side of ['left', 'right'] as const) {
    const thigh = targets.get(`${side}UpperLeg`), knee = targets.get(`${side}LowerLeg`), foot = targets.get(`${side}Foot`)
    if (!thigh || !knee || !foot) continue
    const toes = humanoid.getNormalizedBoneNode(`${side}Toes`)
    const direction = toes?.position.clone() || new THREE.Vector3(0, 0, facing)
    const parent = thigh.clone().multiply(knee)
    const forward = direction.applyQuaternion(parent.clone().multiply(foot))
    if (Math.hypot(forward.x, forward.z) < 1e-6) continue
    const yaw = Math.atan2(forward.x * facing, forward.z * facing)
    foot.premultiply(parent).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -yaw))
      .premultiply(parent.invert()).normalize()
  }
}

type Slice = { y: number; x: number; z: number; rx: number; rz: number }
type Arm = { upper: THREE.Object3D; lower: THREE.Object3D; hand: THREE.Object3D; handRest: THREE.Quaternion; side: number; length1: number; length2: number; palmFrame?: THREE.Quaternion }
type ArmHistory = { wrist: THREE.Vector3; elbow: THREE.Vector3; sourceWrist: THREE.Vector3; sourceElbow: THREE.Vector3; rotations: THREE.Quaternion[] }
export type SafetyStats = { corrections: number; largestCorrection: number }
export type MotionContactPolicy = 'clearance' | 'fluent'

/** Stationary library clips share one floor anchor. Rotating hips without their
 * source translation made the feet and whole body drift around the pelvis.
 * This compensates the displayed feet, never rotates/scales the model, and is
 * deliberately disabled for explicit generated locomotion. */
export class AvatarGroundAnchor {
  private feet: THREE.Object3D[]
  private hips: THREE.Object3D | null
  private reference = new THREE.Vector3()
  constructor(humanoid: VRMHumanoid) {
    this.hips = humanoid.getNormalizedBoneNode('hips')
    this.feet = ['leftFoot', 'rightFoot'].map(name => humanoid.getNormalizedBoneNode(name as any)).filter(Boolean) as THREE.Object3D[]
    this.reference.copy(this.measure())
  }
  private measure() {
    const positions = this.feet.map(node => { node.updateWorldMatrix(true, false); return node.getWorldPosition(new THREE.Vector3()) })
    if (!positions.length) return new THREE.Vector3()
    return new THREE.Vector3(positions.reduce((sum, p) => sum + p.x, 0) / positions.length,
      Math.min(...positions.map(p => p.y)), positions.reduce((sum, p) => sum + p.z, 0) / positions.length)
  }
  apply(weight = 1) {
    if (!this.hips?.parent || !this.feet.length || weight <= 0) return
    const correction = this.reference.clone().sub(this.measure()).multiplyScalar(clamp(weight, 0, 1))
    // World displacement must be transformed as a vector; applying an inverse
    // matrix to it as a point would add the parent's translation a second time.
    const inverse = this.hips.parent.matrixWorld.clone().invert()
    const origin = new THREE.Vector3().applyMatrix4(inverse)
    correction.applyMatrix4(inverse).sub(origin)
    this.hips.position.add(correction)
    this.hips.updateWorldMatrix(false, true)
  }
}

/** Conservative body envelope + two-bone arm IK. Built once per avatar from its
 * own skinned body/clothes, not the source SMPL dimensions. Not cloth simulation. */
export class AvatarMotionSafety {
  readonly height: number
  readonly slices: Slice[] = []
  private arms: Arm[] = []
  private torso: THREE.Object3D
  private root: THREE.Object3D
  private torsoRest = new THREE.Vector3()
  private torsoRestRotation = new THREE.Quaternion()
  private inverseTorso = new THREE.Matrix4()
  private bodyToWorld = new THREE.Matrix4()
  private padding: number
  private history = new Map<Arm, ArmHistory>()
  private clapTargets = new Map<Arm, THREE.Vector3>()
  private clapActivation = 0
  private handTargets = new Map<Arm, THREE.Vector3>()
  private palmOffsets = new Map<Arm, THREE.Vector3>()
  private predictedHands = new Map<Arm, THREE.Vector3>()
  private groundAnchor: AvatarGroundAnchor
  private elapsed = 0

  constructor(private humanoid: VRMHumanoid, model: THREE.Object3D) {
    // SkinnedMesh updates bindMatrixInverse in updateMatrixWorld(), NOT in
    // Object3D.updateWorldMatrix(). This matters after rotateVRM0(): otherwise
    // sampled skin vertices are rotated twice and the collider faces backwards.
    model.updateMatrixWorld(true)
    this.root = humanoid.normalizedHumanBonesRoot
    this.torso = humanoid.getNormalizedBoneNode('chest') || humanoid.getNormalizedBoneNode('spine')!
    this.root.updateWorldMatrix(true, true)
    this.groundAnchor = new AvatarGroundAnchor(humanoid)
    const inverseRoot = this.root.matrixWorld.clone().invert()
    const position = (name: string) => humanoid.getNormalizedBoneNode(name as any)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot)
    const hips = position('hips'), head = position('head')
    const foot = position('leftFoot')
    this.height = Math.max(.01, head.y - foot.y + (head.y - hips.y) * .18)
    this.padding = this.height * .022 // forearm radius + small garment clearance, not a hand-sized torso expansion
    this.torsoRest.copy(position(this.torso === humanoid.getNormalizedBoneNode('chest') ? 'chest' : 'spine'))
    this.torsoRestRotation.copy(this.torso.getWorldQuaternion(new THREE.Quaternion()))
      .premultiply(this.root.getWorldQuaternion(new THREE.Quaternion()).invert())
    const shoulderWidth = position('leftUpperArm').distanceTo(position('rightUpperArm'))
    const low = hips.y - this.height * .05, high = head.y + this.height * .1
    const count = 16, bins: THREE.Vector3[][] = Array.from({ length: count }, () => [])
    const rawTorso = new Set(['hips', 'spine', 'chest', 'upperChest', 'neck', 'head'].map(name => humanoid.getRawBoneNode(name as any)).filter(Boolean))
    const rawArms = new Set(['leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg'].map(name => humanoid.getRawBoneNode(name as any)).filter(Boolean))
    const bodyBone = (bone: THREE.Object3D) => {
      for (let node: THREE.Object3D | null = bone; node; node = node.parent) {
        if (rawArms.has(node)) return false
        if (rawTorso.has(node)) return true
      }
      return false
    }
    model.updateMatrixWorld(true)
    model.traverse(node => {
      const mesh = node as THREE.SkinnedMesh
      if (!mesh.isSkinnedMesh) return
      const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
      if (!indices || !weights) return
      mesh.skeleton.update()
      const include = mesh.skeleton.bones.map(bodyBone)
      const transform = inverseRoot.clone().multiply(mesh.matrixWorld)
      const point = new THREE.Vector3()
      // Sample actual skinned rest positions. Ignore hair/skirts outside the torso
      // span in x/z, which would turn the envelope into a giant hair collider.
      for (let i = 0; i < indices.count; i += 2) {
        let torsoWeight = 0
        for (let j = 0; j < 4; j++) if (include[indices.getComponent(i, j)]) torsoWeight += weights.getComponent(i, j)
        if (torsoWeight < .6) continue
        mesh.getVertexPosition(i, point).applyMatrix4(transform)
        if (Math.abs(point.x - hips.x) > shoulderWidth * .9 || Math.abs(point.z - hips.z) > this.height * .24) continue
        const bin = Math.floor((point.y - low) / (high - low) * count)
        if (bin >= 0 && bin < count) bins[bin]!.push(point.clone())
      }
    })
    const percentile = (values: number[], fraction: number) => values.sort((a, b) => a - b)[Math.floor((values.length - 1) * fraction)]!
    for (let i = 0; i < count; i++) {
      const points = bins[i]!, y = low + (i + .5) * (high - low) / count
      const headRegion = y > head.y - this.height * .06
      let rx = headRegion ? this.height * .075 : shoulderWidth * .48
      let rz = headRegion ? this.height * .075 : this.height * .085
      let x = hips.x, z = hips.z
      if (points.length > 8) {
        const minX = percentile(points.map(p => p.x), .015), maxX = percentile(points.map(p => p.x), .985)
        const minZ = percentile(points.map(p => p.z), .015), maxZ = percentile(points.map(p => p.z), .985)
        x = (minX + maxX) / 2; z = (minZ + maxZ) / 2
        rx = Math.max(rx, (maxX - minX) / 2); rz = Math.max(rz, (maxZ - minZ) / 2)
      }
      this.slices.push({ y, x, z, rx, rz })
    }
    for (const side of ['left', 'right'] as const) {
      const upper = humanoid.getNormalizedBoneNode(`${side}UpperArm` as any)
      const lower = humanoid.getNormalizedBoneNode(`${side}LowerArm` as any)
      const hand = humanoid.getNormalizedBoneNode(`${side}Hand` as any)
      if (upper && lower && hand) {
        // Derive palm axes from this avatar's mapped fingers, not a guessed wrist
        // Euler offset. Optional fingerless rigs keep the original orientation.
        const middle = humanoid.getNormalizedBoneNode(`${side}MiddleProximal` as any)
        const index = humanoid.getNormalizedBoneNode(`${side}IndexProximal` as any)
        const little = humanoid.getNormalizedBoneNode(`${side}LittleProximal` as any)
        let palmFrame: THREE.Quaternion | undefined
        if (middle && index && little) {
          const inverseHand = hand.matrixWorld.clone().invert()
          const finger = middle.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseHand).normalize()
          const across = index.getWorldPosition(new THREE.Vector3()).sub(little.getWorldPosition(new THREE.Vector3()))
            .transformDirection(inverseHand)
          across.addScaledVector(finger, -across.dot(finger)).normalize()
          if (finger.lengthSq() > .9 && across.lengthSq() > .9) {
            palmFrame = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(finger, across, finger.clone().cross(across)))
          }
        }
        this.arms.push({ upper, lower, hand, handRest: hand.quaternion.clone(), side: Math.sign(lower.position.x) || 1,
          length1: upper.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3())),
          length2: lower.getWorldPosition(new THREE.Vector3()).distanceTo(hand.getWorldPosition(new THREE.Vector3())), palmFrame })
      }
    }
  }

  private slice(y: number): Slice | undefined {
    const first = this.slices[0]!, last = this.slices[this.slices.length - 1]!
    if (y < first.y - this.padding || y > last.y + this.padding) return undefined
    const f = clamp((y - first.y) / (last.y - first.y) * (this.slices.length - 1), 0, this.slices.length - 1)
    const left = this.slices[Math.floor(f)]!, right = this.slices[Math.min(this.slices.length - 1, Math.ceil(f))]!, t = f % 1
    return { y, x: THREE.MathUtils.lerp(left.x, right.x, t), z: THREE.MathUtils.lerp(left.z, right.z, t),
      rx: THREE.MathUtils.lerp(left.rx, right.rx, t), rz: THREE.MathUtils.lerp(left.rz, right.rz, t) }
  }

  private project(point: THREE.Vector3, side: number, preferFront: boolean) {
    const local = point.clone().applyMatrix4(this.inverseTorso)
    const shape = this.slice(local.y)
    if (!shape) return false
    const rx = shape.rx + this.padding, rz = shape.rz + this.padding
    let dx = (local.x - shape.x) / rx, dz = (local.z - shape.z) / rz
    const power = this.contactPower(shape)
    const norm = Math.pow(Math.abs(dx) ** power + Math.abs(dz) ** power, 1 / power)
    // A tiny tolerance INSIDE the padded clearance (not inside the body mesh)
    // avoids solving a new elbow plane for millimetric garment/contact noise.
    // Keep project() and the IK penalty on the same boundary; the old 1 vs 1.015
    // mismatch made a nominally clear pose costly and encouraged plane hunting.
    if (norm >= .985) return false
    // Hands crossing the torso should pass IN FRONT, never through it or behind.
    if (preferFront) {
      dz = this.forwardSign * Math.pow(Math.max(.01, 1 - clamp(Math.abs(dx) ** power, 0, .99)), 1 / power)
      local.z = shape.z + dz * rz
    } else {
      if (norm < .01) { dx = side; dz = this.forwardSign * .15 }
      const scale = 1 / Math.max(.01, Math.pow(Math.abs(dx) ** power + Math.abs(dz) ** power, 1 / power))
      local.x = shape.x + dx * rx * scale
      local.z = shape.z + dz * rz * scale
    }
    point.copy(local.applyMatrix4(this.bodyToWorld))
    return true
  }

  private penetration(point: THREE.Vector3) {
    const local = point.clone().applyMatrix4(this.inverseTorso), shape = this.slice(local.y)
    if (!shape) return 0
    const power = this.contactPower(shape)
    return Math.max(0, .985 - Math.pow(Math.abs((local.x - shape.x) / (shape.rx + this.padding)) ** power
      + Math.abs((local.z - shape.z) / (shape.rz + this.padding)) ** power, 1 / power))
  }

  private contactPower(shape: Slice) {
    // Two prominent chest lobes are not an ellipse: matching only their x/z
    // extrema under-fits its front corners and can label a visibly cutting
    // forearm as clear. Use a rounded rectangle only at unusually deep chest
    // slices; head/waist and ordinary proportions retain the smaller ellipse.
    return shape.rz > this.height * .095 && Math.abs(shape.y - this.torsoRest.y) < this.height * .11 ? 4 : 2
  }

  private get forwardSign() {
    const left = this.humanoid.getNormalizedBoneNode('leftLowerArm')!
    return Math.sign(left.position.x) || 1 // VRM0 normalized rest has left at -X
  }

  private aim(node: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
    node.updateWorldMatrix(true, true)
    const start = node.getWorldPosition(new THREE.Vector3())
    const direction = child.getWorldPosition(new THREE.Vector3()).sub(start).normalize()
    const desired = target.clone().sub(start).normalize()
    if (!desired.lengthSq()) return
    const world = node.getWorldQuaternion(new THREE.Quaternion())
    world.premultiply(new THREE.Quaternion().setFromUnitVectors(direction, desired))
    const parent = node.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()
    node.quaternion.copy(parent.multiply(world)).normalize()
    node.updateWorldMatrix(false, true)
  }

  /** Position-only shortest-arc IK has an unconstrained humerus roll. Bending
   * the elbow after that roll can turn a visually correct wrist target into a
   * backwards/twisted elbow. Align the TWO limb frames to one flexion plane;
   * the elbow is a hinge, not another ball joint. */
  private solveArm(arm: Arm, elbow: THREE.Vector3, wrist: THREE.Vector3) {
    const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
    const upperDirection = elbow.clone().sub(shoulder).normalize()
    const lowerDirection = wrist.clone().sub(elbow).normalize()
    const normal = upperDirection.clone().cross(lowerDirection)
    if (normal.lengthSq() < 1e-8) return
    normal.normalize()
    const frame = (direction: THREE.Vector3, hinge: THREE.Vector3) => {
      const x = direction.clone().normalize()
      const y = hinge.clone().addScaledVector(x, -hinge.dot(x)).normalize()
      return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, x.clone().cross(y)))
    }
    const left = arm.side === this.forwardSign
    const hinge = new THREE.Vector3(0, left ? -1 : 1, 0)
    const upperWorld = frame(upperDirection, normal).multiply(frame(arm.lower.position, hinge).invert())
    arm.upper.quaternion.copy(arm.upper.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(upperWorld))
    arm.upper.updateWorldMatrix(false, true)
    const lowerWorld = frame(lowerDirection, normal).multiply(frame(arm.hand.position, hinge).invert())
    arm.lower.quaternion.copy(arm.lower.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(lowerWorld))
    arm.lower.updateWorldMatrix(false, true)
  }

  /** Run after pose interpolation and entry blending, before humanoid.update(). */
  reset() { this.history.clear(); this.elapsed = 0 }

  private prepareClapTargets() {
    this.clapTargets.clear()
    this.clapActivation = 0
    if (this.arms.length !== 2) return
    const wrists = this.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseTorso))
    const middle = wrists[0]!.clone().add(wrists[1]!).multiplyScalar(.5)
    const activation = THREE.MathUtils.smoothstep(middle.y, this.torsoRest.y - this.height * .05, this.torsoRest.y + this.height * .06)
    if (activation < .001) return
    this.clapActivation = activation
    // Preserve GENERATED opening/closing distance, while giving both wrists a
    // shared height/depth and a minimum palm-sized separation. Never let wrists
    // exchange sides just because source and avatar arm lengths differ.
    const half = clamp(wrists[0]!.distanceTo(wrists[1]!) * .5, this.height * .01, this.height * .16)
    const shape = this.slice(middle.y)
    if (shape) {
      const front = shape.z + this.forwardSign * (shape.rz + this.padding + this.height * .035)
      if (this.forwardSign * (middle.z - front) < 0) middle.z = front
    }
    this.arms.forEach((arm, i) => {
      const goal = new THREE.Vector3(middle.x + arm.side * half, middle.y, middle.z)
      this.clapTargets.set(arm, wrists[i]!.clone().lerp(goal, activation).applyMatrix4(this.bodyToWorld))
    })
  }

  private orientClapPalm(arm: Arm) {
    if (!arm.palmFrame || this.clapActivation < .001) return
    const finger = new THREE.Vector3(0, 1, 0)
    // Fingers point up, index/thumb side back toward the body, palms face each
    // other. The measured local frame handles both hands and VRM0/VRM1 parity.
    const across = new THREE.Vector3(0, 0, -this.forwardSign)
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(finger, across, finger.clone().cross(across)))
      .premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.bodyToWorld)))
      .multiply(arm.palmFrame.clone().invert())
    const orientation = arm.hand.getWorldQuaternion(new THREE.Quaternion()).slerp(desired, this.clapActivation)
    const parent = arm.lower.getWorldQuaternion(new THREE.Quaternion())
    const relative = parent.clone().invert().multiply(orientation)
    // Put axial roll into the forearm, not an extreme wrist twist. Rotate about
    // the actual wrist offset so this does not change the solved wrist position.
    const axis = arm.hand.position.clone().normalize()
    const projection = new THREE.Vector3(relative.x, relative.y, relative.z).dot(axis)
    const twist = new THREE.Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, relative.w)
    if (twist.lengthSq() > 1e-8) {
      twist.normalize()
      twist.rotateTowards(identity, Math.max(0, twist.angleTo(identity) - radians(90)))
      arm.lower.quaternion.multiply(twist)
      arm.lower.updateWorldMatrix(false, true)
    }
    arm.hand.quaternion.copy(arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation))
    limitSwingTwist(arm.hand.quaternion, 80, 65)
    arm.hand.updateWorldMatrix(false, true)
  }

  private prepareHandTargets(profile: SafetyProfile) {
    this.handTargets.clear(); this.palmOffsets.clear(); this.predictedHands.clear()
    if (this.arms.length !== 2 || profile === 'clap') return
    const wrists = this.arms.map(arm => {
      const original = arm.hand.getWorldPosition(new THREE.Vector3()), history = this.history.get(arm)
      // Predict the torso-corrected pose too: two originally separated hands can
      // otherwise be projected onto the very same patch of a large chest.
      return history ? history.wrist.clone().applyMatrix4(this.bodyToWorld)
        .add(original.sub(history.sourceWrist.clone().applyMatrix4(this.bodyToWorld))) : original
    })
    const goals = wrists.map(p => p.clone())
    this.arms.forEach(arm => {
      const side = arm.side === this.forwardSign ? 'left' : 'right'
      const middle = this.humanoid.getNormalizedBoneNode(`${side}MiddleProximal` as any)
      const offset = middle ? middle.getWorldPosition(new THREE.Vector3()).sub(arm.hand.getWorldPosition(new THREE.Vector3())).multiplyScalar(.65)
        : new THREE.Vector3(arm.side * this.height * .025, 0, 0).applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion()))
      this.palmOffsets.set(arm, offset)
    })
    // Wrist and palm-center proxies detect hand overlap, not just wrists at the
    // same point. Resolve symmetrically in a stable body-relative direction.
    // Do not force both hands to stay on their anatomical side: folded poses
    // remain possible when hands are separated in depth or height.
    for (let pass = 0; pass < 4; pass++) for (const [a, b, minimum] of [[0, 0, .035], [1, 1, .035], [0, 1, .032], [1, 0, .032]]) {
      const first = goals[0]!.clone().addScaledVector(this.palmOffsets.get(this.arms[0]!)!, a!)
      const second = goals[1]!.clone().addScaledVector(this.palmOffsets.get(this.arms[1]!)!, b!)
      const difference = first.sub(second), distance = difference.length(), gap = this.height * minimum!
      if (distance >= gap) continue
      if (distance < this.height * .001) difference.set(this.arms[0]!.side, 0, 0).transformDirection(this.bodyToWorld)
      else difference.multiplyScalar(1 / distance)
      const correction = difference.multiplyScalar((gap - distance) * .5)
      goals[0]!.add(correction); goals[1]!.sub(correction)
    }
    this.arms.forEach((arm, i) => {
      this.predictedHands.set(arm, goals[i]!)
      if (goals[i]!.distanceToSquared(wrists[i]!) > 1e-10) this.handTargets.set(arm, goals[i]!)
    })
  }

  private handOverlap(arm: Arm, wrist: THREE.Vector3) {
    let penalty = 0
    for (const other of this.arms) {
      if (arm === other) continue
      const otherWrist = this.predictedHands.get(other)
      if (!otherWrist) continue
      for (const [a, b, minimum] of [[0, 0, .035], [1, 1, .035], [0, 1, .032], [1, 0, .032]]) {
        const point = wrist.clone().addScaledVector(this.palmOffsets.get(arm)!, a!)
        const target = otherWrist.clone().addScaledVector(this.palmOffsets.get(other)!, b!)
        penalty += Math.max(0, minimum! - point.distanceTo(target) / this.height) ** 2
      }
    }
    return penalty
  }

  apply(delta = 1 / 60, profile: SafetyProfile = 'conversation', groundWeight = 1, policy: MotionContactPolicy = 'clearance'): SafetyStats {
    this.elapsed += clamp(delta, 0, .1)
    // A planted floor correction cancels intentional cloud-generated hops.
    // Celebration keeps bounded source height while its horizontal path stays in place.
    if (profile !== 'generated' && profile !== 'celebrate') this.groundAnchor.apply(groundWeight)
    this.root.updateWorldMatrix(true, true)
    this.bodyToWorld.compose(this.torso.getWorldPosition(new THREE.Vector3()),
      this.torso.getWorldQuaternion(new THREE.Quaternion()).multiply(this.torsoRestRotation.clone().invert()),
      this.root.getWorldScale(new THREE.Vector3()))
      .multiply(new THREE.Matrix4().makeTranslation(-this.torsoRest.x, -this.torsoRest.y, -this.torsoRest.z))
    this.inverseTorso.copy(this.bodyToWorld).invert()
    if (policy === 'fluent') return this.applyFluent(delta, profile, groundWeight)
    this.clapTargets.clear()
    this.clapActivation = 0
    if (profile === 'clap') this.prepareClapTargets()
    this.prepareHandTargets(profile)
    const stats = { corrections: 0, largestCorrection: 0 }
    for (const arm of this.arms) {
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
      const elbow = arm.lower.getWorldPosition(new THREE.Vector3())
      const hand = arm.hand.getWorldPosition(new THREE.Vector3())
      const original = hand.clone()
      const clapTarget = this.clapTargets.get(arm)
      const contactTarget = clapTarget || this.handTargets.get(arm)
      if (contactTarget) hand.copy(contactTarget)
      const orientation = arm.hand.getWorldQuaternion(new THREE.Quaternion())
      const history = this.history.get(arm)
      const previousWrist = history?.wrist.clone().applyMatrix4(this.bodyToWorld)
      const previousElbow = history?.elbow.clone().applyMatrix4(this.bodyToWorld)
      // Transport the previous correction with the new source movement. A penalty
      // on absolute previous positions pins wrists to the chest and kills claps.
      if (history && previousWrist && previousElbow) {
        previousWrist.add(original.clone().sub(history.sourceWrist.clone().applyMatrix4(this.bodyToWorld)))
        previousElbow.add(elbow.clone().sub(history.sourceElbow.clone().applyMatrix4(this.bodyToWorld)))
      }
      const handAtWaist = hand.clone().applyMatrix4(this.inverseTorso).y < this.torsoRest.y - this.height * .025
      let moved = !!contactTarget || this.handOverlap(arm, hand) > 1e-8
      // Check both the wrist and the forearm segment: clear hands alone do not
      // prevent an elbow/forearm from cutting through a large chest or sleeve.
      for (let pass = 0; pass < 4; pass++) {
        moved = this.project(hand, arm.side, !handAtWaist) || moved
        for (const t of [.25, .5, .75]) {
          const sample = elbow.clone().lerp(hand, t), before = sample.clone()
          if (this.project(sample, arm.side, !handAtWaist && t > .4)) {
            hand.add(sample.sub(before).multiplyScalar(.8))
            moved = true
          }
        }
        moved = this.project(elbow, arm.side, false) || moved
      }
      // Also test the upper arm; a clear wrist is not proof of a clear arm.
      for (const t of [.8]) if (this.penetration(shoulder.clone().lerp(elbow, t)) > .01) moved = true
      if (!moved) {
        if (profile === 'clap') this.orientClapPalm(arm)
        this.remember(arm, delta, original, arm.lower.getWorldPosition(new THREE.Vector3()), profile)
        continue
      }
      const a = arm.length1, b = arm.length2
      // The old single projected wrist can be unreachable or leave no collision-
      // free elbow solution. Search nearby reachable wrists as well as elbow planes.
      const sourceElbow = arm.lower.getWorldPosition(new THREE.Vector3())
      const sourceHand = contactTarget?.clone() || original.clone()
      let bestCost = Infinity, bestAngle = 0
      const bestHand = hand.clone(), bestElbow = elbow.clone()
      const evaluate = (wrist: THREE.Vector3, angle: number) => {
        const direction = wrist.clone().sub(shoulder)
        const distance = clamp(direction.length(), Math.abs(a - b) + this.height * .02, (a + b) * .9999)
        direction.normalize()
        wrist = shoulder.clone().addScaledVector(direction, distance)
        const along = (a * a - b * b + distance * distance) / (2 * distance)
        const radius = Math.sqrt(Math.max(0, a * a - along * along))
        const pole = (previousElbow || sourceElbow).clone().sub(shoulder)
        pole.addScaledVector(direction, -pole.dot(direction))
        if (pole.lengthSq() < 1e-8) pole.set(arm.side, -.5, this.forwardSign * .3).transformDirection(this.bodyToWorld)
        const candidate = shoulder.clone().addScaledVector(direction, along)
          .addScaledVector(pole.normalize().applyAxisAngle(direction, radians(angle)), radius)
        let depth = 0
        for (let i = 0; i <= 10; i++) depth += this.penetration(candidate.clone().lerp(wrist, i / 10)) ** 2
        // The upper arm starts inside the shoulder; only its distal half should
        // be outside the padded torso, unlike the WHOLE forearm and wrist.
        for (const t of [.8]) depth += this.penetration(shoulder.clone().lerp(candidate, t)) ** 2
        const cost = depth * 10000 + this.handOverlap(arm, wrist) * 10000 + wrist.distanceToSquared(sourceHand) / (this.height ** 2)
          + candidate.distanceToSquared(sourceElbow) / (this.height ** 2) * .5
          + (previousWrist ? wrist.distanceToSquared(previousWrist) / this.height ** 2 * (profile === 'thinking' || profile === 'conversation' ? .8 : .12) : 0)
          + (previousElbow ? candidate.distanceToSquared(previousElbow) / this.height ** 2 * (profile === 'thinking' || profile === 'conversation' ? 1.2 : .2) : 0)
          + (contactTarget ? wrist.distanceToSquared(contactTarget) / this.height ** 2 * 30 : 0)
        if (cost < bestCost) { bestCost = cost; bestAngle = angle; bestHand.copy(wrist); bestElbow.copy(candidate) }
        return depth
      }
      const local = hand.clone().applyMatrix4(this.inverseTorso)
      const candidates = [hand.clone(), sourceHand.clone()]
      if (previousWrist) candidates.unshift(previousWrist)
      // Expand forward/outward continuously in avatar coordinates, not global Z.
      for (const front of [0, .04, .08, .12, .18]) {
        for (const outward of [0, .04, .08]) {
          if (!front && !outward) continue
          candidates.push(local.clone().add(new THREE.Vector3(arm.side * this.height * outward, 0, this.forwardSign * this.height * front)).applyMatrix4(this.bodyToWorld))
        }
      }
      for (const wrist of candidates) {
        for (const angle of [0, 15, -15, 30, -30, 50, -50, 75, -75, 105, -105, 140, -140, 180]) evaluate(wrist, angle)
      }
      // Continuous local refinement avoids visible quantized wrist/elbow choices.
      let step = this.height * .025
      let angleStep = 12
      for (let iteration = 0; iteration < 6; iteration++) {
        const start = bestHand.clone()
        const startAngle = bestAngle
        for (const angle of [startAngle - angleStep, startAngle + angleStep]) evaluate(start, angle)
        for (const axis of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]) {
          const worldAxis = axis.transformDirection(this.bodyToWorld)
          for (const sign of [-1, 1]) {
            const trial = start.clone().addScaledVector(worldAxis, step * sign)
            // Reconstruct the best plane relative to this trial before refining.
            for (const angle of [startAngle, startAngle + angleStep, startAngle - angleStep]) evaluate(trial, angle)
          }
        }
        step *= .5; angleStep *= .5
      }
      this.aim(arm.upper, arm.lower, bestElbow)
      this.aim(arm.lower, arm.hand, bestHand)
      arm.hand.quaternion.copy(arm.hand.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation))
      limitSwingTwist(arm.hand.quaternion, 80, profile === 'clap' ? 65 : 50)
      arm.hand.updateWorldMatrix(false, true)
      if (profile === 'clap') this.orientClapPalm(arm)
      stats.corrections++
      stats.largestCorrection = Math.max(stats.largestCorrection, original.distanceTo(bestHand))
      this.remember(arm, delta, original, sourceElbow, profile)
    }
    return stats
  }

  /** Desktop policy: no competing torso collision planes. Preserve the source
   * trajectory and tolerate intersections rather than pumping wrists around a
   * large chest. Only stable semantic hand goals and tiny mutual hand
   * separation are solved, with a fixed continuous elbow pole and output damping. */
  private applyFluent(delta: number, profile: SafetyProfile, blend: number): SafetyStats {
    const stats = { corrections: 0, largestCorrection: 0 }
    this.clapTargets.clear(); this.clapActivation = 0
    if (profile === 'clap') this.prepareClapTargets()
    if (profile === 'celebrate') this.spreadRaisedCelebrationArms(blend)
    const originalWrists = this.arms.map(arm => arm.hand.getWorldPosition(new THREE.Vector3()))
    const separated = this.fluentHandSeparation(originalWrists)
    for (const [index, arm] of this.arms.entries()) {
      const original = originalWrists[index]!, elbow = arm.lower.getWorldPosition(new THREE.Vector3())
      let goal = this.clapTargets.get(arm)?.clone()
      const sideName = arm.side === this.forwardSign ? 'left' : 'right'
      if (profile === 'angry') {
        goal = new THREE.Vector3(arm.side * this.height * .115, this.torsoRest.y - this.height * .06,
          this.torsoRest.z + this.forwardSign * this.height * .025).applyMatrix4(this.bodyToWorld)
      } else if (profile === 'nervous') {
        const y = this.torsoRest.y - this.height * .10 + (sideName === 'left' ? this.height * .016 : 0)
        const shape = this.slice(y)
        const front = shape ? shape.z + this.forwardSign * (shape.rz + this.padding + this.height * .035)
          : this.torsoRest.z + this.forwardSign * this.height * .18
        goal = new THREE.Vector3(arm.side * this.height * .026, y,
          front + (sideName === 'left' ? this.forwardSign * this.height * .012 : 0)).applyMatrix4(this.bodyToWorld)
      } else if (profile === 'shy') {
        const y = this.torsoRest.y + this.height * .065
        const shape = this.slice(y)
        const front = shape ? shape.z + this.forwardSign * (shape.rz + this.padding + this.height * .045)
          : this.torsoRest.z + this.forwardSign * this.height * .22
        goal = new THREE.Vector3(arm.side * this.height * .065, y, front).applyMatrix4(this.bodyToWorld)
      } else if (profile === 'affectionate') {
        const head = this.humanoid.getNormalizedBoneNode('head')
        if (head) {
          const bob = Math.sin(this.elapsed * Math.PI * 1.5 + (sideName === 'right' ? .35 : 0))
          goal = head.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseTorso)
            .add(new THREE.Vector3(arm.side * this.height * .105,
              -this.height * .025 + this.height * .009 * bob, this.forwardSign * this.height * .055))
            .applyMatrix4(this.bodyToWorld)
        }
      } else if (profile === 'disgusted') {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const direction = new THREE.Vector3(arm.side * .10, -.10, this.forwardSign)
          .transformDirection(this.bodyToWorld)
        goal = shoulder.clone().addScaledVector(direction, (arm.length1 + arm.length2) * .9995)
      } else if (profile === 'thinking' && sideName === 'right') {
        const head = this.humanoid.getNormalizedBoneNode('head')
        if (head) {
          head.updateWorldMatrix(true, false)
          // Use an avatar-relative chin goal and a laterally open elbow pole.
          // A forward-only elbow plane sent this forearm straight through a
          // prominent chest even while the wrist itself was under the chin.
          goal = head.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseTorso)
            .add(new THREE.Vector3(arm.side * this.height * .018, -this.height * .062, this.forwardSign * this.height * .065))
            .applyMatrix4(this.bodyToWorld)
        }
      } else if (profile === 'thinking') {
        // The left palm rests on the outer waist, with the elbow open sideways.
        goal = new THREE.Vector3(arm.side * this.height * .115, this.torsoRest.y - this.height * .06,
          this.torsoRest.z + this.forwardSign * this.height * .025).applyMatrix4(this.bodyToWorld)
      } else if (profile === 'fatigue') {
        // Hands hang with gravity in front of the slumped torso, not crossed
        // at its chest. Solve in world space so bending does not lift the arms.
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const outward = new THREE.Vector3(arm.side, 0, 0).transformDirection(this.bodyToWorld)
        goal = shoulder.clone().addScaledVector(outward, this.height * .006)
          .add(new THREE.Vector3(0, -(arm.length1 + arm.length2) * .9995, 0))
      } else if (profile === 'wave' && sideName === 'left') {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const offset = new THREE.Vector3(arm.side * this.height * .08,
          -(arm.length1 + arm.length2) * .95, this.forwardSign * this.height * .095)
          .applyQuaternion(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.bodyToWorld)))
        goal = shoulder.clone().add(offset)
      } else if (profile === 'point' && sideName === 'right') {
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
        const offset = original.clone().sub(shoulder)
        const y = clamp(offset.y, -this.height * .20, -this.height * .075)
        goal = original.clone(); goal.y = shoulder.y + y
      } else if (profile === 'presenter') {
        // Open, naturally bent forearms in front of the waist. Small source
        // motion is retained without allowing either hand to cross the centre.
        const local = original.clone().applyMatrix4(this.inverseTorso)
        goal = new THREE.Vector3(arm.side * this.height * .16, this.torsoRest.y - this.height * .055,
          this.torsoRest.z + this.forwardSign * this.height * .20)
        goal.y += clamp(local.y - goal.y, -this.height * .008, this.height * .008)
        goal.z += clamp(local.z - goal.z, -this.height * .008, this.height * .008)
        goal.applyMatrix4(this.bodyToWorld)
      }
      // Palm proxies detect overlapping fingers even when wrist joints are not
      // coincident. This is independent of torso collision and never hunts for
      // another chest plane on the following frame.
      if (!goal && profile !== 'thinking' && this.arms.length === 2) {
        if (separated[index]!.distanceToSquared(original) > 1e-10) goal = separated[index]!.clone()
      }
      if (goal) {
        const weight = clamp(blend, 0, 1)
        const nodes = [arm.upper, arm.lower, arm.hand], entry = nodes.map(node => node.quaternion.clone())
        goal.lerp(original, 1 - weight)
        const shoulder = arm.upper.getWorldPosition(new THREE.Vector3()), direction = goal.clone().sub(shoulder)
        const a = arm.length1, b = arm.length2
        const distance = clamp(direction.length(), Math.abs(a - b) + this.height * .025, (a + b) * (profile === 'fatigue' || profile === 'disgusted' ? .9995 : .985))
        direction.normalize(); goal.copy(shoulder).addScaledVector(direction, distance)
        const along = (a * a - b * b + distance * distance) / (2 * distance)
        const radius = Math.sqrt(Math.max(0, a * a - along * along))
        const pole = (profile === 'thinking'
          ? sideName === 'right' ? new THREE.Vector3(arm.side * 1.35, -.95, this.forwardSign * .45)
            : new THREE.Vector3(arm.side * 1.4, -.55, -this.forwardSign * .2)
          : profile === 'angry' ? new THREE.Vector3(arm.side * 1.7, -.4, -this.forwardSign * .2)
          : profile === 'affectionate' ? new THREE.Vector3(arm.side * 1.35, -.95, this.forwardSign * .12)
          : profile === 'fatigue' ? new THREE.Vector3(arm.side * .2, -.9, this.forwardSign * .25)
          : profile === 'nervous' || profile === 'shy' || profile === 'point'
            ? new THREE.Vector3(arm.side * .85, -1, this.forwardSign * .12)
          : profile === 'presenter' ? new THREE.Vector3(arm.side * .75, -.9, this.forwardSign * .10)
          : new THREE.Vector3(arm.side * .35, -.8, this.forwardSign * .35)).transformDirection(this.bodyToWorld)
        pole.addScaledVector(direction, -pole.dot(direction))
        if (pole.lengthSq() < 1e-6) pole.set(arm.side, 0, 0).transformDirection(this.bodyToWorld)
        const desiredElbow = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole.normalize(), radius)
        const orientation = arm.hand.getWorldQuaternion(new THREE.Quaternion())
        this.solveArm(arm, desiredElbow, goal)
        arm.hand.quaternion.copy(arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(orientation))
        // The imported wrist orientation belongs to a different arm trajectory.
        // Keeping it in world space after moving the fist under the chin could
        // demand a near-180° wrist bend. A relaxed forearm-relative wrist is safer.
        if (profile === 'thinking') {
          arm.hand.quaternion.copy(arm.handRest)
          if (sideName === 'right') {
            this.orientSemanticPalm(arm, new THREE.Vector3(-arm.side * .12, .16, this.forwardSign * .98),
              new THREE.Vector3(-this.forwardSign * arm.side, 0, .1), 75, 45)
            // Retain the solved forearm roll; only relax the wrist along it.
            arm.hand.quaternion.copy(arm.handRest)
          }
          else this.orientSemanticPalm(arm, new THREE.Vector3(-arm.side, -.38, this.forwardSign * .08),
            new THREE.Vector3(0, 0, -this.forwardSign), 65, 35)
        }
        if (profile === 'fatigue') {
          arm.hand.quaternion.copy(arm.handRest)
        }
        if (profile === 'angry') {
          arm.hand.quaternion.copy(arm.handRest)
          this.orientSemanticPalm(arm, new THREE.Vector3(-arm.side, -.38, this.forwardSign * .08),
            new THREE.Vector3(0, 0, -this.forwardSign), 65, 35)
        }
        if (profile === 'nervous') {
          this.orientPalmFrame(arm, new THREE.Vector3(-arm.side, -.08, 0),
            new THREE.Vector3(0, 0, -this.forwardSign), 65)
        }
        if (profile === 'shy') {
          arm.hand.quaternion.copy(arm.handRest)
          this.orientSemanticPalm(arm, new THREE.Vector3(arm.side * .10, 1, this.forwardSign * .12),
            new THREE.Vector3(arm.side, -.10, 0), 65, 40)
        }
        if (profile === 'affectionate') {
          const bob = Math.sin(this.elapsed * Math.PI * 1.5 + (sideName === 'right' ? .35 : 0))
          this.orientForwardPalm(arm, .36 * bob, 65)
        }
        if (profile === 'disgusted') {
          this.orientForwardPalm(arm, 0, 75)
        }
        if (profile === 'presenter') this.orientPresentationPalm(arm)
        if (profile === 'clap') this.orientClapPalm(arm)
        // A wrist at its original position still has infinitely many elbow
        // planes. Blend rotations as well, so choosing the stable pole cannot
        // swivel an elbow on the first frame of a semantic gesture.
        nodes.forEach((node, i) => node.quaternion.copy(entry[i]!.clone().slerp(node.quaternion, weight)))
        arm.upper.updateWorldMatrix(true, true)
        stats.corrections++; stats.largestCorrection = Math.max(stats.largestCorrection, goal.distanceTo(original))
      }
      this.remember(arm, delta, original, elbow, profile)
    }
    return stats
  }

  /** Open a raised cheering arc as one rigid arm chain. Rotating only the
   * shoulder preserves the generated elbow hinge and wrist relative rotations;
   * independent wrist IK here would reintroduce the forearm corkscrew. */
  private spreadRaisedCelebrationArms(blend: number) {
    for (const arm of this.arms) {
      const shoulder = arm.upper.getWorldPosition(new THREE.Vector3())
      const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
      const localShoulder = shoulder.clone().applyMatrix4(this.inverseTorso)
      const localWrist = wrist.clone().applyMatrix4(this.inverseTorso)
      const activation = THREE.MathUtils.smoothstep(localWrist.y - localShoulder.y,
        -this.height * .035, this.height * .06) * clamp(blend, 0, 1)
      if (!activation || localWrist.x * arm.side >= this.height * .29) continue
      const target = localWrist.clone()
      target.x = arm.side * this.height * .29
      target.applyMatrix4(this.bodyToWorld)
      const sourceDirection = wrist.sub(shoulder).normalize()
      const targetDirection = target.sub(shoulder).normalize()
      const correction = new THREE.Quaternion().setFromUnitVectors(sourceDirection, targetDirection)
      const angle = correction.angleTo(identity)
      correction.slerp(identity, 1 - Math.min(activation, angle > 1e-8 ? radians(32) / angle : 1))
      const parent = arm.upper.parent!.getWorldQuaternion(new THREE.Quaternion())
      const world = arm.upper.getWorldQuaternion(new THREE.Quaternion())
      arm.upper.quaternion.copy(parent.invert().multiply(correction).multiply(world)).normalize()
      arm.upper.updateWorldMatrix(false, true)
    }
  }

  private fluentHandSeparation(wrists: THREE.Vector3[]) {
    const goals = wrists.map(p => p.clone())
    if (this.arms.length !== 2) return goals
    const offsets = this.arms.map((arm, i) => {
      const side = arm.side === this.forwardSign ? 'left' : 'right'
      const middle = this.humanoid.getNormalizedBoneNode(`${side}MiddleProximal` as any)
      return middle ? middle.getWorldPosition(new THREE.Vector3()).sub(wrists[i]!).multiplyScalar(1.15)
        : new THREE.Vector3(arm.side * this.height * .035, 0, 0).applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion()))
    })
    for (let pass = 0; pass < 3; pass++) for (const [a, b] of [[0, 0], [1, 1], [0, 1], [1, 0]] as const) {
      const difference = goals[0]!.clone().addScaledVector(offsets[0]!, a)
        .sub(goals[1]!.clone().addScaledVector(offsets[1]!, b))
      const gap = this.height * (a === 0 && b === 0 ? .035 : .045), distance = difference.length()
      if (distance >= gap) continue
      if (distance < this.height * .002) difference.set(this.arms[0]!.side, 0, 0).transformDirection(this.bodyToWorld)
      else difference.divideScalar(distance)
      const correction = difference.multiplyScalar((gap - distance) * .5)
      goals[0]!.add(correction); goals[1]!.sub(correction)
    }
    return goals
  }

  /** Anatomical palm frame avoids guessed world Euler wrist angles. */
  private orientPresentationPalm(arm: Arm) {
    const finger = new THREE.Vector3(arm.side * .28, .16, this.forwardSign).normalize()
    const across = new THREE.Vector3(arm.side, 0, -this.forwardSign * .28)
    this.orientSemanticPalm(arm, finger, across, 55, 35)
  }

  /** Finger x index-to-little points toward the PALM on the anatomical left,
   * and away on the right. VRM0 reverses arm.side, not anatomical handedness. */
  private orientForwardPalm(arm: Arm, flex: number, bendLimit: number) {
    const finger = new THREE.Vector3(0, Math.cos(flex), this.forwardSign * Math.sin(flex))
    const palm = new THREE.Vector3(0, -Math.sin(flex), this.forwardSign * Math.cos(flex))
    this.orientPalmFrame(arm, finger, palm, bendLimit)
  }

  private orientPalmFrame(arm: Arm, finger: THREE.Vector3, palm: THREE.Vector3, bendLimit: number) {
    if (!arm.palmFrame) return
    const anatomicalSign = arm.side / this.forwardSign
    finger.normalize()
    palm.addScaledVector(finger, -palm.dot(finger)).normalize()
    const across = palm.clone().cross(finger).multiplyScalar(anatomicalSign).normalize()
    const desired = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(finger, across, finger.clone().cross(across)))
      .premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.bodyToWorld)))
      .multiply(arm.palmFrame.clone().invert())
    const relative = arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired)
    if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w)
    const axis = arm.hand.position.clone().normalize()
    const projection = new THREE.Vector3(relative.x, relative.y, relative.z).dot(axis)
    const roll = new THREE.Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, relative.w)
    if (roll.lengthSq() > 1e-8) {
      // Pronation belongs in the forearm. A small roll cap left the wrist
      // facing the opposite way even when the requested palm frame was right.
      roll.normalize().rotateTowards(identity, Math.max(0, roll.angleTo(identity) - radians(165)))
      arm.lower.quaternion.multiply(roll)
      arm.lower.updateWorldMatrix(false, true)
    }
    arm.hand.quaternion.copy(arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired))
    limitSwingTwist(arm.hand.quaternion, 40, bendLimit)
    arm.hand.updateWorldMatrix(false, true)
  }

  private orientSemanticPalm(arm: Arm, finger: THREE.Vector3, across: THREE.Vector3, twistLimit: number, bendLimit: number) {
    if (!arm.palmFrame) return
    finger.normalize()
    across.addScaledVector(finger, -across.dot(finger)).normalize()
    const desired = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(finger, across, finger.clone().cross(across)))
      .premultiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().extractRotation(this.bodyToWorld)))
      .multiply(arm.palmFrame.clone().invert())
    const relative = arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired)
    const axis = arm.hand.position.clone().normalize()
    const projection = new THREE.Vector3(relative.x, relative.y, relative.z).dot(axis)
    const roll = new THREE.Quaternion(axis.x * projection, axis.y * projection, axis.z * projection, relative.w)
    if (roll.lengthSq() > 1e-8) {
      // Pronation is small and measured from the solved elbow frame. The old
      // 100-degree addition compounded source forearm roll beyond 150 degrees
      // and visibly corkscrewed the mesh despite plausible wrist positions.
      roll.normalize().rotateTowards(identity, Math.max(0, roll.angleTo(identity) - radians(45)))
      arm.lower.quaternion.multiply(roll)
      arm.lower.updateWorldMatrix(false, true)
    }
    arm.hand.quaternion.copy(arm.lower.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(desired))
    limitSwingTwist(arm.hand.quaternion, twistLimit, bendLimit)
    arm.hand.updateWorldMatrix(false, true)
  }

  private remember(arm: Arm, delta: number, sourceWrist: THREE.Vector3, sourceElbow: THREE.Vector3, profile: SafetyProfile) {
    const previous = this.history.get(arm)
    const nodes = [arm.upper, arm.lower, arm.hand]
    if (previous) {
      // The safety solver must not bypass the output velocity limit. Apply on
      // BOTH contact and no-contact frames so entering/leaving contact is smooth.
      nodes.forEach((node, i) => {
        const goal = node.quaternion.clone()
        const speed = profile === 'clap' || profile === 'celebrate' ? (i === 2 ? 420 : 540)
          : profile === 'thinking' ? (i === 2 ? 90 : 120) : (i === 2 ? 180 : 240)
        const elapsed = clamp(delta, 0, .1)
        const angle = previous.rotations[i]!.angleTo(goal)
        // A speed ceiling alone still alternated +/-4 degrees every frame when
        // IK switched contact planes. Damp the corrected OUTPUT as well as the
        // independent source; thought gestures need slower, steadier correction.
        const baseTau = profile === 'thinking' ? .14 : profile === 'clap' || profile === 'celebrate' ? .035 : .065
        const slow = profile === 'thinking' ? .3 : profile === 'affectionate' && i === 2 ? .09 : .18
        // Contact-plane changes below a few degrees should not buzz around the
        // resting solution. Adapt damping to movement magnitude, preserving fast
        // claps/celebrations and deliberate larger movements.
        const smallCorrection = 1 - THREE.MathUtils.smoothstep(angle, radians(.25), radians(3))
        const tau = profile === 'clap' || profile === 'celebrate' ? baseTau : THREE.MathUtils.lerp(baseTau, slow, smallCorrection)
        const blend = Math.min(1 - Math.exp(-elapsed / tau), angle > 1e-8 ? radians(speed) * elapsed / angle : 1)
        node.quaternion.copy(previous.rotations[i]!).slerp(goal, blend).normalize()
      })
      arm.upper.updateWorldMatrix(true, true)
    }
    this.history.set(arm, {
      wrist: arm.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseTorso),
      elbow: arm.lower.getWorldPosition(new THREE.Vector3()).applyMatrix4(this.inverseTorso),
      sourceWrist: sourceWrist.clone().applyMatrix4(this.inverseTorso),
      sourceElbow: sourceElbow.clone().applyMatrix4(this.inverseTorso),
      rotations: nodes.map(node => node.quaternion.clone()),
    })
  }
}
