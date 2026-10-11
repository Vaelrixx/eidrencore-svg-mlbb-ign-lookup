# Supabase migrations

Keep each migration filename's numeric version aligned with the corresponding version in the linked database's `supabase_migrations.schema_migrations` history. Supabase compares migration timestamps, not the descriptive name.

Before changing production schema, inspect local and remote state:

```sh
supabase migration list
```

## Production signup-provisioning migration history

The checked-in `20261011160000_signup_provisioning.sql` is already reflected in the production schema, but its version was absent from the remote migration history when audited on 2026-10-12. The live trigger and function were verified, and the three existing auth users all had subscription rows.

After linking the CLI to the correct production project, mark this version applied **only if those schema checks remain true**:

```sh
supabase migration repair --linked --status applied 20261011160000
supabase migration list
```

Supabase's `migration repair` command updates migration tracking only; it does not execute the migration SQL. Do not use it unless the schema effects are already present. See the [Supabase migration sync guide](https://supabase.com/docs/guides/deployment/database-migrations).

For future changes, create a new migration with the Supabase CLI and deploy schema changes through the normal reviewed migration workflow.
