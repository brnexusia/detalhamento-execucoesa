"""Single-container PaddleOCR CPU inference bridge; bound to loopback only."""
import json
import os
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

MAX_PNG = 8 * 1024 * 1024
# Load the models exactly once per service, not once per PDF page.
from paddleocr import PaddleOCR

MODEL = PaddleOCR(
    device="cpu",
    text_detection_model_name="PP-OCRv6_small_det",
    text_recognition_model_name="PP-OCRv6_small_rec",
    use_doc_orientation_classify=False,
    use_doc_unwarping=False,
    use_textline_orientation=False,
    cpu_threads=1,
)

def recognize_png(raw):
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Imagem PNG inválida")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=True) as temp:
        temp.write(raw)
        temp.flush()
        pages = MODEL.predict(temp.name)
        lines = []
        for page in pages:
            block = getattr(page, "json", {})
            if callable(block):
                block = block()
            block = block.get("res", block) if isinstance(block, dict) else {}
            texts = block.get("rec_texts", [])
            scores = block.get("rec_scores", [])
            boxes = block.get("rec_boxes", [])
            for index, value in enumerate(texts):
                value = str(value).strip()
                if not value:
                    continue
                score = float(scores[index]) if index < len(scores) else 0.0
                box = boxes[index].tolist() if index < len(boxes) and hasattr(boxes[index], "tolist") else (boxes[index] if index < len(boxes) else [])
                if not isinstance(box, (list, tuple)) or len(box) != 4:
                    box = []
                lines.append({"text": value, "score": round(score, 4), "box": [round(float(x), 2) for x in box]})
        return {"text": "\n".join(row["text"] for row in lines), "lines": lines}

class Handler(BaseHTTPRequestHandler):
    def reply(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"ok": True, "engine": "paddleocr", "model": "PP-OCRv6_small"})
        self.reply(404, {"error": "not_found"})

    def do_POST(self):
        if self.path != "/ocr":
            return self.reply(404, {"error": "not_found"})
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size < 8 or size > MAX_PNG:
            return self.reply(413, {"error": "invalid_image_size"})
        try:
            raw = self.rfile.read(size)
            result = recognize_png(raw)
            self.reply(200, result)
        except (ValueError, OSError) as exc:
            self.reply(422, {"error": str(exc)[:160]})
        except Exception as exc:
            print("[paddle-ocr] inference failed:", type(exc).__name__, str(exc)[:200], file=sys.stderr, flush=True)
            self.reply(500, {"error": "inference_failed"})

    def log_message(self, format, *args):
        pass

if __name__ == "__main__":
    port = int(os.environ.get("PDF_OCR_PORT", "8088"))
    print("[paddle-ocr] CPU ready on 127.0.0.1:", port, flush=True)
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()
