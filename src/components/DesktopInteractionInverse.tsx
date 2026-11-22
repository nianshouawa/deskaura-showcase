import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CornerBrackets } from './CornerBrackets';
import { 
  Move, 
  Eye, 
  Mic, 
  Activity, 
  Play, 
  Square, 
  RotateCcw, 
  Camera, 
  CameraOff, 
  Volume2, 
  VolumeX, 
  ShieldCheck, 
  Check,
  AlertTriangle
} from 'lucide-react';
import { PoseLandmarker, FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';
import * as Kalidokit from 'kalidokit';

/* =========================================================================
   TAB 01: 3D Wireframe Mannequin & Constant Bounding Sphere (SMPL-H Joints)
   ========================================================================= */
type PoseType = 't_pose' | 'idle' | 'wave';

interface SkeletonJoint {
  id: string;
  nameZh: string;
  nameEn: string;
  group: 'torso' | 'upper' | 'lower';
  rule: string;
  angles: string;
  limits: {
    pitch: [number, number];
    yaw: [number, number];
    roll: [number, number];
  };
  poses: Record<PoseType, [number, number, number]>;
}

const SKELETON_JOINTS: SkeletonJoint[] = [
  // 躯干 (4)
  {
    id: 'head',
    nameZh: '头部',
    nameEn: 'Head',
    group: 'torso',
    rule: 'motionSafety.ts 生理视线转动限位 [P: ±45°, Y: ±65°, R: ±35°]，防过度仰折',
    angles: 'PITCH: 0.0° YAW: 0.0°',
    limits: { pitch: [-45, 45], yaw: [-65, 65], roll: [-35, 35] },
    poses: {
      t_pose: [0, 1.46, 0],
      idle: [0, 1.44, 0.02],
      wave: [0.04, 1.45, 0.03],
    },
  },
  {
    id: 'neck',
    nameZh: '颈部',
    nameEn: 'Neck',
    group: 'torso',
    rule: 'motionSafety.ts 颈椎自然活动域 [P: ±35°, Y: ±45°, R: ±25°]，平滑滤波抑制高频抖动',
    angles: 'ROLL: 0.0° PITCH: 0.0°',
    limits: { pitch: [-35, 35], yaw: [-45, 45], roll: [-25, 25] },
    poses: {
      t_pose: [0, 1.25, 0],
      idle: [0, 1.23, 0.01],
      wave: [0.02, 1.24, 0.02],
    },
  },
  {
    id: 'spine',
    nameZh: '胸脊',
    nameEn: 'Spine/Chest',
    group: 'torso',
    rule: 'motionSafety.ts 脊柱大角度屈伸 [P: -35°~+65°(前倾鞠躬), Y: ±45°, R: ±35°]',
    angles: 'BEND: 0.0° TWIST: 0.0°',
    limits: { pitch: [-35, 65], yaw: [-45, 45], roll: [-35, 35] },
    poses: {
      t_pose: [0, 0.85, 0],
      idle: [0, 0.83, -0.02],
      wave: [0.01, 0.84, 0],
    },
  },
  {
    id: 'hips',
    nameZh: '骨盆',
    nameEn: 'Hips',
    group: 'torso',
    rule: 'motionSafety.ts 骨盆全身根骨骼基准 [P: ±30°, Y: ±60°, R: ±25°]，带动全身 FK 级联',
    angles: 'ROOT_POS: (0, 0.44, 0)',
    limits: { pitch: [-30, 30], yaw: [-60, 60], roll: [-25, 25] },
    poses: {
      t_pose: [0, 0.45, 0],
      idle: [0, 0.44, 0],
      wave: [0.44, 0.44, 0],
    },
  },
  // 上肢 (6)
  {
    id: 'l_shoulder',
    nameZh: '左肩',
    nameEn: 'L_Shoulder',
    group: 'upper',
    rule: 'motionSafety.ts 肩关节全向活动域 [P: -60°~+175°(举手过头), Y: -60°~+110°, R: ±160°(大字展开)]',
    angles: 'PITCH: 0.0° ROLL: 0.0°',
    limits: { pitch: [-60, 175], yaw: [-60, 110], roll: [-160, 160] },
    poses: {
      t_pose: [-0.45, 1.15, 0],
      idle: [-0.42, 1.12, 0],
      wave: [-0.42, 1.12, 0],
    },
  },
  {
    id: 'r_shoulder',
    nameZh: '右肩',
    nameEn: 'R_Shoulder',
    group: 'upper',
    rule: 'motionSafety.ts 肩关节全向活动域 [P: -60°~+175°(举手过头), Y: -60°~+110°, R: ±160°(大字展开)]',
    angles: 'PITCH: 0.0° ROLL: 0.0°',
    limits: { pitch: [-60, 175], yaw: [-60, 110], roll: [-160, 160] },
    poses: {
      t_pose: [0.45, 1.15, 0],
      idle: [0.42, 1.12, 0],
      wave: [0.42, 1.18, 0.05],
    },
  },
  {
    id: 'l_elbow',
    nameZh: '左肘',
    nameEn: 'L_Elbow',
    group: 'upper',
    rule: 'motionSafety.ts 肘关节单向屈伸 [0°, 145°]，前臂旋前/旋后 ±70°，绝对自锁防反折',
    angles: 'FLEX: 0.0°',
    limits: { pitch: [-30, 30], yaw: [-70, 70], roll: [0, 145] },
    poses: {
      t_pose: [-0.75, 1.15, 0],
      idle: [-0.55, 0.75, 0.05],
      wave: [-0.55, 0.75, 0.05],
    },
  },
  {
    id: 'r_elbow',
    nameZh: '右肘',
    nameEn: 'R_Elbow',
    group: 'upper',
    rule: 'motionSafety.ts 肘关节单向屈伸 [0°, 145°]，前臂旋前/旋后 ±70°，绝对自锁防反折',
    angles: 'FLEX: +85.0° (抬臂弯曲)',
    limits: { pitch: [-30, 30], yaw: [-70, 70], roll: [0, 145] },
    poses: {
      t_pose: [0.75, 1.15, 0],
      idle: [0.55, 0.75, 0.05],
      wave: [0.65, 1.35, 0.08],
    },
  },
  {
    id: 'l_wrist',
    nameZh: '左手腕',
    nameEn: 'L_Wrist',
    group: 'upper',
    rule: 'motionSafety.ts 腕关节灵活动作域 [P: ±70°, Y: ±45°, R: ±60°]，支持大幅挥手与招手',
    angles: 'PRON: 0.0° DEVI: 0.0°',
    limits: { pitch: [-70, 70], yaw: [-45, 45], roll: [-60, 60] },
    poses: {
      t_pose: [-1.05, 1.15, 0],
      idle: [-0.48, 0.42, 0.12],
      wave: [-0.48, 0.42, 0.12],
    },
  },
  {
    id: 'r_wrist',
    nameZh: '右手腕',
    nameEn: 'R_Wrist',
    group: 'upper',
    rule: 'motionSafety.ts 腕关节灵活动作域 [P: ±70°, Y: ±45°, R: ±60°]，支持大幅挥手与招手',
    angles: 'WAVE_SWING: ±25.0°',
    limits: { pitch: [-70, 70], yaw: [-45, 45], roll: [-60, 60] },
    poses: {
      t_pose: [1.05, 1.15, 0],
      idle: [0.48, 0.42, 0.12],
      wave: [0.75, 1.65, 0.15],
    },
  },
  // 下肢 (6)
  {
    id: 'l_hip',
    nameZh: '左髋',
    nameEn: 'L_Hip',
    group: 'lower',
    rule: 'motionSafety.ts 髋关节球窝活动域 [P: -40°~+120°(高抬腿), Y: ±45°, R: ±65°]',
    angles: 'FLEX: 0.0° ABD: 0.0°',
    limits: { pitch: [-40, 120], yaw: [-45, 45], roll: [-65, 65] },
    poses: {
      t_pose: [-0.18, 0.38, 0],
      idle: [-0.18, 0.38, 0],
      wave: [-0.18, 0.38, 0],
    },
  },
  {
    id: 'r_hip',
    nameZh: '右髋',
    nameEn: 'R_Hip',
    group: 'lower',
    rule: 'motionSafety.ts 髋关节球窝活动域 [P: -40°~+120°(高抬腿), Y: ±45°, R: ±65°]',
    angles: 'FLEX: 0.0° ABD: 0.0°',
    limits: { pitch: [-40, 120], yaw: [-45, 45], roll: [-65, 65] },
    poses: {
      t_pose: [0.18, 0.38, 0],
      idle: [0.18, 0.38, 0],
      wave: [0.18, 0.38, 0],
    },
  },
  {
    id: 'l_knee',
    nameZh: '左膝',
    nameEn: 'L_Knee',
    group: 'lower',
    rule: 'motionSafety.ts 膝关节单向屈曲 [0°, 135°]，单自由度铰链自锁，严禁前向反折',
    angles: 'BEND: +8.0° (自然微屈)',
    limits: { pitch: [0, 135], yaw: [-10, 10], roll: [-10, 10] },
    poses: {
      t_pose: [-0.28, -0.12, 0],
      idle: [-0.26, -0.14, 0.04],
      wave: [-0.26, -0.14, 0.04],
    },
  },
  {
    id: 'r_knee',
    nameZh: '右膝',
    nameEn: 'R_Knee',
    group: 'lower',
    rule: 'motionSafety.ts 膝关节单向屈曲 [0°, 135°]，单自由度铰链自锁，严禁前向反折',
    angles: 'BEND: +5.0° (自然微屈)',
    limits: { pitch: [0, 135], yaw: [-10, 10], roll: [-10, 10] },
    poses: {
      t_pose: [0.28, -0.12, 0],
      idle: [0.26, -0.14, 0.04],
      wave: [0.26, -0.14, 0.04],
    },
  },
  {
    id: 'l_ankle',
    nameZh: '左踝',
    nameEn: 'L_Ankle',
    group: 'lower',
    rule: 'motionSafety.ts 踝关节屈伸平衡 [P: -45°~+50°, Y: ±25°, R: ±30°]，防浮空穿模',
    angles: 'PITCH: 0.0° YAW: 0.0°',
    limits: { pitch: [-45, 50], yaw: [-25, 25], roll: [-30, 30] },
    poses: {
      t_pose: [-0.28, -0.75, 0],
      idle: [-0.28, -0.75, 0.08],
      wave: [-0.28, -0.75, 0.08],
    },
  },
  {
    id: 'r_ankle',
    nameZh: '右踝',
    nameEn: 'R_Ankle',
    group: 'lower',
    rule: 'motionSafety.ts 踝关节屈伸平衡 [P: -45°~+50°, Y: ±25°, R: ±30°]，防浮空穿模',
    angles: 'PITCH: 0.0° YAW: 0.0°',
    limits: { pitch: [-45, 50], yaw: [-25, 25], roll: [-30, 30] },
    poses: {
      t_pose: [0.28, -0.75, 0],
      idle: [0.28, -0.75, 0.08],
      wave: [0.28, -0.75, 0.08],
    },
  },
];

// 16-Joint VRM / SMPL-H Forward Kinematics (FK) Hierarchy
const SKELETON_HIERARCHY: Record<string, { parent: string | null; children: string[] }> = {
  hips: { parent: null, children: ['spine', 'l_hip', 'r_hip'] },
  spine: { parent: 'hips', children: ['neck', 'l_shoulder', 'r_shoulder'] },
  neck: { parent: 'spine', children: ['head'] },
  head: { parent: 'neck', children: [] },
  l_shoulder: { parent: 'spine', children: ['l_elbow'] },
  l_elbow: { parent: 'l_shoulder', children: ['l_wrist'] },
  l_wrist: { parent: 'l_elbow', children: [] },
  r_shoulder: { parent: 'spine', children: ['r_elbow'] },
  r_elbow: { parent: 'r_shoulder', children: ['r_wrist'] },
  r_wrist: { parent: 'r_elbow', children: [] },
  l_hip: { parent: 'hips', children: ['l_knee'] },
  l_knee: { parent: 'l_hip', children: ['l_ankle'] },
  l_ankle: { parent: 'l_knee', children: [] },
  r_hip: { parent: 'hips', children: ['r_knee'] },
  r_knee: { parent: 'r_hip', children: ['r_ankle'] },
  r_ankle: { parent: 'r_knee', children: [] },
};

const FK_EVAL_ORDER = [
  'hips',
  'spine',
  'neck',
  'head',
  'l_shoulder',
  'l_elbow',
  'l_wrist',
  'r_shoulder',
  'r_elbow',
  'r_wrist',
  'l_hip',
  'l_knee',
  'l_ankle',
  'r_hip',
  'r_knee',
  'r_ankle',
];

// 3 Compact Groups for Bottom Selector (4 Torso, 6 Upper, 6 Lower)
const JOINT_GROUPS = [
  {
    key: 'torso',
    label: '躯干 (4)',
    color: 'border-l-2 border-l-[#8B7FE8]',
    joints: [
      { id: 'head', nameZh: '头部', nameEn: 'Head' },
      { id: 'neck', nameZh: '颈部', nameEn: 'Neck' },
      { id: 'spine', nameZh: '胸脊', nameEn: 'Spine' },
      { id: 'hips', nameZh: '骨盆', nameEn: 'Hips' },
    ],
  },
  {
    key: 'upper',
    label: '上肢 (6)',
    color: 'border-l-2 border-l-[#3B82F6]',
    joints: [
      { id: 'l_shoulder', nameZh: '左肩', nameEn: 'L_Shoulder' },
      { id: 'r_shoulder', nameZh: '右肩', nameEn: 'R_Shoulder' },
      { id: 'l_elbow', nameZh: '左肘', nameEn: 'L_Elbow' },
      { id: 'r_elbow', nameZh: '右肘', nameEn: 'R_Elbow' },
      { id: 'l_wrist', nameZh: '左手腕', nameEn: 'L_Wrist' },
      { id: 'r_wrist', nameZh: '右手腕', nameEn: 'R_Wrist' },
    ],
  },
  {
    key: 'lower',
    label: '下肢 (6)',
    color: 'border-l-2 border-l-[#10B981]',
    joints: [
      { id: 'l_hip', nameZh: '左髋', nameEn: 'L_Hip' },
      { id: 'r_hip', nameZh: '右髋', nameEn: 'R_Hip' },
      { id: 'l_knee', nameZh: '左膝', nameEn: 'L_Knee' },
      { id: 'r_knee', nameZh: '右膝', nameEn: 'R_Knee' },
      { id: 'l_ankle', nameZh: '左踝', nameEn: 'L_Ankle' },
      { id: 'r_ankle', nameZh: '右踝', nameEn: 'R_Ankle' },
    ],
  },
];

// Forward Kinematics 3D Euler Rotation Helper (Roll -> Pitch -> Yaw)
const rotateEulerVec = (
  vec: [number, number, number],
  pitchDeg: number,
  yawDeg: number,
  rollDeg: number
): [number, number, number] => {
  if (pitchDeg === 0 && yawDeg === 0 && rollDeg === 0) return vec;

  const p = (pitchDeg * Math.PI) / 180;
  const y = (yawDeg * Math.PI) / 180;
  const r = (rollDeg * Math.PI) / 180;

  let [x, y0, z] = vec;

  // 1. Roll around Z
  if (r !== 0) {
    const cosR = Math.cos(r);
    const sinR = Math.sin(r);
    const nx = x * cosR - y0 * sinR;
    const ny = x * sinR + y0 * cosR;
    x = nx;
    y0 = ny;
  }

  // 2. Pitch around X
  if (p !== 0) {
    const cosP = Math.cos(p);
    const sinP = Math.sin(p);
    const ny = y0 * cosP - z * sinP;
    const nz = y0 * sinP + z * cosP;
    y0 = ny;
    z = nz;
  }

  // 3. Yaw around Y
  if (y !== 0) {
    const cosY = Math.cos(y);
    const sinY = Math.sin(y);
    const nx = x * cosY + z * sinY;
    const nz = -x * sinY + z * cosY;
    x = nx;
    z = nz;
  }

  return [x, y0, z];
};

type InteractionMode = 'orbit' | 'manual' | 'mocap';

const Tab01BoundingSphere: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mocapVideoRef = useRef<HTMLVideoElement>(null);

  // 1. Core Modes: orbit (视角漫游) / manual (手动调关节) / mocap (摄像头动捕)
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('orbit');
  const [yaw, setYaw] = useState<number>(25);
  const [pitch, setPitch] = useState<number>(15);
  const [zoom, setZoom] = useState<number>(1.0);
  const [currentPose, setCurrentPose] = useState<PoseType>('idle');
  const [selectedJointId, setSelectedJointId] = useState<string>('r_wrist');

  // Dragging & Interaction
  const [isDraggingCamera, setIsDraggingCamera] = useState<boolean>(false);
  const [draggingJointId, setDraggingJointId] = useState<string | null>(null);
  const lastMousePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const projectedJointsRef = useRef<{ id: string; sx: number; sy: number }[]>([]);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const initialPinchDistRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(1.0);

  // Manual IK & FK offsets
  const [manualOffsets, setManualOffsets] = useState<Record<string, [number, number, number]>>({});
  const [sliderAngles, setSliderAngles] = useState<Record<string, { pitch: number; yaw: number; roll: number }>>({
    head: { pitch: 0, yaw: 0, roll: 0 },
    neck: { pitch: 0, yaw: 0, roll: 0 },
    spine: { pitch: 0, yaw: 0, roll: 0 },
    hips: { pitch: 0, yaw: 0, roll: 0 },
    l_shoulder: { pitch: 0, yaw: 0, roll: 0 },
    r_shoulder: { pitch: 0, yaw: 0, roll: 0 },
    l_elbow: { pitch: 0, yaw: 0, roll: 0 },
    r_elbow: { pitch: 0, yaw: 0, roll: 0 },
    l_wrist: { pitch: 0, yaw: 0, roll: 0 },
    r_wrist: { pitch: 15, yaw: 0, roll: 20 },
    l_hip: { pitch: 0, yaw: 0, roll: 0 },
    r_hip: { pitch: 0, yaw: 0, roll: 0 },
    l_knee: { pitch: 0, yaw: 0, roll: 0 },
    r_knee: { pitch: 0, yaw: 0, roll: 0 },
    l_ankle: { pitch: 0, yaw: 0, roll: 0 },
    r_ankle: { pitch: 0, yaw: 0, roll: 0 },
  });
  const [limitTriggered, setLimitTriggered] = useState<boolean>(false);

  // Mocap State & MediaPipe Pose
  const [mocapStream, setMocapStream] = useState<MediaStream | null>(null);
  const mocapStreamRef = useRef<MediaStream | null>(null);
  const [, setMocapCameraActive] = useState<boolean>(false);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const [, setMocapReady] = useState<boolean>(false);
  const mocapAnglesRef = useRef<Record<string, { pitch: number; yaw: number; roll: number }>>({});
  const mocapPipCanvasRef = useRef<HTMLCanvasElement>(null);

  const isBoundLocked = zoom >= 1.40;

  // Reset view to default
  const handleResetOrbit = () => {
    setYaw(25);
    setPitch(15);
    setZoom(1.0);
    setCurrentPose('idle');
    setSelectedJointId('r_wrist');
  };

  const handleResetManualPose = () => {
    setManualOffsets({});
    const initialAngles: Record<string, { pitch: number; yaw: number; roll: number }> = {};
    for (const j of SKELETON_JOINTS) {
      initialAngles[j.id] = { pitch: 0, yaw: 0, roll: 0 };
    }
    setSliderAngles(initialAngles);
    setLimitTriggered(false);
  };

  // 1. Solve Wheel Conflict: Native non-passive event listener with stopPropagation & preventDefault
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY * -0.0015;
      setZoom((z) => {
        const next = z + delta;
        return Math.max(0.75, Math.min(1.40, Number(next.toFixed(2))));
      });
    };

    el.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleNativeWheel);
    };
  }, []);

  // 2. Strict CameraLease Lifecycle Management for Mocap Mode
  useEffect(() => {
    if (interactionMode !== 'mocap') {
      if (mocapStreamRef.current) {
        mocapStreamRef.current.getTracks().forEach((t) => t.stop());
        mocapStreamRef.current = null;
      }
      setMocapStream(null);
      setMocapCameraActive(false);
    } else {
      let cancelled = false;
      const startMocap = async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          mocapStreamRef.current = stream;
          setMocapStream(stream);
          setMocapCameraActive(true);
        } catch (err) {
          console.warn('Webcam not accessible, using mock mocap stream:', err);
          setMocapCameraActive(true);
        }
      };
      startMocap();

      return () => {
        cancelled = true;
        if (mocapStreamRef.current) {
          mocapStreamRef.current.getTracks().forEach((t) => t.stop());
          mocapStreamRef.current = null;
        }
        setMocapStream(null);
        setMocapCameraActive(false);
      };
    }
  }, [interactionMode]);

  // Video element binding for mocap stream
  useEffect(() => {
    if (mocapVideoRef.current && mocapStream) {
      mocapVideoRef.current.srcObject = mocapStream;
      mocapVideoRef.current.play().catch(() => {});
    }
  }, [mocapStream]);

  // 3. Load MediaPipe PoseLandmarker from local /mediapipe/ (Lazy loaded on demand)
  useEffect(() => {
    if (interactionMode !== 'mocap' || landmarkerRef.current) return;
    let isMounted = true;
    const initPose = async () => {
      try {
        const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
        const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
        if (!isMounted) return;
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `${base}mediapipe/pose_landmarker_lite.task`,
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numPoses: 1,
        });
        if (isMounted) {
          landmarkerRef.current = landmarker;
          setMocapReady(true);
        }
      } catch (e) {
        console.warn('Local MediaPipe init notice:', e);
      }
    };
    initPose();

    return () => {
      isMounted = false;
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
    };
  }, [interactionMode]);

  // Handle fine-tuning slider adjustments in manual mode with strict motionSafety checks
  const handleSliderChange = (axis: 'pitch' | 'yaw' | 'roll', val: number) => {
    const cur = sliderAngles[selectedJointId] || { pitch: 0, yaw: 0, roll: 0 };
    const next = { ...cur, [axis]: val };
    setSliderAngles((prev) => ({ ...prev, [selectedJointId]: next }));

    // Check motionSafety.ts physical limit for this specific joint
    const jointDef = SKELETON_JOINTS.find((j) => j.id === selectedJointId);
    if (jointDef) {
      const pL = jointDef.limits.pitch;
      const yL = jointDef.limits.yaw;
      const rL = jointDef.limits.roll;
      const isExceeded =
        next.pitch < pL[0] || next.pitch > pL[1] ||
        next.yaw < yL[0] || next.yaw > yL[1] ||
        next.roll < rL[0] || next.roll > rL[1];
      setLimitTriggered(isExceeded);
    }
  };

  // 4. 3D Wireframe & Bounding Sphere Renderer Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerX = width / 2;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      // Clean white canvas background
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);

      // Subtle architectural grid
      ctx.strokeStyle = 'rgba(17, 18, 24, 0.05)';
      ctx.lineWidth = 1;
      const step = 20;
      for (let x = 0; x < width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Projection angles
      const radYaw = (yaw * Math.PI) / 180;
      const radPitch = (pitch * Math.PI) / 180;
      const cosY = Math.cos(radYaw);
      const sinY = Math.sin(radYaw);
      const cosP = Math.cos(radPitch);
      const sinP = Math.sin(radPitch);

      const project = (x: number, y: number, z: number): [number, number, number] => {
        // Rotate around Y (Yaw)
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;
        // Rotate around X (Pitch)
        const y2 = y * cosP - z1 * sinP;
        const z2 = y * sinP + z1 * cosP;

        // Perspective divide (Camera distance = 4.2)
        const dist = 4.2;
        const perspective = dist / (dist + z2);
        const scale = (height / 3.4) * zoom * perspective;
        const screenX = centerX + x1 * scale;
        const screenY = centerY - (y2 - 0.25) * scale;
        return [screenX, screenY, z2];
      };

      // 1. Draw floor coordinate circle / cross at y = -0.85
      ctx.strokeStyle = 'rgba(17, 18, 24, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let a = 0; a <= Math.PI * 2 + 0.1; a += 0.2) {
        const px = Math.cos(a) * 0.9;
        const pz = Math.sin(a) * 0.9;
        const [sx, sy] = project(px, -0.85, pz);
        if (a === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();

      // Floor grid lines
      for (let g = -0.8; g <= 0.85; g += 0.4) {
        const [x1, y1] = project(g, -0.85, -0.8);
        const [x2, y2] = project(g, -0.85, 0.8);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        const [x3, y3] = project(-0.8, -0.85, g);
        const [x4, y4] = project(0.8, -0.85, g);
        ctx.beginPath();
        ctx.moveTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.stroke();
      }

      // 2. Draw Constant Bounding Sphere (3 orthogonal rings)
      const sphereRadius = 1.35;
      const sphereCenter = 0.35;
      const ringSteps = 48;

      const drawRing = (getCoord: (t: number) => [number, number, number], strokeStyle: string, lineWidth: number, isDashed = false) => {
        ctx.save();
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        if (isDashed) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        for (let i = 0; i <= ringSteps; i++) {
          const t = (i / ringSteps) * Math.PI * 2;
          const [px, py, pz] = getCoord(t);
          const [sx, sy] = project(px, py, pz);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
        ctx.restore();
      };

      const ringColor = isBoundLocked ? '#8B7FE8' : 'rgba(139, 127, 232, 0.45)';
      const ringWidth = isBoundLocked ? 2.5 : 1.2;

      // Equator (XZ plane)
      drawRing((t) => [sphereRadius * Math.cos(t), sphereCenter, sphereRadius * Math.sin(t)], ringColor, ringWidth, !isBoundLocked);
      // Meridian (XY plane)
      drawRing((t) => [sphereRadius * Math.cos(t), sphereCenter + sphereRadius * Math.sin(t), 0], ringColor, ringWidth, !isBoundLocked);
      // Meridian (YZ plane)
      drawRing((t) => [0, sphereCenter + sphereRadius * Math.sin(t), sphereRadius * Math.cos(t)], ringColor, ringWidth, !isBoundLocked);

      // 3. Mocap Detection & Kalidokit Kinematics Solving with 2D Verification Overlay
      if (interactionMode === 'mocap') {
        const now = performance.now();
        const rad2deg = 180 / Math.PI;

        if (landmarkerRef.current && mocapVideoRef.current && mocapVideoRef.current.readyState >= 2) {
          try {
            const results = landmarkerRef.current.detectForVideo(mocapVideoRef.current, now);
            if (results && results.landmarks && results.landmarks[0]) {
              const lm2d = results.landmarks[0];
              const lm3d = results.worldLandmarks && results.worldLandmarks[0] ? results.worldLandmarks[0] : lm2d;

              // Draw real-time 2D skeleton verification overlay on the PIP video
              const pipCanvas = mocapPipCanvasRef.current;
              if (pipCanvas) {
                const pCtx = pipCanvas.getContext('2d');
                if (pCtx) {
                  pCtx.clearRect(0, 0, pipCanvas.width, pipCanvas.height);
                  const pw = pipCanvas.width;
                  const ph = pipCanvas.height;

                  const pipConnections = [
                    [11, 12], [11, 13], [13, 15],
                    [12, 14], [14, 16],
                    [11, 23], [12, 24], [23, 24],
                    [23, 25], [25, 27],
                    [24, 26], [26, 28],
                  ];

                  pCtx.strokeStyle = '#8B7FE8';
                  pCtx.lineWidth = 2.5;
                  for (const [i, j] of pipConnections) {
                    const p1 = lm2d[i];
                    const p2 = lm2d[j];
                    if (p1 && p2 && (p1.visibility ?? 1) > 0.35 && (p2.visibility ?? 1) > 0.35) {
                      pCtx.beginPath();
                      pCtx.moveTo(p1.x * pw, p1.y * ph);
                      pCtx.lineTo(p2.x * pw, p2.y * ph);
                      pCtx.stroke();
                    }
                  }

                  // Draw joints
                  pCtx.fillStyle = '#7ED4AC';
                  for (const idx of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
                    const p = lm2d[idx];
                    if (p && (p.visibility ?? 1) > 0.35) {
                      pCtx.beginPath();
                      pCtx.arc(p.x * pw, p.y * ph, 3, 0, Math.PI * 2);
                      pCtx.fill();
                    }
                  }
                }
              }

              // Run Kalidokit Pose Solver
              const riggedPose = Kalidokit.Pose.solve(lm3d, lm2d, {
                runtime: 'mediapipe',
                video: mocapVideoRef.current,
                enableLegs: true,
              });

              if (riggedPose) {
                const alpha = 0.30;
                const updateMocapAngle = (jointId: string, pitch: number, yaw: number, roll: number) => {
                  const prev = mocapAnglesRef.current[jointId] || { pitch: 0, yaw: 0, roll: 0 };
                  const targetP = isNaN(pitch) ? prev.pitch : pitch;
                  const targetY = isNaN(yaw) ? prev.yaw : yaw;
                  const targetR = isNaN(roll) ? prev.roll : roll;
                  mocapAnglesRef.current[jointId] = {
                    pitch: prev.pitch * (1 - alpha) + targetP * alpha,
                    yaw: prev.yaw * (1 - alpha) + targetY * alpha,
                    roll: prev.roll * (1 - alpha) + targetR * alpha,
                  };
                };

                // Rigged Pose to Humanoid Skeleton Mapping (mirrored camera perspective)
                if (riggedPose.RightUpperArm) {
                  updateMocapAngle(
                    'r_shoulder',
                    -riggedPose.RightUpperArm.x * rad2deg,
                    riggedPose.RightUpperArm.y * rad2deg,
                    -riggedPose.RightUpperArm.z * rad2deg
                  );
                }
                if (riggedPose.RightLowerArm) {
                  updateMocapAngle(
                    'r_elbow',
                    0,
                    0,
                    Math.max(0, Math.min(145, Math.abs(riggedPose.RightLowerArm.z || riggedPose.RightLowerArm.x) * rad2deg))
                  );
                }
                if (riggedPose.LeftUpperArm) {
                  updateMocapAngle(
                    'l_shoulder',
                    -riggedPose.LeftUpperArm.x * rad2deg,
                    riggedPose.LeftUpperArm.y * rad2deg,
                    riggedPose.LeftUpperArm.z * rad2deg
                  );
                }
                if (riggedPose.LeftLowerArm) {
                  updateMocapAngle(
                    'l_elbow',
                    0,
                    0,
                    Math.max(0, Math.min(145, Math.abs(riggedPose.LeftLowerArm.z || riggedPose.LeftLowerArm.x) * rad2deg))
                  );
                }
                if (riggedPose.Spine) {
                  updateMocapAngle(
                    'spine',
                    -(riggedPose.Spine.x || 0) * rad2deg,
                    (riggedPose.Spine.y || 0) * rad2deg,
                    (riggedPose.Spine.z || 0) * rad2deg
                  );
                }
                if (lm2d[0]) {
                  const headYaw = -(lm2d[0].x - 0.5) * 80;
                  const headPitch = (lm2d[0].y - 0.25) * 70;
                  updateMocapAngle('head', headPitch, headYaw, 0);
                  updateMocapAngle('neck', headPitch * 0.5, headYaw * 0.5, 0);
                }
                if (riggedPose.RightUpperLeg) {
                  updateMocapAngle(
                    'r_hip',
                    ((riggedPose.RightUpperLeg.x || 0) * rad2deg),
                    ((riggedPose.RightUpperLeg.y || 0) * rad2deg),
                    ((riggedPose.RightUpperLeg.z || 0) * rad2deg)
                  );
                }
                if (riggedPose.RightLowerLeg) {
                  updateMocapAngle(
                    'r_knee',
                    Math.max(0, Math.min(135, (riggedPose.RightLowerLeg.x || 0) * rad2deg)),
                    0,
                    0
                  );
                }
                if (riggedPose.LeftUpperLeg) {
                  updateMocapAngle(
                    'l_hip',
                    ((riggedPose.LeftUpperLeg.x || 0) * rad2deg),
                    ((riggedPose.LeftUpperLeg.y || 0) * rad2deg),
                    ((riggedPose.LeftUpperLeg.z || 0) * rad2deg)
                  );
                }
                if (riggedPose.LeftLowerLeg) {
                  updateMocapAngle(
                    'l_knee',
                    Math.max(0, Math.min(135, (riggedPose.LeftLowerLeg.x || 0) * rad2deg)),
                    0,
                    0
                  );
                }
              }
            }
          } catch (e) {
            console.warn('Kalidokit solve warning:', e);
          }
        } else {
          // Smooth simulated Kalidokit test driver for offline/headless presentation
          const t = now * 0.0025;
          const alpha = 0.25;
          const target = {
            r_shoulder: { pitch: 35 + Math.sin(t * 1.5) * 40, yaw: 15, roll: -70 - Math.sin(t * 2) * 35 },
            r_elbow: { pitch: 0, yaw: 0, roll: 70 + Math.cos(t * 2) * 35 },
            r_wrist: { pitch: 10, yaw: Math.sin(t * 4) * 30, roll: 15 },
            l_shoulder: { pitch: 0, yaw: 0, roll: 15 + Math.sin(t * 0.8) * 8 },
            l_elbow: { pitch: 0, yaw: 0, roll: 10 },
            spine: { pitch: Math.sin(t * 0.6) * 5, yaw: Math.sin(t * 0.8) * 6, roll: 0 },
            head: { pitch: Math.sin(t * 0.6) * 8, yaw: Math.sin(t * 0.8) * 12, roll: 0 },
          };
          for (const [k, angles] of Object.entries(target)) {
            const prev = mocapAnglesRef.current[k] || { pitch: 0, yaw: 0, roll: 0 };
            mocapAnglesRef.current[k] = {
              pitch: prev.pitch * (1 - alpha) + angles.pitch * alpha,
              yaw: prev.yaw * (1 - alpha) + angles.yaw * alpha,
              roll: prev.roll * (1 - alpha) + angles.roll * alpha,
            };
          }
        }
      }

      // 4. Calculate Skeleton Coordinates with Strict FK Hierarchy (Manual & Mocap both use FK)
      const jointMap = new Map<string, [number, number, number]>();
      const currentProjected: { id: string; sx: number; sy: number }[] = [];

      if (interactionMode === 'manual' || interactionMode === 'mocap') {
        const worldPos: Record<string, [number, number, number]> = {};
        const accRot: Record<string, { pitch: number; yaw: number; roll: number }> = {};
        const activeAngles = interactionMode === 'manual' ? sliderAngles : mocapAnglesRef.current;

        for (const jId of FK_EVAL_ORDER) {
          const jointDef = SKELETON_JOINTS.find((j) => j.id === jId)!;
          const basePose = jointDef.poses['idle'];
          const userOff = interactionMode === 'manual' ? (manualOffsets[jId] || [0, 0, 0]) : [0, 0, 0];
          const localRot = activeAngles[jId] || { pitch: 0, yaw: 0, roll: 0 };
          const parentId = SKELETON_HIERARCHY[jId].parent;

          if (!parentId) {
            // Root joint (hips): drives whole body position and orientation
            worldPos[jId] = [
              basePose[0] + userOff[0],
              basePose[1] + userOff[1],
              basePose[2] + userOff[2],
            ];
            accRot[jId] = { ...localRot };
          } else {
            const parentWorld = worldPos[parentId];
            const parentRot = accRot[parentId];
            const parentDef = SKELETON_JOINTS.find((j) => j.id === parentId)!;
            const parentBase = parentDef.poses['idle'];

            // Rest relative offset vector from parent
            const restOffset: [number, number, number] = [
              basePose[0] - parentBase[0],
              basePose[1] - parentBase[1],
              basePose[2] - parentBase[2],
            ];

            // Rotate relative offset by parent accumulated rotation (FK linkage)
            const rotatedOffset = rotateEulerVec(
              restOffset,
              parentRot.pitch,
              parentRot.yaw,
              parentRot.roll
            );

            worldPos[jId] = [
              parentWorld[0] + rotatedOffset[0] + userOff[0],
              parentWorld[1] + rotatedOffset[1] + userOff[1],
              parentWorld[2] + rotatedOffset[2] + userOff[2],
            ];

            accRot[jId] = {
              pitch: parentRot.pitch + localRot.pitch,
              yaw: parentRot.yaw + localRot.yaw,
              roll: parentRot.roll + localRot.roll,
            };
          }

          jointMap.set(jId, worldPos[jId]);
          const [sx, sy] = project(worldPos[jId][0], worldPos[jId][1], worldPos[jId][2]);
          currentProjected.push({ id: jId, sx, sy });
        }
      } else {
        // orbit mode
        for (const j of SKELETON_JOINTS) {
          const coords = j.poses[currentPose];
          jointMap.set(j.id, coords);
          const [sx, sy] = project(coords[0], coords[1], coords[2]);
          currentProjected.push({ id: j.id, sx, sy });
        }
      }
      projectedJointsRef.current = currentProjected;

      // 5. Draw Skeleton Bones (Complete 16-Joint VRM / SMPL-H skeleton)
      const boneConnections: [string, string][] = [
        ['neck', 'head'],
        ['spine', 'neck'],
        ['hips', 'spine'],
        ['spine', 'l_shoulder'],
        ['l_shoulder', 'l_elbow'],
        ['l_elbow', 'l_wrist'],
        ['spine', 'r_shoulder'],
        ['r_shoulder', 'r_elbow'],
        ['r_elbow', 'r_wrist'],
        ['hips', 'l_hip'],
        ['l_hip', 'l_knee'],
        ['l_knee', 'l_ankle'],
        ['hips', 'r_hip'],
        ['r_hip', 'r_knee'],
        ['r_knee', 'r_ankle'],
        ['l_hip', 'r_hip'],
      ];

      ctx.strokeStyle = '#111218';
      ctx.lineWidth = 2.2;
      for (const [idA, idB] of boneConnections) {
        const posA = jointMap.get(idA);
        const posB = jointMap.get(idB);
        if (posA && posB) {
          const [sx1, sy1] = project(posA[0], posA[1], posA[2]);
          const [sx2, sy2] = project(posB[0], posB[1], posB[2]);
          ctx.beginPath();
          ctx.moveTo(sx1, sy1);
          ctx.lineTo(sx2, sy2);
          ctx.stroke();
        }
      }

      // 6. Draw Head Wireframe
      const headPos = jointMap.get('head');
      if (headPos) {
        const [hx, hy] = project(headPos[0], headPos[1], headPos[2]);
        const headRadius = 22 * zoom;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(hx, hy, headRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#111218';
        ctx.lineWidth = 2.0;
        ctx.stroke();

        // Visor line
        ctx.strokeStyle = '#8B7FE8';
        ctx.lineWidth = 2.5;
        const [vx1, vy1] = project(headPos[0] - 0.14, headPos[1], headPos[2] + 0.16);
        const [vx2, vy2] = project(headPos[0] + 0.14, headPos[1], headPos[2] + 0.16);
        ctx.beginPath();
        ctx.moveTo(vx1, vy1);
        ctx.lineTo(vx2, vy2);
        ctx.stroke();
      }

      // 7. Draw Interactive Joint Nodes (16 Nodes with Dual Concentric Highlight & Label)
      for (const j of SKELETON_JOINTS) {
        const coords = jointMap.get(j.id);
        if (!coords) continue;
        const [sx, sy] = project(coords[0], coords[1], coords[2]);
        const isSelected = selectedJointId === j.id;
        const isWarning = isSelected && limitTriggered && interactionMode === 'manual';

        // Outer dual concentric ring if selected or warning
        if (isSelected) {
          // Inner ring
          ctx.strokeStyle = isWarning ? '#F59E0B' : '#8B7FE8';
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
          ctx.stroke();

          // Outer halo
          ctx.strokeStyle = isWarning ? 'rgba(245, 158, 11, 0.40)' : 'rgba(139, 127, 232, 0.35)';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(sx, sy, 13.5, 0, Math.PI * 2);
          ctx.stroke();
        }

        // Joint Core Dot
        ctx.fillStyle = isWarning ? '#F59E0B' : isSelected ? '#8B7FE8' : '#111218';
        ctx.beginPath();
        ctx.arc(sx, sy, isSelected ? 4.8 : 3.6, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Node Label tag for selected joint
        if (isSelected) {
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillStyle = isWarning ? '#D97706' : '#5B4EB8';
          ctx.fillText(`${j.nameZh} (${j.nameEn})`, sx + 12, sy + 3);
        }
      }

      // 8. Bottom-Left Canvas Telemetry Watermark
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = isBoundLocked ? '#8B7FE8' : '#9396AA';
      ctx.fillText(
        `BOUND_SPHERE // R: 1.35m · cameraBounds.ts · 16_JOINT_RIG · ${interactionMode.toUpperCase()}_MODE`,
        14,
        height - 14
      );

      // Loop animation continuously (especially for mocap and smooth IK)
      animId = requestAnimationFrame(render);
    };

    render();
    return () => {
      cancelAnimationFrame(animId);
    };
  }, [yaw, pitch, zoom, isBoundLocked, currentPose, selectedJointId, interactionMode, manualOffsets, limitTriggered, sliderAngles]);

  // Unified Pointer & Touch Handlers for 3D Viewport
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // Handle 2-finger pinch gesture
    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      initialPinchDistRef.current = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      initialZoomRef.current = zoom;
      setIsDraggingCamera(false);
      setDraggingJointId(null);
      return;
    }

    if (activePointersRef.current.size > 2) return;

    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    // Check hit test against joints (radius = 24px on mobile for comfortable touch)
    let closestJoint: string | null = null;
    let minDist = 24;
    for (const j of projectedJointsRef.current) {
      const dist = Math.hypot(clickX - j.sx, clickY - j.sy);
      if (dist < minDist) {
        minDist = dist;
        closestJoint = j.id;
      }
    }

    if (closestJoint) {
      setSelectedJointId(closestJoint);
      // Synchronize safety limit state for the clicked joint
      const jointDef = SKELETON_JOINTS.find((k) => k.id === closestJoint);
      if (jointDef && interactionMode === 'manual') {
        const angles = sliderAngles[closestJoint] || { pitch: 0, yaw: 0, roll: 0 };
        const pL = jointDef.limits.pitch;
        const yL = jointDef.limits.yaw;
        const rL = jointDef.limits.roll;
        const isExceeded =
          angles.pitch < pL[0] || angles.pitch > pL[1] ||
          angles.yaw < yL[0] || angles.yaw > yL[1] ||
          angles.roll < rL[0] || angles.roll > rL[1];
        setLimitTriggered(isExceeded);
      }
      if (interactionMode === 'manual') {
        setDraggingJointId(closestJoint);
        lastMousePos.current = { x: e.clientX, y: e.clientY };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }

    // Orbit drag
    setIsDraggingCamera(true);
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    // Handle 2-finger pinch zoom
    if (activePointersRef.current.size === 2 && initialPinchDistRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const currentDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = currentDist / initialPinchDistRef.current;
      const newZoom = Math.max(0.75, Math.min(1.40, Number((initialZoomRef.current * scale).toFixed(2))));
      setZoom(newZoom);
      return;
    }

    if (draggingJointId && interactionMode === 'manual') {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      const radY = (yaw * Math.PI) / 180;
      const radP = (pitch * Math.PI) / 180;
      const scale = (360 / 3.4) * zoom;

      const dwx = (dx / scale) * Math.cos(radY);
      const dwy = -(dy / scale) * Math.cos(radP);
      const dwz = (dx / scale) * Math.sin(radY);

      const cur = manualOffsets[draggingJointId] || [0, 0, 0];
      let nextOffset: [number, number, number] = [cur[0] + dwx, cur[1] + dwy, cur[2] + dwz];
      const updatedExtraOffsets: Record<string, [number, number, number]> = {};
      let isExceeded = false;

      // Kinematics and relaxed motionSafety.ts limits across all 16 joints
      if (draggingJointId === 'r_wrist' || draggingJointId === 'l_wrist') {
        const isR = draggingJointId === 'r_wrist';
        const shoulderPos = isR ? [0.42, 1.12, 0] : [-0.42, 1.12, 0];
        const baseW = isR ? [0.48, 0.42, 0.12] : [-0.48, 0.42, 0.12];
        const targetW = [baseW[0] + nextOffset[0], baseW[1] + nextOffset[1], baseW[2] + nextOffset[2]];
        const dist = Math.hypot(targetW[0] - shoulderPos[0], targetW[1] - shoulderPos[1], targetW[2] - shoulderPos[2]);
        const maxReach = 0.95;

        if (dist > maxReach) {
          const ratio = maxReach / dist;
          nextOffset = [
            shoulderPos[0] + (targetW[0] - shoulderPos[0]) * ratio - baseW[0],
            shoulderPos[1] + (targetW[1] - shoulderPos[1]) * ratio - baseW[0],
            shoulderPos[2] + (targetW[2] - shoulderPos[2]) * ratio - baseW[2],
          ];
          isExceeded = true;
        }

        // 2-Bone IK elbow calculation
        const mid = [(shoulderPos[0] + targetW[0]) / 2, (shoulderPos[1] + targetW[1]) / 2, (shoulderPos[2] + targetW[2]) / 2];
        const bendDist = Math.sqrt(Math.max(0, 0.42 * 0.42 - (dist / 2) * (dist / 2)));
        const elbowTarget = [
          mid[0] + (isR ? 0.6 : -0.6) * bendDist,
          mid[1] + 0.1 * bendDist,
          mid[2] - 0.4 * bendDist,
        ];
        const baseE = isR ? [0.55, 0.75, 0.05] : [-0.55, 0.75, 0.05];
        updatedExtraOffsets[isR ? 'r_elbow' : 'l_elbow'] = [
          elbowTarget[0] - baseE[0],
          elbowTarget[1] - baseE[1],
          elbowTarget[2] - baseE[2],
        ];
      } else if (draggingJointId === 'r_ankle' || draggingJointId === 'l_ankle') {
        const isR = draggingJointId === 'r_ankle';
        const hipPos = isR ? [0.18, 0.38, 0] : [-0.18, 0.38, 0];
        const baseA = isR ? [0.28, -0.75, 0.08] : [-0.28, -0.75, 0.08];
        const targetA = [baseA[0] + nextOffset[0], baseA[1] + nextOffset[1], baseA[2] + nextOffset[2]];
        const dist = Math.hypot(targetA[0] - hipPos[0], targetA[1] - hipPos[1], targetA[2] - hipPos[2]);
        const maxReach = 1.35;

        if (dist > maxReach) {
          const ratio = maxReach / dist;
          nextOffset = [
            hipPos[0] + (targetA[0] - hipPos[0]) * ratio - baseA[0],
            hipPos[1] + (targetA[1] - hipPos[1]) * ratio - baseA[1],
            hipPos[2] + (targetA[2] - hipPos[2]) * ratio - baseA[2],
          ];
          isExceeded = true;
        }

        // Knee bend offset
        const mid = [(hipPos[0] + targetA[0]) / 2, (hipPos[1] + targetA[1]) / 2, (hipPos[2] + targetA[2]) / 2];
        const kneeBend = Math.sqrt(Math.max(0, 0.65 * 0.65 - (dist / 2) * (dist / 2)));
        const baseK = isR ? [0.26, -0.14, 0.04] : [-0.26, -0.14, 0.04];
        updatedExtraOffsets[isR ? 'r_knee' : 'l_knee'] = [
          mid[0] - baseK[0],
          mid[1] - baseK[1],
          mid[2] + kneeBend * 0.7 - baseK[2],
        ];
      } else if (draggingJointId === 'hips') {
        // Hips (Root): moves entire humanoid skeleton via FK
        const cx = Math.max(-0.85, Math.min(0.85, nextOffset[0]));
        const cy = Math.max(-0.6, Math.min(0.6, nextOffset[1]));
        const cz = Math.max(-0.6, Math.min(0.6, nextOffset[2]));
        if (cx !== nextOffset[0] || cy !== nextOffset[1] || cz !== nextOffset[2]) isExceeded = true;
        nextOffset = [cx, cy, cz];
      } else if (draggingJointId === 'spine') {
        // Spine (Chest): drives neck, head, shoulders and both arms via FK
        const cx = Math.max(-0.6, Math.min(0.6, nextOffset[0]));
        const cy = Math.max(-0.5, Math.min(0.5, nextOffset[1]));
        const cz = Math.max(-0.5, Math.min(0.5, nextOffset[2]));
        if (cx !== nextOffset[0] || cy !== nextOffset[1] || cz !== nextOffset[2]) isExceeded = true;
        nextOffset = [cx, cy, cz];
      } else if (draggingJointId === 'head' || draggingJointId === 'neck') {
        const cx = Math.max(-0.45, Math.min(0.45, nextOffset[0]));
        const cy = Math.max(-0.35, Math.min(0.35, nextOffset[1]));
        const cz = Math.max(-0.35, Math.min(0.35, nextOffset[2]));
        if (cx !== nextOffset[0] || cy !== nextOffset[1] || cz !== nextOffset[2]) isExceeded = true;
        nextOffset = [cx, cy, cz];
      } else {
        // Shoulders, Hips L/R, Elbows, Knees
        const cx = Math.max(-0.65, Math.min(0.65, nextOffset[0]));
        const cy = Math.max(-0.65, Math.min(0.65, nextOffset[1]));
        const cz = Math.max(-0.65, Math.min(0.65, nextOffset[2]));
        if (cx !== nextOffset[0] || cy !== nextOffset[1] || cz !== nextOffset[2]) isExceeded = true;
        nextOffset = [cx, cy, cz];
      }

      setLimitTriggered(isExceeded);

      // Synchronize slider angles with the dragging gesture (amplified sensitivity: 130)
      const jointDef = SKELETON_JOINTS.find((j) => j.id === draggingJointId);
      if (jointDef) {
        const curAngles = sliderAngles[draggingJointId] || { pitch: 0, yaw: 0, roll: 0 };
        const newPitch = Math.max(
          jointDef.limits.pitch[0] - 5,
          Math.min(jointDef.limits.pitch[1] + 5, Math.round(curAngles.pitch + dwy * 130))
        );
        const newYaw = Math.max(
          jointDef.limits.yaw[0] - 5,
          Math.min(jointDef.limits.yaw[1] + 5, Math.round(curAngles.yaw + dwx * 130))
        );
        setSliderAngles((prev) => ({
          ...prev,
          [draggingJointId]: { ...curAngles, pitch: newPitch, yaw: newYaw },
        }));
      }

      setManualOffsets((prev) => ({
        ...prev,
        [draggingJointId]: nextOffset,
        ...updatedExtraOffsets,
      }));
      return;
    }

    if (!isDraggingCamera) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    setYaw((y) => (y + dx * 0.75) % 360);
    setPitch((p) => Math.max(-65, Math.min(65, p + dy * 0.75)));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    activePointersRef.current.delete(e.pointerId);
    if (activePointersRef.current.size < 2) {
      initialPinchDistRef.current = null;
    }
    if (activePointersRef.current.size === 0) {
      setIsDraggingCamera(false);
      setDraggingJointId(null);
    }
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch {}
  };

  const activeJoint = SKELETON_JOINTS.find((j) => j.id === selectedJointId) || SKELETON_JOINTS[0];

  return (
    <div className="space-y-3 font-sans-ui">
      
      {/* Top Header: Tab Label + Industrial 3-Mode Segmented Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-2.5 border-b border-[#111218]/8 gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono-code text-[11px] font-bold text-[#111218]">// TAB 01 · 3D 骨骼视口</span>
          <span className="text-[10px] font-mono-code text-[#8B7FE8] hidden sm:inline">SMPL-H_VRM_RIG</span>
        </div>

        {/* 3-Mode Segmented Control (Mobile Friendly 3-Col Grid) */}
        <div className="w-full sm:w-auto grid grid-cols-3 gap-1 sm:flex sm:items-center bg-[#ECEEF2] p-1 border border-[#111218]/15 rounded font-sans-ui text-xs">
          <button
            onClick={() => setInteractionMode('orbit')}
            className={`min-h-[44px] sm:min-h-[32px] px-2 sm:px-3 py-1 font-medium text-xs transition-all cursor-pointer rounded-xs flex items-center justify-center gap-1.5 ${
              interactionMode === 'orbit'
                ? 'bg-[#111218] text-[#F2F3F7] shadow-sm'
                : 'text-[#686A7A] hover:text-[#111218]'
            }`}
          >
            <Eye className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">视角漫游</span>
          </button>
          <button
            onClick={() => setInteractionMode('manual')}
            className={`min-h-[44px] sm:min-h-[32px] px-2 sm:px-3 py-1 font-medium text-xs transition-all cursor-pointer rounded-xs flex items-center justify-center gap-1.5 ${
              interactionMode === 'manual'
                ? 'bg-[#111218] text-[#F2F3F7] shadow-sm'
                : 'text-[#686A7A] hover:text-[#111218]'
            }`}
          >
            <Move className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">手动调关节</span>
          </button>
          <button
            onClick={() => setInteractionMode('mocap')}
            className={`min-h-[44px] sm:min-h-[32px] px-2 sm:px-3 py-1 font-medium text-xs transition-all cursor-pointer rounded-xs flex items-center justify-center gap-1.5 ${
              interactionMode === 'mocap'
                ? 'bg-[#8B7FE8] text-white shadow-sm'
                : 'text-[#686A7A] hover:text-[#111218]'
            }`}
          >
            <Camera className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="truncate">摄像头动捕</span>
          </button>
        </div>
      </div>

      {/* 3D Viewport with Native Wheel Lock & Touch Prevention (Pointer Events) */}
      <div 
        ref={containerRef}
        className={`relative w-full h-[320px] sm:h-[360px] border border-[#111218]/15 bg-white overflow-hidden select-none ${
          interactionMode === 'manual' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
        }`}
        style={{ overscrollBehavior: 'contain', touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleResetOrbit}
        title={
          interactionMode === 'manual'
            ? '手动调关节: 直接拖拽关节点 · 实时 IK 与角度限位'
            : interactionMode === 'mocap'
            ? '摄像头动捕: 纯前端 MediaPipe 姿态捕捉驱动'
            : '视角漫游: 单指/左键拖拽旋转 · 滚轮或下方按钮缩放'
        }
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          className="w-full h-full object-cover"
        />

        {/* Dedicated Top-Left HUD Slot (Compact for Mobile) */}
        <div className="absolute top-3 left-3 bg-[#111218]/95 backdrop-blur-xs text-[#F2F3F7] border border-[#8B7FE8]/30 px-2.5 py-1.5 sm:px-3 sm:py-2 text-xs shadow-lg max-w-[240px] sm:max-w-[320px] pointer-events-none z-10 rounded-xs">
          <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10 text-[9px] sm:text-[10px] font-mono-code">
            <span className="text-[#8B7FE8] font-bold truncate">NODE: {activeJoint.nameEn} ({activeJoint.nameZh})</span>
            <span className={limitTriggered && interactionMode === 'manual' ? 'text-[#F59E0B] font-bold' : 'text-[#7ed4ac]'}>
              {limitTriggered && interactionMode === 'manual' ? 'LIMIT_TRIGGERED' : 'SMPL-H_FK'}
            </span>
          </div>
          <div className="mt-1 font-mono-code text-[10px] sm:text-[11px] text-[#CBD0E4] truncate">
            {interactionMode === 'manual'
              ? `P:${sliderAngles[selectedJointId]?.pitch || 0}° Y:${sliderAngles[selectedJointId]?.yaw || 0}° R:${sliderAngles[selectedJointId]?.roll || 0}°`
              : interactionMode === 'mocap'
              ? '[MOCAP] MediaPipe 实时驱动'
              : activeJoint.angles}
          </div>
          <div className="text-[9px] sm:text-[10px] text-[#9396AA] leading-tight mt-0.5 line-clamp-2">
            {activeJoint.rule}
          </div>
        </div>

        {/* Top-Right Operation Hints (Hidden on narrow screens to avoid crowding) */}
        <div className="hidden sm:flex absolute top-3 right-3 font-mono-code text-[10px] text-[#686A7A] bg-white/95 border border-[#111218]/10 px-2.5 py-1 shadow-sm items-center gap-2 pointer-events-none z-10 rounded-xs">
          {interactionMode === 'manual' ? (
            <>
              <Move className="w-3 h-3 text-[#F59E0B]" />
              <span>DRAG: 拖拽关节点 · 实时 IK 联动与物理限位</span>
            </>
          ) : interactionMode === 'mocap' ? (
            <>
              <Camera className="w-3 h-3 text-[#8B7FE8]" />
              <span>MOCAP: MediaPipe 本地端侧动捕 · 零上传</span>
            </>
          ) : (
            <>
              <Eye className="w-3 h-3 text-[#8B7FE8]" />
              <span>DRAG: 360°漫游 · 点击关节点 · 按钮/滚轮缩放</span>
            </>
          )}
        </div>

        {/* Max Zoom Lock Alert Banner */}
        {isBoundLocked && (
          <div className="absolute bottom-14 left-3 sm:bottom-3 sm:left-3 bg-[#111218] text-[#F2F3F7] border border-[#8B7FE8] px-2.5 py-1 text-xs font-mono-code shadow-md animate-in fade-in flex items-center gap-2 z-10 rounded-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-[#8B7FE8] animate-pulse" />
            <span>MAX_ZOOM_BOUND (1.40x) · 锁定</span>
          </div>
        )}

        {/* Bottom-Right Mocap Video Picture-in-Picture with Kalidokit 2D Real Verification */}
        {interactionMode === 'mocap' && (
          <div className="absolute bottom-14 right-3 sm:bottom-3 sm:right-36 w-[120px] h-[90px] sm:w-52 sm:h-40 bg-[#111218] border border-[#8B7FE8]/60 shadow-xl overflow-hidden rounded flex flex-col z-20">
            <div className="h-4 sm:h-5 bg-[#171926] px-1.5 sm:px-2 flex items-center justify-between font-mono-code text-[8px] sm:text-[9px] text-[#C4C7D4] border-b border-white/10">
              <span className="text-[#8B7FE8] flex items-center gap-1 font-bold truncate">
                <span className="w-1.5 h-1.5 rounded-full bg-[#8B7FE8] animate-pulse" />
                <span className="hidden sm:inline">KALIDOKIT_SOLVER</span>
                <span className="sm:hidden">KALIDO</span>
              </span>
              <span className="text-[#7ed4ac] text-[8px]">2D/3D 解算</span>
            </div>
            <div className="relative flex-1 bg-black flex items-center justify-center overflow-hidden">
              <video
                ref={mocapVideoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover scale-x-[-1]"
              />
              {/* Overlay 2D real skeleton verification canvas */}
              <canvas
                ref={mocapPipCanvasRef}
                width={208}
                height={160}
                className="absolute inset-0 w-full h-full pointer-events-none scale-x-[-1]"
              />
              <div className="absolute bottom-0.5 left-1 text-[7px] sm:text-[8px] font-mono-code text-white/90 bg-black/60 px-1 rounded pointer-events-none">
                MediaPipe + Kalidokit
              </div>
            </div>
          </div>
        )}

        {/* Mobile & Desktop Friendly Floating Zoom & Reset Controls (+ / -) */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1.5 z-20">
          {interactionMode === 'orbit' && (
            <button
              onClick={handleResetOrbit}
              className="min-h-[38px] px-2.5 py-1 bg-white hover:bg-[#F2F3F7] border border-[#111218]/15 text-xs text-[#111218] transition-colors cursor-pointer shadow-sm rounded-xs flex items-center gap-1 font-sans-ui"
              title="重置视角与缩放"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#8B7FE8]" />
              <span className="hidden sm:inline">重置</span>
            </button>
          )}

          <div className="flex items-center bg-white/95 border border-[#111218]/15 shadow-sm rounded-xs p-0.5 font-mono-code text-xs">
            <button
              onClick={() => setZoom((z) => Math.max(0.75, Number((z - 0.10).toFixed(2))))}
              className="min-h-[38px] min-w-[38px] flex items-center justify-center text-[#111218] hover:bg-[#F2F3F7] font-bold cursor-pointer rounded-xs transition-colors"
              title="缩小视口 (-0.10x)"
              aria-label="缩小"
            >
              -
            </button>
            <span className="px-1.5 text-[11px] font-bold text-[#8B7FE8] min-w-[42px] text-center select-none">
              {zoom.toFixed(2)}x
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.40, Number((z + 0.10).toFixed(2))))}
              disabled={isBoundLocked}
              className={`min-h-[38px] min-w-[38px] flex items-center justify-center font-bold rounded-xs transition-colors cursor-pointer ${
                isBoundLocked
                  ? 'text-[#C4C7D4] cursor-not-allowed bg-gray-100'
                  : 'text-[#111218] hover:bg-[#F2F3F7]'
              }`}
              title={isBoundLocked ? '已达到最大缩放极值 1.40x' : '放大视口 (+0.10x)'}
              aria-label="放大"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Mode-Specific Interactive Dock */}
      {interactionMode === 'orbit' && (
        <div className="p-3.5 bg-white border border-[#111218]/12 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#111218]/8">
            <div className="flex items-center gap-1.5 text-xs font-sans-ui">
              <span className="text-[#686A7A] text-[11px]">姿势标定:</span>
              <button
                onClick={() => setCurrentPose('t_pose')}
                className={`px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer rounded-xs ${
                  currentPose === 't_pose'
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#111218]'
                    : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/10 hover:border-[#111218]/25'
                }`}
              >
                T-Pose 标定
              </button>
              <button
                onClick={() => setCurrentPose('idle')}
                className={`px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer rounded-xs ${
                  currentPose === 'idle'
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#111218]'
                    : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/10 hover:border-[#111218]/25'
                }`}
              >
                自然待机 (Relaxed)
              </button>
              <button
                onClick={() => setCurrentPose('wave')}
                className={`px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer rounded-xs ${
                  currentPose === 'wave'
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#111218]'
                    : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/10 hover:border-[#111218]/25'
                }`}
              >
                挥手问候 (Wave)
              </button>
            </div>

            <div className="flex items-center gap-2 font-mono-code text-[11px] text-[#686A7A]">
              <span>OVERSCROLL: CONTAIN (零网页滚动打架)</span>
            </div>
          </div>

          <div className="text-xs flex flex-wrap items-center justify-between gap-3 font-mono-code">
            <div className="flex items-center gap-4 text-[#111218]">
              <span>YAW: <strong className="text-[#8B7FE8]">{yaw >= 0 ? `+${yaw.toFixed(0)}` : yaw.toFixed(0)}°</strong></span>
              <span>PITCH: <strong className="text-[#8B7FE8]">{pitch >= 0 ? `+${pitch.toFixed(0)}` : pitch.toFixed(0)}°</strong></span>
              <span>
                ZOOM: <strong className={isBoundLocked ? 'text-[#8B7FE8] font-bold' : 'text-[#111218]'}>{zoom.toFixed(2)}x</strong> / MAX 1.40x
              </span>
            </div>

            <div className="flex items-center gap-2 font-sans-ui text-[11px]">
              <span className={`px-2 py-0.5 border rounded-xs ${isBoundLocked ? 'bg-[#8B7FE8]/15 border-[#8B7FE8] text-[#4f42b5] font-bold' : 'bg-gray-100 border-gray-200 text-[#686A7A]'}`}>
                {isBoundLocked ? '✓ 恒定包围球锁死' : '○ 安全缩放球内'}
              </span>
              <span className="text-[#686A7A]">关节点点击支持</span>
            </div>
          </div>
        </div>
      )}

      {/* Manual Joint Control Dock */}
      {interactionMode === 'manual' && (
        <div className="p-3.5 bg-white border border-[#111218]/12 space-y-3">
          {/* 3 Compact Joint Selector Rows */}
          <div className="space-y-2 pb-2.5 border-b border-[#111218]/8">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono-code font-bold text-[#111218] flex items-center gap-1.5">
                <span>16 核心关节选择器 (VRM / SMPL-H)</span>
                <span className="text-[#8B7FE8] font-normal hidden sm:inline">· 画布与按钮双向联动</span>
              </span>
              <button
                onClick={handleResetManualPose}
                className="flex items-center gap-1 px-2.5 py-1 text-xs bg-[#F2F3F7] hover:bg-gray-200 text-[#111218] border border-[#111218]/15 rounded-xs transition-colors cursor-pointer"
                title="重置全部 16 个关节点至自然待机位"
              >
                <RotateCcw className="w-3 h-3 text-[#8B7FE8]" />
                <span>重置姿势</span>
              </button>
            </div>

            <div className="space-y-1.5 font-sans-ui text-xs">
              {JOINT_GROUPS.map((g) => (
                <div key={g.key} className="flex flex-wrap items-center gap-1.5">
                  <span className={`w-14 pl-1 text-[10px] font-mono-code text-[#686A7A] shrink-0 font-medium ${g.color}`}>
                    {g.label}:
                  </span>
                  <div className="flex flex-wrap items-center gap-1 flex-1">
                    {g.joints.map((j) => {
                      const isSelected = selectedJointId === j.id;
                      const hasWarning = isSelected && limitTriggered;
                      return (
                        <button
                          key={j.id}
                          onClick={() => {
                            setSelectedJointId(j.id);
                            const jointDef = SKELETON_JOINTS.find((k) => k.id === j.id);
                            if (jointDef) {
                              const angles = sliderAngles[j.id] || { pitch: 0, yaw: 0, roll: 0 };
                              const pL = jointDef.limits.pitch;
                              const yL = jointDef.limits.yaw;
                              const rL = jointDef.limits.roll;
                              const isExceeded =
                                angles.pitch < pL[0] || angles.pitch > pL[1] ||
                                angles.yaw < yL[0] || angles.yaw > yL[1] ||
                                angles.roll < rL[0] || angles.roll > rL[1];
                              setLimitTriggered(isExceeded);
                            }
                          }}
                          className={`px-2 py-0.5 text-[11px] border rounded-xs transition-all cursor-pointer whitespace-nowrap flex items-center gap-1 ${
                            isSelected
                              ? hasWarning
                                ? 'bg-[#111218] text-[#F59E0B] border-[#F59E0B] font-bold shadow-xs'
                                : 'bg-[#111218] text-[#F2F3F7] border-[#8B7FE8] font-bold shadow-xs ring-1 ring-[#8B7FE8]/50'
                              : 'bg-[#F2F3F7] text-[#474A5E] border-[#111218]/10 hover:border-[#8B7FE8]/50 hover:bg-[#EAEBED]'
                          }`}
                        >
                          <span>{j.nameZh}</span>
                          <span className={`text-[9px] font-mono-code ${isSelected ? (hasWarning ? 'text-[#F59E0B]' : 'text-[#A59CF0]') : 'text-[#8B8D9E]'}`}>
                            {j.nameEn}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 3 Sliders: Pitch / Yaw / Roll */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
            <div className="space-y-1">
              <div className="flex justify-between font-mono-code text-[11px] text-[#686A7A]">
                <span>PITCH (俯仰):</span>
                <span className={`font-bold ${
                  (sliderAngles[selectedJointId]?.pitch || 0) < activeJoint.limits.pitch[0] ||
                  (sliderAngles[selectedJointId]?.pitch || 0) > activeJoint.limits.pitch[1]
                    ? 'text-[#F59E0B]'
                    : 'text-[#111218]'
                }`}>
                  {sliderAngles[selectedJointId]?.pitch || 0}°
                </span>
              </div>
              <input
                type="range"
                min={activeJoint.limits.pitch[0] - 5}
                max={activeJoint.limits.pitch[1] + 5}
                value={sliderAngles[selectedJointId]?.pitch || 0}
                onChange={(e) => handleSliderChange('pitch', Number(e.target.value))}
                className="w-full accent-[#8B7FE8] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono-code text-[#9396AA]">
                <span>{activeJoint.limits.pitch[0]}°</span>
                <span className="text-[#8B7FE8]">安全限位</span>
                <span>{activeJoint.limits.pitch[1]}°</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between font-mono-code text-[11px] text-[#686A7A]">
                <span>YAW (偏航):</span>
                <span className={`font-bold ${
                  (sliderAngles[selectedJointId]?.yaw || 0) < activeJoint.limits.yaw[0] ||
                  (sliderAngles[selectedJointId]?.yaw || 0) > activeJoint.limits.yaw[1]
                    ? 'text-[#F59E0B]'
                    : 'text-[#111218]'
                }`}>
                  {sliderAngles[selectedJointId]?.yaw || 0}°
                </span>
              </div>
              <input
                type="range"
                min={activeJoint.limits.yaw[0] - 5}
                max={activeJoint.limits.yaw[1] + 5}
                value={sliderAngles[selectedJointId]?.yaw || 0}
                onChange={(e) => handleSliderChange('yaw', Number(e.target.value))}
                className="w-full accent-[#8B7FE8] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono-code text-[#9396AA]">
                <span>{activeJoint.limits.yaw[0]}°</span>
                <span className="text-[#8B7FE8]">安全限位</span>
                <span>{activeJoint.limits.yaw[1]}°</span>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between font-mono-code text-[11px] text-[#686A7A]">
                <span>ROLL / FLEX (侧倾/屈伸):</span>
                <span className={`font-bold ${
                  (sliderAngles[selectedJointId]?.roll || 0) < activeJoint.limits.roll[0] ||
                  (sliderAngles[selectedJointId]?.roll || 0) > activeJoint.limits.roll[1]
                    ? 'text-[#F59E0B]'
                    : 'text-[#111218]'
                }`}>
                  {sliderAngles[selectedJointId]?.roll || 0}°
                </span>
              </div>
              <input
                type="range"
                min={activeJoint.limits.roll[0] - 5}
                max={activeJoint.limits.roll[1] + 5}
                value={sliderAngles[selectedJointId]?.roll || 0}
                onChange={(e) => handleSliderChange('roll', Number(e.target.value))}
                className="w-full accent-[#8B7FE8] cursor-pointer"
              />
              <div className="flex justify-between text-[10px] font-mono-code text-[#9396AA]">
                <span>{activeJoint.limits.roll[0]}°</span>
                <span className="text-[#8B7FE8]">安全限位</span>
                <span>{activeJoint.limits.roll[1]}°</span>
              </div>
            </div>
          </div>

          {/* Limit Protection Banner */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-1 border-t border-[#111218]/8 text-xs gap-1.5">
            <div className="flex items-center gap-2">
              {limitTriggered ? (
                <span className="text-[#F59E0B] bg-[#F59E0B]/10 border border-[#F59E0B]/30 px-2 py-0.5 text-[11px] rounded flex items-center gap-1 font-mono-code">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span>{activeJoint.nameZh}: 触发物理安全限位约束 (motionSafety.ts 软限位防反折)</span>
                </span>
              ) : (
                <span className="text-[#2B7853] bg-[#7ed4ac]/15 border border-[#7ed4ac]/35 px-2 py-0.5 text-[11px] rounded flex items-center gap-1 font-mono-code">
                  <Check className="w-3 h-3 shrink-0 text-[#2B7853]" />
                  <span>{activeJoint.nameZh}: 处于 motionSafety.ts 正常物理约束范围</span>
                </span>
              )}
            </div>

            <span className="text-[11px] text-[#686A7A]">
              鼠标拖动画布节点实时联动 FK/IK 层级骨骼链
            </span>
          </div>
        </div>
      )}

      {/* Mocap Status Dock */}
      {interactionMode === 'mocap' && (
        <div className="p-3.5 bg-white border border-[#111218]/12 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="space-y-0.5">
            <div className="font-mono-code text-[11px] text-[#111218] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#8B7FE8] animate-ping" />
              <strong className="text-[#8B7FE8]">KALIDOKIT VRM POSE SOLVER</strong>
              <span className="text-[#686A7A]">· MediaPipe 2D/3D 解算 · 零云端上传</span>
            </div>
            <div className="text-[11px] text-[#686A7A]">
              指数平滑滤波 (EMA α=0.30) 运行中 · 离开本模式或切换 Tab 立即触发 tracks.stop() 释放摄像头
            </div>
          </div>

          <div className="flex items-center gap-2 font-mono-code text-[11px]">
            <span className="px-2 py-0.5 bg-[#7ed4ac]/15 border border-[#7ed4ac]/30 text-[#2B7853] rounded">
              CameraLease: 独占激活
            </span>
            <button
              onClick={() => setInteractionMode('orbit')}
              className="px-2.5 py-1 bg-[#111218] text-[#F2F3F7] rounded cursor-pointer transition-colors hover:bg-black"
            >
              切回漫游
            </button>
          </div>
        </div>
      )}

    </div>
  );
};

/* =========================================================================
   TAB 02: Local Gaze Tracker & CameraLease Live Webcam Sandbox (Real BlazeFace)
   ========================================================================= */
const Tab02GazeTracker: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const detectorRef = useRef<FaceDetector | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);

  // Smooth filter references
  const smoothGazeRef = useRef<{ yaw: number; pitch: number }>({ yaw: 8.5, pitch: -4.2 });
  const smoothPosRef = useRef<{ x: number; y: number }>({ x: 0.5, y: 0.5 });

  // State
  const [gaze, setGaze] = useState({ yaw: 8.5, pitch: -4.2 });
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [inputSource, setInputSource] = useState<'POINTER_SIM' | 'WEBCAM_BLAZEFACE'>('POINTER_SIM');
  const [detectorStatus, setDetectorStatus] = useState<string>('STANDBY');
  const [confidenceText, setConfidenceText] = useState<string>('POINTER_SIMULATION');

  // 1. Mouse/Pointer tracking with input source mutual exclusion
  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    // If webcam face tracking is active, lock pointer input so real face gaze is not overwritten
    if (cameraActive || inputSource === 'WEBCAM_BLAZEFACE') return;
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const nx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setMousePos({ x: nx, y: ny });
    smoothPosRef.current = { x: nx, y: ny };
    const newGaze = {
      yaw: Number(((nx - 0.5) * 70).toFixed(1)), // -35° ~ +35°
      pitch: Number(((ny - 0.5) * 50).toFixed(1)), // -25° ~ +25°
    };
    smoothGazeRef.current = newGaze;
    setGaze(newGaze);
  };

  const handlePointerLeave = () => {
    if (cameraActive || inputSource === 'WEBCAM_BLAZEFACE') return;
    setGaze({ yaw: 0, pitch: 0 });
    setMousePos({ x: 0.5, y: 0.5 });
    smoothGazeRef.current = { yaw: 0, pitch: 0 };
    smoothPosRef.current = { x: 0.5, y: 0.5 };
  };

  // 2. Real BlazeFace inference frame loop (requestAnimationFrame)
  const runInferenceLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const detector = detectorRef.current;

    if (video && canvas && detector && video.readyState >= 2 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }

      const now = performance.now();
      if (now - lastVideoTimeRef.current >= 30) {
        lastVideoTimeRef.current = now;
        try {
          const results = detector.detectForVideo(video, now);
          if (results.detections && results.detections.length > 0) {
            // Sort by bounding box area to lock onto foreground face
            const sorted = [...results.detections].sort((a, b) => {
              const areaA = (a.boundingBox?.width ?? 0) * (a.boundingBox?.height ?? 0);
              const areaB = (b.boundingBox?.width ?? 0) * (b.boundingBox?.height ?? 0);
              return areaB - areaA;
            });
            const detection = sorted[0];
            const score = detection.categories?.[0]?.score ?? 0;
            const box = detection.boundingBox;
            const kps = detection.keypoints || [];

            setDetectorStatus('TRACKING');
            setConfidenceText(`CONFIDENCE: ${(score * 100).toFixed(1)}% · 6 KEYPOINTS`);

            // Draw real-time bounding box and 6 keypoints on mirrored overlay canvas
            if (ctx && box) {
              ctx.save();
              ctx.strokeStyle = '#8B7FE8';
              ctx.lineWidth = 3;
              ctx.strokeRect(box.originX, box.originY, box.width, box.height);

              // HUD tag on box
              ctx.fillStyle = 'rgba(139, 127, 232, 0.9)';
              ctx.fillRect(box.originX, Math.max(0, box.originY - 18), 86, 18);
              ctx.fillStyle = '#ffffff';
              ctx.font = 'bold 10px monospace';
              ctx.fillText(`FACE ${(score * 100).toFixed(0)}% (6KP)`, box.originX + 4, Math.max(12, box.originY - 5));

              // 6 Keypoints (0: right eye, 1: left eye, 2: nose tip, 3: mouth, 4: right ear, 5: left ear)
              if (kps.length > 0) {
                kps.forEach((kp, idx) => {
                  const px = kp.x * canvas.width;
                  const py = kp.y * canvas.height;
                  ctx.beginPath();
                  ctx.arc(px, py, 4, 0, Math.PI * 2);
                  ctx.fillStyle = idx < 2 ? '#7ed4ac' : '#8B7FE8';
                  ctx.fill();
                  ctx.strokeStyle = '#ffffff';
                  ctx.lineWidth = 1.5;
                  ctx.stroke();
                });
              }
              ctx.restore();
            }

            // Gaze calculation:
            // Prefer eyes midpoint or nose tip (keypoints[2])
            let rawX = 0.5;
            let rawY = 0.5;
            if (kps.length >= 2 && kps[0] && kps[1]) {
              rawX = (kps[0].x + kps[1].x) / 2;
              rawY = (kps[0].y + kps[1].y) / 2;
            } else if (box) {
              rawX = (box.originX + box.width / 2) / video.videoWidth;
              rawY = (box.originY + box.height * 0.38) / video.videoHeight;
            }

            // Mirroring direction compensation:
            // Because video and canvas have CSS `scale-x-[-1]`,
            // user moving to user's left appears on screen left (1 - rawX < 0.5).
            // Avatar turns towards screen left (negative yaw).
            const normX = Math.max(-1, Math.min(1, (0.5 - rawX) * 2));
            const normY = Math.max(-1, Math.min(1, (rawY - 0.5) * 2));

            const targetYaw = normX * 35; // -35° ~ +35°
            const targetPitch = normY * 25; // -25° ~ +25°

            const targetPosX = Math.max(0.05, Math.min(0.95, 1 - rawX));
            const targetPosY = Math.max(0.05, Math.min(0.95, rawY));

            // Exponential smoothing (lerp factor 0.25)
            smoothGazeRef.current.yaw += (targetYaw - smoothGazeRef.current.yaw) * 0.25;
            smoothGazeRef.current.pitch += (targetPitch - smoothGazeRef.current.pitch) * 0.25;
            smoothPosRef.current.x += (targetPosX - smoothPosRef.current.x) * 0.25;
            smoothPosRef.current.y += (targetPosY - smoothPosRef.current.y) * 0.25;

            setGaze({
              yaw: Number(smoothGazeRef.current.yaw.toFixed(1)),
              pitch: Number(smoothGazeRef.current.pitch.toFixed(1)),
            });
            setMousePos({
              x: Number(smoothPosRef.current.x.toFixed(3)),
              y: Number(smoothPosRef.current.y.toFixed(3)),
            });
          } else {
            // No face detected in current frame: smooth return to center
            setDetectorStatus('NO_FACE_DETECTED');
            setConfidenceText('NO_FACE_DETECTED');

            smoothGazeRef.current.yaw += (0 - smoothGazeRef.current.yaw) * 0.1;
            smoothGazeRef.current.pitch += (0 - smoothGazeRef.current.pitch) * 0.1;
            smoothPosRef.current.x += (0.5 - smoothPosRef.current.x) * 0.1;
            smoothPosRef.current.y += (0.5 - smoothPosRef.current.y) * 0.1;

            setGaze({
              yaw: Number(smoothGazeRef.current.yaw.toFixed(1)),
              pitch: Number(smoothGazeRef.current.pitch.toFixed(1)),
            });
            setMousePos({
              x: Number(smoothPosRef.current.x.toFixed(3)),
              y: Number(smoothPosRef.current.y.toFixed(3)),
            });
          }
        } catch (inferErr) {
          console.warn('BlazeFace frame inference warning:', inferErr);
          setConfidenceText(`INFER_WARN: ${inferErr instanceof Error ? inferErr.message : String(inferErr)}`);
        }
      }
    }

    rafIdRef.current = requestAnimationFrame(runInferenceLoop);
  }, []);

  // 3. CameraLease acquire: Lazy load BlazeFace WASM + start video
  const startCamera = async () => {
    setCameraError(null);
    setDetectorStatus('LOADING_WASM...');
    setConfidenceText('LOADING_BLAZEFACE_WASM...');
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('当前浏览器环境不支持 getUserMedia 接口');
      }

      // Request hardware camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: 'user' },
        audio: false,
      });

      // Lazy load MediaPipe FilesetResolver & FaceDetector if not yet loaded
      if (!detectorRef.current) {
        const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
        const vision = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`);
        const modelPath = `${base}mediapipe/blaze_face_short_range.tflite`;
        let detector: FaceDetector;
        try {
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: modelPath,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.4,
          });
        } catch {
          detector = await FaceDetector.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: modelPath,
            },
            runningMode: 'VIDEO',
            minDetectionConfidence: 0.4,
          });
        }
        detectorRef.current = detector;
      }

      setCameraStream(stream);
      setCameraActive(true);
      setInputSource('WEBCAM_BLAZEFACE');
      setDetectorStatus('TRACKING');
      setConfidenceText('INITIALIZED · ACQUIRING_FRAME');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '获取摄像头或加载模型失败';
      const userMsg = msg.includes('Permission') ? '摄像头访问权限被拒绝' : msg;
      setCameraError(userMsg);
      setDetectorStatus('ERROR');
      setConfidenceText(`ERROR: ${userMsg}`);
      setInputSource('POINTER_SIM');
    }
  };

  // 4. CameraLease release: Stop all tracks cleanly, cancel RAF, clear canvas
  const stopCamera = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setCameraStream(null);
    setCameraActive(false);
    setInputSource('POINTER_SIM');
    setDetectorStatus('STANDBY');
    setConfidenceText('POINTER_SIMULATION');
  }, [cameraStream]);

  // 5. Ensure <video> binds srcObject and starts inference loop when active
  useEffect(() => {
    if (videoRef.current && cameraStream) {
      videoRef.current.srcObject = cameraStream;
      videoRef.current.play().then(() => {
        if (!rafIdRef.current) {
          rafIdRef.current = requestAnimationFrame(runInferenceLoop);
        }
      }).catch(() => {});
    }
  }, [cameraStream, runInferenceLoop]);

  // 6. Strict resource cleanup on unmount or tab switch
  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      if (cameraStream) {
        cameraStream.getTracks().forEach((track) => track.stop());
      }
      if (detectorRef.current) {
        detectorRef.current.close();
        detectorRef.current = null;
      }
    };
  }, [cameraStream]);

  return (
    <div className="space-y-4 font-sans-ui">
      {/* Top: Industrial Face & Pupil Gaze Reticle Canvas (Pointer Move & Touch Enabled) */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerMove}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        style={{ touchAction: 'none' }}
        className="relative h-[220px] sm:h-[240px] w-full bg-white border border-[#111218]/15 overflow-hidden select-none flex items-center justify-center cursor-crosshair"
      >
        {/* HUD Grid & Crosshairs (pointer-events-none) */}
        <div className="absolute inset-0 bg-[radial-gradient(#111218_1px,transparent_1px)] [background-size:16px_16px] opacity-15 pointer-events-none" />

        {/* Reticle coordinate lines (pointer-events-none) */}
        <div
          className="absolute w-full h-[1px] bg-[#8B7FE8]/30 pointer-events-none transition-all duration-75"
          style={{ top: `${mousePos.y * 100}%` }}
        />
        <div
          className="absolute h-full w-[1px] bg-[#8B7FE8]/30 pointer-events-none transition-all duration-75"
          style={{ left: `${mousePos.x * 100}%` }}
        />

        {/* 3D Wireframe Face Simulator (pointer-events-none) */}
        <div
          className="relative w-44 h-48 transition-transform duration-75 ease-out flex flex-col items-center justify-center pointer-events-none"
          style={{
            transform: `perspective(500px) rotateY(${gaze.yaw}deg) rotateX(${-gaze.pitch}deg)`,
          }}
        >
          {/* Face Oval */}
          <div className="w-32 h-40 border-2 border-[#111218] rounded-full flex flex-col items-center justify-between p-3 relative bg-white/70 backdrop-blur-xs">
            {/* Top Forehead Anchor */}
            <div className="w-6 h-1 bg-[#111218]/40" />

            {/* Eyes Row */}
            <div className="w-full flex items-center justify-between px-3">
              {/* Left Eye */}
              <div className="w-7 h-5 border border-[#111218] rounded-full flex items-center justify-center relative bg-white">
                <div
                  className="w-3 h-3 rounded-full bg-[#111218] flex items-center justify-center transition-transform duration-75"
                  style={{
                    transform: `translate(${(mousePos.x - 0.5) * 8}px, ${(mousePos.y - 0.5) * 5}px)`,
                  }}
                >
                  <span className="w-1 h-1 rounded-full bg-[#8B7FE8]" />
                </div>
              </div>

              {/* Right Eye */}
              <div className="w-7 h-5 border border-[#111218] rounded-full flex items-center justify-center relative bg-white">
                <div
                  className="w-3 h-3 rounded-full bg-[#111218] flex items-center justify-center transition-transform duration-75"
                  style={{
                    transform: `translate(${(mousePos.x - 0.5) * 8}px, ${(mousePos.y - 0.5) * 5}px)`,
                  }}
                >
                  <span className="w-1 h-1 rounded-full bg-[#8B7FE8]" />
                </div>
              </div>
            </div>

            {/* Nose Bridge */}
            <div className="w-1 h-6 bg-[#111218]/40 rounded" />

            {/* Mouth */}
            <div className="w-8 h-1.5 border border-[#111218] rounded-full bg-[#8B7FE8]/20" />
          </div>

          {/* Gaze Vector Ray Point */}
          <div
            className="absolute w-4 h-4 rounded-full border border-[#8B7FE8] flex items-center justify-center"
            style={{
              transform: `translate(${(mousePos.x - 0.5) * 50}px, ${(mousePos.y - 0.5) * 40}px)`,
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#8B7FE8] animate-ping" />
          </div>
        </div>

        {/* HUD 4-Corner Telemetry (pointer-events-none) */}
        <div className="absolute top-2.5 left-3 font-mono-code text-[10px] text-[#686A7A] pointer-events-none">
          <span>TRACKER: MediaPipe BlazeFace WASM ({cameraActive ? 'ACTIVE' : 'CPU'})</span>
        </div>
        <div className="absolute top-2.5 right-3 font-mono-code text-[10px] text-[#8B7FE8] font-bold pointer-events-none">
          <span>{confidenceText}</span>
        </div>
        <div className="absolute bottom-2.5 left-3 font-mono-code text-[10px] text-[#111218] pointer-events-none">
          <span>TARGET: [YAW: {gaze.yaw >= 0 ? `+${gaze.yaw}` : gaze.yaw}°, PITCH: {gaze.pitch >= 0 ? `+${gaze.pitch}` : gaze.pitch}°]</span>
        </div>
        <div className="absolute bottom-2.5 right-3 font-mono-code text-[10px] text-[#7ed4ac] pointer-events-none">
          <span>SOURCE: {inputSource} · ZERO_NETWORK_UPLOAD: TRUE</span>
        </div>
      </div>

      {/* Bottom: CameraLease Real Test Console */}
      <div className="p-4 bg-white border border-[#111218]/12 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-[#111218]/10 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#7ed4ac]" />
            <span className="font-bold text-[#111218]">CameraLease 硬件生命周期隔离验证</span>
          </div>
          <span className="text-[11px] text-[#686A7A]">
            显式租约管控 · 离开自动释放
          </span>
        </div>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="text-xs text-[#686A7A] leading-relaxed max-w-lg">
            {cameraActive ? (
              <span className="text-[#111218]">
                ✓ <strong className="text-[#8B7FE8]">LEASE_ACTIVE</strong>: 摄像头视频流仅在浏览器本地显卡帧缓冲解码，已加载 BlazeFace WASM 执行实时 6 关键点推理。随时可点击右侧按钮调用 <code className="font-mono-code bg-gray-100 px-1">track.stop()</code> 彻底关闭。
              </span>
            ) : (
              <span>
                点击右侧按钮请求本机摄像头。画面纯本地解码用于 6 关键点注视计算，离开本页面或切换 Tab 时硬件租约自动彻底回收。
              </span>
            )}
            {cameraError && (
              <div className="text-[#b3405b] mt-1 font-mono-code text-[11px]">
                ✕ {cameraError}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 w-full sm:w-auto">
            {cameraActive ? (
              <button
                onClick={stopCamera}
                className="min-h-[44px] w-full sm:w-auto px-4 py-2 bg-[#b3405b] hover:bg-[#922b43] text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <CameraOff className="w-3.5 h-3.5" />
                <span>立即释放租约 (tracks.stop)</span>
              </button>
            ) : (
              <button
                onClick={startCamera}
                className="cut-corner-tr min-h-[44px] w-full sm:w-auto px-4 py-2 bg-[#111218] hover:bg-[#333] text-[#F2F3F7] text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <Camera className="w-3.5 h-3.5 text-[#8B7FE8]" />
                <span>开启本机摄像头测试 CameraLease</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Video Preview Window with Overlay Canvas if Active */}
        {cameraActive && (
          <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center gap-4 animate-in fade-in">
            <div className="relative w-48 h-36 bg-black border-2 border-[#8B7FE8] overflow-hidden shadow-sm flex-shrink-0">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover transform scale-x-[-1]"
              />
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full object-cover pointer-events-none transform scale-x-[-1]"
              />
              <div className="absolute inset-0 border border-dashed border-[#7ed4ac]/50 pointer-events-none" />
              <div className="absolute top-1 left-1 bg-black/80 text-[9px] text-[#7ed4ac] px-1 font-mono-code z-10">
                LOCAL_FRAMEBUFFER
              </div>
              <div className="absolute top-1 right-1 bg-black/80 text-[9px] text-[#8B7FE8] px-1 font-mono-code z-10">
                {detectorStatus}
              </div>
              <div className="absolute bottom-1 left-1 bg-black/80 text-[9px] text-[#F2F3F7] px-1 font-mono-code z-10">
                BLAZEFACE_OVERLAY (6KP)
              </div>
            </div>
            <div className="font-mono-code text-xs space-y-1.5 text-[#686A7A]">
              <div>STATUS: <span className="text-[#7ed4ac] font-bold">1 TRACK ACTIVE (640x480)</span></div>
              <div>INFERENCE: <span className="text-[#8B7FE8] font-bold">{confidenceText}</span></div>
              <div>INPUT_SOURCE: <span className="text-[#111218] font-semibold">{inputSource} (MOUSE_MUTED)</span></div>
              <div>MEMORY_BUFFER: <span className="text-[#111218]">GPU_SHARED_TEXTURE (0 CLOUD UPLOAD)</span></div>
              <div className="text-[11px] text-[#8B7FE8]">切换 Tab 或点击红色按钮时立即触发 tracks.stop() 熄灭指示灯</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* =========================================================================
   TAB 03: SpeechSentenceBuffer with Real Web Speech & Instant Interrupt
   ========================================================================= */
const Tab03SpeechBuffer: React.FC = () => {
  const defaultText = `今天工作区已准备就绪，各项微服务运行正常！
\`\`\`ts
const memory = await memu.search("user_profile");
\`\`\`
已根据你的习惯完成本地 MemU 长期记忆索引。双击我可以随时在桌面开启连续语音对话，请随时指示。`;

  const [inputText, setInputText] = useState(defaultText);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [streamProgress, setStreamProgress] = useState(0);
  const [currentSentence, setCurrentSentence] = useState<string>('');
  const [completedSentences, setCompletedSentences] = useState<{ text: string; isCode: boolean }[]>([]);
  const [statusLog, setStatusLog] = useState<string>('待命就绪 · 准备流式生成与切分');

  const streamTimerRef = useRef<number | null>(null);

  // Stop everything
  const handleInterrupt = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (streamTimerRef.current) {
      clearInterval(streamTimerRef.current);
      streamTimerRef.current = null;
    }
    setIsStreaming(false);
    setIsSpeaking(false);
    setStatusLog('AUDIO_BUFFER_RELEASED (已调用 speechSynthesis.cancel() 瞬间打断)');
  }, []);

  // Cleanup on unmount or tab switch
  useEffect(() => {
    return () => {
      handleInterrupt();
    };
  }, [handleInterrupt]);

  // Start streaming and sentence-based TTS
  const handleStartStream = () => {
    handleInterrupt();
    setCompletedSentences([]);
    setCurrentSentence('');
    setStreamProgress(0);
    setIsStreaming(true);
    setStatusLog('STREAMING_ACTIVE: 正在逐字生成并实时按标点切分...');

    let index = 0;
    const fullLength = inputText.length;
    let buffer = '';
    let inCodeBlock = false;

    streamTimerRef.current = window.setInterval(() => {
      if (index >= fullLength) {
        if (buffer.trim()) {
          processSentence(buffer.trim(), inCodeBlock);
        }
        clearInterval(streamTimerRef.current!);
        streamTimerRef.current = null;
        setIsStreaming(false);
        setStatusLog('✓ STREAMING_COMPLETED: 全文流式输出与切片朗读已闭环完成');
        return;
      }

      const char = inputText[index];
      buffer += char;
      index++;
      setStreamProgress(Math.floor((index / fullLength) * 100));

      // Check code block fences
      if (buffer.includes('```')) {
        inCodeBlock = !inCodeBlock;
        buffer = buffer.replace('```', '');
      }

      // Sentence delimiter detection
      const isDelimiter = /[，。！？,.!?\n]/.test(char);
      if (isDelimiter && buffer.trim().length > 0) {
        const sentenceToSpeak = buffer.trim();
        buffer = '';
        processSentence(sentenceToSpeak, inCodeBlock);
      }
    }, 45);
  };

  const processSentence = (sentence: string, isCode: boolean) => {
    if (isCode || sentence.startsWith('const ') || sentence.startsWith('import ')) {
      setCompletedSentences((prev) => [...prev, { text: sentence, isCode: true }]);
      return;
    }

    setCompletedSentences((prev) => [...prev, { text: sentence, isCode: false }]);
    setCurrentSentence(sentence);

    // Call browser Web Speech API
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(sentence);
      utterance.lang = 'zh-CN';
      utterance.rate = 1.05;

      utterance.onstart = () => {
        setIsSpeaking(true);
      };
      utterance.onend = () => {
        setIsSpeaking(false);
      };
      utterance.onerror = () => {
        setIsSpeaking(false);
      };

      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <div className="space-y-4 font-sans-ui">
      {/* Editor & Prompt Input Box */}
      <div className="p-3.5 bg-white border border-[#111218]/15 space-y-2">
        <div className="flex items-center justify-between text-xs text-[#686A7A] pb-1 border-b border-[#111218]/10 font-mono-code">
          <span>SPEECH_SENTENCE_BUFFER // INPUT_STREAM</span>
          <span>AUTOSPLIT: [，。！？,.!?] · SKIP_MARKDOWN_CODE</span>
        </div>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isStreaming}
          rows={4}
          className="w-full p-2 bg-[#F2F3F7] border border-[#111218]/10 text-xs font-mono-code text-[#111218] focus:outline-none focus:border-[#8B7FE8] resize-none"
        />
      </div>

      {/* Control Buttons & Audio Visualizer Bar */}
      <div className="p-4 bg-white border border-[#111218]/15 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full sm:w-auto">
          <button
            onClick={handleStartStream}
            disabled={isStreaming}
            className={`cut-corner-tr min-h-[44px] px-4 py-2.5 text-xs font-medium flex items-center justify-center gap-2 transition-colors cursor-pointer ${
              isStreaming
                ? 'bg-gray-200 text-[#999] cursor-not-allowed'
                : 'bg-[#111218] hover:bg-[#333] text-[#F2F3F7]'
            }`}
          >
            <Play className="w-3.5 h-3.5 text-[#8B7FE8]" />
            <span>开始流式生成并朗读</span>
          </button>

          <button
            onClick={handleInterrupt}
            className="min-h-[44px] px-4 py-2.5 bg-[#b3405b]/10 hover:bg-[#b3405b] text-[#b3405b] hover:text-white border border-[#b3405b]/30 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          >
            <Square className="w-3 h-3" />
            <span>立即打断 (SpeechCancel)</span>
          </button>
        </div>

        {/* Dynamic Jumping Soundwave Bar */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 h-6 px-3 bg-[#F2F3F7] border border-[#111218]/10">
            {isSpeaking ? (
              <Volume2 className="w-3.5 h-3.5 text-[#8B7FE8]" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-[#686A7A]" />
            )}
            <div className="flex items-center gap-1 ml-1.5">
              {[40, 75, 100, 60, 90, 45, 80, 100, 50, 70].map((h, i) => (
                <span
                  key={i}
                  className="w-1 bg-[#8B7FE8] transition-all duration-150"
                  style={{
                    height: isSpeaking ? `${Math.max(4, Math.floor(h * Math.random()))}px` : '3px',
                    opacity: isSpeaking ? 1 : 0.3,
                  }}
                />
              ))}
            </div>
          </div>
          <span className="font-mono-code text-[11px] text-[#686A7A]">
            {isSpeaking ? 'TTS_STREAMING_AUDIO' : 'BUFFER_IDLE'}
          </span>
        </div>
      </div>

      {/* Realtime Sentence Splitting Flow Viewer */}
      <div className="p-4 bg-white border border-[#111218]/15 space-y-2">
        <div className="flex items-center justify-between text-xs text-[#686A7A] pb-1 border-b border-[#111218]/10 font-mono-code">
          <span>BUFFER_QUEUE // 已切分分句队列</span>
          <span>PROGRESS: {streamProgress}%</span>
        </div>

        <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
          {completedSentences.length === 0 && !isStreaming && (
            <div className="text-xs text-[#999] py-2">点击上方按钮启动流式模拟。遇到标点即刻出声，跳过代码块。</div>
          )}

          {completedSentences.map((s, idx) => (
            <div
              key={idx}
              className={`p-2 border text-xs flex items-center justify-between ${
                s.isCode
                  ? 'bg-gray-100 border-dashed border-gray-300 text-[#686A7A] font-mono-code'
                  : currentSentence === s.text && isSpeaking
                  ? 'bg-[#111218] text-[#F2F3F7] border-[#8B7FE8]'
                  : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/8'
              }`}
            >
              <div className="flex items-center gap-2 truncate">
                <span className="font-mono-code text-[10px] text-[#8B7FE8]">#{idx + 1}</span>
                <span className="truncate">{s.text}</span>
              </div>
              <span className="text-[10px] font-mono-code flex-shrink-0">
                {s.isCode ? '[SKIPPED_CODE_BLOCK]' : '✓ PLAYED'}
              </span>
            </div>
          ))}
        </div>

        <div className="pt-2 text-[11px] text-[#686A7A] font-mono-code border-t border-[#111218]/8">
          {statusLog}
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   TAB 04: standby.ts 4-Node Visual State Machine & 25-Motion Library
   ========================================================================= */
const Tab04StandbyStateMachine: React.FC = () => {
  const [currentState, setCurrentState] = useState<'ACTIVE' | 'FACE_ABSENT' | 'NATURAL_IDLE' | 'MOTION_CYCLE'>('ACTIVE');
  const [countdown, setCountdown] = useState<number>(10);
  const [motionIndex, setMotionIndex] = useState<number>(0);
  const [lastMotionIndex, setLastMotionIndex] = useState<number>(-1);
  const [mode, setMode] = useState<'OFFLINE_ONLY' | 'HYBRID'>('OFFLINE_ONLY');

  const MOTION_LIBRARY = [
    { id: 'idle_breathe', name: '待机呼吸', fbx: 'idle_01.fbx' },
    { id: 'wave_hello', name: '挥手问候', fbx: 'wave_02.fbx' },
    { id: 'bow_polite', name: '礼貌鞠躬', fbx: 'bow_01.fbx' },
    { id: 'clap_happy', name: '拍手欢呼', fbx: 'clap_03.fbx' },
    { id: 'think_chin', name: '托腮思考', fbx: 'think_02.fbx' },
    { id: 'nod_agree', name: '点头赞同', fbx: 'nod_01.fbx' },
    { id: 'stretch_arms', name: '双臂伸展', fbx: 'stretch_01.fbx' },
    { id: 'tilt_head', name: '歪头好奇', fbx: 'tilt_02.fbx' },
    { id: 'curious_look', name: '凑近观察', fbx: 'curious_01.fbx' },
    { id: 'standby_shift', name: '重心微调', fbx: 'shift_02.fbx' },
    { id: 'yawn_sleepy', name: '轻微呵欠', fbx: 'yawn_01.fbx' },
    { id: 'look_around', name: '环顾四周', fbx: 'look_03.fbx' },
    { id: 'shake_head', name: '轻轻摇头', fbx: 'shake_01.fbx' },
    { id: 'shrug_hands', name: '无奈耸肩', fbx: 'shrug_02.fbx' },
    { id: 'point_front', name: '手指前方', fbx: 'point_01.fbx' },
    { id: 'listen_hand', name: '侧耳倾听', fbx: 'listen_02.fbx' },
    { id: 'cheer_fist', name: '握拳打气', fbx: 'cheer_01.fbx' },
    { id: 'sigh_relax', name: '轻叹放松', fbx: 'sigh_01.fbx' },
    { id: 'dance_step', name: '律动踏步', fbx: 'dance_02.fbx' },
    { id: 'check_watch', name: '看表动作', fbx: 'watch_01.fbx' },
    { id: 'surprise_jump', name: '轻微惊喜', fbx: 'surprise_01.fbx' },
    { id: 'warm_hands', name: '搓手取暖', fbx: 'warm_02.fbx' },
    { id: 'blink_slow', name: '慢速眨眼', fbx: 'blink_01.fbx' },
    { id: 'lean_back', name: '后仰伸展', fbx: 'lean_02.fbx' },
    { id: 'standby_loop', name: '经典巡回', fbx: 'loop_01.fbx' },
  ];

  // Pick a random non-repeating motion
  const pickNextMotion = useCallback(() => {
    setMotionIndex((prev) => {
      setLastMotionIndex(prev);
      let next = Math.floor(Math.random() * MOTION_LIBRARY.length);
      while (next === prev) {
        next = Math.floor(Math.random() * MOTION_LIBRARY.length);
      }
      return next;
    });
  }, [MOTION_LIBRARY.length]);

  // Main state machine tick loop
  useEffect(() => {
    const timer = setInterval(() => {
      if (currentState === 'FACE_ABSENT') {
        setCountdown((c) => {
          if (c <= 1) {
            setCurrentState('NATURAL_IDLE');
            return 8;
          }
          return c - 1;
        });
      } else if (currentState === 'NATURAL_IDLE') {
        setCountdown((c) => {
          if (c <= 1) {
            setCurrentState('MOTION_CYCLE');
            pickNextMotion();
            return 8;
          }
          return c - 1;
        });
      } else if (currentState === 'MOTION_CYCLE') {
        setCountdown((c) => {
          if (c <= 1) {
            pickNextMotion();
            return 8;
          }
          return c - 1;
        });
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [currentState, pickNextMotion]);

  // Interactive buttons
  const handleFaceAbsent = () => {
    setCurrentState('FACE_ABSENT');
    setCountdown(10);
  };

  const handleFastForward = () => {
    if (currentState === 'ACTIVE') {
      setCurrentState('FACE_ABSENT');
      setCountdown(1);
    } else if (currentState === 'FACE_ABSENT') {
      setCurrentState('NATURAL_IDLE');
      setCountdown(1);
    } else {
      setCurrentState('MOTION_CYCLE');
      pickNextMotion();
      setCountdown(8);
    }
  };

  const handleResetActive = () => {
    setCurrentState('ACTIVE');
    setCountdown(10);
  };

  const toggleMode = () => {
    setMode((m) => (m === 'OFFLINE_ONLY' ? 'HYBRID' : 'OFFLINE_ONLY'));
  };

  const nodes = [
    { id: 'ACTIVE', label: 'ACTIVE', desc: '正常注视' },
    { id: 'FACE_ABSENT', label: 'FACE_ABSENT', desc: '离开倒计 10s' },
    { id: 'NATURAL_IDLE', label: 'NATURAL_IDLE', desc: '自然待机 60s' },
    { id: 'MOTION_CYCLE', label: 'MOTION_CYCLE', desc: '8s 动作轮换' },
  ];

  return (
    <div className="space-y-4 font-sans-ui">
      {/* 4-Node Visual State Transition Flowchart */}
      <div className="p-4 bg-white border border-[#111218]/15 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono-code text-[#686A7A] pb-2 border-b border-[#111218]/10">
          <span>standby.ts // 4-NODE STATE FLOW</span>
          <span>MODE: {mode === 'OFFLINE_ONLY' ? '25_OFFLINE_FBX' : 'HYBRID_WORKER'}</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {nodes.map((n, i) => {
            const isCur = currentState === n.id;
            return (
              <div
                key={n.id}
                className={`p-3 border transition-all relative ${
                  isCur
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#8B7FE8] shadow-md'
                    : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/10'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] font-mono-code mb-1">
                  <span className={isCur ? 'text-[#8B7FE8]' : 'text-[#686A7A]'}>[0{i + 1}]</span>
                  {isCur && <span className="w-1.5 h-1.5 rounded-full bg-[#8B7FE8] animate-ping" />}
                </div>
                <div className="font-bold text-xs font-mono-code">{n.label}</div>
                <div className={`text-[11px] mt-0.5 ${isCur ? 'text-[#CBD0E4]' : 'text-[#686A7A]'}`}>
                  {n.desc}
                </div>

                {isCur && (
                  <div className="mt-2 pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] font-mono-code text-[#8B7FE8]">
                    <span>TICK:</span>
                    <span>{countdown}s</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 4 Interactive Simulation Buttons */}
      <div className="p-4 bg-white border border-[#111218]/15 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 text-xs">
        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-2">
          <button
            onClick={handleFaceAbsent}
            className="min-h-[44px] px-3.5 py-2 bg-[#F2F3F7] hover:bg-[#E5E7EB] border border-[#111218]/15 text-[#111218] transition-colors cursor-pointer font-medium flex items-center justify-center"
          >
            模拟人脸离开
          </button>
          <button
            onClick={handleFastForward}
            className="min-h-[44px] px-3.5 py-2 bg-[#F2F3F7] hover:bg-[#E5E7EB] border border-[#111218]/15 text-[#111218] transition-colors cursor-pointer font-medium flex items-center justify-center"
          >
            快进 +10s
          </button>
          <button
            onClick={handleResetActive}
            className="min-h-[44px] px-3.5 py-2 bg-[#111218] hover:bg-[#333] text-[#F2F3F7] transition-colors cursor-pointer font-medium flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#8B7FE8]" />
            <span>点击角色打断（重置）</span>
          </button>
        </div>

        <button
          onClick={toggleMode}
          className="min-h-[44px] px-3.5 py-2 border border-[#8B7FE8]/50 bg-[#8B7FE8]/10 text-[#4f42b5] text-xs font-mono-code hover:bg-[#8B7FE8]/20 transition-colors cursor-pointer flex items-center justify-center"
        >
          [切换: {mode === 'OFFLINE_ONLY' ? '离线模式' : '混合模式'}]
        </button>
      </div>

      {/* 25 Offline Motion Badges Grid */}
      <div className="p-4 bg-white border border-[#111218]/15 space-y-3">
        <div className="flex items-center justify-between text-xs text-[#686A7A] pb-1 border-b border-[#111218]/10 font-mono-code">
          <span>25 MOTION LIBRARY // 离线动作库矩阵</span>
          <span className="text-[#8B7FE8]">SMPL-H 52-JOINT RETARGETING</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5">
          {MOTION_LIBRARY.map((m, idx) => {
            const isPlaying = idx === motionIndex && currentState === 'MOTION_CYCLE';
            const wasLast = idx === lastMotionIndex;
            return (
              <div
                key={m.id}
                className={`p-2 border text-[11px] transition-all ${
                  isPlaying
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#8B7FE8] shadow-sm font-bold'
                    : wasLast
                    ? 'bg-gray-100 border-gray-300 text-[#888]'
                    : 'bg-[#F2F3F7] text-[#111218] border-[#111218]/8'
                }`}
              >
                <div className="flex items-center justify-between text-[9px] font-mono-code">
                  <span className={isPlaying ? 'text-[#8B7FE8]' : 'text-[#686A7A]'}>#{idx + 1}</span>
                  {isPlaying && <Check className="w-2.5 h-2.5 text-[#7ed4ac]" />}
                </div>
                <div className="truncate">{m.name}</div>
                <div className="text-[9px] font-mono-code text-[#686A7A] truncate">{m.id}</div>
              </div>
            );
          })}
        </div>

        {/* Anti-Repetition Assurance Banner */}
        <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[#111218]/10 text-xs text-[#686A7A]">
          <div>
            当前动作: <strong className="text-[#111218]">[{MOTION_LIBRARY[motionIndex].name} ({MOTION_LIBRARY[motionIndex].id})]</strong>
          </div>
          <div className="text-[#8B7FE8] text-[11px] font-medium">
            ✓ standby.ts 防死循环：已排除上一动作 [{lastMotionIndex >= 0 ? MOTION_LIBRARY[lastMotionIndex].name : '无'}]，确保连续非重复
          </div>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   MAIN COMPONENT: DesktopInteractionInverse
   ========================================================================= */
export const DesktopInteractionInverse: React.FC = () => {
  const [activeTab, setActiveTab] = useState<number>(0);

  const items = [
    {
      idx: '01',
      shortTitle: '操控',
      title: '桌面原生操控',
      subtitle: '3D 包围球视口 · cameraBounds.ts',
      icon: Move,
      desc: '基于模型加载时拟合的恒定包围球，左键拖拽旋转视角，滚轮缩放至 1.40x 极值强制锁定，绝不随角度变化跳变或反向缩小。',
    },
    {
      idx: '02',
      shortTitle: '视线',
      title: '本地视线追踪',
      subtitle: 'BlazeFace WASM · CameraLease',
      icon: Eye,
      desc: 'MediaPipe BlazeFace WASM 纯本地人脸检测，双瞳焦点平滑注视。提供 CameraLease 真实摄像头租约测试，离开即释放硬件。',
    },
    {
      idx: '03',
      shortTitle: '朗读',
      title: '离线听觉与分句朗读',
      subtitle: 'SenseVoice ONNX · SentenceBuffer',
      icon: Mic,
      desc: '支持真实网页语音合成（Web Speech API）。流式按中英标点分句即时朗读，自动过滤代码块，支持毫秒级一键打断。',
    },
    {
      idx: '04',
      shortTitle: '待机',
      title: '25组动作与待机状态机',
      subtitle: 'standby.ts · SMPL-H 52 关节',
      icon: Activity,
      desc: '真实运行的 4 节点状态机（活跃 → 离开预警 → 自然待机 → 8秒非重复动作轮换），防死循环调度 25 组离线动作库。',
    },
  ];

  return (
    <section id="desktop-interaction" className="py-16 md:py-28 bg-[#F2F3F7] text-[#111218] relative select-none">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Editorial Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-8 sm:mb-16 pb-6 border-b border-[#111218]/15 gap-4">
          <div>
            <div className="font-mono-code text-[11px] text-[#686A7A] tracking-widest uppercase mb-2">
              SECTION // 01 · DESKTOP EXPERIENCE
            </div>
            <h2 className="font-sans-ui font-bold text-3xl sm:text-4xl text-[#111218] tracking-tight">
              桌面真实交互
            </h2>
          </div>
          <div className="font-mono-code text-xs text-[#686A7A]">
            WIN32 TRANSPARENT OVERLAY // 4 LIVE ZERO-BACKEND SANDBOXES
          </div>
        </div>

        {/* Mobile Compact 4-Tab Bar (< lg Only, Instant In-Place Switch) */}
        <div className="grid grid-cols-4 gap-1.5 mb-4 lg:hidden">
          {items.map((item, idx) => {
            const isActive = activeTab === idx;
            return (
              <button
                key={item.idx}
                onClick={() => setActiveTab(idx)}
                className={`min-h-[44px] px-1 py-1.5 border text-center transition-all cursor-pointer rounded-xs flex flex-col items-center justify-center ${
                  isActive
                    ? 'bg-[#111218] text-[#F2F3F7] border-[#111218] shadow-md'
                    : 'bg-white hover:bg-gray-50 text-[#111218] border-[#111218]/15'
                }`}
              >
                <span className={`font-mono-code text-[10px] font-bold ${isActive ? 'text-[#8B7FE8]' : 'text-[#686A7A]'}`}>
                  [{item.idx}]
                </span>
                <span className="font-sans-ui text-xs font-bold truncate max-w-full">
                  {item.shortTitle}
                </span>
              </button>
            );
          })}
        </div>

        {/* Asymmetric Layout: Left 4 Index Bars + Right Big Interactive Stage */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left: 4 Industrial Index Bars (4 cols, hidden on < lg) */}
          <div className="hidden lg:flex lg:col-span-4 flex-col gap-3">
            {items.map((item, idx) => {
              const isActive = activeTab === idx;
              return (
                <button
                  key={item.idx}
                  onClick={() => setActiveTab(idx)}
                  className={`text-left p-4 sm:p-5 border transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#111218] text-[#F2F3F7] border-[#111218] shadow-lg'
                      : 'bg-white/80 hover:bg-white text-[#111218] border-[#111218]/12'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-2">
                    <span className={`font-mono-code font-bold ${isActive ? 'text-[#8B7FE8]' : 'text-[#686A7A]'}`}>
                      [{item.idx}]
                    </span>
                    <span className="font-sans-ui text-[10px] tracking-wider uppercase opacity-75">
                      {item.subtitle}
                    </span>
                  </div>
                  <h3 className="font-sans-ui font-bold text-base mb-1">
                    {item.title}
                  </h3>
                  <p className={`font-sans-ui text-xs leading-relaxed line-clamp-2 ${isActive ? 'text-[#9396AA]' : 'text-[#686A7A]'}`}>
                    {item.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Right: Big Interactive Stage (8 cols on lg, full width on mobile) */}
          <div className="lg:col-span-8 bg-white border border-[#111218]/15 p-4 sm:p-6 md:p-8 relative dot-grid-light min-h-[420px] sm:min-h-[480px] flex flex-col justify-between">
            {/* Viewfinder corner brackets in ink black */}
            <CornerBrackets color="#111218" size={14} strokeWidth={2} />

            {/* Stage Header */}
            <div className="flex items-center justify-between pb-3 sm:pb-4 mb-4 border-b border-[#111218]/10 text-xs">
              <span className="font-sans-ui font-bold text-[#111218] uppercase">
                // {items[activeTab].title}
              </span>
              <span className="font-mono-code text-[#686A7A] text-[10px] sm:text-xs">
                STATUS: LIVE_SANDBOX_READY
              </span>
            </div>

            {/* Stage Body Per Active Tab */}
            <div className="flex-1">
              {activeTab === 0 && <Tab01BoundingSphere />}
              {activeTab === 1 && <Tab02GazeTracker />}
              {activeTab === 2 && <Tab03SpeechBuffer />}
              {activeTab === 3 && <Tab04StandbyStateMachine />}
            </div>

            {/* Stage Footer Bar */}
            <div className="pt-3 sm:pt-4 mt-6 border-t border-[#111218]/10 flex flex-wrap items-center justify-between gap-2 font-mono-code text-[10px] sm:text-[11px] text-[#686A7A]">
              <span>DESKAURA // NATIVE_ENGINE_SPEC</span>
              <span className="hidden sm:inline">STANDBY_SCHEDULE · CAMERA_BOUNDS · SPEECH_BUFFER</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
};
