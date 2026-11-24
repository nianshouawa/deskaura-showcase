@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Write-Host '正在推送到 GitHub (client 分支)...' -ForegroundColor Cyan; git add .; git commit -m 'feat: 内置默认 VRM 角色模型 (结海与千駄ヶ谷渋) 及开箱即用支持' 2>$null; git push -u origin main:client"
echo.
pause
