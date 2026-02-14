# Balance Model

## Core Variables
1. Hunger: 0..100
2. Happiness: 0..100
3. Cleanliness: 0..100
4. Health: 0..100

## Tick Rules
1. Every tick, reduce hunger/happiness/cleanliness by configured decay rates.
2. If hunger or cleanliness is below threshold, reduce health by penalty rate.
3. Clamp all stats between 0 and 100.

## Tuning Targets
1. New user should maintain healthy state for at least 1-2 hours with periodic actions.
2. Offline penalty should be capped with a maximum elapsed window.
3. Evolution pacing should not skip stages under normal play.
