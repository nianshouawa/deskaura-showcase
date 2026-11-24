import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachmentAccept, attachmentSupportDetail, attachmentSupportLabel, defaultChatCapabilities, readChatAttachment, validateAttachmentFile } from './chatAttachments'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII='), c => c.charCodeAt(0))
const enabled = { ...defaultChatCapabilities, image_input: true, source: 'manual' as const }
afterEach(() => vi.unstubAllGlobals())

describe('model-aware attachments', () => {
  it('does not claim arbitrary audio/video/PDF support', () => {
    expect(attachmentAccept(defaultChatCapabilities)).not.toContain('.png')
    expect(attachmentSupportLabel(defaultChatCapabilities)).toBe('未知')
    expect(attachmentAccept(enabled)).toContain('.webp')
    expect(attachmentSupportLabel(enabled)).toBe('文本 / 图片')
    expect(attachmentSupportDetail(enabled)).toContain('不上传音视频、PDF 或 Office')
  })
  it('checks limits, extensions, capabilities and MIME before reading', () => {
    expect(() => validateAttachmentFile({ name: 'a.png', type: 'image/png', size: 10 }, defaultChatCapabilities)).toThrow('尚未允许图片')
    expect(() => validateAttachmentFile({ name: 'a.png', type: 'image/png', size: 4 * 1024 * 1024 + 1 }, enabled)).toThrow('4 MB')
    expect(() => validateAttachmentFile({ name: 'a.png', type: 'image/jpeg', size: 10 }, enabled)).toThrow('不一致')
    expect(() => validateAttachmentFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 }, enabled)).toThrow('暂不支持')
    expect(() => validateAttachmentFile({ name: 'a.pdf', type: 'application/pdf', size: 10 }, enabled)).toThrow('暂不支持')
    expect(() => validateAttachmentFile({ name: 'a.txt', type: 'text/plain', size: 48 * 1024 + 1 }, enabled)).toThrow('48 KB')
  })
  it('reads legacy text without pretending to parse binary documents', async () => {
    const attachment = await readChatAttachment(new File(['你好'], 'note.TXT', { type: 'text/plain' }), enabled)
    expect(attachment).toEqual({ name: 'note.TXT', kind: 'text', content: '你好' })
    await expect(readChatAttachment(new File([new Uint8Array([0xFF])], 'bad.txt'), enabled)).rejects.toThrow('UTF-8')
    await expect(readChatAttachment(new File(['x'.repeat(12001)], 'long.txt'), enabled)).rejects.toThrow('12000')
  })
  it('encodes an image as a verified MIME data URI', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 1, height: 1, close }))
    const attachment = await readChatAttachment(new File([png], 'tiny.png', { type: 'image/png' }), enabled)
    expect(attachment.kind).toBe('image')
    expect(attachment.mime_type).toBe('image/png')
    expect(attachment.content).toBe('data:image/png;base64,' + btoa(String.fromCharCode(...png)))
    expect(close).toHaveBeenCalledOnce()
    await expect(readChatAttachment(new File(['fake'], 'fake.png', { type: 'image/png' }), enabled)).rejects.toThrow('数据与类型不一致')
  })
  it('rejects oversized pixel dimensions and releases browser image memory', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 10000, height: 10000, close }))
    await expect(readChatAttachment(new File([png], 'big.png', { type: 'image/png' }), enabled)).rejects.toThrow('2000 万像素')
    expect(close).toHaveBeenCalledOnce()
  })
})
