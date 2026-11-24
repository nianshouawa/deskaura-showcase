import type { ModelSettings } from './api'

export const gazeOptions = [
  { value: 'off', label: '关闭' }, { value: 'face', label: '人脸' },
  { value: 'mouse', label: '鼠标' }, { value: 'auto', label: '自动' },
]
export function selectedGaze(settings: ModelSettings) {
  return settings.gaze_enabled === false ? 'off' : settings.gaze_mode || 'face'
}
export function gazeSelectionPatch(value: string): Partial<ModelSettings> {
  if (value === 'off') return { gaze_enabled: false }
  if (value === 'face' || value === 'mouse' || value === 'auto') return { gaze_enabled: true, gaze_mode: value }
  return {}
}
