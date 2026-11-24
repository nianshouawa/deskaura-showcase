import { describe, expect, it } from 'vitest'
import { systemOperationPolicy } from './systemOperation'
import type { ModelSettings } from './api'

const config: ModelSettings = { base_url: '', model: '', tools_enabled: true, local_sandbox_mode: 'full_access' }
describe('native system operation permissions', () => {
  it('keeps access separate from approval', () => {
    expect(systemOperationPolicy({ ...config, local_operation_mode: 'request_approval' })).toBe('confirm')
    expect(systemOperationPolicy({ ...config, local_operation_mode: 'help_me_approve' })).toBe('confirm')
    expect(systemOperationPolicy({ ...config, local_operation_mode: 'full_approval' })).toBe('allow')
    for (const local_sandbox_mode of ['read_only', 'workspace_write'] as const) {
      expect(systemOperationPolicy({ ...config, local_sandbox_mode, local_operation_mode: 'full_approval' })).toBe('deny')
    }
  })
  it('never bypasses a disabled module or unavailable OS sandbox', () => {
    expect(systemOperationPolicy({ ...config, tools_enabled: false, local_operation_mode: 'full_approval' })).toBe('deny')
    expect(systemOperationPolicy({ ...config, local_sandbox_enabled: true, local_operation_mode: 'full_approval' })).toBe('deny')
  })
})
