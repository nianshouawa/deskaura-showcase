<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { VRMUtils, type VRM, type VRMHumanoid } from '@pixiv/three-vrm'
import { loadModelScene } from '../modelScene'
import { prepareMotionTracks, sampleTrack, sampleLoopTrack, smoothBone, sourceRootHeading, usesIdleMotionReference } from '../motionPlayback'
import { AvatarMotionSafety, alignSwayFootTargets, boundedRootOffset, limitJointRotation, motionSafetyProfile, stabilizeBowTargets } from '../motionSafety'
import { closestZoomDistance, fitOrbitDistance, zoomDistance } from '../cameraBounds'
import type { Motion } from '../api'
import { motionPlaybackTiming } from '../motionTiming'
import { getCursorPos } from '../tauri'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AvatarCursorGaze, AvatarHeadGaze, AvatarFingerPose, configureAvatarGaze, gazeAngles, type AvatarFaceTarget, type AvatarGazeMode } from '../avatarDetails'
import { AvatarClickInteraction } from '../avatarInteraction'
import { bodyTouchRegion, privateTouchRegion } from '../avatarBodyRegions'
import { parseTencentFbxMotion } from '../fbxMotion'
import { AvatarFaceAnimation } from '../avatarFace'

const props = defineProps<{ motion?: Motion; emotion?: string; thinking?: boolean; preview?: boolean; speechLevel?: number; gazeMode?: AvatarGazeMode; faceTarget?: AvatarFaceTarget }>()
const emit = defineEmits<{
  /** 模型包围盒已计算，父组件据此裁剪窗口尺寸（逻辑像素）。 */
  (e: 'model-fit', payload: { width: number; height: number }): void
  /** 输出渲染缓冲区的真实 alpha 像素，供点击穿透检测。 */
  (e: 'alpha-mask', payload: { pixels: Uint8Array; width: number; height: number }): void
  /** 模型非透明包围盒中心（CSS 逻辑像素，相对 canvas 左上角），供缩放锚点使用。 */
  (e: 'model-center', payload: { x: number; y: number }): void
  (e: 'loaded', value: boolean): void
  (e: 'capability', value: string): void
  (e: 'head-anchor', value: { x: number; y: number; visible: boolean }): void
  (e: 'body-touch', region: string): void
  (e: 'open-chat'): void
  (e: 'interaction'): void
  (e: 'motion-ended', id: string): void
}>()
// 暴露给父组件：窗口尺寸变化后重新拟合相机，避免角色因 aspect 变化被裁剪
const refitCamera = () => {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      fitCameraToModel()
      if (props.preview) renderOnce()
      else scanModelAlpha(false)
      cameraReady.value = true
      resolve()
    })
  })
}
/** 单帧绘制：预览只在加载/尺寸变化时重绘一次，不常驻动画循环。 */
function renderOnce() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}
// 滚轮缩放：只调相机距离，不动窗口，角色围绕自身模型中心原地放大缩小。
// factor > 1 拉近（放大），< 1 拉远（缩小）；内部钳位到合理范围。
const zoomCamera = (factor: number) => {
  if (props.preview) return
  if (!camera || !Number.isFinite(factor) || factor <= 0) return
  orbit.distance = zoomDistance(orbit.distance, factor, zoomRange.closest, zoomRange.farthest)
  updateCamera()
  // 缩放松开下一帧重扫 alpha，保证点击命中、模型中心随新尺寸更新。
  if (modelRoot) scanModelAlpha(false)
}
const panAvatar = (dx: number, dy: number) => {
  if (props.preview) return
  if (!camera || !canvas.value) return
  screenOffset.x += dx
  screenOffset.y += dy
  nudgeInertia(dx, dy)
  updateCamera()
}
defineExpose({ refitCamera, zoomCamera, panAvatar, loadFile, loadUrl })
const canvas = ref<HTMLCanvasElement>()
const error = ref('')
const cameraReady = ref(false)
const hasModel = ref(false)
let renderer: THREE.WebGLRenderer | undefined
let scene: THREE.Scene | undefined
let camera: THREE.PerspectiveCamera | undefined
let vrm: VRM | undefined
let modelRoot: THREE.Object3D | undefined
let humanoid: VRMHumanoid | undefined
let motionSafety: AvatarMotionSafety | undefined
let fingers: AvatarFingerPose | undefined
let cursorGaze: AvatarCursorGaze | undefined
let headGaze: AvatarHeadGaze | undefined
let currentMotionId = 'cloud_idle'
let faceAnimation = new AvatarFaceAnimation()
let cursorTimer: number | undefined
let cursorBusy = false
const gazeCursor = { x: 0, y: 0, at: -Infinity }
const gazeDescription = ref('眼动尚未初始化')
let gazeMode = 'unsupported'
let lastGazeDescription = 0
let genericRigRoot: THREE.Object3D | undefined
let frame = 0
let lastFrame = performance.now()
let lastAlphaScan = 0
let lastAnchorAt = 0
const touchRay = new THREE.Raycaster()
const projectedHead = new THREE.Vector3()
function emitHeadAnchor() {
  if (!camera || !canvas.value || !humanoid) { emit('head-anchor', { x: 0, y: 0, visible: false }); return }
  const head = humanoid.getRawBoneNode('head') || humanoid.getNormalizedBoneNode('head')
  if (!head) return
  head.getWorldPosition(projectedHead)
  projectedHead.y += Math.max(.08, (cameraBounds.max.y - cameraBounds.min.y) * .09)
  projectedHead.project(camera)
  const rect = canvas.value.getBoundingClientRect()
  emit('head-anchor', { x: rect.left + (projectedHead.x + 1) * rect.width / 2,
    y: rect.top + (1 - projectedHead.y) * rect.height / 2,
    visible: projectedHead.z > -1 && projectedHead.z < 1 && Math.abs(projectedHead.x) < 1.3 && Math.abs(projectedHead.y) < 1.3 })
}
function touchedRegion(point: { x: number; y: number }): string | undefined {
  if (props.preview || !camera || !canvas.value || !modelRoot) return
  const rect = canvas.value.getBoundingClientRect()
  if (!rect.width || !rect.height) return
  modelRoot.updateMatrixWorld(true)
  touchRay.setFromCamera(new THREE.Vector2((point.x - rect.left) / rect.width * 2 - 1, 1 - (point.y - rect.top) / rect.height * 2), camera)
  const hit = touchRay.intersectObject(modelRoot, true).find(h => h.object.visible)
  if (!hit) return
  if (!humanoid) return 'torso'
  const regionBones: Record<string, string[]> = {
    head: ['head', 'neck', 'leftEye', 'rightEye', 'jaw'],
    hand: ['leftHand', 'rightHand'], arm: ['leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm', 'leftShoulder', 'rightShoulder'],
    torso: ['hips', 'spine', 'chest', 'upperChest'], leg: ['leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'],
    foot: ['leftFoot', 'rightFoot', 'leftToes', 'rightToes'],
  }
  const regions = new Map<THREE.Object3D, string>()
  for (const [region, names] of Object.entries(regionBones)) for (const name of names) {
    const node = humanoid.getRawBoneNode(name as any)
    if (node) regions.set(node, region)
  }
  // Weighted skin influences identify the real touched mesh, not viewport height.
  const mesh = hit.object as THREE.SkinnedMesh
  const indices = mesh.geometry?.getAttribute('skinIndex'), weights = mesh.geometry?.getAttribute('skinWeight')
  const scores: Record<string, number> = {}
  if (mesh.isSkinnedMesh && hit.face && indices && weights) {
    for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) for (let i = 0; i < 4; i++) {
      let node: THREE.Object3D | null = mesh.skeleton.bones[indices.getComponent(vertex, i)] || null
      while (node && !regions.has(node)) node = node.parent
      const region = node ? regions.get(node) : undefined
      if (region) scores[region] = (scores[region] || 0) + weights.getComponent(vertex, i)
    }
  }
  let region = Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0]
  if (!region) {
    // Rigid accessories: nearest posed anatomical bone in world coordinates.
    let nearest = Infinity
    for (const [node, value] of regions) {
      const distance = node.getWorldPosition(new THREE.Vector3()).distanceToSquared(hit.point)
      if (distance < nearest) { nearest = distance; region = value }
    }
  }
  if (region === 'torso' || region === 'leg') {
    const hips = humanoid.getRawBoneNode('hips')
    const chest = humanoid.getRawBoneNode('chest') || humanoid.getRawBoneNode('upperChest')
    const neck = humanoid.getRawBoneNode('neck') || humanoid.getRawBoneNode('head')
    const leftThigh = humanoid.getRawBoneNode('leftUpperLeg')
    const rightThigh = humanoid.getRawBoneNode('rightUpperLeg')
    if (hips && chest && neck) region = bodyTouchRegion(region, hit.point,
      hips.getWorldPosition(new THREE.Vector3()), chest.getWorldPosition(new THREE.Vector3()),
      neck.getWorldPosition(new THREE.Vector3()), leftThigh?.getWorldPosition(new THREE.Vector3()),
      rightThigh?.getWorldPosition(new THREE.Vector3()))
  }
  return region
}
const clickInteraction = new AvatarClickInteraction(touchedRegion,
  region => emit('body-touch', region), () => emit('open-chat'),
  () => emit('body-touch', 'private-triple'), 500, privateTouchRegion)
