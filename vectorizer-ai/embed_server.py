"""
HTTP embedding service. Loads all-MiniLM-L6-v2 once and serves POST /embed.
Used by the API (network) and by the batch vectorizer (local subprocess).
"""
import json, os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from sentence_transformers import SentenceTransformer

MODEL_NAME = "all-MiniLM-L6-v2"
PORT = int(os.environ.get("EMBED_PORT", "5001"))

print(f"[embed] loading {MODEL_NAME}...", flush=True)
model = SentenceTransformer(MODEL_NAME)
DIM = model.get_sentence_embedding_dimension()
print(f"[embed] ready dim={DIM} port={PORT}", flush=True)


class Handler(BaseHTTPRequestHandler):
    # Quiet default access log.
    def log_message(self, *_): pass

    # Health endpoint.
    def do_GET(self):
        if self.path == "/health":
            self._json(200, {"status": "ok", "dim": DIM})
        else:
            self._json(404, {"error": "not found"})

    # Embed a single text from JSON body {"text": "..."}.
    def do_POST(self):
        if self.path != "/embed":
            return self._json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("content-length", "0"))
            req = json.loads(self.rfile.read(n) or b"{}")
            text = req.get("text", "")
            vec = model.encode(text, normalize_embeddings=True).tolist()
            self._json(200, {"vector": vec})
        except Exception as e:
            self._json(500, {"error": str(e)})

    # Write a JSON response.
    def _json(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
