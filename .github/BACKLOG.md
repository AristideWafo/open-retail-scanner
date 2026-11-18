# Backlog publishing

The canonical initial backlog is encoded in [`scripts/publish-backlog.mjs`](../scripts/publish-backlog.mjs) so repository creation is reproducible and issue titles remain idempotent.

After GitHub authentication and repository creation:

```bash
node scripts/publish-backlog.mjs AristideWafo/safeeat-scanner-sdk
```

The script creates or updates project labels and creates missing issues without duplicating matching titles.
