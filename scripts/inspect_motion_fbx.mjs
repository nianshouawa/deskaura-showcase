// Structural QA for downloaded provider FBX; textures are intentionally ignored.
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
const require = createRequire(new URL('../companion-frontend/package.json', import.meta.url))
const THREE = await import(pathToFileURL(require.resolve('three')).href)
const { FBXLoader } = await import(pathToFileURL(require.resolve('three/examples/jsm/loaders/FBXLoader.js')).href)
globalThis.ProgressEvent = class { constructor(type, init) { Object.assign(this, { type }, init) } }
THREE.TextureLoader.prototype.load = function() { return new THREE.Texture() }
globalThis.window = { URL: { createObjectURL: () => '', revokeObjectURL: () => {} } }
globalThis.document = { createElementNS: () => ({ addEventListener() {}, removeEventListener() {}, set src(value) {} }) }
const data = fs.readFileSync(process.argv[2])
const fbx = new FBXLoader().parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
if (process.argv.includes('--canonical') || process.argv.includes('--canonical-output')) {
  const ts = require('typescript')
  const threeUrl = pathToFileURL(require.resolve('three')).href
  const fbxLoaderUrl = pathToFileURL(require.resolve('three/examples/jsm/loaders/FBXLoader.js')).href
  const code = ts.transpileModule(fs.readFileSync(new URL('../companion-frontend/src/fbxMotion.ts', import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText.replaceAll("'three'", JSON.stringify(threeUrl)).replaceAll("'three/examples/jsm/loaders/FBXLoader.js'", JSON.stringify(fbxLoaderUrl))
  const { decodeTencentFbxSkeleton } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))
  const canonical = decodeTencentFbxSkeleton(fbx)
  const outputIndex = process.argv.indexOf('--canonical-output')
  if (outputIndex >= 0) {
    if (!process.argv[outputIndex + 1]) throw new Error('Missing canonical output path')
    fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(canonical))
  }
  console.log(JSON.stringify({
    frames: canonical.poses.length, joints: canonical.poses[0].length / 3,
    fps: canonical.fps, duration: canonical.duration,
    finite: canonical.poses.every(row => row.every(Number.isFinite)),
    maxRotation: Math.max(...canonical.poses.flat().map(Math.abs)),
    translation: [canonical.trans[0], canonical.trans.at(-1)],
  }))
  process.exit(0)
}
const bones = []
fbx.updateMatrixWorld(true)
fbx.traverse(node => {
  if (node.isBone) bones.push({
    name: node.name, parent: node.parent?.name,
    p: node.position.toArray().map(v => +v.toFixed(5)),
    q: node.quaternion.toArray().map(v => +v.toFixed(5)),
    world: node.getWorldPosition(new THREE.Vector3()).toArray().map(v => +v.toFixed(5)),
  })
})
console.log(JSON.stringify({
  bones, animations: fbx.animations.map(clip => ({
    name: clip.name, duration: clip.duration, tracks: clip.tracks.map(track => ({
      name: track.name, type: track.ValueTypeName, count: track.times.length,
      first: Array.from(track.values).slice(0, 4), last: Array.from(track.values).slice(-4),
    })),
  })),
}, null, 2))
