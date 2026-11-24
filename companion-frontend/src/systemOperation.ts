import type { ModelSettings } from './api'

/** Access limits apply before the separate policy for asking approval. */
export function systemOperationPolicy(config: ModelSettings): 'deny' | 'confirm' | 'allow' {
  if (config.tools_enabled === false || config.local_sandbox_mode !== 'full_access' || config.local_sandbox_enabled) return 'deny'
  return config.local_operation_mode === 'full_approval' ? 'allow' : 'confirm'
}
