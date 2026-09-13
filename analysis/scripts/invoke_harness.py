"""Build a reviewable invocation request; the actual AWS call is opt-in."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import uuid


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("prompt")
    parser.add_argument("--session-id", default=None)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()

    payload = {
        "prompt": args.prompt,
        "sessionId": args.session_id or str(uuid.uuid4()),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if not args.execute:
        print("DRY_RUN: add --execute only after confirming AWS target and cost controls")
        return 0

    command = ["npx", "@aws/agentcore", "invoke", "NtpcYouthAI", "--input", json.dumps(payload)]
    return subprocess.call(command)


if __name__ == "__main__":
    sys.exit(main())
