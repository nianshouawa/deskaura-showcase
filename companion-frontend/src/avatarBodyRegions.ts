import * as THREE from 'three'

/** Split the posed torso along its own axis, not overlapping world-Y bands. */
export function torsoTouchRegion(point: THREE.Vector3, hips: THREE.Vector3,
  chest: THREE.Vector3, neck: THREE.Vector3): 'chest' | 'belly' | 'groin' | 'torso' {
  // The bone called "chest" may actually sit at the lower rib cage.
  // Use the whole pelvis-to-neck span so that upper belly remains ordinary.
  const axis = neck.clone().sub(hips)
  const length = axis.length()
  if (length < 1e-5 || chest.distanceTo(hips) < 1e-5) return 'torso'
  axis.divideScalar(length)
  const offset = point.clone().sub(hips)
  const along = offset.dot(axis)
  const sideways = offset.addScaledVector(axis, -along).length()
  if (sideways > length * .65) return 'torso'
  if (along <= length * .08) return 'groin'
  if (along < length * .60) return 'belly'
  return 'chest'
}

export function privateTouchRegion(region: string): boolean {
  return region === 'chest' || region === 'groin'
}

/** Pelvic clothing is often weighted to thighs rather than the torso. */
export function bodyTouchRegion(region: string, point: THREE.Vector3, hips: THREE.Vector3,
  chest: THREE.Vector3, neck: THREE.Vector3, leftThigh?: THREE.Vector3,
  rightThigh?: THREE.Vector3): string {
  if (region !== 'torso' && region !== 'leg') return region
  const up = neck.clone().sub(hips)
  const length = up.length()
  if (length < 1e-5) return region
  up.divideScalar(length)
  if (leftThigh && rightThigh) {
    const across = leftThigh.clone().sub(rightThigh)
    across.addScaledVector(up, -across.dot(up))
    const width = across.length()
    if (width > 1e-5) {
      across.divideScalar(width)
      const offset = point.clone().sub(hips)
      const along = offset.dot(up)
      const lateral = offset.dot(across)
      const depth = offset.clone().addScaledVector(up, -along).addScaledVector(across, -lateral).length()
      const thighCenter = leftThigh.clone().add(rightThigh).multiplyScalar(.5)
      const upper = Math.max(length * .08, thighCenter.sub(hips).dot(up) + length * .01)
      if (along >= -length * .16 && along <= upper &&
        Math.abs(lateral) <= width * .42 && depth <= length * .35) return 'groin'
    }
  }
  if (region === 'leg') return region
  const torso = torsoTouchRegion(point, hips, chest, neck)
  // Outside the bounded central pelvis, low torso weights mean hip/side, not groin.
  return torso === 'groin' ? 'torso' : torso
}

export const bellyReaction = {
  text: '肚子有点怕痒啦，轻轻戳一下就好。',
  emotion: 'happy',
  clip: 'cloud_emotion_happy',
}
