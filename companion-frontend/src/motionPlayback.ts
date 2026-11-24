import * as THREE from 'three'
import { SMPL_TO_VRM_BONES, smplAxisAngleToLocal } from './motion'

export type QuaternionTracks = Map<string, THREE.Quaternion[]>
/** Shared by the loader and composer so a new composed clip cannot silently
 * skip fetching the relaxed reference it needs in actual desktop playback. */
export function usesIdleMotionReference(id: string) {
  return (id.startsWith('cloud_standby_') && !['cloud_standby_stretch', 'cloud_standby_sway'].includes(id)) || ['cloud_nod', 'cloud_emotion_neutral', 'cloud_bow', 'cloud_emotion_sad',
    'cloud_think', 'cloud_thinking_loop', 'cloud_wave'].includes(id)
}
// SMPL hierarchy, not array adjacency. Optional VRM bones must not discard a
// source rotation: e.g. a missing upperChest belongs in BOTH neck and shoulders.
const parents = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19]
const splineCache = new WeakMap<THREE.Quaternion[], { tangents: THREE.Quaternion[]; scratch: THREE.Quaternion }>()

/** Recording heading is not a command to turn the desktop avatar. Remove only
 * the initial yaw, never the root pitch/roll needed for a bend or weight shift. */
export function sourceRootHeading(poses: number[][]) {
  const row = poses[0]
  if (!row || row.length < 3) return new THREE.Quaternion()
  const root = smplAxisAngleToLocal([row[0]!, row[1]!, row[2]!], new THREE.Quaternion(), false)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(root)
  const yaw = Math.hypot(forward.x, forward.z) > 1e-5 ? Math.atan2(forward.x, forward.z) : 0
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
}

function removeHeading(rotation: THREE.Quaternion) {
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation)
  if (Math.hypot(forward.x, forward.z) < 1e-5) return rotation
  return rotation.premultiply(new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 1, 0), -Math.atan2(forward.x, forward.z)))
}

function tangent(previous: THREE.Quaternion, current: THREE.Quaternion, next: THREE.Quaternion) {
  const inverse = current.clone().invert()
  const logarithm = (q: THREE.Quaternion) => {
    const relative = inverse.clone().multiply(q)
    if (relative.w < 0) relative.set(-relative.x, -relative.y, -relative.z, -relative.w)
    const norm = Math.hypot(relative.x, relative.y, relative.z)
    const scale = norm > 1e-8 ? Math.atan2(norm, relative.w) / norm : 1
    return new THREE.Vector3(relative.x, relative.y, relative.z).multiplyScalar(scale)
  }
  const log = logarithm(previous).add(logarithm(next)).multiplyScalar(-0.25)
  const angle = log.length(), factor = angle > 1e-8 ? Math.sin(angle) / angle : 1
  return current.clone().multiply(new THREE.Quaternion(log.x * factor, log.y * factor, log.z * factor, Math.cos(angle))).normalize()
}

/** Symmetric quaternion filter removes source-frame spikes without a phase lag.
 * Keep original archives intact; never average axis angles across their wrap. */
