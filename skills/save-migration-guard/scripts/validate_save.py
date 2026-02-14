#!/usr/bin/env python3
import argparse
import json
import sys


def has_path(obj, path):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return True


def main() -> None:
    p = argparse.ArgumentParser(description="Validate required DesktopPet save fields")
    p.add_argument("save_file")
    args = p.parse_args()

    with open(args.save_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    required = [
        "schemaVersion",
        "stats.hunger",
        "stats.happiness",
        "stats.cleanliness",
        "stats.health",
        "stage",
        "exp",
        "lastSeenTimestamp",
    ]
    missing = [k for k in required if not has_path(data, k)]
    if missing:
        print("Missing required fields:")
        for k in missing:
            print(f"- {k}")
        sys.exit(1)

    print("Save schema validation passed.")


if __name__ == "__main__":
    main()
