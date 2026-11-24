import { request, roleHeaders } from './api'

export interface McpTool {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
  enabled: boolean
}
export interface McpService {
  name: string
  connected: boolean
  description?: string
  detail?: string
  server_info?: { name?: string; version?: string }
  tools: McpTool[]
}
export interface McpConfiguration { mcpServers: Record<string, Record<string, unknown>> }
export interface McpServices { services: McpService[]; label?: string }
export const defaultMcpTemplate = JSON.stringify({ mcpServers: {} }, null, 2)

export function parseMcpConfiguration(text: string): McpConfiguration {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { throw new Error('JSON 格式不正确，请检查引号、逗号和括号。') }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object' ||
      !('mcpServers' in parsed) || !parsed.mcpServers || Array.isArray(parsed.mcpServers) ||
      typeof parsed.mcpServers !== 'object') throw new Error('配置需要包含 mcpServers 对象。')
  for (const [name, server] of Object.entries(parsed.mcpServers)) {
    if (!name.trim() || !server || Array.isArray(server) || typeof server !== 'object') {
      throw new Error('每个 MCP 服务都需要名称和有效的配置对象。')
    }
  }
  return parsed as McpConfiguration
}
export const getMcpConfiguration = (roleId: string) =>
  request<McpConfiguration>('/api/tools/mcp/export', { headers: roleHeaders(roleId) }).then(config => ({ config }))
export const saveMcpConfiguration = (roleId: string, config: McpConfiguration, reconnect = true) =>
  request<McpServices & { config: McpConfiguration }>('/api/tools/mcp/config', {
    method: 'PUT', headers: roleHeaders(roleId), body: JSON.stringify({ config, reconnect }),
  })
export const getMcpServices = (roleId: string) =>
  request<McpServices>('/api/tools/mcp', { headers: roleHeaders(roleId) })
export const connectMcpServices = (roleId: string, server?: string) =>
  request<McpServices>('/api/tools/mcp/refresh', { method: 'POST', headers: roleHeaders(roleId), body: JSON.stringify(server ? { server } : {}) })
export const setMcpToolEnabled = (roleId: string, server: string, name: string, enabled: boolean) =>
  request<McpServices>('/api/tools/mcp/tool', {
    method: 'PUT', headers: roleHeaders(roleId), body: JSON.stringify({ server, tool: name, enabled }),
  })
