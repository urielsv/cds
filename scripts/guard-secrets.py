#!/usr/bin/env python3
"""Block git commands that would stage or commit a secret file.

Invoked by the `guard-secrets` Kiro hook on every shell tool call. Reads the
hook payload as JSON on stdin.

Exit codes follow the hook contract:
  0  allow the command
  2  block it; stderr is shown to the agent

Why this exists: `.env.local` holds UPLOAD_PASSWORD_HASH and SESSION_SECRET.
This repository is public. A single `git add .` that happened to run before
.gitignore was correct would publish the upload credentials, and rewriting
public history does not un-publish them.
"""

from __future__ import annotations

import json
import re
import sys

# Any of these appearing in a staging/committing command is suspicious.
SECRET_PATTERNS = (
    r"\.env\.local",
    r"\.env\.production",
    r"\.env(?![.\w])",  # bare `.env`, but not `.env.example`
    r"id_rsa",
    r"id_ed25519",
    r"\.pem\b",
    r"\.p12\b",
    r"\.keystore\b",
    r"credentials\.json",
    r"secrets\.json",
)

# Commands that can move a file into git's index or history.
STAGING_COMMAND = re.compile(r"git\s+(?:add|commit|stash)\b")

# Explicitly fine: the committed template that contains no real values.
ALLOWED = re.compile(r"\.env\.example")


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        # If the payload is not what we expect, do not block the user's work.
        return 0

    haystack = json.dumps(payload)

    if not STAGING_COMMAND.search(haystack):
        return 0

    matched = [p for p in SECRET_PATTERNS if re.search(p, haystack)]
    if not matched:
        return 0

    # `git add .env.example` is legitimate and common.
    if ALLOWED.search(haystack) and len(matched) == 1 and matched[0] == r"\.env(?![.\w])":
        return 0

    sys.stderr.write(
        "Blocked: this git command references what looks like a secret file "
        f"(matched: {', '.join(matched)}).\n"
        "\n"
        ".env files in this project hold UPLOAD_PASSWORD_HASH and SESSION_SECRET, "
        "and the repository is public. Committing them would expose the upload "
        "credentials permanently, since rewriting public history does not retract "
        "what was published.\n"
        "\n"
        "Stage specific files by name instead of using a wildcard. If you meant "
        "the committed template, that file is .env.example.\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
