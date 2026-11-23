# SQL scripts

Scripts run against the database in `.env` (`DB_*`), either from the terminal:

```
npm run sql -- src/scripts/sql/example-cleanup.sql
npm run sql:dry -- src/scripts/sql/example-cleanup.sql
npm run sql -- --param name="E2E Order" src/scripts/sql/example-cleanup.sql
```

or from a test, through the `db` fixture in `src/fixtures/database.ts`.

Conventions:

- One job per file, named after what it does: `cleanup-orders.sql`, `reset-test-users.sql`.
- Always give UPDATE and DELETE a WHERE clause, and prefer a bound `@parameter` over a literal.
- Rehearse anything destructive with `npm run sql:dry` first. It runs the script inside a
  transaction, reports the row count, and rolls back.
- `GO` on its own line separates batches, exactly as in SSMS.
