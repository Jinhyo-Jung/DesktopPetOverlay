# Save Schema

## Required Fields
1. `schemaVersion`
2. `stats.hunger`
3. `stats.happiness`
4. `stats.cleanliness`
5. `stats.health`
6. `stage`
7. `exp`
8. `lastSeenTimestamp`

## Migration Strategy
1. Read raw save file.
2. Detect schema version.
3. Apply stepwise migrations until latest version.
4. Fill defaults for missing fields.
5. Write in latest schema format.