let activeMotion = false
let motionGeneration = 0
let motionController: AbortController | undefined
function cancelMotionRequest() {
  motionGeneration++
  motionController?.abort()
  motionController = undefined
}
const restPose = new Map<string, THREE.Quaternion>()
const inertia = new THREE.Vector3()
const lastScreenPosition = new THREE.Vector2()
let screenPositionReady = false
function nudgeInertia(x: number, y: number) {
  inertia.x = THREE.MathUtils.clamp(inertia.x - x * 0.015, -0.8, 0.8)
  inertia.z = THREE.MathUtils.clamp(inertia.z + y * 0.015, -0.6, 0.6)
}
let updateMotion: ((now: number, delta: number) => void) | undefined
const hymotionBaseQuaternions = new Map<string, THREE.Quaternion>()
const HYMOTION_BONES = ['hips','leftUpperLeg','rightUpperLeg','spine','leftLowerLeg','rightLowerLeg','chest','upperChest','leftFoot','rightFoot','leftToes','rightToes','neck','leftShoulder','rightShoulder','head','leftUpperArm','rightUpperArm','leftLowerArm','rightLowerArm','leftHand','rightHand']
let hymotionBaseHipsPosition: THREE.Vector3 | undefined
// Normalized VRM0 bones use -X for left and -Z forward, before scene rotation.
function needsYFlip(): boolean {
  const meta = (vrm as any)?.meta
  if (!meta) return false
  if (typeof meta.metaVersion === 'string' && meta.metaVersion.startsWith('0')) return true
  return typeof meta.metaVersion === 'number' && meta.metaVersion === 0
}

