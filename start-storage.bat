@echo off
title Verso Local S3 Storage
echo ========================================================
echo Starting Verso Local S3 Storage and ngrok Tunnel
echo ========================================================
echo.

if not exist "D:\s3-data\verso-books" (
    echo Creating bucket directory D:\s3-data\verso-books...
    mkdir "D:\s3-data\verso-books"
)

echo [1/2] Launching S3rver on port 9000...
start "Verso S3rver (Port 9000)" cmd /k "npx s3rver --directory D:\s3-data --port 9000 --no-vhost-buckets --allow-mismatched-signatures"

timeout /t 2 /nobreak >nul

echo [2/2] Launching ngrok Tunnel...
start "Verso ngrok Tunnel" cmd /k "ngrok http --domain=tianna-tissuey-exactingly.ngrok-free.dev 9000"

echo.
echo ========================================================
echo Storage is LIVE!
echo.
echo Endpoint:  https://tianna-tissuey-exactingly.ngrok-free.dev
echo Bucket:    verso-books
echo Folder:    D:\s3-data\verso-books
echo ========================================================
echo Keep the opened windows running while syncing books.
echo.
pause
