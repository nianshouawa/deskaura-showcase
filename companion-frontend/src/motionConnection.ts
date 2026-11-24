import type { ModelSettings } from './api'
import { privateServiceAddress } from './localConnection'

/** Both motion protocols share one user-facing address/key form. */
export function motionConnectionPatch(settings: ModelSettings): Partial<ModelSettings> {
  const address = settings.motion_api_base_url?.trim() || ''
  const model = settings.motion_api_model?.trim().toLowerCase() || ''
  const tencent = model.startsWith('hy-3d-motion') || /(?:^|\.)tokenhub\.tencentmaas\.com(?=\/|$)/i.test(address.replace(/^https?:\/\//, ''))
  const worker = !tencent && (privateServiceAddress(address) || /^(?:hy[-_]?motion|tencent-hy\/)/.test(model) ||
    settings.motion_provider === 'hymotion')
  if (!worker) return { motion_provider: 'tencent_tokenhub', motion_connection_mode: 'cloud' }
  return {
    motion_provider: 'hymotion', motion_connection_mode: privateServiceAddress(address) ? 'local' : 'cloud',
    motion_worker_url: address,
    ...(settings.motion_api_key?.trim() ? { motion_worker_api_key: settings.motion_api_key } : {}),
  }
}
