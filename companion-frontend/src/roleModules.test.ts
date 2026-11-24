import { afterEach, describe, expect, it, vi } from 'vitest'
import { moduleEnabled, moduleSettingsPatch, moduleStates, moduleStatusText, roleModules, testRoleModule } from './roleModules'
import { safeRoleConfig, uniqueModelName, type StoredModel } from './modelLibrary'

afterEach(() => vi.unstubAllGlobals())

describe('character module configuration', () => {
  it('keeps the requested module order and separate enable fields', () => {
    expect(roleModules.map(item => item.label)).toEqual(['人设', '记忆', '大脑', '手脚', '视觉', '听觉', '语音', '动作'])
    const settings = { base_url: '', model: '' }
    expect(moduleEnabled(settings, 'brain')).toBe(true)
    expect(moduleEnabled(settings, 'hearing')).toBe(false)
    expect(moduleEnabled(settings, 'voice')).toBe(false)
    expect(moduleStatusText()).toBe('未检测')
    expect(moduleStatusText({ verified: false, enabled: false, detail: '' })).toBe('已停用')
    expect(moduleStatusText({ verified: false, detail: '验证已过期 · 请重新检测' })).toBe('待复检')
    expect(moduleStatusText({ verified: false, detail: '无法连接服务' })).toBe('异常')
  })
  it('never treats the presence of a provider response as verified', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options?: RequestInit) => {
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'alpha' })
      return Response.json({ provider_verified: true, detail: '未回读' })
    }))
    const result = await moduleStates('alpha')
    expect(Object.values(result).every(item => item.verified === false)).toBe(true)
  })
  it('saves only the selected module rather than another module’s hidden draft key', () => {
    const value = { base_url: 'https://example.invalid/v1', model: 'brain', api_key: 'unsaved-brain-key',
      persona_text: '角色名称：QA', persona_embedding_model: 'embedding', persona_embedding_api_key: 'persona-key',
      persona_tag: '人设', asr_api_key: 'unsaved-hearing-key' }
    expect(moduleSettingsPatch(value, 'persona')).toEqual({
      persona_text: '角色名称：QA', persona_embedding_model: 'embedding', persona_embedding_api_key: 'persona-key',
    })
  })
  it('does not expose unsupported memory LLM controls as saved runtime configuration', () => {
    expect(moduleSettingsPatch({ base_url: '', model: '', memory_tag: '记忆',
      memory_embedding_tag: '向量', memory_embedding_model: 'embedding',
      memory_retrieve_method: 'llm', memory_llm_api_key: 'unused-key' }, 'memory')).toEqual({
      memory_embedding_model: 'embedding',
    })
  })
  it('keeps errors visible instead of hard-coded green statuses', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/brain/')) return Response.json({ verified: true, detail: '正常' })
      throw new Error('unavailable')
    }))
    const result = await moduleStates('alpha')
    expect(result.brain?.verified).toBe(true)
    expect(result.motion).toEqual({ verified: false, detail: 'unavailable' })
  })
  it('sends role-scoped tests and receipts without creating conversations', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
      urls.push(url)
      expect(options?.headers).toMatchObject({ 'X-DeskAura-Role': 'beta' })
      return Response.json(url.endsWith('/receipt') ? { accepted: true }
        : url.endsWith('/status') ? { verified: true, detail: '正常' } : { text: '正常', verification_id: 'test-verification' })
    }))
    expect((await testRoleModule('brain', 'beta')).verified).toBe(true)
    expect(urls.every(url => !url.includes('/chat/send') && !url.includes('/sessions'))).toBe(true)
  })
  it('strips nested credentials but preserves masks and model identifiers', () => {
    const result = safeRoleConfig({ api_key: 'secret', api_key_masked: 'sk-******1234',
      motion_provider: 'tencent_tokenhub', profiles: { cloud: { api_key: 'private', model: 'test', access_token: 'private' } } })
    expect(JSON.stringify(result)).not.toContain('private')
    expect(result).toEqual({ api_key_masked: 'sk-******1234', motion_provider: 'tencent_tokenhub', profiles: { cloud: { model: 'test' } } })
  })
  it('does not copy full MCP process arguments or connection configuration into the model library', () => {
    expect(safeRoleConfig({ model: 'qa', tools_mcp_config: {
      mcpServers: { private: { command: 'node', args: ['--token=private-secret'], env: { API_KEY: 'private-secret' } } },
    } })).toEqual({ model: 'qa' })
  })
  it('creates collision-free duplicate role names', () => {
    const models = ['Momo', 'Momo(1)', 'Momo(3)'].map(name => ({ name } as StoredModel))
    expect(uniqueModelName('Momo', models)).toBe('Momo(2)')
    expect(uniqueModelName('Other', models)).toBe('Other')
  })
})