const MOTION_API_URL = import.meta.env.VITE_MOTION_API_URL || 'http://127.0.0.1:8002'
let resizeObserver: ResizeObserver | undefined
let resizeQueued = false
function onCanvasResize() {
  if (resizeQueued) return
  resizeQueued = true
  requestAnimationFrame(() => {
    resizeQueued = false
    updateCamera()
    // 预览是静态图，尺寸变化只需重绘一次；亚宠靠 alpha 重采样保持点击命中。
    if (props.preview) { renderOnce(); return }
    // 不改变相机距离；新尺寸的 alpha 必须重采样，确保点击命中位置正确。
    if (modelRoot) scanModelAlpha(false)
  })
}
let dragging = false
let pointerId = -1
let dragTravel = 0
let lastPointerX = 0
let lastPointerY = 0
const screenOffset = new THREE.Vector2()
const orbit = { yaw: 0, pitch: 0.02, distance: 3, targetX: 0, targetY: 1.15, targetZ: 0 }
const zoomRange = { closest: .2, farthest: 6 }
const cameraBounds = new THREE.Box3()
function refreshCameraBounds() {
  if (!modelRoot) return
  modelRoot.updateMatrixWorld(true)
  modelRoot.traverse(object => {
    if (object instanceof THREE.SkinnedMesh) {
      object.skeleton.update()
      object.computeBoundingBox()
    }
  })
  cameraBounds.setFromObject(modelRoot)
}

function updateCamera() {
  if (!camera || !canvas.value) return
  const width = canvas.value.clientWidth || 600
  const height = canvas.value.clientHeight || 600
  camera.aspect = width / height
  orbit.distance = Math.max(orbit.distance, camera.near * 2)
  camera.position.set(
    orbit.targetX + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance,
    orbit.targetY + Math.sin(orbit.pitch) * orbit.distance,
    orbit.targetZ + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * orbit.distance,
  )
  camera.lookAt(orbit.targetX, orbit.targetY, orbit.targetZ)
  // Pan the projection, never the orbit pivot: the model center remains fixed on screen.
  camera.setViewOffset(width, height, -screenOffset.x, -screenOffset.y, width, height)
  camera.updateProjectionMatrix()
  renderer?.setSize(width, height, false)
}

/** 加载模型后，根据包围盒自动计算相机距离/目标点，让角色完整居中。 */
function fitCameraToModel() {
  if (!modelRoot || !camera || !canvas.value) return
  refreshCameraBounds()
  const box = cameraBounds
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const height = canvas.value.clientHeight || 560
  const width = canvas.value.clientWidth || 420
  const fov = (camera.fov * Math.PI) / 180
  const aspect = width / height
  // 同时兼顾水平与垂直方向：取能同时容纳宽度和高度所需的最大距离
  const vfov = fov
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
  const distanceByHeight = (size.y * 0.5) / Math.tan(vfov / 2)
  const distanceByWidthFallback = (size.x * 0.5) / Math.tan(hfov / 2)
  // 加 1.06 安全边距，取两者较大值，确保角色完整可见不被裁剪
  // 保留桌宠原本的屏幕显示大小；仅移除反复校正，不改变默认缩放。
  // 主页预览用更近的相机距离，让角色在预览框里显得更大；桌宠保持原有屏幕尺寸。
  const initialScale = props.preview ? 1.12 : Math.max(1, height / 560)
  orbit.distance = (Math.max(distanceByHeight, distanceByWidthFallback) + size.z / 2) * 1.16 * initialScale
  screenOffset.set(0, 0)
  orbit.targetX = center.x
  orbit.targetY = center.y
  orbit.targetZ = center.z
  orbit.yaw = 0
  orbit.pitch = 0
  updateCamera()
  const target = new THREE.Vector3(center.x, center.y, center.z)
  const fitted = fitOrbitDistance(box, target, new THREE.Vector3(0, 0, 1), camera.fov, camera.aspect, camera.near)
  zoomRange.closest = closestZoomDistance(box, target, fitted, camera.near)
  zoomRange.farthest = Math.max(6, fitted * 4, orbit.distance)
}

