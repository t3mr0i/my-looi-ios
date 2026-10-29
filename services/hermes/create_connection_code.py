"""Print an existing single-owner credential as a deliberate-paste app setup code."""

import argparse
import base64
import getpass
import json
import os
import re
from urllib.parse import urlsplit


def create_code(origin: str, token: str) -> str:
    parsed = urlsplit(origin)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")
            or not re.fullmatch(r"[A-Za-z0-9_-]{32,512}", token)):
        raise ValueError("Use an HTTPS origin and a 32-512 character base64url key")
    # JSON stays ASCII so the portable app parser needs no permissive UTF-8 fallback.
    payload = json.dumps({"url": origin.rstrip("/"), "token": token}, separators=(",", ":"), ensure_ascii=True)
    return "LOOI1." + base64.urlsafe_b64encode(payload.encode("ascii")).decode("ascii").rstrip("=")


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a private setup code for an existing single-owner Hermes service.")
    parser.add_argument("--url", required=True, help="HTTPS origin of the existing service")
    args = parser.parse_args()
    token = os.environ.get("LOOI_AGENT_TOKEN") or getpass.getpass("Existing LOOI access key: ")
    try:
        print(create_code(args.url, token))
    except ValueError as error:
        parser.error(str(error))


if __name__ == "__main__":
    main()
