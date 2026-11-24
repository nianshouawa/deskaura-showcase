// Read-only eye skinning audit using the same gaze controller as the desktop.
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
VRMUtils.removeUnnecessaryVertices(vrm.scene)
VRMUtils.combineSkeletons(vrm.scene)
VRMUtils.rotateVRM0(vrm)
vrm.scene.updateMatrixWorld(true)
const ts = require('typescript')
const code = ts.transpileModule(fs.readFileSync(new URL('../companion-frontend/src/avatarDetails.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText.replaceAll("'three'", JSON.stringify(pathToFileURL(require.resolve('three')).href))
const source = code.replaceAll("'@pixiv/three-vrm'", JSON.stringify(new URL('../companion-frontend/node_modules/@pixiv/three-vrm/lib/three-vrm.module.js', import.meta.url).href))
const { AvatarCursorGaze, configureAvatarGaze } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const eyes = ['leftEye', 'rightEye'].map(name => vrm.humanoid.getRawBoneNode(name))
const affected = []
vrm.scene.traverse(mesh => {
  if (!mesh.isSkinnedMesh) return
  const indices = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight
  const vertices = []
  for (let i = 0; i < indices.count; i++) {
    let weight = 0
    for (let j = 0; j < 4; j++) if (eyes.includes(mesh.skeleton.bones[indices.getComponent(i, j)])) weight += weights.getComponent(i, j)
    if (weight > .1) vertices.push(i)
  }
  affected.push({ mesh, vertices })
})
console.log('EYE_SKIN', affected.map(({ mesh, vertices }) => ({ mesh: mesh.name, influenced: vertices.length })))
console.log('EYE_BONES', eyes.map(eye => ({ name: eye?.name, position: eye?.getWorldPosition(new THREE.Vector3()).toArray() })))
console.log('SELECTED_CONTROLLER', configureAvatarGaze(vrm))
// Morph-driven eyes have no weighted eye vertices: verify their real mesh too.
for (const item of affected) if (item.mesh.morphTargetInfluences) {
  item.vertices = Array.from({ length: item.mesh.geometry.attributes.position.count }, (_, i) => i)
}
const gaze = new AvatarCursorGaze(vrm.lookAt)
const camera = new THREE.PerspectiveCamera(35, 1.6, .1, 100)
camera.position.set(0, 1, 3); camera.lookAt(0, 1, 0); camera.updateMatrixWorld(true)
const rect = { left: 0, top: 0, width: 1600, height: 1000 }
const snapshots = {}
for (const [direction, x, y] of [['left', 0, 200], ['right', 1600, 200], ['up', 800, 0], ['down', 800, 1000]]) {
  for (let i = 0; i < 120; i++) {
    gaze.update({ x, y, at: i * 1000 / 60 }, camera, rect, i * 1000 / 60, 1 / 60)
    vrm.update(1 / 60)
    vrm.scene.updateMatrixWorld(true)
  }
  for (const { mesh } of affected) mesh.skeleton.update()
  snapshots[direction] = affected.flatMap(({ mesh, vertices }) => vertices.map(i => mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld)))
  console.log(direction, { yaw: vrm.lookAt.yaw, pitch: vrm.lookAt.pitch,
    eyes: eyes.map(eye => eye.quaternion.toArray()) })
}
const distances = snapshots.left.map((point, i) => point.distanceTo(snapshots.right[i]))
const changed = distances.map((distance, i) => ({ distance, i })).filter(item => item.distance > .004)
console.log('ACTUAL_SKIN_MOVEMENT', { vertices: distances.length, max: distances.reduce((a, b) => Math.max(a, b), 0),
  mean: distances.reduce((a, b) => a + b, 0) / Math.max(1, distances.length),
  changed: changed.length,
  meanRightwardDelta: changed.reduce((sum, { i }) => sum + snapshots.right[i].x - snapshots.left[i].x, 0) / Math.max(1, changed.length),
  meanUpwardDelta: changed.reduce((sum, { i }) => sum + snapshots.up[i].y - snapshots.down[i].y, 0) / Math.max(1, changed.length) })
