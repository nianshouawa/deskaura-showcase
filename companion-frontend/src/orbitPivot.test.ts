import { expect, it } from 'vitest'
import * as THREE from 'three'

it('keeps the orbit pivot at the dragged screen location through rotation and reset', () => {
  const width = 1707, height = 1067
  const offset = new THREE.Vector2(240, -130)
  const pivot = new THREE.Vector3(0, 1, 0)
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100)
  for (const [yaw, pitch] of [[0, 0], [1.2, 0.4], [-2, -0.5], [0, 0]]) {
    camera.position.set(pivot.x + Math.sin(yaw) * Math.cos(pitch) * 4,
      pivot.y + Math.sin(pitch) * 4, pivot.z + Math.cos(yaw) * Math.cos(pitch) * 4)
    camera.lookAt(pivot)
    camera.setViewOffset(width, height, -offset.x, -offset.y, width, height)
    camera.updateMatrixWorld(true)
    const ndc = pivot.clone().project(camera)
    expect((ndc.x + 1) * width / 2).toBeCloseTo(width / 2 + offset.x, 6)
    expect((1 - ndc.y) * height / 2).toBeCloseTo(height / 2 + offset.y, 6)
    expect(camera.position.distanceTo(pivot)).toBeCloseTo(4, 6)
  }
})
