// Read-only skeleton and surface diagnostics; textures are not needed in Node.
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
console.log('META', vrm.meta.metaVersion)
const rig = vrm.humanoid
for (const [name, bone] of Object.entries(rig.normalizedHumanBones)) {
  if (/finger|thumb|index|middle|ring|little|Eye|Jaw/i.test(name)) continue
  console.log(name, bone.node.position.toArray().map(v => +v.toFixed(5)), 'parent', bone.node.parent.name)
}
gltf.scene.updateMatrixWorld(true)
let meshes = 0, vertices = 0
gltf.scene.traverse(node => { if (node.isSkinnedMesh) { meshes++; vertices += node.geometry.attributes.position.count } })
console.log('SURFACE', meshes, vertices)
if (process.argv.includes('--features')) {
  console.log('FEATURES', JSON.stringify({
    lookAt: vrm.lookAt?.applier.constructor.name,
    expressions: Object.keys(vrm.expressionManager?.expressionMap || {}),
    fingers: Object.keys(rig.normalizedHumanBones).filter(name => /Thumb|Index|Middle|Ring|Little/.test(name)),
    handFrames: Object.fromEntries(['left', 'right'].map(side => [side, Object.fromEntries(['Hand', 'ThumbMetacarpal', 'IndexProximal', 'MiddleProximal', 'LittleProximal', 'MiddleDistal'].map(part => [part, rig.getNormalizedBoneNode(side + part)?.getWorldPosition(new THREE.Vector3()).toArray()]))])),
    springs: [...(vrm.springBoneManager?.springBones || [])].map(joint => joint.bone.name),
    springHumanoidOverlap: [...(vrm.springBoneManager?.springBones || [])].flatMap(joint => Object.entries(rig.rawHumanBones).filter(([, bone]) => bone.node === joint.bone).map(([name]) => name)),
  }))
}

