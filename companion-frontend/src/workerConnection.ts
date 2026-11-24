/** Accept one copied AutoDL local access URL, never silently pick among two. */
export function normalizeWorkerUrl(raw: string): string {
  const text = raw.trim()
  if (!text) throw new Error('请粘贴 AutoDL 工具中映射到 Worker 的本地访问地址')
  const matches = text.match(/https?:\/\/[^\s"'`<>,;，；）)]+/gi) || []
  if (matches.length > 1) throw new Error('检测到多个地址，请只复制映射到动作 Worker 的一个本地访问地址')
  const value = matches[0] || (/^(localhost|127\.0\.0\.1|\[::1\]):\d+(\/.*)?$/i.test(text) ? `http://${text}` : text)
  let url: URL
  try { url = new URL(value) } catch { throw new Error('地址格式无效，请填写 http://127.0.0.1:端口') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash)
    throw new Error('需要不带账号密码、查询参数的 HTTP(S) Worker 地址，不是 SSH / SOCKS 代理')
  if (['22', '1080', '10808', '7890', '7897'].includes(url.port))
    throw new Error('该端口通常是 SSH / 网络代理端口，请改填 Worker 的本地 HTTP 访问地址（当前常用 6006）')
  url.pathname = url.pathname.replace(/\/(health|generate)\/?$/, '').replace(/\/+$/, '')
  return url.toString().replace(/\/+$/, '')
}
