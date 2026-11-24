/** DeskAura input adapters, not an assertion that every remote gateway supports them. */
export interface ChatAttachment {
  name: string
  content: string
  kind?: 'text' | 'image'
  mime_type?: string
}
export interface ChatCapabilities {
  image_input: boolean
  source: 'provider' | 'known-model' | 'manual' | 'disabled' | 'unknown' | 'vision-module'
  detail: string
  provider_verified: boolean
  max_attachments: number
  max_image_bytes: number
  max_image_pixels: number
  max_text_bytes: number
  max_text_characters: number
  image_mime_types: string[]
  text_extensions: string[]
  audio_input: boolean
  video_input: boolean
  document_input: boolean
}
export const textAttachmentExtensions = ['.txt', '.md', '.csv', '.json', '.log', '.py', '.js', '.ts', '.vue', '.css', '.html', '.xml', '.yaml', '.yml', '.ini', '.toml']
const imageMimeByExtension: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
export const defaultChatCapabilities: ChatCapabilities = {
  image_input: false, source: 'unknown', detail: '尚未确认模型图片能力', provider_verified: false,
  max_attachments: 3, max_image_bytes: 4 * 1024 * 1024, max_image_pixels: 20_000_000,
  max_text_bytes: 48 * 1024, max_text_characters: 12000,
  image_mime_types: ['image/jpeg', 'image/png', 'image/webp'], text_extensions: textAttachmentExtensions,
  audio_input: false, video_input: false, document_input: false,
}

export function attachmentAccept(capabilities: ChatCapabilities): string {
  return [...capabilities.text_extensions, ...(capabilities.image_input ? Object.keys(imageMimeByExtension) : [])].join(',')
}
export function attachmentSupportLabel(capabilities: ChatCapabilities): string {
  if (capabilities.source === 'unknown') return '未知'
  if (!capabilities.image_input) return '文本 / 代码'
  return '文本 / 图片'
}
export function attachmentSupportDetail(capabilities: ChatCapabilities): string {
  const images = capabilities.image_input ? 'JPEG / PNG / WebP 图片（每张最多 4 MB / 2000 万像素）' : '接口未确认图片能力'
  return `文本 / 代码（48 KB / 12000 字），${images}；每次最多 3 个。当前不上传音视频、PDF 或 Office。${capabilities.detail}。`
}
function extensionOf(name: string): string { return /\.[^.]+$/.exec(name)?.[0].toLowerCase() || '' }

export function validateAttachmentFile(file: Pick<File, 'name' | 'size' | 'type'>, capabilities: ChatCapabilities): { kind: 'text' | 'image'; mime: string } {
  const extension = extensionOf(file.name)
  const mime = imageMimeByExtension[extension]
  if (mime) {
    if (!capabilities.image_input) throw new Error('当前模型尚未允许图片输入，接口未提供可确认的图片能力。')
    if (!capabilities.image_mime_types.includes(mime)) throw new Error('当前适配不支持这种图片格式。')
    if (!file.size || file.size > Math.min(capabilities.max_image_bytes, 4 * 1024 * 1024)) throw new Error('每张图片最多 4 MB，请压缩后重试。')
    if (file.type && file.type !== mime) throw new Error('图片扩展名与实际类型不一致，请重新导出 JPEG / PNG / WebP。')
    return { kind: 'image', mime }
  }
  if (!capabilities.text_extensions.includes(extension)) throw new Error('当前支持文本 / 代码，以及已启用的 JPEG / PNG / WebP 图片；暂不支持音视频、PDF 或 Office。')
  if (file.size > Math.min(capabilities.max_text_bytes, 48 * 1024)) throw new Error('文本附件最多 48 KB / 12000 字。')
  return { kind: 'text', mime: 'text/plain' }
}
function detectImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)) return 'image/png'
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[bytes.length - 2] === 255 && bytes[bytes.length - 1] === 217) return 'image/jpeg'
  if (bytes.length >= 30 && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  return ''
}
function toBase64(bytes: Uint8Array): string {
  let value = ''
  for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(value)
}
async function checkImageDimensions(blob: Blob, capabilities: ChatCapabilities): Promise<void> {
  const image = await createImageBitmap(blob)
  try {
    if (!image.width || !image.height || image.width * image.height > Math.min(capabilities.max_image_pixels, 20_000_000) || Math.max(image.width, image.height) > 16384) {
      throw new Error('图片不能超过 2000 万像素，最长边不能超过 16384 像素，请缩小后重试。')
    }
  } finally { image.close() }
}
export async function readChatAttachment(file: File, capabilities: ChatCapabilities): Promise<ChatAttachment> {
  const { kind, mime } = validateAttachmentFile(file, capabilities)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (kind === 'image') {
    if (detectImageMime(bytes) !== mime) throw new Error('图片数据与类型不一致，请重新导出 JPEG / PNG / WebP。')
    try { await checkImageDimensions(new Blob([bytes], { type: mime }), capabilities) }
    catch (e) { throw new Error(e instanceof Error && e.message.includes('像素') ? e.message : '图片无法解码，请重新导出 JPEG / PNG / WebP。') }
    return { name: file.name.slice(0, 200), kind, mime_type: mime, content: `data:${mime};base64,${toBase64(bytes)}` }
  }
  let content: string
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  catch { throw new Error('文本附件不是有效 UTF-8 编码，请转换编码后重试。') }
  if (content.length > Math.min(capabilities.max_text_characters, 12000) || content.includes('\0')) throw new Error('文本附件超过 12000 字或包含无效空字符。')
  return { name: file.name.slice(0, 200), kind: 'text', content }
}
