Database migrations for this project are no longer plain .sql files in
this folder. They're defined directly in code at:

    utils/migrate.js

Why: an earlier .sql-file approach used MySQL CLI "DELIMITER" blocks for
stored procedures, but the mysql2 Node driver doesn't understand
DELIMITER (it's a MySQL Workbench/CLI-only convenience, not real SQL) —
sending it through the driver silently failed with a syntax error, and
no tables/columns ever actually got created.

Migrations now run automatically every time the server starts
(see app.js), checking information_schema before each change so it's
always safe to re-run. You don't need to do anything manually — just
start the app normally with `node app.js` or `npm start`.
