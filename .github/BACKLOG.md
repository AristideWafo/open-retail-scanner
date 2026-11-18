# Backlog publishing

The backlog is encoded in [`scripts/publish-backlog.mjs`](../scripts/publish-backlog.mjs) and published as an idempotent upsert.

Each issue has a stable `key`, and its body ends with `<!-- orc-key: KEY -->`. The script finds existing issues by that marker (falling back to an exact legacy title for issues created before markers existed) and then creates or edits title, body, labels, and milestone. Re-running with no changes does nothing. Milestones are created or renamed/updated in place. Issues that no longer have a successor are closed with a comment, never deleted.

```bash
# preview planned actions; no GitHub writes
bun scripts/publish-backlog.mjs --dry-run AristideWafo/open-retail-scanner
# apply
bun scripts/publish-backlog.mjs AristideWafo/open-retail-scanner
```

`node` works too (no dependencies beyond the `gh` CLI). Edit the issue definitions in the script, not in the GitHub UI, or the next run will overwrite the changes.