/** 渲染一帧并从 WebGL 读取 alpha 通道，计算非透明包围盒 + 输出遮罩。 */
function scanModelAlpha(emitFit = true) {
  if (!renderer || !scene || !camera || !canvas.value) return
  const gl = renderer.getContext()
  // 关键：readPixels 必须使用绘制缓冲区实际像素尺寸（含 devicePixelRatio），
  // 而不是 CSS 尺寸，否则数据错位导致包围盒/遮罩错误。
  const scale = Math.min(1, 256 / Math.max(gl.drawingBufferWidth, gl.drawingBufferHeight))
  const width = Math.max(1, Math.round(gl.drawingBufferWidth * scale))
  const height = Math.max(1, Math.round(gl.drawingBufferHeight * scale))

  // 渲染一帧（此时相机已 fit 到位，模型应完整可见）
  const previousTarget = renderer.getRenderTarget()
  const target = new THREE.WebGLRenderTarget(width, height)
  renderer.setRenderTarget(target)
  renderer.render(scene, camera)

  // 读取像素 alpha（RGBA，每个像素 4 字节）
  const pixels = new Uint8Array(width * height * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  renderer.setRenderTarget(previousTarget)
  target.dispose()

  // 包围盒：扫描非透明像素（alpha > 阈值）
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  const ALPHA_THRESHOLD = 16
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = pixels[(y * width + x) * 4 + 3]
      if (alpha > ALPHA_THRESHOLD) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX < minX || maxY < minY) return // 全是透明，无模型

  // 注意：WebGL 的 readPixels 原点在左下，需翻转 Y
  const topY = height - 1 - maxY
  const bottomY = height - 1 - minY
  const boxW = (maxX - minX + 1) / (width / Math.max(1, canvas.value.clientWidth || 1))
  const boxH = (bottomY - topY + 1) / (height / Math.max(1, canvas.value.clientHeight || 1))

  // 转换为 CSS 逻辑像素输出给父组件
  const boxWcss = Math.round(boxW)
  const boxHcss = Math.round(boxH)

  // 加一点内边距，避免边缘被裁剪
  const pad = Math.max(8, Math.round(Math.max(boxWcss, boxHcss) * 0.04))
  const finalW = Math.min(Math.max(1, canvas.value.clientWidth || 1), boxWcss + pad * 2)
  const finalH = Math.min(Math.max(1, canvas.value.clientHeight || 1), boxHcss + pad * 2)

  // 保留完整 alpha 图，逐像素判断；WebGL 原点位于左下，在查询时转换 Y。
  const alphaPixels = new Uint8Array(width * height)
  for (let i = 0; i < alphaPixels.length; i++) alphaPixels[i] = pixels[i * 4 + 3]
  emit('alpha-mask', { pixels: alphaPixels, width, height })

  // 模型非透明区域中心 → 0~1 比例坐标（相对 canvas 左上角）。
  // readPixels 原点在左下，需翻转 Y；除以 canvas 实际尺寸得到比例，免疫尺寸/DPI 换算误差。
  const centerRatioX = (minX + maxX + 1) / 2 / width
  const centerRatioY = (height - 1 - (minY + maxY) / 2) / height
  emit('model-center', { x: centerRatioX, y: centerRatioY })

  // 只在初始计算时触发窗口裁剪（emitFit=true）；refit 重扫时跳过避免循环
  if (emitFit) emit('model-fit', { width: finalW, height: finalH })
}

function startDrag(event: PointerEvent) {
  if (props.preview) return
  // 中键拖拽旋转视角
  if (event.button !== 1 || !canvas.value) return
  dragTravel = 0
  event.preventDefault()
  dragging = true
  pointerId = event.pointerId
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  try {
    canvas.value.setPointerCapture(pointerId)
  } catch {
    // 某些环境下 setPointerCapture 可能抛错，忽略
  }
  canvas.value.style.cursor = 'grabbing'
}

function drag(event: PointerEvent) {  if (!dragging || event.pointerId !== pointerId) return
  event.preventDefault()
  dragTravel += Math.hypot(event.clientX - lastPointerX, event.clientY - lastPointerY)
  if (dragTravel < 4) return
  nudgeInertia(event.clientX - lastPointerX, event.clientY - lastPointerY)
  orbit.yaw -= (event.clientX - lastPointerX) * 0.008
  orbit.pitch = Math.max(-0.65, Math.min(0.65, orbit.pitch + (event.clientY - lastPointerY) * 0.006))
  lastPointerX = event.clientX
  lastPointerY = event.clientY
  updateCamera()
}

function stopDrag(event: PointerEvent) {
  if (!dragging || event.pointerId !== pointerId) return
  dragging = false
  if (event.type === 'pointerup' && dragTravel < 4) {
    orbit.yaw = 0
    orbit.pitch = 0
    updateCamera()
  }
  try {
    canvas.value?.releasePointerCapture(pointerId)
  } catch {
    // ignore
  }
  if (canvas.value) canvas.value.style.cursor = 'grab'
}

/** 预览不参与任何鼠标交互；桌宠保留中键旋转视角。 */
function beginDrag(event: PointerEvent) {
  if (props.preview) return
  if (touchedRegion({ x: event.clientX, y: event.clientY })) emit('interaction')
  clickInteraction.down(event)
  startDrag(event)
}
function moveDrag(event: PointerEvent) {
  if (props.preview) return
  drag(event)
}
function trackPointer(event: PointerEvent) {
  gazeCursor.x = event.clientX; gazeCursor.y = event.clientY; gazeCursor.at = performance.now()
  clickInteraction.move(event)
  moveDrag(event)
}
function endDrag(event: PointerEvent) {
  if (props.preview) return
  if (event.type === 'pointerup') clickInteraction.up(event)
  else clickInteraction.cancelPointer()
  stopDrag(event)
}

