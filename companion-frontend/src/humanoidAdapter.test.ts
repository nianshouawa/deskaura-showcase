import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import { adaptHumanoid } from './humanoidAdapter'
import { isFBX, loadModelScene } from './modelScene'

function fixture(scale = 1) {
  const root = new THREE.Group(); root.scale.setScalar(scale)
  const nodes = new Map<string, THREE.Bone>()
  function bone(name: string, parent: string | undefined, x: number, y: number, z = 0) {
    const node = new THREE.Bone(); node.name = `mixamorig:${name}`; node.position.set(x, y, z)
    ;(parent ? nodes.get(parent)! : root).add(node); nodes.set(name, node)
  }
  bone('Hips', undefined, 0, 1); bone('Spine', 'Hips', 0, .2); bone('Spine1', 'Spine', 0, .2)
  bone('Spine2', 'Spine1', 0, .1); bone('Neck', 'Spine2', 0, .1); bone('Head', 'Neck', 0, .1)
  for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
    bone(`${side}Shoulder`, 'Spine2', sign * .1, 0); bone(`${side}Arm`, `${side}Shoulder`, sign * .1, 0)
    bone(`${side}ForeArm`, `${side}Arm`, sign * .3, 0); bone(`${side}Hand`, `${side}ForeArm`, sign * .3, 0)
    bone(`${side}UpLeg`, 'Hips', sign * .1, -.1); bone(`${side}Leg`, `${side}UpLeg`, 0, -.4); bone(`${side}Foot`, `${side}Leg`, 0, -.4, .1)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0], 4))
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  mesh.bind(new THREE.Skeleton([...nodes.values()] as THREE.Bone[]))
  root.add(mesh)
  return { root, nodes, mesh }
}
describe('generic model loading and normalized humanoid', () => {
  it('transfers motion and preserves root position for centimetre-scaled Mixamo rigs', () => {
    const { root, nodes } = fixture(.01), adapted = adaptHumanoid(root)
    expect(adapted.humanoid, adapted.reason).toBeDefined()
    const scene = new THREE.Scene(); scene.add(root, adapted.humanoid!.normalizedHumanBonesRoot)
    const before = nodes.get('Hips')!.getWorldPosition(new THREE.Vector3())
    adapted.humanoid!.getNormalizedBoneNode('leftLowerArm')!.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), .5)
    adapted.humanoid!.update()
    expect(nodes.get('LeftForeArm')!.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(.5)
    expect(nodes.get('Hips')!.getWorldPosition(new THREE.Vector3()).distanceTo(before)).toBeLessThan(1e-6)
  })
  it('rejects incomplete, nonuniform and A-pose rigs', () => {
    const { root, nodes } = fixture(); root.scale.y = 2
    expect(adaptHumanoid(root).humanoid).toBeUndefined()
    root.scale.setScalar(1); nodes.get('LeftForeArm')!.position.y = -.8
    expect(adaptHumanoid(root).humanoid).toBeUndefined()
    nodes.get('Head')!.name = 'unknown'
    expect(adaptHumanoid(root).humanoid).toBeUndefined()
  })
  it('rejects a humanoid skeleton that is not bound to any skinned mesh', () => {
    const { root, mesh } = fixture()
    root.remove(mesh)
    expect(adaptHumanoid(root).humanoid).toBeUndefined()
    expect(adaptHumanoid(root).reason).toContain('未绑定')
  })
  it('sniffs binary and ASCII FBX even when legacy blob filenames say VRM', () => {
    expect(isFBX(new TextEncoder().encode('Kaydara FBX Binary  \0'))).toBe(true)
    expect(isFBX(new TextEncoder().encode('; FBX 7.4.0'))).toBe(true)
    expect(isFBX(new TextEncoder().encode('{}'))).toBe(false)
  })
  it('loads a real static glTF scene without VRM metadata', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Static' }] }))))
    try {
      const result = await loadModelScene('http://localhost/model.gltf')
      expect(result.root.children[0]?.name).toBe('Static')
      expect(result.humanoid).toBeUndefined()
      expect(result.capability).toContain('静态')
    } finally { vi.unstubAllGlobals() }
  })
})
