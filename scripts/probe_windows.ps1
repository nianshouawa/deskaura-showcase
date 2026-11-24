Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class WinProbe {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  public struct RECT { public int L, T, R, B; }
}
"@
$targets = Get-Process deskaura -ErrorAction SilentlyContinue | ForEach-Object { $_.Id }
$rows = New-Object System.Collections.ArrayList
$cb = [WinProbe+EnumProc]{
  param($h, $l)
  [uint32]$procId = 0
  [void][WinProbe]::GetWindowThreadProcessId($h, [ref]$procId)
  if ($targets -contains [int]$procId) {
    $sb = New-Object System.Text.StringBuilder 256
    [void][WinProbe]::GetWindowText($h, $sb, 256)
    $r = New-Object WinProbe+RECT
    [void][WinProbe]::GetWindowRect($h, [ref]$r)
    $style = [WinProbe]::GetWindowLong($h, -16)
    [void]$rows.Add([pscustomobject]@{
      Pid = [int]$procId
      Title = $sb.ToString()
      Visible = [WinProbe]::IsWindowVisible($h)
      Maximized = [WinProbe]::IsZoomed($h)
      Size = "$($r.R - $r.L)x$($r.B - $r.T)"
      Pos = "$($r.L),$($r.T)"
      ThickFrame = [bool]($style -band 0x00040000)
      Caption = [bool]($style -band 0x00C00000)
    })
  }
  return $true
}
[void][WinProbe]::EnumWindows($cb, [IntPtr]::Zero)
$rows | Where-Object { $_.Visible -and $_.Title } | Format-Table -AutoSize
