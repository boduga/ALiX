---
name: migrate
description: Safe migrations for schema changes, dependency upgrades, and config migrations using dual-write pattern.
trigger: /migrate
pattern: "migrate|migration|upgrade|schema|transition|dual.?write"
version: "1.0.0"
is_core: true
tags: [migrations, safety, reliability]
---

# Safe Migrations

## Core Principle

**Always maintain backward compatibility.** Old code must work during and after migration.

## Migration Patterns

### 1. Expand-Contract (Blue-Green)
1. **Expand** — Add new schema/behavior alongside old
2. **Migrate data** — Convert data to new format
3. **Contract** — Remove old schema/behavior

### 2. Dual-Write Pattern
Write to both old and new simultaneously:
- New data goes to new format
- Old code reads from old format
- Migration tool syncs existing data
- Old code eventually updated to read from new

### 3. Feature Flag
Use flags to gradually enable new behavior:
```typescript
const result = flag.enabled('new-feature')
  ? newImplementation(input)
  : oldImplementation(input);
```

## When to Use Each

| Pattern | Use When |
|---------|----------|
| Expand-Contract | Schema changes, API versioning |
| Dual-Write | Data migration with live users |
| Feature Flag | Behavioral changes, A/B testing |

## Safety Checklist

- [ ] Migration is reversible
- [ ] Old behavior still works during migration
- [ ] Data integrity maintained
- [ ] Tests cover both old and new paths
- [ ] Rollback plan documented