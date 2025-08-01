#!/usr/bin/env python3
import json
import sys
import os

# This mock state is based on the JSON you provided.
# You can modify it here to test different scenarios in your UI.
MOCK_STATE = {
    "initialized": True,
    "primary_pool": "tank-dev",
    "secondary_pools": ["data-dev"],
    "server_name": "SAMBA-SERVER-DEV",
    "workgroup": "WORKGROUP",
    "macos_optimized": True,
    "default_home_quota": "50G",
    "users": {
        "devuser1": {
            "shell_access": True,
            "groups": ["smb_users"],
            "created": "2025-08-01T14:00:00",
            "dataset": {"name": "tank-dev/homes/devuser1", "quota": "50G", "pool": "tank-dev"}
        },
        "devuser2": {
            "shell_access": False,
            "groups": [],
            "created": "2025-08-01T14:05:00",
            "dataset": {"name": "tank-dev/homes/devuser2", "quota": None, "pool": "tank-dev"}
        }
    },
    "groups": {
        "smb_users": {"description": "Default Samba users", "members": ["devuser1"], "created": "2025-08-01T13:59:00"},
        "project-alpha": {"description": "Project Alpha Team", "members": ["devuser1", "devuser2"], "created": "2025-08-01T14:10:00"}
    },
    "shares": {
        "public": {
            "dataset": {"name": "data-dev/shares/public", "quota": "1T", "pool": "data-dev"},
            "smb_config": {"comment": "Public Dev Share", "browseable": True, "read_only": False, "valid_users": "@smb_users"},
            "system": {"owner": "root", "group": "smb_users", "permissions": "775"},
            "created": "2025-08-01T14:15:00"
        }
    }
}

def main():
    """Parses CLI arguments and returns mock JSON data."""
    args = sys.argv[1:]

    # The --json flag is used by the UI, so we check for it.
    is_json_output = "--json" in args
    if is_json_output:
        args.remove("--json")

    if not args:
        print("Usage: smb-zfs {get-state|list|create|...}", file=sys.stderr)
        sys.exit(1)

    command = args[0]

    if command == "get-state":
        print(json.dumps(MOCK_STATE))
    elif command == "list" and "pools" in args:
        print(json.dumps(["tank-dev", "data-dev", "backup-dev"]))
    elif command in ["create", "modify", "delete", "setup", "passwd"]:
        # For any action, just return a generic success message.
        print(json.dumps({"success": True, "message": f"Mocked '{' '.join(args)}' command was successful."}))
    else:
        print(f"Error: Mock command '{command}' not implemented.", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