function loop(now = performance.now()) {
  frame = requestAnimationFrame(loop)
  // A fullscreen transparent overlay must not render at a 144/240 Hz monitor's
  // native refresh rate; motion is 30 FPS and interpolation targets <=60 FPS.
  if (now - lastFrame < 1000 / 60 - 1) return
  const delta = Math.min((now - lastFrame) / 1000, 0.1)
  lastFrame = now
  // Pose first, then normalized-to-raw retargeting, physics and rendering in ONE clock.
  headGaze?.restore()
  updateMotion?.(now, delta)
  fingers?.update(currentMotionId, now / 1000, delta)
  if (!cursorGaze && headGaze && camera && canvas.value && humanoid) {
    const mode = props.gazeMode || 'face'
    let angles = { yaw: 0, pitch: 0 }
    if ((mode === 'face' && props.faceTarget?.visible) || (mode === 'mouse' && now - gazeCursor.at < 1000)) {
      const head = humanoid.getNormalizedBoneNode('head')
      if (head) {
        head.getWorldPosition(projectedHead).project(camera)
        const rect = canvas.value.getBoundingClientRect()
        const eyeX = rect.left + (projectedHead.x + 1) * rect.width / 2
        const eyeY = rect.top + (1 - projectedHead.y) * rect.height / 2
        if (mode === 'face' && props.faceTarget) {
          const faceX = THREE.MathUtils.clamp(props.faceTarget.x, -1, 1)
          const faceY = THREE.MathUtils.clamp(props.faceTarget.y, -1, 1)
          angles = gazeAngles(
            eyeX + faceX * rect.width * .28, eyeY + faceY * rect.height * .22,
            eyeX, eyeY, rect.width, rect.height,
          )
        } else {
          angles = gazeAngles(gazeCursor.x, gazeCursor.y, eyeX, eyeY, rect.width, rect.height)
        }
      }
    }
    headGaze.update(angles, camera, delta, mode)
  }
  if (vrm) {
    const manager = vrm.expressionManager
    if (manager) faceAnimation.update(manager, currentMotionId, now / 1000, delta, props.speechLevel)
    if (cursorGaze && camera && canvas.value) cursorGaze.update(gazeCursor, camera, canvas.value.getBoundingClientRect(), now, delta, props.gazeMode || 'face', props.faceTarget, headGaze)
    if (now - lastGazeDescription > 500) {
      lastGazeDescription = now
      gazeDescription.value = `眼动 ${gazeMode}；目标 ${props.gazeMode || 'face'}；光标 ${Math.round(gazeCursor.x)},${Math.round(gazeCursor.y)}；水平 ${vrm.lookAt?.yaw.toFixed(1) || 0}；垂直 ${vrm.lookAt?.pitch.toFixed(1) || 0}；表情 ${['lookLeft', 'lookRight', 'lookUp', 'lookDown'].map(name => manager?.getValue(name)?.toFixed(2) || 0).join(',')}`
    }
    if (screenPositionReady) nudgeInertia(window.screenX - lastScreenPosition.x, window.screenY - lastScreenPosition.y)
    lastScreenPosition.set(window.screenX, window.screenY)
    screenPositionReady = true
    if (props.preview) {
      // 主页预览只要姿势与表情：跳过弹簧骨骼物理和惯性，减少占用。
      vrm.humanoid.update()
      vrm.expressionManager?.update()
    } else {
      const saved = [...(vrm.springBoneManager?.springBones || [])].map(joint => ({
        joint, dir: joint.settings.gravityDir.clone(), power: joint.settings.gravityPower,
      }))
      for (const item of saved) {
        const force = item.dir.clone().multiplyScalar(item.power).add(inertia)
        item.joint.settings.gravityPower = force.length()
        item.joint.settings.gravityDir.copy(force.lengthSq() > 0 ? force.normalize() : item.dir)
      }
      vrm.update(delta)
      for (const item of saved) {
        item.joint.settings.gravityDir.copy(item.dir)
        item.joint.settings.gravityPower = item.power
      }
    }
    inertia.multiplyScalar(Math.exp(-delta * 5))
    if (!activeMotion && hymotionBaseHipsPosition) {
      const hips = humanoid!.getNormalizedBoneNode('hips')
      hips?.position.lerp(hymotionBaseHipsPosition, 1 - Math.exp(-delta * 7))
    }
  }
  if (!vrm) humanoid?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
  if (!props.preview && now - lastAnchorAt > 65) { lastAnchorAt = now; emitHeadAnchor() }
  // 动画、旋转和缩放都会改变角色轮廓；定期刷新命中像素，而非只在导入时扫描一次。
  if (!props.preview && modelRoot && now - lastAlphaScan > 250) {
    lastAlphaScan = now
    // 动作或转身后边界也会变化，重新限制相机，不能沿用静止姿势的上限。
    scanModelAlpha(false)
  }
}

