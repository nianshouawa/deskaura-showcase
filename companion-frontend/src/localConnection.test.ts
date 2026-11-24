import { describe, expect, it } from 'vitest'
import { localConnectionPatch, privateServiceAddress } from './localConnection'
import type { ModelSettings } from './api'

describe('external local service configuration', () => {
  it.each([
    'http://127.0.0.1:11434/v1', 'http://localhost:9000/v1', 'http://192.168.1.55:3000/mcp',
    'http://10.1.2.3/v1', 'https://172.20.0.4/v1', 'http://[::1]:8003/v1', 'http://[fd12::1]:8000/v1',
  ])('preserves a private service address %s', address => {
    expect(privateServiceAddress(address)).toBe(true)
    expect(localConnectionPatch({ base_url: address, model: 'local-model' }, 'brain')).toEqual({})
  })

  it.each(['https://api.example.com/v1', 'http://8.8.8.8', 'file:///tmp/api', 'http://user:secret@localhost', 'not-an-address'])(
    'does not treat a cloud or invalid address as local: %s', address => {
      expect(privateServiceAddress(address)).toBe(false)
      expect(localConnectionPatch({ base_url: address, model: 'cloud-model' }, 'brain')).toEqual({ base_url: 'http://127.0.0.1:11434/v1' })
    },
  )

  it('prepares the separate external endpoints while leaving built-in cloud settings intact', () => {
    const settings: ModelSettings = {
      base_url: '', model: '', persona_embedding_base_url: 'https://api.example.com/v1', persona_local_provider: 'built_in',
      memory_embedding_base_url: 'https://api.example.com/v1', vision_base_url: 'https://api.example.com/v1',
      asr_provider: 'dashscope', asr_base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      audio_provider: 'dashscope', audio_base_url: 'https://dashscope.aliyuncs.com/api/v1',
    }
    expect(localConnectionPatch(settings, 'persona')).toEqual({})
    expect(localConnectionPatch({ ...settings, persona_local_provider: 'external' }, 'persona')).toEqual({
      persona_embedding_base_url: 'http://127.0.0.1:11434/v1',
    })
    expect(localConnectionPatch(settings, 'memory')).toEqual({ memory_embedding_base_url: 'http://127.0.0.1:11434/v1' })
    expect(localConnectionPatch(settings, 'vision')).toEqual({ vision_base_url: 'http://127.0.0.1:1234/v1' })
    expect(localConnectionPatch(settings, 'hearing')).toEqual({
      asr_base_url: 'http://127.0.0.1:8003/v1', asr_provider: 'compatible', asr_model: 'whisper-1',
    })
    expect(localConnectionPatch(settings, 'voice')).toEqual({
      audio_base_url: 'http://127.0.0.1:8004/v1', audio_provider: 'compatible', audio_model: '', audio_voice: '',
    })
  })

  it('keeps the local speech model when only converting the request protocol', () => {
    const settings: ModelSettings = {
      base_url: '', model: '', asr_provider: 'dashscope', asr_base_url: 'http://192.168.1.2:8003/v1', asr_model: 'local-asr',
    }
    expect(localConnectionPatch(settings, 'hearing')).toEqual({ asr_provider: 'compatible' })
  })
})