if (process.argv.includes('--audit')) {
  // Import the same TypeScript source used by the desktop, without emitting files.
  const ts = require('typescript')
  const threeUrl = pathToFileURL(require.resolve('three')).href
  async function source(name, overrides = {}) {
    let code = ts.transpileModule(fs.readFileSync(new URL('../companion-frontend/src/' + name, import.meta.url), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    }).outputText.replaceAll("'three'", JSON.stringify(threeUrl))
    for (const [key, value] of Object.entries(overrides)) code = code.replaceAll(JSON.stringify(key), JSON.stringify(value)).replaceAll(`'${key}'`, JSON.stringify(value))
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64')
  }
  const motionUrl = await source('motion.ts')
  const { prepareMotionTracks, sampleTrack, sampleLoopTrack, smoothBone } = await import(await source('motionPlayback.ts', { './motion': motionUrl }))
  const { AvatarMotionSafety, alignSwayFootTargets, limitJointRotation, motionSafetyProfile, stabilizeBowTargets } = await import(await source('motionSafety.ts'))
  const flip = vrm.meta.metaVersion === '0'
  VRMUtils.rotateVRM0(vrm)
  const rest = new Map(Object.entries(rig.normalizedHumanBones).map(([name, bone]) => [name, bone.node.quaternion.clone()]))
  const safety = new AvatarMotionSafety(rig, gltf.scene)
  console.log('ENVELOPE', safety.height, safety.slices)
  const audit = []
  const runtime = process.argv.includes('--runtime')
  const selection = process.argv.indexOf('--only')
  const only = selection < 0 ? [] : process.argv[selection + 1].split(',')
  // Independent surface check: ray/triangle crossings of actual skinned torso
  // triangles, NOT the same ellipse used by the correction algorithm.
  const surface = process.argv.includes('--surface')
  const surfaces = []
  if (surface) gltf.scene.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return
    const index = mesh.geometry.index, skins = mesh.geometry.attributes.skinIndex, weights = mesh.geometry.attributes.skinWeight
    const torso = mesh.skeleton.bones.map(bone => {
      for (let node = bone; node; node = node.parent) {
        if (['leftShoulder', 'rightShoulder', 'leftUpperLeg', 'rightUpperLeg'].some(name => rig.getRawBoneNode(name) === node)) return false
        if (['hips', 'spine', 'chest', 'upperChest', 'neck'].some(name => rig.getRawBoneNode(name) === node)) return true
      }
      return false
    })
    const included = i => {
      let weight = 0
      for (let j = 0; j < 4; j++) if (torso[skins.getComponent(i, j)]) weight += weights.getComponent(i, j)
      return weight >= .6
    }
    const triangles = []
    for (let i = 0; i < (index?.count || skins.count); i += 3) {
      const ids = [0, 1, 2].map(j => index ? index.getX(i + j) : i + j)
      if (ids.every(included)) triangles.push(ids)
    }
    if (triangles.length) surfaces.push({ mesh, triangles })
  })
  const directoryIndex = process.argv.indexOf('--library-dir')
  const clipDirectory = directoryIndex < 0 ? new URL('../motion-service/data/cloud_motions/', import.meta.url)
    : pathToFileURL(process.argv[directoryIndex + 1].replaceAll('\\', '/').replace(/\/?$/, '/'))
  for (const name of fs.readdirSync(clipDirectory).filter(n => n.startsWith('cloud_') && n.endsWith('.json') && !n.includes('.canonical.') && !n.includes('.receipt.'))) {
    const clip = JSON.parse(fs.readFileSync(new URL(name, clipDirectory)))
    if (only.length && !only.includes(clip.id)) continue
    const idle = JSON.parse(fs.readFileSync(new URL('../motion-service/data/cloud_motions/cloud_idle.json', import.meta.url)))
    const tracks = prepareMotionTracks(clip.poses, rest, flip, { id: clip.id, idlePoses: idle.poses })
    const profile = motionSafetyProfile(clip.id)
    const q = new THREE.Quaternion(), scratch = new THREE.Quaternion()
    if (process.argv.includes('--from-idle')) {
      rig.resetNormalizedPose(); safety.reset()
      const ambient = prepareMotionTracks(idle.poses, rest, flip, { id: 'cloud_idle' })
      const filteredIdle = new Map([...rest].map(([bone, rotation]) => [bone, rotation.clone()]))
      for (let frame = 0; frame < 120; frame++) {
        for (const [bone, track] of ambient) {
          sampleLoopTrack(track, frame / 60, idle.fps, q, scratch)
          limitJointRotation(bone, q, rest.get(bone), flip, 'conversation', q)
          smoothBone(filteredIdle.get(bone), q, bone, 1 / 60)
          rig.getNormalizedBoneNode(bone).quaternion.copy(filteredIdle.get(bone))
        }
        safety.apply(1 / 60, 'conversation', THREE.MathUtils.smoothstep(frame / 60, 0, .8), 'fluent')
      }
      rig.update();gltf.scene.updateMatrixWorld(true)
    }
    let largestCorrection = 0, corrections = 0, maxElbow = 0, maxWrist = 0
    let initialPenetrations = 0, finalPenetrations = 0, worstDepth = 0
    let maxCorrectedStep = 0, worstStep, previous = new Map(), previousPrevious = new Map()
    let steadyArmAcceleration = 0, accelerationSamples = 0, maxRootYaw = 0, maxGroundDrift = 0
    let maxBodyStep = 0, maxBodySecondDifference = 0
    let maxWristBend = 0, maxFootWidth = 0, minFootWidth = Infinity, minStackGap = Infinity
    let maxToeYaw = 0
    let minEntryStackGap = Infinity, minEntryHandGap = Infinity, minEntryPalmGap = Infinity
    const previousBody = new Map(), previousPreviousBody = new Map(), yawSamples = [], palmSamples = []
    let surfaceCrossings = 0, surfaceChecks = 0
    const surfaceMeshes = {}
    const samplesLog = []
    let minHandGap = Infinity, maxHandGap = 0, rawMinHandGap = Infinity, rawMaxHandGap = 0
    function penetration() {
      let count = 0
      for (const side of ['left', 'right']) {
        const elbow = rig.getNormalizedBoneNode(side + 'LowerArm').getWorldPosition(new THREE.Vector3())
        const hand = rig.getNormalizedBoneNode(side + 'Hand').getWorldPosition(new THREE.Vector3())
        for (const t of [0, .25, .5, .75, 1]) {
          const p = elbow.clone().lerp(hand, t).applyMatrix4(safety.inverseTorso)
          const slice = safety.slice(p.y)
          if (!slice) continue
          const power = safety.contactPower(slice)
          const d = Math.pow(Math.abs((p.x - slice.x) / (slice.rx + safety.padding)) ** power
            + Math.abs((p.z - slice.z) / (slice.rz + safety.padding)) ** power, 1 / power)
          if (d < .98) { count++; worstDepth = Math.max(worstDepth, 1 - d) }
        }
      }
      return count
    }
    // Optional sequential check includes entry blending, the speed limiter and
    // two loop seams. Independent-pose audit remains the default.
    const samples = runtime ? Math.ceil(clip.duration * 2 * 60) : 240
    const entry = new Map([...tracks.keys()].map(name => [name, rig.getNormalizedBoneNode(name).quaternion.clone()]))
    const filtered = new Map([...entry].map(([name, value]) => [name, value.clone()]))
    const targets = new Map([...entry].map(([name, value]) => [name, value.clone()]))
    safety.reset()
    for (let i = 0; i < samples; i++) {
      if (!runtime) rig.resetNormalizedPose()
      const elapsed = runtime ? i / 60 : i * clip.duration / samples
      for (const [bone, track] of tracks) {
        if (clip.loop) sampleLoopTrack(track, elapsed, clip.fps, q, scratch)
        else sampleTrack(track, elapsed, clip.fps, q)
        q.copy(limitJointRotation(bone, q, rest.get(bone), flip, profile))
        targets.get(bone).copy(q)
      }
      if (profile === 'bow' || profile === 'fatigue') stabilizeBowTargets(targets, rest)
      if (profile === 'turning') alignSwayFootTargets(targets, rig)
      for (const [bone, goal] of targets) {
        q.copy(goal)
        const node = rig.getNormalizedBoneNode(bone)
        if (runtime) {
          q.slerp(entry.get(bone), 1 - THREE.MathUtils.smoothstep(elapsed, 0, .8))
          smoothBone(filtered.get(bone), q, bone, 1 / 60)
          node.quaternion.copy(filtered.get(bone))
        } else node.quaternion.copy(q)
      }
      rig.normalizedHumanBonesRoot.updateWorldMatrix(true, true)
      // Refresh body frame without mutating the pose to count raw collisions.
      safety.bodyToWorld.compose(safety.torso.getWorldPosition(new THREE.Vector3()), safety.torso.getWorldQuaternion(new THREE.Quaternion()).multiply(safety.torsoRestRotation.clone().invert()), safety.root.getWorldScale(new THREE.Vector3()))
        .multiply(new THREE.Matrix4().makeTranslation(-safety.torsoRest.x, -safety.torsoRest.y, -safety.torsoRest.z))
      safety.inverseTorso.copy(safety.bodyToWorld).invert()
      initialPenetrations += penetration()
      const sourceGap = rig.getNormalizedBoneNode('leftHand').getWorldPosition(new THREE.Vector3()).distanceTo(rig.getNormalizedBoneNode('rightHand').getWorldPosition(new THREE.Vector3()))
      if (elapsed >= 1 && elapsed <= clip.duration - 1) { rawMinHandGap = Math.min(rawMinHandGap, sourceGap); rawMaxHandGap = Math.max(rawMaxHandGap, sourceGap) }
      if (!runtime) safety.reset()
      const stats = safety.apply(1 / 60, profile, runtime ? THREE.MathUtils.smoothstep(elapsed, 0, .8) : 1, process.argv.includes('--fluent') ? 'fluent' : 'clearance')
      if (profile === 'nervous' && elapsed <= 1.2) {
        const upper = safety.arms.find(arm => arm.side === safety.forwardSign), lower = safety.arms.find(arm => arm !== upper)
        const high = upper.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso)
        const low = lower.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso)
        minEntryStackGap = Math.min(minEntryStackGap, high.y - low.y)
        minEntryHandGap = Math.min(minEntryHandGap, high.distanceTo(low))
        const proxies = safety.arms.map(arm => {
          const side = arm.side === safety.forwardSign ? 'left' : 'right'
          const wrist = arm.hand.getWorldPosition(new THREE.Vector3())
          const middle = rig.getNormalizedBoneNode(side + 'MiddleProximal')
          return [wrist, middle ? middle.getWorldPosition(new THREE.Vector3()) : wrist]
        })
        for (const a of proxies[0]) for (const b of proxies[1]) minEntryPalmGap = Math.min(minEntryPalmGap, a.distanceTo(b))
      }
      corrections += stats.corrections
      largestCorrection = Math.max(largestCorrection, stats.largestCorrection)
      finalPenetrations += penetration()
      const gap = rig.getNormalizedBoneNode('leftHand').getWorldPosition(new THREE.Vector3()).distanceTo(rig.getNormalizedBoneNode('rightHand').getWorldPosition(new THREE.Vector3()))
      const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(rig.getNormalizedBoneNode('hips').quaternion)
      maxRootYaw = Math.max(maxRootYaw, Math.abs(Math.atan2(facing.x, facing.z)) * 180 / Math.PI)
      if (elapsed > 1) {
        yawSamples.push(Math.atan2(facing.x, facing.z) * 180 / Math.PI)
        for (const [bone, mapped] of Object.entries(rig.normalizedHumanBones)) {
          if (!/hips|spine|chest|upperChest|head|neck|Leg|Foot|Toes/.test(bone)) continue
          const q = mapped.node.quaternion
          if (previousBody.has(bone)) maxBodyStep = Math.max(maxBodyStep, previousBody.get(bone).angleTo(q) * 180 / Math.PI)
          if (previousPreviousBody.has(bone)) maxBodySecondDifference = Math.max(maxBodySecondDifference,
            previousPreviousBody.get(bone).clone().slerp(q, .5).angleTo(previousBody.get(bone)) * 180 / Math.PI)
          if (previousBody.has(bone)) previousPreviousBody.set(bone, previousBody.get(bone))
          previousBody.set(bone, q.clone())
        }
        if (['disgusted', 'affectionate', 'nervous'].includes(profile)) {
          const front = new THREE.Vector3(0, 0, safety.forwardSign * (profile === 'nervous' ? -1 : 1)).transformDirection(safety.bodyToWorld)
          palmSamples.push(safety.arms.map(arm => {
            if (!arm.palmFrame) return null
            const frame = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmFrame)
            const palm = new THREE.Vector3(1, 0, 0).applyQuaternion(frame)
              .cross(new THREE.Vector3(0, 1, 0).applyQuaternion(frame)).multiplyScalar(arm.side / safety.forwardSign).normalize()
            return +palm.dot(front).toFixed(4)
          }))
        }
        if (profile === 'nervous') {
          for (const arm of safety.arms) maxWristBend = Math.max(maxWristBend, arm.hand.quaternion.angleTo(arm.handRest) * 180 / Math.PI)
          const upper = safety.arms.find(arm => arm.side === safety.forwardSign)
          if (upper) {
            const lower = safety.arms.find(arm => arm !== upper)
            const high = upper.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso)
            const low = lower.hand.getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso)
            minStackGap = Math.min(minStackGap, high.y - low.y)
          }
        }
        const hipsFrame = rig.getNormalizedBoneNode('hips').matrixWorld.clone().invert()
        const feet = ['leftFoot', 'rightFoot'].map(name => rig.getNormalizedBoneNode(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(hipsFrame))
        const width = Math.abs(feet[0].x - feet[1].x)
        maxFootWidth = Math.max(maxFootWidth, width)
        minFootWidth = Math.min(minFootWidth, width)
        for (const side of ['left', 'right']) {
          const foot = rig.getNormalizedBoneNode(side + 'Foot'), toes = rig.getNormalizedBoneNode(side + 'Toes')
          if (!toes) continue
          const direction = toes.getWorldPosition(new THREE.Vector3()).sub(foot.getWorldPosition(new THREE.Vector3()))
            .transformDirection(hipsFrame)
          const yaw = Math.atan2(direction.x * safety.forwardSign, direction.z * safety.forwardSign) * 180 / Math.PI
          maxToeYaw = Math.max(maxToeYaw, Math.abs(yaw))
        }
      }
      if (elapsed > 1) maxGroundDrift = Math.max(maxGroundDrift, safety.groundAnchor.measure().distanceTo(safety.groundAnchor.reference))
      if (elapsed >= 1 && elapsed <= clip.duration - 1) { minHandGap = Math.min(minHandGap, gap); maxHandGap = Math.max(maxHandGap, gap) }
      if (surface && i % 30 === 0) {
        rig.update(); gltf.scene.updateMatrixWorld(true)
        const triangle = new THREE.Triangle(), hit = new THREE.Vector3()
        for (const side of ['left', 'right']) {
          const elbow = rig.getRawBoneNode(side + 'LowerArm').getWorldPosition(new THREE.Vector3())
          const wrist = rig.getRawBoneNode(side + 'Hand').getWorldPosition(new THREE.Vector3())
          const ray = new THREE.Ray(elbow, wrist.clone().sub(elbow).normalize())
          const length = elbow.distanceTo(wrist)
          for (const { mesh, triangles } of surfaces) {
            for (const ids of triangles) {
              ids.forEach((id, n) => mesh.getVertexPosition(id, [triangle.a, triangle.b, triangle.c][n]).applyMatrix4(mesh.matrixWorld))
              if (ray.intersectTriangle(triangle.a, triangle.b, triangle.c, false, hit) && hit.distanceTo(elbow) < length) {
                surfaceCrossings++
                surfaceMeshes[mesh.name || '(unnamed)'] = (surfaceMeshes[mesh.name || '(unnamed)'] || 0) + 1
                if (process.argv.includes('--surface-details') && i === 120) console.log('CROSSING', clip.id, side, mesh.name, {
                  hit: hit.clone().applyMatrix4(safety.inverseTorso).toArray(),
                  rawElbow: elbow.clone().applyMatrix4(safety.inverseTorso).toArray(),
                  rawWrist: wrist.clone().applyMatrix4(safety.inverseTorso).toArray(),
                  normalizedElbow: rig.getNormalizedBoneNode(side + 'LowerArm').getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso).toArray(),
                  normalizedWrist: rig.getNormalizedBoneNode(side + 'Hand').getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso).toArray(),
                })
              }
            }
          }
          surfaceChecks++
        }
      }
      if (process.argv.includes('--positions') && i % 30 === 0) {
        samplesLog.push({ t: +elapsed.toFixed(2), hands: ['leftHand', 'rightHand'].map(name => rig.getNormalizedBoneNode(name).getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso).toArray().map(v => +v.toFixed(3))), head: rig.getNormalizedBoneNode('head').getWorldPosition(new THREE.Vector3()).applyMatrix4(safety.inverseTorso).toArray().map(v => +v.toFixed(3)), headPitch: +new THREE.Euler().setFromQuaternion(rig.getNormalizedBoneNode('head').quaternion).x.toFixed(3) })
      }
      for (const side of ['left', 'right']) {
        maxElbow = Math.max(maxElbow, THREE.MathUtils.radToDeg(rig.getNormalizedBoneNode(side + 'LowerArm').quaternion.angleTo(new THREE.Quaternion())))
        maxWrist = Math.max(maxWrist, THREE.MathUtils.radToDeg(rig.getNormalizedBoneNode(side + 'Hand').quaternion.angleTo(new THREE.Quaternion())))
        for (const part of ['UpperArm', 'LowerArm', 'Hand']) {
          const name = side + part, rotation = rig.getNormalizedBoneNode(name).quaternion
          if (previous.has(name)) {
            const step = THREE.MathUtils.radToDeg(previous.get(name).angleTo(rotation))
            if (step > maxCorrectedStep) { maxCorrectedStep = step; worstStep = { name, elapsed: +elapsed.toFixed(3), corrections: stats.corrections, offset: +stats.largestCorrection.toFixed(4) } }
          }
          if (elapsed > 1 && previousPrevious.has(name)) {
            const midpoint = previousPrevious.get(name).clone().slerp(rotation, .5)
            steadyArmAcceleration += THREE.MathUtils.radToDeg(previous.get(name).angleTo(midpoint))
            accelerationSamples++
          }
          if (previous.has(name)) previousPrevious.set(name, previous.get(name))
          previous.set(name, rotation.clone())
        }
      }
    }
    audit.push({ id: clip.id, initialPenetrations, finalPenetrations, corrections, largestCorrection: +largestCorrection.toFixed(3), maxElbow: +maxElbow.toFixed(1), maxWrist: +maxWrist.toFixed(1), maxCorrectedStep: +maxCorrectedStep.toFixed(2), meanArmSecondDifference: +(steadyArmAcceleration / Math.max(1, accelerationSamples)).toFixed(4), maxRootYaw: +maxRootYaw.toFixed(3), maxGroundDrift: +maxGroundDrift.toFixed(6), worstStep, handGap: [minHandGap,maxHandGap,rawMinHandGap,rawMaxHandGap].map(v=>+v.toFixed(3)), maxBodyStep: +maxBodyStep.toFixed(4), maxBodySecondDifference: +maxBodySecondDifference.toFixed(4), yawRange: [Math.min(...yawSamples),Math.max(...yawSamples)].map(v=>+v.toFixed(3)), footWidth: [minFootWidth,maxFootWidth].map(v=>+v.toFixed(4)),maxToeYaw: +maxToeYaw.toFixed(4), ...(profile === 'nervous' ? {maxWristBend: +maxWristBend.toFixed(4),minStackGap: +minStackGap.toFixed(4),minEntryStackGap: +minEntryStackGap.toFixed(4),minEntryHandGap: +minEntryHandGap.toFixed(4),minEntryPalmGap: +minEntryPalmGap.toFixed(4)} : {}), ...(palmSamples.length ? { minimumForwardPalm: [0,1].map(i=>Math.min(...palmSamples.map(row=>row[i]))) } : {}), ...(surface ? {surfaceCrossings, surfaceChecks, surfaceMeshes} : {}), ...(samplesLog.length ? {samplesLog} : {}) })
  }
  console.log(runtime ? 'RUNTIME_AUDIT' : 'AUDIT', JSON.stringify(audit))
}
