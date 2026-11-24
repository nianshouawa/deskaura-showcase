import * as THREE from 'three'

/** Apply one stable range shared by every viewing direction. */
export function zoomDistance(current: number, factor: number, closest: number, farthest: number): number {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return current
  if (factor > 1) return Math.max(Math.min(current, closest), current / factor)
  return Math.min(Math.max(current, farthest), current / factor)
}

/** A sphere around the orbit pivot keeps the closest distance angle-independent. */
export function closestZoomDistance(box: THREE.Box3, target: THREE.Vector3, fitted: number, near: number) {
  if (box.isEmpty()) return near * 2
  let radius = 0
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    radius = Math.max(radius, new THREE.Vector3(x, y, z).distanceTo(target))
  }
  return Math.max(near * 2, fitted * .42, radius + near * 2)
}

/** Minimum orbit distance that keeps all bounds corners inside the viewport. */
export function fitOrbitDistance(
  box: THREE.Box3, target: THREE.Vector3, direction: THREE.Vector3,
  fov: number, aspect: number, near: number, margin = 1.08,
): number {
  if (box.isEmpty()) return 0
  const back = direction.clone().normalize()
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), back).normalize()
  const up = new THREE.Vector3().crossVectors(back, right).normalize()
  const tanY = Math.tan(THREE.MathUtils.degToRad(fov / 2)) / margin
  const tanX = tanY * Math.max(aspect, 0.01)
  let distance = near * 2
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).sub(target)
        const depth = p.dot(back)
        distance = Math.max(distance, depth + Math.abs(p.dot(right)) / tanX,
          depth + Math.abs(p.dot(up)) / tanY, depth + near * 2)
      }
    }
  }
  return distance
}
