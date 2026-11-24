import * as THREE from 'three'


/**
 * SMPL → VRM 重定向工具。
 *
 * 旧的本地程序化预设动作（wave/nod/think 等 29 个手写关键帧）已全部删除：
 * 角色动作只来自云端 HY-Motion 生成并归档的片段，避免云端不可用时
 * 又播放一套过时的旧动作。
 */

/**
 * SMPL-H 52 关节 → VRM 骨骼的映射表。
 *
 * HY-Motion worker 返回的 `poses` 是一帧展平的数组：
 *   - 前 22 个关节各贡献 3 个 float（22×3 = 66）
 *   - 后 30 个是手指关节（左右手各 15），桌面 VRM 角色通常没有手指骨骼，忽略。
 *
 * SMPL 22 身体关节顺序（0-21，SMPL 官方约定）：
 *   0 pelvis, 1 left_hip, 2 right_hip, 3 spine1, 4 left_knee, 5 right_knee,
 *   6 spine2, 7 left_ankle, 8 right_ankle, 9 spine3, 10 left_foot, 11 right_foot,
 *   12 neck, 13 left_collar, 14 right_collar, 15 head,
 *   16 left_shoulder, 17 right_shoulder, 18 left_elbow, 19 right_elbow,
 *   20 left_wrist, 21 right_wrist
 *
 * 每个条目 = [SMPL 关节索引, VRM 归一化骨骼名]。
 * 未列出的 VRM 骨骼（如上身 chest/upperChest）会在重定向时跟随父级。
 */
export const SMPL_TO_VRM_BONES: Array<[number, string]> = [
  [0, 'hips'],
  [1, 'leftUpperLeg'],
  [2, 'rightUpperLeg'],
  [3, 'spine'],
  [4, 'leftLowerLeg'],
  [5, 'rightLowerLeg'],
  [6, 'chest'],
  [7, 'leftFoot'],
  [8, 'rightFoot'],
  [9, 'upperChest'],
  [10, 'leftToes'],
  [11, 'rightToes'],
  [12, 'neck'],
  [13, 'leftShoulder'],
  [14, 'rightShoulder'],
  [15, 'head'],
  [16, 'leftUpperArm'],
  [17, 'rightUpperArm'],
  [18, 'leftLowerArm'],
  [19, 'rightLowerArm'],
  [20, 'leftHand'],
  [21, 'rightHand'],
]

/** SMPL 主关节数量（前 22 个，不含手指）。 */
export const SMPL_BODY_JOINT_COUNT = 22

/**
 * SMPL-H → VRM 的基变换。
 *
 * SMPL-H 静止姿态（官方 j_template 实测）：Y 向上、左侧为 +X、脚尖朝 +Z（+Z 为人物正前方）。
 * 这与 VRM 1.0 的归一化骨骼约定一致；VRM 0.x 的模型面向 -Z，需要绕 Y 轴 180° 的基变换。
 *
 * 轴角是定义在 SMPL 父级坐标系（世界轴向）里的旋转，而 VRM 归一化骨骼的静止旋转为单位四元数，
 * 因此只需做一次基变换共轭：q_vrm = C · q_smpl · C⁻¹。
 * 此前只翻转根位移、却不翻转旋转，四肢就会朝镜像方向摆动——这正是动作“极为怪异”的直接原因。
 */
const Y_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI)
const Y_FLIP_INV = Y_FLIP.clone().invert()

/**
 * 把一帧 SMPL 轴角转成 VRM 归一化骨骼应设的局部四元数。
 *
 * @param aa    SMPL 轴角（x, y, z）
 * @param rest  该骨骼的静止局部四元数（归一化骨骼通常为单位四元数）
 * @param flip  VRM 0.x 模型为 true
 */
export function smplAxisAngleToLocal(
  aa: [number, number, number],
  rest: THREE.Quaternion,
  flip: boolean,
): THREE.Quaternion {
  const [x, y, z] = aa
  const angle = Math.sqrt(x * x + y * y + z * z)
  const q = new THREE.Quaternion()
  if (angle > 1e-5) {
    q.setFromAxisAngle(new THREE.Vector3(x / angle, y / angle, z / angle), angle)
  }
  if (flip) {
    q.premultiply(Y_FLIP).multiply(Y_FLIP_INV)
  }
  return q.premultiply(rest)
}