async function load(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  await loadFile(file)
}
let loadGeneration = 0
async function loadFile(file: File) {
  const url = URL.createObjectURL(file)
  try {
    await loadUrl(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}
async function loadUrl(url: string) {
  const generation = ++loadGeneration
  cancelMotionRequest()
  if (!scene) return
  cameraReady.value = false
  try {
    const loaded = await loadModelScene(url)
    if (generation !== loadGeneration) { VRMUtils.deepDispose(loaded.root); return }
    if (modelRoot) { scene.remove(modelRoot); VRMUtils.deepDispose(modelRoot) }
    if (genericRigRoot) scene.remove(genericRigRoot)
    vrm = loaded.vrm
    humanoid = loaded.humanoid
    modelRoot = loaded.root
    genericRigRoot = !vrm ? humanoid?.normalizedHumanBonesRoot : undefined
    if (genericRigRoot) scene.add(genericRigRoot)
    activeMotion = false
    cancelMotionRequest()
    updateMotion = undefined
    restPose.clear()
    hymotionBaseQuaternions.clear()
    hymotionBaseHipsPosition = undefined
    for (const bone of HYMOTION_BONES) {
      const node = humanoid?.getNormalizedBoneNode(bone as any)
      if (node) restPose.set(bone, node.quaternion.clone())
    }
    inertia.set(0, 0, 0)
    screenPositionReady = false
    if (vrm) { VRMUtils.removeUnnecessaryVertices(vrm.scene); VRMUtils.combineSkeletons(vrm.scene); VRMUtils.rotateVRM0(vrm) }
    const gazeCapability = vrm ? configureAvatarGaze(vrm) : undefined
    gazeMode = gazeCapability?.mode || 'unsupported'
    // Even an eye-unsupported VRM may have a usable head/neck. Capability still
    // reports the absent eye deformation; a head turn is not called eye support.
    cursorGaze = vrm?.lookAt && !props.preview ? new AvatarCursorGaze(vrm.lookAt) : undefined
    headGaze = humanoid && !props.preview ? new AvatarHeadGaze(humanoid) : undefined
    clickInteraction.dispose()
    gazeCursor.at = -Infinity
    faceAnimation = new AvatarFaceAnimation()
    fingers = humanoid && !props.preview ? new AvatarFingerPose(humanoid) : undefined
    scene.add(loaded.root)
    motionSafety = humanoid && !props.preview ? new AvatarMotionSafety(humanoid, loaded.root) : undefined
    hasModel.value = true
    emit('loaded', true)
    emit('capability', `${loaded.capability} · ${gazeCapability?.detail || '当前模型不支持眼动'}`)
    // Resolve only once a fitted frame and its hit mask exist. Callers can then
    // show the native overlay without exposing an empty click-blocking window.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (generation !== loadGeneration) { resolve(); return }
      vrm?.update(0)
      fitCameraToModel()
      if (renderer && scene && camera) renderer.render(scene, camera)
      scanModelAlpha(false)
      cameraReady.value = true
      if (!props.preview) playAmbientCloud()
      resolve()
    })))
  } catch (cause) {
    if (generation !== loadGeneration) return
    cameraReady.value = !!modelRoot
    error.value = `模型加载失败：${String(cause)}。FBX/GLTF 外部纹理请保留在原目录，压缩 glTF 请先导出为未压缩 GLB。`
    throw new Error(error.value)
  }
}


function resetHYMotionPose() {
  if (!humanoid) return
  for (const bone of HYMOTION_BONES) {
    const node = humanoid!.getNormalizedBoneNode(bone as any)
    const base = hymotionBaseQuaternions.get(bone)
    if (node && base) node.quaternion.copy(base)
  }
  hymotionBaseQuaternions.clear()
  const hips = humanoid!.getNormalizedBoneNode('hips')
  if (hips && hymotionBaseHipsPosition) hips.position.copy(hymotionBaseHipsPosition)
  hymotionBaseHipsPosition = undefined
}

