Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName UIAutomationClient
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class GazeCaptureNative {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr value);
}
'@
[GazeCaptureNative]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
foreach ($direction in @('left','right','up','down')) {
  $point = switch ($direction) { left { @(50,400) }; right { @(2500,400) }; up { @(710,30) }; down { @(710,1500) } }
  [GazeCaptureNative]::SetCursorPos($point[0],$point[1]) | Out-Null
  Start-Sleep -Milliseconds 1100
  $bounds=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $shot=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
  $graphics=[System.Drawing.Graphics]::FromImage($shot)
  $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
  $shot.Save((Join-Path $PSScriptRoot "../build/gaze-desktop-$direction.png"))
  $graphics.Dispose(); $shot.Dispose()
  $pet=[System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty,'DeskAura')))
  if ($pet) {
    $images=$pet.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Image)))
    foreach($item in $images) { if($item.Current.Name -like '眼动 *') { "$direction : $($item.Current.Name)" } }
  }
}
