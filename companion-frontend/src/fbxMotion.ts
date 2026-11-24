import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'

/** TokenHub's verified FBX skeleton is the official 52-joint SMPL-H layout.
 * Decode it to the same canonical axis-angle representation already used by
 * our VRM player instead of guessing a generic FBX-to-avatar bone transform.
 */
export interface TencentFbxMotion {
  fps: number
  poses: number[][]
  trans: number[][]
  duration: number
}

export const TENCENT_SMPL_JOINTS = [
  'Pelvis', 'L_Hip', 'R_Hip', 'Spine1', 'L_Knee', 'R_Knee',
  'Spine2', 'L_Ankle', 'R_Ankle', 'Spine3', 'L_Foot', 'R_Foot',
  'Neck', 'L_Collar', 'R_Collar', 'Head', 'L_Shoulder', 'R_Shoulder',
  'L_Elbow', 'R_Elbow', 'L_Wrist', 'R_Wrist',
  'L_Index1', 'L_Index2', 'L_Index3', 'L_Middle1', 'L_Middle2', 'L_Middle3',
  'L_Pinky1', 'L_Pinky2', 'L_Pinky3', 'L_Ring1', 'L_Ring2', 'L_Ring3',
  'L_Thumb1', 'L_Thumb2', 'L_Thumb3',
  'R_Index1', 'R_Index2', 'R_Index3', 'R_Middle1', 'R_Middle2', 'R_Middle3',
  'R_Pinky1', 'R_Pinky2', 'R_Pinky3', 'R_Ring1', 'R_Ring2', 'R_Ring3',
  'R_Thumb1', 'R_Thumb2', 'R_Thumb3',
] as const

const identity = new THREE.Quaternion()

function key(name: string) { return name.toLowerCase().replace(/^.*:/, '').replace(/[^a-z0-9]/g, '') }
function trackBone(name: string) {
  const value = name.replace(/\\/g, '/').split('/').pop() || name
  return key(value.replace(/\.(quaternion|position|scale)$/i, ''))
}

function validateTrack(track: THREE.KeyframeTrack, size: number) {
  if (track.times.length < 2 || track.values.length !== track.times.length * size ||
      !Array.from(track.times).every(Number.isFinite) || !Array.from(track.values).every(Number.isFinite) ||
      Array.from(track.times).some((time, index) => index > 0 && (time < track.times[index - 1]! ||
        time === track.times[index - 1]! && Array.from(track.values.slice(index * size, (index + 1) * size))
          .some((value, component) => value !== track.values[(index - 1) * size + component]))))
    throw new Error('FBX 动作轨道数据无效')
}

function sampleQuaternion(track: THREE.KeyframeTrack, time: number, target: THREE.Quaternion, cursor: number[]) {
  const times = track.times, values = track.values
  while (cursor[0]! + 1 < times.length && times[cursor[0]! + 1]! <= time) cursor[0] = cursor[0]! + 1
  const index = cursor[0]!, next = Math.min(index + 1, times.length - 1)
  target.fromArray(values, index * 4)
  if (target.lengthSq() < 1e-8) throw new Error('FBX 包含无效旋转')
  target.normalize()
  if (index !== next) {
    const weight = THREE.MathUtils.clamp((time - times[index]!) / (times[next]! - times[index]!), 0, 1)
    target.slerp(new THREE.Quaternion().fromArray(values, next * 4).normalize(), weight)
  }
  return target
}

export function decodeTencentFbxSkeleton(root: THREE.Object3D): TencentFbxMotion {
  const clip = root.animations?.find(value => value.tracks.some(track => track.name.endsWith('.quaternion')))
  if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 30) throw new Error('FBX 未包含有效动作轨道')
  const bones = new Map<string, THREE.Object3D>()
  root.traverse(node => { if ((node as THREE.Bone).isBone) bones.set(key(node.name), node) })
  const tracks = new Map<string, THREE.KeyframeTrack>()
  for (const track of clip.tracks) {
    if (track.name.endsWith('.quaternion')) {
      validateTrack(track, 4)
      tracks.set(trackBone(track.name), track)
    }
  }
  // Fail closed for an unknown rig rather than applying wrong axes to the VRM.
  const body = TENCENT_SMPL_JOINTS.slice(0, 22)
  if (body.some(name => !bones.has(key(name)) || !tracks.has(key(name)))) throw new Error('FBX 不是受支持的腾讯 SMPL-H 人形动作')
  for (const name of body) {
    const bone = bones.get(key(name))!
    if (bone.quaternion.angleTo(identity) > .01) throw new Error('FBX 骨骼基准姿态不受支持')
  }
  // The verified Tencent file uses centimetres, +Y up, +X character-left.
  // Reject a different export orientation instead of silently mirroring it.
  root.updateMatrixWorld(true)
  const p = (name: string) => bones.get(key(name))!.getWorldPosition(new THREE.Vector3())
  if (p('Head').y <= p('Pelvis').y || p('L_Shoulder').x <= p('R_Shoulder').x)
    throw new Error('FBX 骨架坐标方向不受支持')
  const fps = 30
  const frames = Math.round(clip.duration * fps) + 1
  if (frames < 2 || frames > 901) throw new Error('FBX 动作时长无效')
  const poses = Array.from({ length: frames }, () => Array<number>(156).fill(0))
  const trans = Array.from({ length: frames }, () => [0, 0, 0])
  const q = new THREE.Quaternion()
  for (let joint = 0; joint < TENCENT_SMPL_JOINTS.length; joint++) {
    const track = tracks.get(key(TENCENT_SMPL_JOINTS[joint]!))
    if (!track) continue
    const cursor = [0]
    for (let frame = 0; frame < frames; frame++) {
      sampleQuaternion(track, frame / fps, q, cursor)
      if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      const sine = Math.hypot(q.x, q.y, q.z)
      const factor = sine < 1e-8 ? 2 : 2 * Math.atan2(sine, q.w) / sine
      poses[frame]![joint * 3] = q.x * factor
      poses[frame]![joint * 3 + 1] = q.y * factor
      poses[frame]![joint * 3 + 2] = q.z * factor
    }
  }
  const position = clip.tracks.find(track => track.name.endsWith('.position') && trackBone(track.name) === 'pelvis')
  if (position) {
    validateTrack(position, 3)
    const interpolant = (position as THREE.VectorKeyframeTrack).createInterpolant()
    for (let frame = 0; frame < frames; frame++) trans[frame] = Array.from(interpolant.evaluate(frame / fps) as ArrayLike<number>).map(value => value * .01)
  }
  return { fps, poses, trans, duration: frames / fps }
}

/** Parsing a motion must not follow texture references or upload any mesh. */
export function parseTencentFbxMotion(bytes: ArrayBuffer): TencentFbxMotion {
  if (bytes.byteLength < 64 || bytes.byteLength > 64 * 1024 * 1024) throw new Error('FBX 文件大小无效')
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(url => {
    if (url.startsWith('blob:')) URL.revokeObjectURL(url)
    return 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  })
  const root = new FBXLoader(manager).parse(bytes, '')
  try { return decodeTencentFbxSkeleton(root) }
  finally {
    root.traverse(node => {
      const mesh = node as THREE.Mesh
      mesh.geometry?.dispose()
      if (mesh.material) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
        material.dispose()
      }
    })
  }
}
