@echo off
chcp 65001 >nul
title 推送 DeskAura 客户端源码到 GitHub
echo ====================================================================
echo   正在推送 DeskAura 客户端源码到 GitHub:
echo   https://github.com/nianshouawa/deskaura-showcase (client 分支)
echo ====================================================================
echo.
cd /d "%~dp0"

echo [1/2] 暂存最新更改...
"C:\Program Files\Git\cmd\git.exe" add .
"C:\Program Files\Git\cmd\git.exe" commit -m "feat: 内置默认 VRM 角色模型 (结海与千駄ヶ谷渋) 及开箱即用支持" 2>nul

echo.
echo [2/2] 正在推送到 GitHub (client 分支)...
"C:\Program Files\Git\cmd\git.exe" push -u origin main:client

echo.
echo ====================================================================
echo 同步完成！您可在 GitHub 仓库切换到 client 分支查看完整源码。
echo ====================================================================
pause
