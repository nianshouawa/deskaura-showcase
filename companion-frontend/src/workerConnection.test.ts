import { it, expect } from 'vitest'
import { normalizeWorkerUrl } from './workerConnection'

it('accepts AutoDL copied access URL and trims endpoint suffix', () => {
  expect(normalizeWorkerUrl('本地访问：http://127.0.0.1:6006/health')).toBe('http://127.0.0.1:6006')
  expect(normalizeWorkerUrl('127.0.0.1:6006')).toBe('http://127.0.0.1:6006')
  expect(normalizeWorkerUrl('export WORKER="https://worker.test/prefix/generate"')).toBe('https://worker.test/prefix')
})
it('does not guess among two AutoDL addresses or accept SSH / proxy / credential URLs', () => {
  for (const value of ['http://127.0.0.1:6006 http://127.0.0.1:6008', 'ssh -p 123 root@host', 'socks5://127.0.0.1:1080', 'http://127.0.0.1:1080', 'https://user:secret@worker.test', 'https://worker.test/?token=secret']) {
    expect(() => normalizeWorkerUrl(value)).toThrow()
  }
})
