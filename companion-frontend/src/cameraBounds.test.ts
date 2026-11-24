import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { closestZoomDistance, fitOrbitDistance, zoomDistance } from './cameraBounds'

describe('camera zoom bounds', () => {
  it('uses the same maximum zoom before and after changing the viewing angle', () => {
    const box = new THREE.Box3(new THREE.Vector3(-.4, 0, -.2), new THREE.Vector3(.4, 1.7, .2))
    const target = new THREE.Vector3(0, .85, 0)
    const front = new THREE.Vector3(0, 0, 1)
    const fitted = fitOrbitDistance(box, target, front, 35, 1, .1)
    const closest = closestZoomDistance(box, target, fitted, .1)
    for (const pitch of [-.65, .65]) {
      const direction = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch))
      let distance = fitted
      for (let i = 0; i < 100; i++) distance = zoomDistance(distance, 1.1, closest, fitted * 4)
      expect(distance).toBe(closest)
      expect(zoomDistance(distance, 1.1, closest, fitted * 4)).toBe(distance)
      expect(target.clone().addScaledVector(direction, closest).distanceTo(target)).toBeCloseTo(closest)
    }
    expect(zoomDistance(20, .9, 1, 10)).toBe(20)
    expect(zoomDistance(2, 1.1, 1, 10)).toBeCloseTo(2 / 1.1)
    expect(zoomDistance(2, .9, 1, 10)).toBeCloseTo(2 / .9)
  })
  it('allows over twice the fitted size without crossing the near-side surface', () => {
    const box = new THREE.Box3(new THREE.Vector3(-.4, 0, -.2), new THREE.Vector3(.4, 1.7, .2))
    const target = new THREE.Vector3(0, .85, 0), direction = new THREE.Vector3(0, 0, 1)
    const fitted = fitOrbitDistance(box, target, direction, 35, 1, .1)
    const closest = closestZoomDistance(box, target, fitted, .1)
    expect(closest).toBeLessThan(fitted / 2)
    expect(closest).toBeGreaterThan(.3)
  })
  it('keeps the near clipping plane outside the bounds for every orbit direction', () => {
    const box = new THREE.Box3(new THREE.Vector3(-.4, 0, -.2), new THREE.Vector3(.4, 1.7, .2))
    const target = box.getCenter(new THREE.Vector3())
    const closest = closestZoomDistance(box, target, 3, .1)
    for (const yaw of [0, 1, 2, 3, 4, 5]) for (const pitch of [-.65, 0, .65]) {
      const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        expect(closest - new THREE.Vector3(x, y, z).sub(target).dot(direction)).toBeGreaterThan(.1)
      }
    }
  })
  it('keeps every corner in frame across aspect ratios and orbit angles', () => {
    const box = new THREE.Box3(new THREE.Vector3(-0.9, -1, -0.3), new THREE.Vector3(0.9, 1, 0.3))
    for (const aspect of [0.4, 0.75, 1.8]) for (const yaw of [0, 1, 3]) for (const pitch of [-0.65, 0, 0.65]) {
      const direction = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      const target = new THREE.Vector3(0.1, 0.15, 0)
      const distance = fitOrbitDistance(box, target, direction, 35, aspect, 0.1)
      const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100)
      camera.position.copy(target).addScaledVector(direction, distance)
      camera.lookAt(target)
      camera.updateMatrixWorld(true)
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).project(camera)
        expect(Math.abs(p.x)).toBeLessThan(1)
        expect(Math.abs(p.y)).toBeLessThan(1)
        expect(Math.abs(p.z)).toBeLessThan(1)
      }
    }
  })
  it('handles an empty model', () => {
    expect(fitOrbitDistance(new THREE.Box3(), new THREE.Vector3(), new THREE.Vector3(0, 0, 1), 35, 1, 0.1)).toBe(0)
  })
})
