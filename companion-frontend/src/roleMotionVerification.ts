import { roleHeaders, notifyModuleStatus } from './api'
import { localFetch } from './localFetch'

export async function verifyRoleMotion(roleId: string) {
  const headers = roleHeaders(roleId)
  const response = await localFetch('http://127.0.0.1:8002/api/motion/cloud-test', { method: 'POST', headers, signal: AbortSignal.timeout(240000) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.detail || '动作检测失败')
  if (!result.verified || typeof result.result_url !== 'string' || !/^\/api\/motion\/(?:result|fbx)\/[a-zA-Z0-9-]+$/.test(result.result_url)) {
    throw new Error(result.detail || '动作接口未返回可验证结果')
  }
  const resultId = result.result_id || result.result_url.split('/').pop()
  let success = false, failure = ''
  try {
    const download = await localFetch(`http://127.0.0.1:8002${result.result_url}`, { headers, signal: AbortSignal.timeout(30000) })
    if (!download.ok) throw new Error('动作结果无法回读')
    if (result.kind === 'fbx') {
      const { parseTencentFbxMotion } = await import('./fbxMotion')
      parseTencentFbxMotion(await download.arrayBuffer())
    } else if (result.kind === 'hymotion') {
      const clip = await download.json()
      success = Number.isFinite(clip.fps) && clip.fps > 0 && Array.isArray(clip.poses) && clip.poses.length > 0 &&
        clip.poses.every((frame: unknown) => Array.isArray(frame) && frame.length >= 66 && frame.length % 3 === 0 &&
          frame.every(value => typeof value === 'number' && Number.isFinite(value)))
      if (!success) throw new Error('回读骨骼数据无效')
    } else throw new Error('动作结果格式不支持')
    success = true
  } catch (error) { failure = error instanceof Error ? error.message : '动作解析失败' }
  const receipt = await localFetch('http://127.0.0.1:8002/api/motion/receipt', {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ result_id: resultId, success }), signal: AbortSignal.timeout(10000),
  })
  if (!success) throw new Error(failure)
  if (!receipt.ok || !(await receipt.json()).accepted) throw new Error('验证结果已失效，请重新检测')
  await notifyModuleStatus(roleId)
}
