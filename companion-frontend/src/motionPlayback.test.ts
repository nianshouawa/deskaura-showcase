import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { prepareMotionTracks, sampleTrack, sampleLoopTrack, smoothBone, sourceRootHeading, usesIdleMotionReference } from './motionPlayback'

const rotation = (angle: number) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
describe('motion playback stability', () => {
  it('uses relaxed cloud arm chains for low-arm standby without replacing its head motion', () => {
    const rest = new Map(['hips', 'spine', 'neck', 'head', 'leftShoulder', 'rightShoulder',
      'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand']
      .map(name => [name, new THREE.Quaternion()]))
    const poses = Array.from({ length: 8 }, () => Array(156).fill(0))
    const idle = Array.from({ length: 8 }, () => Array(156).fill(0))
    poses.forEach(row => { row[45] = .2; row[48] = .8 })
    idle.forEach(row => { row[50] = -1.2; row[53] = 1.2 })
    const snapshot = JSON.stringify(poses)
    for (const id of ['cloud_standby_sleep', 'cloud_standby_sing']) {
      expect(usesIdleMotionReference(id)).toBe(true)
      const result = prepareMotionTracks(poses, rest, false, { id, idlePoses: idle })
      const ambient = prepareMotionTracks(idle, rest, false, { id: 'cloud_idle' })
      expect(result.get('leftUpperArm')![0]!.angleTo(ambient.get('leftUpperArm')![0]!)).toBeLessThan(1e-6)
      expect(result.get('head')![0]!.angleTo(ambient.get('head')![0]!)).toBeCloseTo(.2 * .42, 5)
    }
    expect(JSON.stringify(poses)).toBe(snapshot)
  })
  it('requests the same idle reference for desktop loading and pose composition', () => {
    for (const id of ['cloud_nod', 'cloud_emotion_neutral', 'cloud_bow', 'cloud_emotion_sad', 'cloud_think', 'cloud_thinking_loop', 'cloud_wave']) expect(usesIdleMotionReference(id)).toBe(true)
    for (const id of ['cloud_idle', 'cloud_emotion_tired', 'cloud_standby_stretch', 'cloud_standby_sway', 'cloud_clap', 'cloud_celebrate', 'generated-turn-id']) expect(usesIdleMotionReference(id)).toBe(false)
  })
  it('smooths a single source spike without rewriting the archive', () => {
    const poses = Array.from({ length: 15 }, (_, i) => [0, i === 7 ? 1 : 0, 0, ...Array(63).fill(0)])
    const original = JSON.stringify(poses)
    const track = prepareMotionTracks(poses, new Map([['hips', new THREE.Quaternion()]]), false).get('hips')!
    expect(track[7]!.angleTo(new THREE.Quaternion())).toBeLessThan(0.5)
    expect(JSON.stringify(poses)).toBe(original)
  })
  it('interpolates quaternions across the axis-angle wrap via shortest path', () => {
    const result = sampleTrack([rotation(Math.PI - 0.1), rotation(-Math.PI + 0.1)], 0.5, 1, new THREE.Quaternion())
    expect(result.angleTo(rotation(Math.PI))).toBeLessThan(0.00001)
  })
  it('has no position or velocity jump at the loop boundary', () => {
    const track = Array.from({ length: 240 }, (_, i) => rotation(Math.sin(i / 30) * 0.6 + i / 240))
    const duration = (track.length - 1) / 30, period = duration - Math.min(1.2, duration / 3)
    const sample = (t: number) => sampleLoopTrack(track, t, 30, new THREE.Quaternion(), new THREE.Quaternion()).clone()
    const h = 0.0001, middle = sample(period)
    expect(sample(period - h).angleTo(middle)).toBeLessThan(0.001)
    expect(sample(period + h).angleTo(middle)).toBeLessThan(0.001)
    const before = sample(period - h).angleTo(middle) / h
    const after = sample(period + h).angleTo(middle) / h
    expect(Math.abs(before - after)).toBeLessThan(0.01)
  })
  it('limits outliers per elapsed second and is independent of frame rate', () => {
    for (const fps of [30, 60, 120]) {
      const current = rotation(0)
      smoothBone(current, rotation(2), 'hips', 1 / fps)
      expect(current.angleTo(rotation(0))).toBeLessThanOrEqual(Math.PI / fps + 1e-6)
      const steady = rotation(0)
      for (let i = 0; i < fps; i++) smoothBone(steady, rotation(0.5), 'head', 1 / fps)
      expect(steady.angleTo(rotation(0.5))).toBeLessThan(0.0001)
    }
  })
  it('uses cloud idle body tracks for nods while preserving the generated head gesture', () => {
    const rest = new Map(['hips', 'leftUpperLeg', 'rightUpperLeg', 'head'].map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 4 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 4 }, () => Array(66).fill(0))
    source.forEach(row => { row[1 * 3 + 2] = .3; row[2 * 3 + 2] = -.3; row[15 * 3] = .2 })
    const snapshot = JSON.stringify(source)
    const result = prepareMotionTracks(source, rest, false, { id: 'cloud_nod', idlePoses: idle })
    expect(result.get('leftUpperLeg')![0]!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    expect(result.get('rightUpperLeg')![0]!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    expect(result.get('head')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.2)
    expect(JSON.stringify(source)).toBe(snapshot)
  })
  it('relaxes normal replies toward cloud idle without flattening every motion', () => {
    const rest = new Map(['hips', 'leftUpperLeg', 'leftUpperArm', 'head'].map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 6 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 3 }, () => Array(66).fill(0))
    source.forEach(row => { row[1 * 3] = .3; row[16 * 3] = .4; row[15 * 3] = .2 })
    const sourceSnapshot = JSON.stringify(source), idleSnapshot = JSON.stringify(idle)
    const reply = prepareMotionTracks(source, rest, false, { id: 'cloud_emotion_neutral', idlePoses: idle })
    const happy = prepareMotionTracks(source, rest, false, { id: 'cloud_emotion_happy', idlePoses: idle })
    expect(reply.get('leftUpperLeg')![0]!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
    expect(reply.get('leftUpperArm')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.18)
    expect(reply.get('head')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.16)
    expect(happy.get('leftUpperArm')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.4)
    expect(JSON.stringify(source)).toBe(sourceSnapshot)
    expect(JSON.stringify(idle)).toBe(idleSnapshot)
  })
  it('removes recording yaw while preserving a bend and subsequent intentional turns', () => {
    const yaw = rotation(2.3)
    const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .48)
    const source = Array.from({ length: 12 }, (_, i) => {
      const q = yaw.clone().multiply(rotation(i / 11 * .3)).multiply(bend)
      const angle = 2 * Math.acos(q.w), divisor = Math.sqrt(1 - q.w * q.w)
      return [q.x / divisor * angle, q.y / divisor * angle, q.z / divisor * angle, ...Array(63).fill(0)]
    })
    const original = JSON.stringify(source)
    expect(sourceRootHeading(source).angleTo(yaw)).toBeLessThan(1e-6)
    const rest = new Map([['hips', new THREE.Quaternion()]])
    for (const flip of [false, true]) {
      const track = prepareMotionTracks(source, rest, flip).get('hips')!
      const expected = bend.clone()
      if (flip) expected.premultiply(new THREE.Quaternion(0, 1, 0, 0)).multiply(new THREE.Quaternion(0, 1, 0, 0))
      expect(track[0]!.angleTo(expected)).toBeLessThan(.03)
      expect(track[0]!.angleTo(track[track.length - 1]!)).toBeGreaterThan(.24)
    }
    expect(JSON.stringify(source)).toBe(original)
  })
  it('strips dynamic recording turns only from stationary library gestures', () => {
    const bend = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .42)
    const poses = Array.from({ length: 60 }, (_, i) => {
      const q = rotation(.4 + i / 59 * .5).multiply(bend)
      const angle = 2 * Math.acos(q.w), divisor = Math.hypot(q.x, q.y, q.z)
      return [q.x / divisor * angle, q.y / divisor * angle, q.z / divisor * angle, ...Array(63).fill(0)]
    })
    const rest = new Map([['hips', new THREE.Quaternion()]])
    for (const flip of [false, true]) {
      const tracks = prepareMotionTracks(poses, rest, flip, { id: 'cloud_point' }).get('hips')!
      const expected = bend.clone()
      if (flip) expected.premultiply(rotation(Math.PI)).multiply(rotation(-Math.PI))
      for (const q of tracks) expect(q.angleTo(expected)).toBeLessThan(1e-6)
      const requestedTurn = prepareMotionTracks(poses, rest, flip, { id: 'generated-turn-id' }).get('hips')!
      expect(requestedTurn[0]!.angleTo(requestedTurn[59]!)).toBeGreaterThan(.45)
      const standbyTurn = prepareMotionTracks(poses, rest, flip, { id: 'cloud_standby_sway' }).get('hips')!
      expect(standbyTurn[0]!.angleTo(standbyTurn[59]!)).toBeGreaterThan(.45)
    }
  })
  it('keeps the complete generated sway timeline and arm motion without reversal, trimming or idle substitution', () => {
    const poses = Array.from({ length: 240 }, (_, i) => {
      const row = Array(156).fill(0)
      row[1] = Math.sin(i / 239 * Math.PI * 2) * .22
      row[16 * 3] = i / 239 * .5
      row[17 * 3] = -.15 - i / 239 * .35
      return row
    })
    const rest = new Map(['hips', 'leftUpperArm', 'rightUpperArm'].map(bone => [bone, new THREE.Quaternion()]))
    const snapshot = JSON.stringify(poses)
    for (const flip of [false, true]) {
      const tracks = prepareMotionTracks(poses, rest, flip, { id: 'cloud_standby_sway',
        idlePoses: Array.from({ length: 240 }, () => Array(156).fill(0)) })
      for (const bone of ['leftUpperArm', 'rightUpperArm']) {
        const track = tracks.get(bone)!
        expect(track).toHaveLength(240)
        expect(track[0]!.angleTo(track[239]!)).toBeGreaterThan(.33)
        const angle = (i: number) => track[0]!.angleTo(track[i]!)
        expect(angle(50)).toBeLessThan(angle(100))
        expect(angle(100)).toBeLessThan(angle(180))
        expect(angle(180)).toBeLessThan(angle(230))
      }
      const hips = tracks.get('hips')!
      expect(hips[60]!.angleTo(hips[180]!)).toBeGreaterThan(.4)
    }
    expect(JSON.stringify(poses)).toBe(snapshot)
  })
  it('restores the full original stretch without changing its source data', () => {
    const poses = Array.from({ length: 12 }, () => Array(156).fill(0))
    poses.forEach(row => { row[16 * 3] = 1.2 })
    const rest = new Map([['leftUpperArm', new THREE.Quaternion()]])
    const snapshot = JSON.stringify(poses)
    const original = prepareMotionTracks(poses, rest, false, { id: 'cloud_standby_stretch' })
    const withIdle = prepareMotionTracks(poses, rest, false, { id: 'cloud_standby_stretch',
      idlePoses: Array.from({ length: 12 }, () => Array(156).fill(0)) })
    expect(original.get('leftUpperArm')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(1.2)
    expect(original.get('leftUpperArm')![0]!.angleTo(withIdle.get('leftUpperArm')![0]!)).toBeLessThan(1e-6)
    expect(JSON.stringify(poses)).toBe(snapshot)
  })
  it('keeps fearful upper body slightly backward in either VRM basis', () => {
    const poses = Array.from({ length: 12 }, () => Array(156).fill(0))
    poses.forEach(row => { row[0] = .7; row[9] = .4; row[18] = .4 })
    const rest = new Map(['hips', 'spine', 'chest', 'upperChest'].map(bone => [bone, new THREE.Quaternion()]))
    for (const flip of [false, true]) {
      const tracks = prepareMotionTracks(poses, rest, flip, { id: 'cloud_emotion_fearful' })
      for (const bone of ['hips', 'spine', 'chest']) {
        const q = tracks.get(bone)![0]!.clone()
        if (flip) q.premultiply(new THREE.Quaternion(0, 1, 0, 0)).multiply(new THREE.Quaternion(0, 1, 0, 0))
        const pitch = new THREE.Euler().setFromQuaternion(q).x
        expect(pitch).toBeLessThan(0)
        expect(pitch).toBeGreaterThanOrEqual(-THREE.MathUtils.degToRad(5) - 1e-6)
      }
    }
  })
  it('keeps bow arms lowered using cloud idle chains without removing its waist bend', () => {
    const names = ['hips', 'spine', 'leftUpperArm', 'leftShoulder', 'leftLowerArm', 'leftHand', 'rightUpperArm']
    const rest = new Map(names.map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 12 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 5 }, () => Array(66).fill(0))
    source.forEach(row => { row[0] = .5; row[3 * 3] = .2; row[16 * 3 + 2] = -.4; row[13 * 3 + 2] = .3 })
    idle.forEach(row => { row[16 * 3 + 2] = -1.2; row[17 * 3 + 2] = 1.2 })
    const tracks = prepareMotionTracks(source, rest, false, { id: 'cloud_bow', idlePoses: idle })
    expect(tracks.get('hips')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.5)
    expect(tracks.get('spine')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.2)
    expect(tracks.get('leftUpperArm')![0]!.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -1.2))).toBeLessThan(1e-6)
    expect(tracks.get('rightUpperArm')![0]!.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.2))).toBeLessThan(1e-6)
    expect(tracks.get('leftShoulder')![0]!.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
  })
  it('reduces small alternating arm noise without flattening deliberate changes', () => {
    const source = Array.from({ length: 90 }, (_, i) => {
      const row = Array(66).fill(0)
      row[16 * 3 + 2] = -1.2 + Math.sin(i / 28) * .2 + (i % 2 ? .025 : -.025)
      return row
    })
    const rest = new Map([['leftUpperArm', new THREE.Quaternion()]])
    const steady = prepareMotionTracks(source, rest, false, { id: 'cloud_thinking_loop' }).get('leftUpperArm')!
    const gesture = prepareMotionTracks(source, rest, false, { id: 'cloud_clap' }).get('leftUpperArm')!
    const secondDifference = (track: THREE.Quaternion[]) => {
      let sum = 0
      for (let i = 6; i < track.length - 6; i++) {
        const middle = track[i - 1]!.clone().slerp(track[i + 1]!, .5)
        sum += track[i]!.angleTo(middle)
      }
      return sum
    }
    expect(secondDifference(steady)).toBeLessThan(secondDifference(gesture) * .65)
    expect(steady[10]!.angleTo(steady[65]!)).toBeGreaterThan(.06)
  })
  it('replaces a tipped sad pelvis with a forward upper-body slump and relaxed idle arms for both VRM bases', () => {
    const names = ['hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg']
    const rest = new Map(names.map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 12 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 5 }, () => Array(66).fill(0))
    source.forEach(row => { row[0] = .4; row[1] = .7; row[2] = .5; row[16 * 3] = .6 })
    idle.forEach(row => { row[16 * 3 + 2] = -1.2; row[17 * 3 + 2] = 1.2 })
    for (const flip of [false, true]) {
      const tracks = prepareMotionTracks(source, rest, flip, { id: 'cloud_emotion_sad', idlePoses: idle })
      const ambient = prepareMotionTracks(idle, rest, flip, { id: 'cloud_idle' })
      for (const q of tracks.get('hips')!) expect(q.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6)
      for (const bone of ['spine', 'chest', 'upperChest', 'neck', 'head']) {
        for (const q of tracks.get(bone)!) {
          const euler = new THREE.Euler().setFromQuaternion(q)
          expect(euler.x * (flip ? -1 : 1)).toBeGreaterThan(0)
          expect(Math.abs(euler.y) + Math.abs(euler.z)).toBeLessThan(1e-6)
        }
      }
      for (const bone of ['leftUpperArm', 'rightUpperArm', 'leftUpperLeg', 'rightUpperLeg']) {
        expect(tracks.get(bone)![0]!.angleTo(ambient.get(bone)![0]!)).toBeLessThan(1e-6)
      }
    }
  })
  it('retains the generated thinking left waist arm while keeping its stance from idle', () => {
    const names = ['hips', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'leftHand', 'leftUpperLeg', 'rightUpperLeg']
    const rest = new Map(names.map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 12 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 5 }, () => Array(66).fill(0))
    source.forEach(row => { row[16 * 3] = .6; row[17 * 3] = -.5; row[1 * 3 + 2] = .4 })
    idle.forEach(row => { row[16 * 3 + 2] = -1.2; row[17 * 3 + 2] = 1.2 })
    for (const id of ['cloud_think', 'cloud_thinking_loop']) {
      const tracks = prepareMotionTracks(source, rest, false, { id, idlePoses: idle })
      const ambient = prepareMotionTracks(idle, rest, false, { id: 'cloud_idle' })
      for (const bone of ['hips', 'leftUpperLeg', 'rightUpperLeg']) expect(tracks.get(bone)![0]!.angleTo(ambient.get(bone)![0]!)).toBeLessThan(1e-6)
      expect(tracks.get('leftUpperArm')![0]!.angleTo(ambient.get('leftUpperArm')![0]!)).toBeGreaterThan(.5)
      expect(tracks.get('rightUpperArm')![0]!.angleTo(ambient.get('rightUpperArm')![0]!)).toBeGreaterThan(.5)
    }
  })
  it('preserves the newly generated tired forward bend rather than overwriting it with an authored slump', () => {
    const names = ['hips', 'spine', 'chest', 'upperChest', 'head', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftUpperLeg', 'rightUpperLeg']
    const rest = new Map(names.map(name => [name, new THREE.Quaternion()]))
    const source = Array.from({ length: 30 }, () => Array(66).fill(0))
    const idle = Array.from({ length: 30 }, () => Array(66).fill(0))
    source.forEach(row => { row[0] = .6; row[3 * 3] = .2; row[16 * 3] = .9; row[17 * 3] = -.9 })
    idle.forEach(row => { row[16 * 3 + 2] = -1.3; row[17 * 3 + 2] = 1.3 })
    for (const flip of [false, true]) {
      const tracks = prepareMotionTracks(source, rest, flip, { id: 'cloud_emotion_tired', idlePoses: idle })
      const ambient = prepareMotionTracks(idle, rest, flip, { id: 'cloud_idle' })
      expect(tracks.get('hips')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.6, 5)
      expect(tracks.get('spine')![0]!.angleTo(new THREE.Quaternion())).toBeCloseTo(.2, 5)
      expect(tracks.get('leftUpperArm')![0]!.angleTo(ambient.get('leftUpperArm')![0]!)).toBeGreaterThan(.5)
    }
  })
})
