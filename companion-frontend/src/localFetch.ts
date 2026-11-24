/** Translate transport failures only; never retry writes or paid detections. */
export async function localFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (error) {
    if (init?.signal?.aborted) {
      if (init.signal.reason?.name === 'TimeoutError') throw new Error('请求超时，服务可能仍在处理；请稍后查看状态，不要连续重复检测。')
      throw new Error('操作已取消。')
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/failed to fetch|fetch failed|networkerror|load failed|network request failed/i.test(message)) {
      const target = String(input)
      const service = /:8002\b/.test(target) ? '动作服务' : /:8001\b/.test(target) ? '记忆服务' : '本机服务'
      throw new Error(`无法连接${service}，连接可能已中断或服务尚未启动。请确认 DeskAura 正在运行，稍后重试；这不代表密钥已验证失败。`)
    }
    throw error
  }
}
