import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { VRMLoaderPlugin, type VRM, type VRMHumanoid } from '@pixiv/three-vrm'
import { adaptHumanoid } from './humanoidAdapter'

export function isFBX(bytes: Uint8Array) {
  const header = new TextDecoder().decode(bytes.subarray(0, 256))
  return header.startsWith('Kaydara FBX Binary') || header.includes('FBXHeaderExtension') || header.startsWith('; FBX')
}
export async function loadModelScene(url: string): Promise<{ root: THREE.Object3D; vrm?: VRM; humanoid?: VRMHumanoid; capability: string }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`模型读取失败 (${response.status})`)
  const buffer = await response.arrayBuffer(), base = url.slice(0, url.lastIndexOf('/') + 1)
  if (isFBX(new Uint8Array(buffer))) {
    const root = new FBXLoader().parse(buffer, base), adapted = adaptHumanoid(root)
    return { root, humanoid: adapted.humanoid, capability: `FBX · ${adapted.reason}` }
  }
  const loader = new GLTFLoader()
  loader.register(parser => new VRMLoaderPlugin(parser))
  const gltf = await loader.parseAsync(buffer, base), vrm = gltf.userData.vrm as VRM | undefined
  const adapted = vrm ? undefined : adaptHumanoid(gltf.scene)
  return { root: vrm?.scene || gltf.scene, vrm, humanoid: vrm?.humanoid || adapted?.humanoid,
    capability: vrm ? 'VRM 人形骨架 · 云动作 / 表情就绪' : `glTF · ${adapted?.reason}` }
}
