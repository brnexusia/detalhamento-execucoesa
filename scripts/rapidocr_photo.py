#!/usr/bin/env python3
"""Single-image, local-only RapidOCR fallback for price labels.
Runs as an isolated subprocess with strict input size and no network activity.
Prints at most one JSON object. Never guesses or returns a price directly:
the Node parser validates monetary units and conflicting labels.
"""
import json
import sys

MAX_IMAGE_BYTES = 8 * 1024 * 1024
raw = sys.stdin.buffer.read(MAX_IMAGE_BYTES + 1)
if not raw or len(raw) > MAX_IMAGE_BYTES:
    print(json.dumps({"text": "", "reason": "invalid_image"}))
    sys.exit(0)

try:
    import cv2
    import numpy as np
    from rapidocr import RapidOCR

    image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None or image.shape[0] * image.shape[1] > 40_000_000:
        print(json.dumps({"text": "", "reason": "invalid_dimensions"}))
        sys.exit(0)

    # Inference uses local bundled ONNX models; no cloud OCR.
    result = RapidOCR()(image)
    texts = list(result.txts or [])
    scores = list(result.scores or [])
    accepted = []
    confidences = []
    for index, text in enumerate(texts[:80]):
        confidence = float(scores[index]) if index < len(scores) else 0.0
        if confidence < 0.82:
            continue
        accepted.append(str(text)[:200])
        confidences.append(round(confidence, 4))

    print(json.dumps({"text": "\n".join(accepted)[:10000], "scores": confidences}, ensure_ascii=False))
except Exception:
    # A failed secondary engine may never block the original Tesseract path.
    print(json.dumps({"text": "", "reason": "engine_failed"}))
