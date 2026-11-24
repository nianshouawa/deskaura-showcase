// Read-only raycast diagnostics against the actual skinned avatar.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../companion-frontend/package.json', import.meta.url))
const THREE = await import(pathToFileURL(require.resolve('three')).href)
const { GLTFLoader } = await import(pathToFileURL(require.resolve('three/examples/jsm/loaders/GLTFLoader.js')).href)
const { VRMLoaderPlugin, VRMUtils } = await import(new URL('../companion-frontend/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js', import.meta.url))
globalThis.ProgressEvent = class { constructor(type, init) { Object.assign(this, { type }, init) } }
const bytes = fs.readFileSync(process.argv[2])
const loader = new GLTFLoader()
loader.register(parser => { parser.loadTexture = async () => null; return new VRMLoaderPlugin(parser) })
const gltf = await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')
const vrm = gltf.userData.vrm
VRMUtils.rotateVRM0(vrm)
vrm.scene.updateMatrixWorld(true)
const rig = vrm.humanoid
const boneRegions = new Map()
for (const [name, bone] of Object.entries(rig.rawHumanBones)) {
  const region = /UpperLeg|LowerLeg/.test(name) ? 'leg' : /Foot|Toes/.test(name) ? 'foot' :
    /Arm|Shoulder/.test(name) ? 'arm' : /Hand/.test(name) ? 'hand' :
    /head|neck|Eye|jaw/.test(name) ? 'head' : /hips|spine|chest|upperChest/.test(name) ? 'torso' : undefined
  if (region) boneRegions.set(bone.node, region)
}
const positions = {}
for (const name of ['hips', 'chest', 'neck', 'leftUpperLeg', 'rightUpperLeg']) {
  positions[name] = rig.getRawBoneNode(name).getWorldPosition(new THREE.Vector3())
}
console.log('LANDMARKS', JSON.stringify(positions))
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(new URL('../companion-frontend/src/avatarBodyRegions.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replaceAll("'three'", JSON.stringify(pathToFileURL(require.resolve('three')).href))
const regions = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
const ray = new THREE.Raycaster()
const report = []
for (const x of [0, .04, .10]) for (const y of [.84, .88, .92, .96, 1.00, 1.06, 1.14, 1.24, 1.34]) {
  ray.set(new THREE.Vector3(x, y, 3), new THREE.Vector3(0, 0, -1))
  const hit = ray.intersectObject(vrm.scene, true).find(h => h.object.visible)
  if (!hit) continue
  const mesh = hit.object
  const scores = {}
  const weightedRegions = {}
  if (mesh.isSkinnedMesh && hit.face) {
    const ids = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight')
    for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) for (let i = 0; i < 4; i++) {
      const bone = mesh.skeleton.bones[ids.getComponent(vertex, i)]
      scores[bone.name] = (scores[bone.name] || 0) + weights.getComponent(vertex, i)
      let node = bone
      while (node && !boneRegions.has(node)) node = node.parent
      const region = boneRegions.get(node)
      if (region) weightedRegions[region] = (weightedRegions[region] || 0) + weights.getComponent(vertex, i)
    }
  }
  const base = Object.entries(weightedRegions).sort((a, b) => b[1] - a[1])[0]?.[0] || 'torso'
  const region = regions.bodyTouchRegion(base, hit.point, positions.hips, positions.chest,
    positions.neck, positions.leftUpperLeg, positions.rightUpperLeg)
  report.push({ x, y, mesh: mesh.name, base, region })
}
console.log(JSON.stringify(report, null, 2))
for (const y of [.88, .92, .96]) {
  if (report.find(row => row.x === 0 && row.y === y)?.region !== 'groin') throw new Error(`Central groin failed at ${y}`)
  if (report.find(row => row.x === .1 && row.y === y)?.region !== 'leg') throw new Error(`Thigh incorrectly private at ${y}`)
}
if (report.find(row => row.x === 0 && row.y === 1.06)?.region !== 'belly') throw new Error('Belly incorrectly private')
console.log('PASS: actual skinned mesh groin, thigh and belly raycasts')
