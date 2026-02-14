#!/usr/bin/env python3
import argparse


def main() -> None:
    p = argparse.ArgumentParser(description="Preview activity-to-EXP conversion")
    p.add_argument("--active-minutes", type=int, default=30)
    p.add_argument("--input-events", type=int, default=500)
    p.add_argument("--daily-cap", type=int, default=300)
    args = p.parse_args()

    exp = int(args.active_minutes * 2 + args.input_events / 20)
    exp = min(exp, args.daily_cap)
    print(f"estimated_exp={exp}")


if __name__ == "__main__":
    main()
