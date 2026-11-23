-- EXAMPLE - removes the records an E2E run created, by their generated name.
-- Run: npm run sql:dry -- src/scripts/sql/example-cleanup.sql --param name="E2E Example_1700000000000"
DELETE FROM Orders
WHERE Name = @name;
