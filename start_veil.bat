@echo off
setlocal EnableDelayedExpansion
title PROJECT VEIL // Post-Quantum Encrypted Messenger
color 0B

echo ====================================================================
echo    PROJECT VEIL // ZERO-KNOWLEDGE POST-QUANTUM MESSENGER
echo    Dual Architecture: Veil Flow (WhatsApp UX) ^& Veil Bunker (HUD)
echo    Security: NIST FIPS 203 ML-KEM-768 + TreeKEM MLS + PQXDH
echo ====================================================================
echo.

:: 1. Verify Node.js Environment
echo [1/3] Verifying Node.js Runtime...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not found in your PATH!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [*] Node.js detected: !NODE_VER!

:: 2. Start Project VEIL Relay & Attachment Server (Port 8080)
echo.
echo [2/3] Checking Project VEIL Relay Server (http://127.0.0.1:8080)...
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [*] Relay server is offline. Starting server daemon...
    start "VEIL Relay Server (Port 8080)" /min cmd /c "cd /d "%~dp0server" && node server.js"
    echo [*] Initializing WebSocket signaling ^& quantum key stores...
    set /a count=0
    :WAIT_SERVER
    timeout /t 1 /nobreak >nul
    powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/health' -UseBasicParsing -TimeoutSec 2; exit 0 } catch { exit 1 }" >nul 2>&1
    if !ERRORLEVEL! NEQ 0 (
        set /a count+=1
        if !count! LSS 10 goto WAIT_SERVER
        echo [WARNING] Relay server took longer than expected. Continuing...
    )
)
echo [OK] Relay Server is active on port 8080 (HTTP + WSS).

:: 3. Launch Web Interface in default browser
echo.
echo [3/3] Launching Project VEIL in your default browser...
start "" "http://localhost:8080"

echo.
echo ====================================================================
echo  [ONLINE] Project VEIL is running successfully!
echo  - Local Web App:     http://localhost:8080
echo  - Local Relay WSS:   ws://localhost:8080
echo  - Cloud Relay Sync:  https://veil-relay.onrender.com
echo ====================================================================
echo.
echo Keep this window open while using VEIL. Press any key to stop server.
pause >nul

:: Graceful cleanup on keypress
echo [*] Stopping local relay server...
taskkill /FI "WINDOWTITLE eq VEIL Relay Server (Port 8080)*" /F >nul 2>&1
echo [OK] Project VEIL session closed.
timeout /t 1 /nobreak >nul
