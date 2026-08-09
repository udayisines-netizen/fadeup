#!/usr/bin/env python3

import json
import sys
import re

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

tool = data.get("tool_name", "")
tool_input = data.get("tool_input", {})

def deny(reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }))
    sys.exit(0)

# Never touch Jasmean OS
if tool in ("Read", "Write", "Edit"):
    path = tool_input.get("file_path", "")
    if "/opt/jasmean-os" in path:
        deny("BLOCKED: FadeUp must never access or modify /opt/jasmean-os")

if tool == "Bash":
    command = tool_input.get("command", "")

    # Jasmean isolation
    if "/opt/jasmean-os" in command:
        deny("BLOCKED: FadeUp must never execute commands against Jasmean OS")

    dangerous_patterns = [
        r"\bdocker\s+system\s+prune\b",
        r"\bdocker\s+volume\s+prune\b",
        r"\bdocker\s+network\s+prune\b",
        r"\bdocker\s+container\s+prune\b",
        r"\bdocker\s+image\s+prune\b",
        r"\bdocker\s+compose\s+down\b.*(?:-v|--volumes)",
        r"\bdocker-compose\s+down\b.*(?:-v|--volumes)",
        r"\brm\s+-rf\s+/\s*(?:$|;|&&|\|\|)",
        r"\brm\s+-rf\s+/opt\s*(?:$|;|&&|\|\|)",
        r"\bmkfs\b",
        r"\bwipefs\b",
    ]

    for pattern in dangerous_patterns:
        if re.search(pattern, command, flags=re.IGNORECASE):
            deny("BLOCKED: destructive infrastructure command prohibited by FadeUp security guard")

sys.exit(0)
