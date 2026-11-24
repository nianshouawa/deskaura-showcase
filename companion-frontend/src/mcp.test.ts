import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectMcpServices, defaultMcpTemplate, getMcpConfiguration, getMcpServices, parseMcpConfiguration, saveMcpConfiguration, setMcpToolEnabled } from './mcp'
afterEach(() => vi.unstubAllGlobals())
describe('MCP JSON and role requests', () => {
  it('accepts the ready-to-save template and common local/remote service definitions', () => {
    expect(parseMcpConfiguration(defaultMcpTemplate)).toEqual({ mcpServers: {} })
    expect(parseMcpConfiguration('{"mcpServers":{"local":{"command":"node","args":["worker.js"]},"remote":{"url":"https://example.test/mcp"}}}').mcpServers).toHaveProperty('local')
    for (const invalid of ['null', '{}', '[]', '{"mcpServers":[]}', '{"mcpServers":{"x":null}}', '{"mcpServers":']) {
      expect(() => parseMcpConfiguration(invalid)).toThrow()
    }
  })
  it('sends every configuration, connection and tool preference to the selected character', async () => {
    const fetcher = vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'beta' })
      return Response.json({ mcpServers: {}, config: { mcpServers: {} }, services: [] })
    })
    vi.stubGlobal('fetch', fetcher)
    await getMcpConfiguration('beta'); await getMcpServices('beta')
    await saveMcpConfiguration('beta', { mcpServers: {} }); await connectMcpServices('beta', 'server')
    await setMcpToolEnabled('beta', 'server', 'read_file', false)
    expect(fetcher).toHaveBeenCalledTimes(5)
    expect(fetcher.mock.calls[4]![1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ server: 'server', tool: 'read_file', enabled: false }) })
    expect(fetcher.mock.calls[3]![1]?.body).toBe(JSON.stringify({ server: 'server' }))
  })
})
