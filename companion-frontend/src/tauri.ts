// Tauri 桌面窗口桥接：无边框窗口的拖动、置顶、点击穿透。
// 使用官方 @tauri-apps/api（Tauri 2.x）。浏览器开发模式下 invoke 会抛错，这里做降级。

import { invoke as tauriInvoke } from '@tauri-apps/api/core'

/** 是否运行在 Tauri 环境（区别于浏览器预览）。 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isTauri()) return undefined
  try {
    return (await tauriInvoke<T>(cmd, args)) as T
  } catch (error) {
    console.warn(`[DeskAura] invoke "${cmd}" 失败:`, error)
    return undefined
  }
}

/** 切换窗口置顶；传入 true/false 强制设置，不传则取反。返回切换后的状态。 */
export async function toggleAlwaysOnTop(value?: boolean): Promise<boolean> {
  const result = await invoke<boolean>('set_always_on_top', value === undefined ? {} : { value })
  return result ?? true
}

/** 开始拖动窗口（用于无边框窗口的 pointerdown）。
 *  注意：Tauri 的 start_dragging 必须在鼠标按下事件同步上下文中立即调用，
 *  不能 await 延迟（否则 Windows 会丢失活动鼠标按键上下文，拖动失效）。 */
export function startWindowDrag(): void {
  // 同步立即触发，不能 await —— 否则会丢失 pointerdown 上下文导致无法拖动。
  if (!isTauri()) return
  void tauriInvoke('start_drag').catch((error) => {
    console.warn('[DeskAura] start_drag 失败:', error)
  })
}

/** 切换点击穿透：true 穿透（可点到桌面），false 恢复拦截。 */
export async function setIgnoreCursorEvents(value: boolean): Promise<void> {
  await invoke('set_ignore_cursor_events', { value })
}

/** 隐藏窗口到托盘。 */
export async function hideWindow(): Promise<void> {
  await invoke('hide_window')
}

/** 从托盘恢复显示窗口。 */
export async function showWindow(): Promise<void> {
  await invoke('show_window')
}

/** Bring an existing application window to the foreground on Windows. */
export async function raiseOwnedWindow(label: 'home' | 'settings' | 'tutorial' | 'dialog'): Promise<void> {
  await invoke('raise_owned_window', { label })
}

/** 读取全局光标屏幕坐标（穿透状态下前端仍需要知道鼠标位置）。 */
export async function getCursorPos(): Promise<{ x: number; y: number } | undefined> {
  const result = await invoke<[number, number]>('get_cursor_pos')
  if (!result) return undefined
  return { x: result[0], y: result[1] }
}

/** 执行一个白名单系统操作（打开应用/网址/调音量/锁屏/开文件夹）。 */
export async function runSystemAction(
  actionType: string,
  param?: string,
): Promise<string> {
  const result = await invoke<string>('run_system_action', {
    actionType,
    param: param ?? null,
  })
  return result ?? ''
}
