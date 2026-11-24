import * as THREE from 'three'
import { VRMHumanoid, type VRMHumanBones } from '@pixiv/three-vrm'

const aliases: Record<string, string[]> = {
  hips: ['hips', 'pelvis'], spine: ['spine', 'spine1'], chest: ['chest', 'spine1', 'spine2'], upperChest: ['upperchest', 'spine2', 'spine3'],
  neck: ['neck'], head: ['head'],
  leftShoulder: ['leftshoulder', 'lclavicle'], rightShoulder: ['rightshoulder', 'rclavicle'],
  leftUpperArm: ['leftarm', 'leftupperarm', 'lupperarm'], rightUpperArm: ['rightarm', 'rightupperarm', 'rupperarm'],
  leftLowerArm: ['leftforearm', 'leftlowerarm', 'lforearm'], rightLowerArm: ['rightforearm', 'rightlowerarm', 'rforearm'],
  leftHand: ['lefthand', 'lhand'], rightHand: ['righthand', 'rhand'],
  leftUpperLeg: ['leftupleg', 'leftupperleg', 'lthigh'], rightUpperLeg: ['rightupleg', 'rightupperleg', 'rthigh'],
  leftLowerLeg: ['leftleg', 'leftlowerleg', 'lcalf'], rightLowerLeg: ['rightleg', 'rightlowerleg', 'rcalf'],
  leftFoot: ['leftfoot', 'lfoot'], rightFoot: ['rightfoot', 'rfoot'],
  leftToes: ['lefttoebase', 'lefttoes'], rightToes: ['righttoebase', 'righttoes'],
}
const parent: Record<string, string> = {
  spine: 'hips', head: 'spine', leftUpperArm: 'spine', rightUpperArm: 'spine',
  leftLowerArm: 'leftUpperArm', leftHand: 'leftLowerArm', rightLowerArm: 'rightUpperArm', rightHand: 'rightLowerArm',
  leftUpperLeg: 'hips', rightUpperLeg: 'hips', leftLowerLeg: 'leftUpperLeg', rightLowerLeg: 'rightUpperLeg', leftFoot: 'leftLowerLeg', rightFoot: 'rightLowerLeg',
}
const required = ['hips', ...Object.keys(parent)]
function key(name: string) { return name.toLowerCase().replace(/^.*:/, '').replace(/^mixamorig\d*/, '').replace(/[^a-z0-9]/g, '') }

/** Explicit semantic aliases + hierarchy + rest-pose checks; never guess nonhuman rigs. */
export function adaptHumanoid(root: THREE.Object3D): { humanoid?: VRMHumanoid; reason: string } {
  const candidates: THREE.Bone[] = []
  root.traverse(node => { if (node instanceof THREE.Bone) candidates.push(node) })
  const mapped = new Map<string, THREE.Bone>(), used = new Set<THREE.Bone>()
  for (const [semantic, names] of Object.entries(aliases)) {
    for (const name of names) {
      const matches = candidates.filter(node => key(node.name) === name && !used.has(node))
      if (matches.length > 1) break
      if (matches.length === 1) { mapped.set(semantic, matches[0]!); used.add(matches[0]!); break }
    }
  }
  const missing = required.filter(name => !mapped.has(name))
  if (missing.length) return { reason: `静态场景 · 缺少或无法识别人形骨骼：${missing.join(', ')}` }
  for (const [child, ancestor] of Object.entries(parent)) {
    let node: THREE.Object3D | null = mapped.get(child)!.parent
    while (node && node !== mapped.get(ancestor)) node = node.parent
    if (!node) return { reason: '静态场景 · 骨骼层级不符合人形结构' }
  }
  root.updateMatrixWorld(true)
  const pos = (name: string) => mapped.get(name)!.getWorldPosition(new THREE.Vector3())
  const height = pos('head').y - pos('hips').y
  if (!(height > 0.00001) || pos('leftUpperArm').x <= pos('rightUpperArm').x)
    return { reason: '静态场景 · 请导出 Y 向上、面向 +Z 的人形 T-pose' }
  for (const side of ['left', 'right']) {
    const upper = pos(`${side}UpperArm`), hand = pos(`${side}Hand`)
    if (Math.abs(hand.y - upper.y) > Math.abs(hand.x - upper.x) * 0.35)
      return { reason: '静态场景 · 请先将人形骨架转换为 T-pose 后导出' }
  }
  for (const bone of mapped.values()) {
    const scale = bone.getWorldScale(new THREE.Vector3())
    if (Math.min(scale.x, scale.y, scale.z) <= 0 || Math.max(scale.x, scale.y, scale.z) / Math.min(scale.x, scale.y, scale.z) > 1.02)
      return { reason: '静态场景 · 骨骼含负缩放或非均匀缩放，请先应用变换' }
  }
  const semanticBones = new Set(mapped.values())
  let skinBound = false
  root.traverse(node => {
    if (skinBound || !(node instanceof THREE.SkinnedMesh)) return
    const indices = node.geometry.getAttribute('skinIndex')
    const weights = node.geometry.getAttribute('skinWeight')
    if (!indices || !weights) return
    const weightedIndices = new Set<number>()
    for (let vertex = 0; vertex < indices.count; vertex++) {
      for (let slot = 0; slot < indices.itemSize; slot++) {
        if (weights.getComponent(vertex, slot) > .001) weightedIndices.add(indices.getComponent(vertex, slot))
      }
    }
    const weighted = new Set([...weightedIndices].map(index => node.skeleton.bones[index]).filter(Boolean))
    skinBound = [...semanticBones].some(bone => weighted.has(bone))
  })
  if (!skinBound) return { reason: '静态场景 · 骨架未绑定到角色网格，无法播放可见动作' }
  const bones = Object.fromEntries([...mapped].map(([name, node]) => [name, { node }])) as unknown as VRMHumanBones
  return { humanoid: new VRMHumanoid(bones), reason: '通用人形骨架 · 云动作已适配（Mixamo/标准命名；无 VRM 表情）' }
}