export function prepareMotionTracks(poses: number[][], rest: Map<string, THREE.Quaternion>, flip: boolean,
  desktop?: { id: string; idlePoses?: number[][] }): QuaternionTracks {
  const tracks: QuaternionTracks = new Map()
  const headingInverse = sourceRootHeading(poses).invert()
  const mapped = new Set(SMPL_TO_VRM_BONES.filter(([, bone]) => rest.has(bone)).map(([joint]) => joint))
  for (const [joint, bone] of SMPL_TO_VRM_BONES) {
    if (!rest.has(bone)) continue
    const chain = [joint]
    for (let parent = parents[joint]!; parent >= 0 && !mapped.has(parent); parent = parents[parent]!) chain.unshift(parent)
    const raw = poses.map(row => {
      const rotation = new THREE.Quaternion()
      for (const source of chain) rotation.multiply(smplAxisAngleToLocal(
        [row[source * 3]!, row[source * 3 + 1]!, row[source * 3 + 2]!], new THREE.Quaternion(), flip))
      // Archived desktop replies are stationary gestures, not turn commands.
      // Removing only the recording's FIRST heading still let a fear/point/bow
      // clip rotate the entire avatar later. Keep pitch/roll and all articulated
      // movement, but strip each frame's global yaw for this library only.
      // User-generated locomotion/turns retain their relative heading changes.
      if (joint === 0) {
        if (desktop?.id === 'cloud_standby_sway') {
          const basis = new THREE.Quaternion(0, 1, 0, 0)
          const inverse = flip ? headingInverse.clone().premultiply(basis).multiply(basis) : headingInverse
          rotation.premultiply(inverse)
        }
        else if (desktop?.id.startsWith('cloud_')) removeHeading(rotation)
        else rotation.premultiply(headingInverse)
      }
      return rotation.premultiply(rest.get(bone)!)
    })
    // A five-frame average still passes visible low-amplitude arm chatter. Use
    // a wider symmetric filter for relaxed/think/bow arms; retain clap/wave and
    // celebration timing. Filtering quaternions also avoids axis-angle wrap spikes.
    const steadyArm = /Arm$|Hand$|Shoulder$/.test(bone) && !['cloud_clap', 'cloud_wave', 'cloud_celebrate'].includes(desktop?.id || '')
    const weights = steadyArm ? [1, 4, 7, 10, 12, 10, 7, 4, 1] : [1, 2, 3, 2, 1]
    const half = Math.floor(weights.length / 2)
    tracks.set(bone, raw.map((_, i) => {
      const average = raw[Math.max(0, i - half)]!.clone()
      let sum = weights[0]!
      for (let k = 1; k < weights.length; k++) {
        const weight = weights[k]!
        average.slerp(raw[Math.min(raw.length - 1, Math.max(0, i + k - half))]!, weight / (sum + weight))
        sum += weight
      }
      return average.normalize()
    }))
  }
  if (desktop?.idlePoses && usesIdleMotionReference(desktop.id)) {
    // Compose verified cloud tracks, not hand-authored keyframes. A nod is a
    // head gesture, not a new wide-legged body pose. Neutral replies use this
    // relaxed base for their entry; avatar-sized presenter IK supplies the open
    // forward palms instead of inheriting an unrelated source arm position.
    const ambient = prepareMotionTracks(desktop.idlePoses, rest, flip, { id: 'cloud_idle' })
    for (const [bone, track] of tracks) {
      const reference = ambient.get(bone)
      // These raw standby arms cross the clothed torso. Keep their generated
      // head/body rhythm, with the already-reviewed cloud idle arm chains.
      if (desktop.id.startsWith('cloud_standby_')) {
        if (reference) {
          const arms = /Shoulder$|Arm$|Hand$/.test(bone)
          const strength = arms ? 0
            : desktop.id === 'cloud_standby_look_around' ? /head|neck/.test(bone) ? 1 : .5
            : /head|neck/.test(bone) ? .42 : .32
          tracks.set(bone, track.map((pose, index) => {
            const position = index * (reference.length - 1) / Math.max(1, track.length - 1)
            const first = Math.floor(position), last = Math.min(first + 1, reference.length - 1)
            return reference[first]!.clone().slerp(reference[last]!, position - first).slerp(pose, strength)
          }))
        }
        continue
      }
      if (desktop.id === 'cloud_wave' && !/^left(Shoulder|UpperArm|LowerArm|Hand)$/.test(bone)) continue
      if (!reference || (desktop.id === 'cloud_nod' && ['head', 'neck'].includes(bone))) continue
      // Bow is a waist gesture with arms resting at the sides, not a presentation
      // with spread hands. Reuse verified relaxed cloud arm chains, including
      // shoulders (important on avatars without an upperChest bone).
      if (desktop.id === 'cloud_bow' && !/Arm$|Hand$|Shoulder$/.test(bone)) continue
      const thought = desktop.id.includes('think')
      if (thought && !/hips|Leg$|Foot$|Toes$/.test(bone)) continue
      const weight = thought || desktop.id === 'cloud_wave' || desktop.id === 'cloud_emotion_sad' || desktop.id === 'cloud_nod' || desktop.id === 'cloud_bow' ? 1 : /Arm$|Hand$|Shoulder$/.test(bone) ? .55 : /Leg$|Foot$|Toes$/.test(bone) ? 1 : .2
      for (let i = 0; i < track.length; i++) {
        const f = i / Math.max(1, track.length - 1) * (reference.length - 1)
        const a = Math.floor(f), b = Math.min(a + 1, reference.length - 1)
        const pose = reference[a]!.clone().slerp(reference[b]!, f - a)
        track[i]!.slerp(pose, weight)
      }
    }
    if (desktop.id === 'cloud_emotion_sad') {
      // Sadness is a small forward upper-body slump with hanging hands, not a
      // tipped pelvis or a whole-character side tilt. Keep legs/arms from idle.
      const slumped = [['hips', 0], ['spine', 8], ['chest', 9], ['upperChest', 4], ['neck', 7], ['head', 10]] as const
      for (const [bone, degrees] of slumped) {
        const track = tracks.get(bone)
        if (!track) continue
        for (let i = 0; i < track.length; i++) {
          const breath = bone === 'spine' ? Math.sin(i / Math.max(1, track.length - 1) * Math.PI * 2) * .6 : 0
          track[i]!.copy(rest.get(bone)!).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad((degrees + breath) * (flip ? -1 : 1))))
        }
      }
    }
  }
  if (desktop?.id === 'cloud_emotion_fearful') {
    // Keep the generated hesitation, but constrain its torso to a small recoil.
    // Forward-pitched fear was reading as approaching rather than withdrawing.
    const ranges: Record<string, [number, number]> = { hips: [-5, -2], spine: [-3, -1], chest: [-3, -1], upperChest: [-1, 0] }
    const basis = new THREE.Quaternion(0, 1, 0, 0)
    for (const [bone, track] of tracks) {
      const range = ranges[bone]
      if (!range) continue
      for (const pose of track) {
        const local = pose.clone().premultiply(rest.get(bone)!.clone().invert())
        if (flip) local.premultiply(basis).multiply(basis)
        const angles = new THREE.Euler().setFromQuaternion(local, 'XYZ')
        angles.x = THREE.MathUtils.clamp(angles.x, THREE.MathUtils.degToRad(range[0]), THREE.MathUtils.degToRad(range[1]))
        local.setFromEuler(angles)
        if (flip) local.premultiply(basis).multiply(basis)
        pose.copy(rest.get(bone)!).multiply(local)
      }
    }
  }
  return tracks
}

