@echo off
title Verso S3rver
if not exist "D:\s3-data\verso-books" (
    mkdir "D:\s3-data\verso-books"
)
echo Starting S3rver on http://localhost:9000 (Storage: D:\s3-data)...
npx s3rver --directory D:\s3-data --port 9000 --no-vhost-buckets --allow-mismatched-signatures
pause