function playAmbientCloud() {
  if (props.preview || !humanoid) return
  const id = props.thinking ? 'cloud_thinking_loop' : 'cloud_idle'
  void playHYMotion({ id, kind: 'hymotion', url: `/api/motion/library/${id}`, duration: 8, loop: true })
}
async function playHYMotion(motion: Motion) {
  if (!humanoid || props.preview || !['hymotion', 'fbx'].includes(motion.kind)) return
  motionController?.abort()
  const controller = motionController = new AbortController()
  const generation = ++motionGeneration
  // Keep downloads/receipts attached to the role that requested this clip,
  // even if another character becomes active while its API call is in flight.
  const roleHeaders = { 'X-DeskAura-Role': motion.role_id || localStorage.getItem('deskaura-active-model') || 'default' }
  updateMotion = undefined
  activeMotion = true
  try {
    const response = await fetch(`${MOTION_API_URL}${motion.url}`, { headers: roleHeaders, signal: controller.signal })
    if (!response.ok) throw new Error('Cloud motion unavailable: ' + response.status)
    const data = motion.kind === 'fbx'
      ? parseTencentFbxMotion(await response.arrayBuffer())
      : await response.json() as { fps: number; poses: number[][]; trans?: number[][] }
    if (generation !== motionGeneration) return
    if (!Number.isFinite(data.fps) || data.fps <= 0 || !Array.isArray(data.poses) || data.poses.length < 2 || data.poses.some(row => !Array.isArray(row) || row.length < 66 || row.some(v => !Number.isFinite(v)))) throw new Error('Invalid cloud motion frames')
    let idlePoses: number[][] | undefined
    if (usesIdleMotionReference(motion.id)) {
      try {
        const idleResponse = await fetch(`${MOTION_API_URL}/api/motion/library/cloud_idle`, { signal: controller.signal })
        if (idleResponse.ok) {
          const reference = (await idleResponse.json()).poses
          if (Array.isArray(reference) && reference.length >= 2 && reference.every(row => Array.isArray(row) && row.length >= 66 && row.every(Number.isFinite))) idlePoses = reference
        }
      } catch { /* Original verified cloud clip remains usable without the reference. */ }
    }
    if (generation !== motionGeneration) return
    const tracks = prepareMotionTracks(data.poses, restPose, needsYFlip(), { id: motion.id, idlePoses })
    const bindings = [...tracks].map(([bone, track]) => ({
      bone, track, node: humanoid!.getNormalizedBoneNode(bone as any),
    })).filter(binding => binding.node)
    // Capture this frame's base pose AFTER loading, not a stale pre-fetch pose.
    // Gaze is reapplied independently and must not be baked into entry twice.
    headGaze?.restore()
    const entryPose = new Map(bindings.map(b => [b.bone, b.node!.quaternion.clone()]))
    // Keep animation filtering independent of the displayed IK-corrected pose.
    // Feeding corrections back into next frame's source causes a contact tug-of-war.
    const filteredPose = new Map(bindings.map(b => [b.bone, b.node!.quaternion.clone()]))
    const targetPose = new Map(bindings.map(b => [b.bone, b.node!.quaternion.clone()]))
    const hips = humanoid.getNormalizedBoneNode('hips')
    if (hips && !hymotionBaseHipsPosition) hymotionBaseHipsPosition = hips.position.clone()
    const entryPosition = hips?.position.clone()
    const targetPosition = new THREE.Vector3()
    const target = new THREE.Quaternion(), scratch = new THREE.Quaternion()
    const safe = new THREE.Quaternion()
    const safetyProfile = motionSafetyProfile(motion.id)
    currentMotionId = motion.id
    const flip = needsYFlip()
    const inverseSourceHeading = sourceRootHeading(data.poses).invert()
    const looping = motion.loop === true || motion.id === 'cloud_idle' || motion.id === 'cloud_thinking_loop'
    const started = performance.now()
    const timing = motionPlaybackTiming((data.poses.length - 1) / data.fps, motion.duration, motion.duration_source)
    updateMotion = (now, delta) => {
      if (generation !== motionGeneration || !humanoid) return
      const elapsed = Math.max(0, (now - started) / 1000)
      const sampleSeconds = looping ? elapsed : elapsed * timing.sampleScale
      const blend = THREE.MathUtils.smoothstep(elapsed, 0, 0.8)
      for (const { bone, track } of bindings) {
        if (looping) sampleLoopTrack(track, elapsed, data.fps, target, scratch)
        else sampleTrack(track, sampleSeconds, data.fps, target)
        limitJointRotation(bone, target, restPose.get(bone)!, flip, safetyProfile, safe)
        targetPose.get(bone)!.copy(safe)
      }
      // Bow leg compensation is a sampled GOAL, never an unfiltered overwrite of
      // the displayed legs. Hips and legs now share entry blend and speed limits.
      if (safetyProfile === 'bow' || safetyProfile === 'fatigue') stabilizeBowTargets(targetPose, restPose)
      if (safetyProfile === 'turning') alignSwayFootTargets(targetPose, humanoid)
      for (const { bone, node } of bindings) {
        target.copy(targetPose.get(bone)!)
        target.slerp(entryPose.get(bone)!, 1 - blend)
        const filtered = filteredPose.get(bone)!
        smoothBone(filtered, target, bone, delta)
        node!.quaternion.copy(filtered)
        // Constrain the sampled goal, not the displayed entry pose: a wave may
        // start outside the narrower conversation range and must settle smoothly
        // rather than snap to the new boundary on its first frame. Body IK below
        // still runs throughout this transition.
      }
      if (hips && hymotionBaseHipsPosition && entryPosition) {
        targetPosition.copy(hymotionBaseHipsPosition)
        // Most archived gestures stay planted. Celebration preserves vertical
        // hops while bounding horizontal travel; recording turns are not
        // requests to rotate the desktop character.
        if ((safetyProfile === 'generated' || safetyProfile === 'celebrate') && !looping && data.trans?.length === data.poses.length) {
          const f = Math.min(data.poses.length - 1, sampleSeconds * data.fps)
          const i = Math.floor(f), j = Math.min(i + 1, data.poses.length - 1)
          const first = data.trans[0]!, left = data.trans[i]!, right = data.trans[j]!
          const sign = flip ? -1 : 1
          const offset = new THREE.Vector3(
            THREE.MathUtils.lerp(left[0]!, right[0]!, f - i) - first[0]!,
            THREE.MathUtils.lerp(left[1]!, right[1]!, f - i) - first[1]!,
            THREE.MathUtils.lerp(left[2]!, right[2]!, f - i) - first[2]!).applyQuaternion(inverseSourceHeading)
          offset.x *= sign; offset.z *= sign
          targetPosition.add(boundedRootOffset(offset, motionSafety?.height || 1.7, safetyProfile))
        }
        targetPosition.lerp(entryPosition, 1 - blend)
        hips.position.lerp(targetPosition, 1 - Math.exp(-delta / 0.055))
      }
      // Prioritize continuous avatar-relative goals over collision-plane hunting.
      motionSafety?.apply(delta, safetyProfile, blend, 'fluent')
      if (!looping && elapsed >= timing.duration) {
        updateMotion = undefined; activeMotion = false
        emit('motion-ended', motion.id)
        void nextTick(() => {
          if (generation === motionGeneration && !activeMotion) playAmbientCloud()
        })
      }
    }
    // A Tencent API response/download alone is not a usable desktop animation.
    // Confirm only after parse, canonical SMPL-H validation and player binding.
    if (motion.kind === 'fbx') {
      const resultId = motion.url.split('/').pop()
      if (resultId) void fetch(`${MOTION_API_URL}/api/motion/receipt`, {
        method: 'POST', headers: { ...roleHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_id: resultId, success: true }),
      }).catch(() => {})
    }
  } catch (error) {
    if (controller.signal.aborted || generation !== motionGeneration) return
    if (motion.kind === 'fbx') {
      const resultId = motion.url.split('/').pop()
      if (resultId) void fetch(`${MOTION_API_URL}/api/motion/receipt`, {
        method: 'POST', headers: { ...roleHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_id: resultId, success: false }),
      }).catch(() => {})
    }
    if (generation === motionGeneration) { activeMotion = false; console.warn('[DeskAura] Cloud animation unavailable', motion.id, error) }
  }
}

