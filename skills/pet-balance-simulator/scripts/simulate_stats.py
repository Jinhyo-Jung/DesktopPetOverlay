#!/usr/bin/env python3
import argparse


def clamp(v: float) -> float:
    return max(0.0, min(100.0, v))


def main() -> None:
    p = argparse.ArgumentParser(description="Simple desktop pet stat simulation")
    p.add_argument("--minutes", type=int, default=240)
    p.add_argument("--tick", type=int, default=5)
    p.add_argument("--hunger-decay", type=float, default=0.8)
    p.add_argument("--happy-decay", type=float, default=0.5)
    p.add_argument("--clean-decay", type=float, default=0.6)
    p.add_argument("--health-penalty", type=float, default=0.7)
    p.add_argument("--danger-threshold", type=float, default=20.0)
    args = p.parse_args()

    hunger = happiness = cleanliness = health = 100.0
    steps = max(1, args.minutes // args.tick)

    for _ in range(steps):
        hunger = clamp(hunger - args.hunger_decay)
        happiness = clamp(happiness - args.happy_decay)
        cleanliness = clamp(cleanliness - args.clean_decay)
        if hunger <= args.danger_threshold or cleanliness <= args.danger_threshold:
            health = clamp(health - args.health_penalty)

    print(f"minutes={args.minutes}, tick={args.tick}")
    print(f"hunger={hunger:.1f}")
    print(f"happiness={happiness:.1f}")
    print(f"cleanliness={cleanliness:.1f}")
    print(f"health={health:.1f}")


if __name__ == "__main__":
    main()
