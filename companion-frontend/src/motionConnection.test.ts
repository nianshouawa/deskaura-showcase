import { describe, expect, it } from 'vitest'
import { motionConnectionPatch } from './motionConnection'
describe('single motion connection form', () => {
  it('uses Tencent without requiring a separate local worker address', () => {
    expect(motionConnectionPatch({ base_url: '', model: '', motion_api_base_url: 'https://tokenhub.tencentmaas.com/v1/api/3d', motion_api_model: 'hy-3d-motion' }))
      .toEqual({ motion_provider: 'tencent_tokenhub', motion_connection_mode: 'cloud' })
  })
  it('applies the shared local worker address and optional key to the actual adapter', () => {
    expect(motionConnectionPatch({ base_url: '', model: '', motion_api_base_url: 'http://127.0.0.1:6006', motion_api_model: 'HY-Motion', motion_api_key: 'worker-private' }))
      .toEqual({ motion_provider: 'hymotion', motion_connection_mode: 'local', motion_worker_url: 'http://127.0.0.1:6006', motion_worker_api_key: 'worker-private' })
  })
})
