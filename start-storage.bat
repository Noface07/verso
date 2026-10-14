
@echo off
setlocal
title Verso Local S3 Storage + Nginx + ngrok

set "DATA_DIR=D:\s3-data"
set "BUCKET_DIR=D:\s3-data\verso-books"
set "S3_PORT=9000"
set "NGINX_PORT=8090"
set "NGROK_DOMAIN=tianna-tissuey-exactingly.ngrok-free.dev"

echo ========================================================
echo   Verso Local S3 Storage + Nginx + ngrok
echo ========================================================
echo.

REM 1. Check Node.js and npm/npx
where npx >nul 2>&1
if errorlevel 1 (
    echo ERROR: npx was not found. Install Node.js or fix PATH.
    goto :error
)

REM 2. Create storage directories
if not exist "%BUCKET_DIR%" (
    echo Creating bucket directory: %BUCKET_DIR%
    mkdir "%BUCKET_DIR%"
    if errorlevel 1 goto :error
)

REM 3. Check that Nginx is already listening on port 8090
echo [1/4] Checking Nginx on port %NGINX_PORT%...
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %NGINX_PORT% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo ERROR: Nginx is not listening on port %NGINX_PORT%.
    echo Start Nginx from C:\nginx first.
    goto :error
)

REM 4. Check whether S3rver is already listening
echo [2/4] Checking S3rver on port %S3_PORT%...
powershell -NoProfile -Command "if (Get-NetTCPConnection -State Listen -LocalPort %S3_PORT% -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }"
if errorlevel 1 (
    echo Starting S3rver...
    start "Verso S3rver - Port 9000" cmd /k "cd /d D:\s3-data && npx s3rver --directory D:\s3-data --port 9000 --no-vhost-buckets --allow-mismatched-signatures"

    echo Waiting for S3rver to start...
    powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(30); do { Start-Sleep -Seconds 1; $listening = [bool](Get-NetTCPConnection -State Listen -LocalPort %S3_PORT% -ErrorAction SilentlyContinue) } until ($listening -or (Get-Date) -ge $deadline); if (-not $listening) { exit 1 }"
    if errorlevel 1 (
        echo ERROR: S3rver did not start on port %S3_PORT%.
        goto :error
    )
) else (
    echo S3rver is already listening on port %S3_PORT%.
)

REM 5. Start ngrok through Nginx
echo [3/4] Starting ngrok for both services...
start "Verso ngrok Tunnel" cmd /k "ngrok http --domain=%NGROK_DOMAIN% %NGINX_PORT%"

echo.
echo ========================================================
echo   Startup commands issued
echo ========================================================
echo.
echo Public domain: https://%NGROK_DOMAIN%
echo.
echo Suwayomi:      https://%NGROK_DOMAIN%/suwayomi/
echo Verso S3:      https://%NGROK_DOMAIN%/
echo.
echo S3 port:       %S3_PORT%
echo Nginx port:    %NGINX_PORT%
echo Storage:       %DATA_DIR%
echo Bucket folder: %BUCKET_DIR%
echo.
echo Ensure Nginx routes /suwayomi/ to port 4567
echo and / to port 9000.
echo Keep S3rver, Nginx and ngrok running.
echo.
pause
endlocal
exit /b 0

:error
echo.
echo Startup failed. Check the error messages above.
pause
endlocal
exit /b 1
