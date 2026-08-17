import os
import sys
import urllib.request

port = os.environ.get("PORT", "8000")

try:
    urllib.request.urlopen(f"http://localhost:{port}/api/health", timeout=4)
except Exception:
    sys.exit(1)
