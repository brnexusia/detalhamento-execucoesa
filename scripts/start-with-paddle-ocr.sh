#!/bin/sh
set -eu
# A local process, not an additional Docker/EasyPanel service.
# It loads OCR models once and remains on loopback 127.0.0.1:8088.
# The web server still starts normally; a failed Paddle process triggers
# the existing Tesseract fallback on OCR requests.
if [ "${PDF_OCR_ENGINE:-paddle}" = "paddle" ]; then
  echo '[pdf-ocr] starting PaddleOCR CPU model inside application container' >&2
  nice -n 10 /opt/paddleocr/bin/python -u /app/server/paddle-ocr-service.py >&2 &
else
  echo '[pdf-ocr] engine set to Tesseract; PaddleOCR disabled' >&2
fi
exec "$@"