export function sampleTrack(track: THREE.Quaternion[], seconds: number, fps: number, target: THREE.Quaternion) {
  const position = THREE.MathUtils.clamp(seconds * fps, 0, track.length - 1)
  const index = Math.floor(position)
  const next = Math.min(index + 1, track.length - 1), weight = position - index
  let spline = splineCache.get(track)
  if (!spline) {
    spline = { tangents: track.map((q, i) => tangent(track[Math.max(0, i - 1)]!, q, track[Math.min(track.length - 1, i + 1)]!)), scratch: new THREE.Quaternion() }
    splineCache.set(track, spline)
  }
  // Quaternion SQUAD preserves velocity across source-frame boundaries as well.
  target.copy(track[index]!).slerp(track[next]!, weight)
  spline.scratch.copy(spline.tangents[index]!).slerp(spline.tangents[next]!, weight)
  return target.slerp(spline.scratch, 2 * weight * (1 - weight)).normalize()
}

/** C1-continuous overlap: end of one cycle exactly equals start of the next. */
export function sampleLoopTrack(track: THREE.Quaternion[], seconds: number, fps: number, target: THREE.Quaternion, scratch: THREE.Quaternion) {
  const duration = (track.length - 1) / fps
  const seam = Math.min(1.2, duration / 3)
  const period = duration - seam
  const time = ((seconds % period) + period) % period
  sampleTrack(track, time + seam, fps, target)
  if (time > period - seam) {
    sampleTrack(track, time - (period - seam), fps, scratch)
    target.slerp(scratch, THREE.MathUtils.smoothstep(time, period - seam, period))
  }
  return target
}

/** Frame-rate independent dampening plus an angular-speed ceiling for outliers. */
export function smoothBone(current: THREE.Quaternion, target: THREE.Quaternion, bone: string, delta: number) {
  const lowerBody = /hips|Leg|Foot|Toes/.test(bone)
  const maxSpeed = THREE.MathUtils.degToRad(lowerBody ? 180 : 420)
  const angle = current.angleTo(target)
  const amount = Math.min(1 - Math.exp(-Math.max(0, delta) / 0.055), angle > 1e-8 ? maxSpeed * delta / angle : 1)
  current.slerp(target, Math.max(0, amount)).normalize()
}