// The motion prop owns transitions. A thinking=false event cannot cancel a reply.

watch(
  () => props.motion,
  (motion) => {
    if (!humanoid) return
    if (!motion) {
      cancelMotionRequest()
      updateMotion = undefined
      activeMotion = false
      return
    }
      // Only cloud-generated clips animate the character now. Legacy 'preset' or
    // 'glb' ids are ignored, so no old motion can replay.
    if (motion.kind === 'hymotion' || motion.kind === 'fbx') void playHYMotion(motion)
  },
)

watch(
  () => props.emotion,
  (emotion) => {
    // 预览保持模型自带表情，不参与任何表情播放。
    if (props.preview || !vrm?.expressionManager) return
    for (const name of ['happy', 'sad', 'angry', 'surprised', 'relaxed']) {
      vrm.expressionManager.setValue(name, 0)
    }
    const weights: Record<string, Record<string, number>> = {
      neutral: { relaxed: .25 }, happy: { happy: .8 }, sad: { sad: .8 }, angry: { angry: 1 },
      nervous: { sad: .2, surprised: .25 }, serious: { angry: .2 }, fearful: { sad: .3, surprised: .6 },
      surprised: { surprised: .85 }, disgusted: { angry: .65, sad: .15 }, shy: { happy: .25, relaxed: .3 },
      tired: { relaxed: .65, sad: .2 }, curious: { surprised: .3 }, confident: { happy: .3 }, affectionate: { happy: .8, relaxed: .15 },
    }
    for (const [name, weight] of Object.entries(weights[emotion || 'neutral'] || weights.neutral!)) vrm.expressionManager.setValue(name, weight)
  },
)

onMounted(() => {
  scene = new THREE.Scene()
  scene.background = null
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334466, 2.2))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2)
  keyLight.position.set(1, 2, 3)
  scene.add(keyLight)
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100)
  camera.position.set(0, 1.35, orbit.distance)
  renderer = new THREE.WebGLRenderer({ canvas: canvas.value!, antialias: true, alpha: true })
  renderer.setPixelRatio(props.preview ? 0.75 : Math.min(window.devicePixelRatio, 1.25))
  canvas.value!.style.cursor = props.preview ? 'default' : 'grab'
  updateCamera()
  resizeObserver = new ResizeObserver(onCanvasResize)
  resizeObserver.observe(canvas.value!.parentElement || canvas.value!)
  // 预览不启动动画循环：只在模型加载完成和尺寸变化时画一帧。
  if (!props.preview) loop()
  if (!props.preview && '__TAURI_INTERNALS__' in window) cursorTimer = window.setInterval(async () => {
    if (cursorBusy || !hasModel.value || !humanoid) return
    cursorBusy = true
    try {
      const win = getCurrentWindow()
      const [cursor, origin, scale] = await Promise.all([
        getCursorPos(), win.outerPosition(), win.scaleFactor(),
      ])
      if (cursor) { gazeCursor.x = (cursor.x - origin.x) / scale; gazeCursor.y = (cursor.y - origin.y) / scale; gazeCursor.at = performance.now() }
    } catch { /* Local pointer events remain usable in browser preview. */ }
    finally { cursorBusy = false }
  }, 80)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  cancelMotionRequest()
  clickInteraction.dispose()
  if (cursorTimer) clearInterval(cursorTimer)
  updateMotion = undefined
  resetHYMotionPose()
  resizeObserver?.disconnect()
  loadGeneration++
  if (modelRoot) VRMUtils.deepDispose(modelRoot)
  renderer?.dispose()
})
</script>

<template>
  <section class="stage">
    <canvas
      role="img"
      :aria-label="preview ? '角色静态预览' : gazeDescription"
      ref="canvas"
      :class="{ 'camera-ready': cameraReady }"
      @pointerdown="beginDrag"
      @pointermove="trackPointer"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @pointerleave="endDrag"
      @contextmenu.prevent
      @dblclick.stop.prevent
    />

  </section>
</template>

<style scoped>
canvas { opacity: 0; transition: opacity 0.08s linear; }
canvas.camera-ready { opacity: 1; }
</style>
