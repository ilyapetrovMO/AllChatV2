# 21 — Back up, restore, and migrate an Instance

**What to build:** An operator can create and restore a coherent online snapshot of SQLite state and Attachments, and upgrades protect data with guarded forward-only migrations and pre-migration recovery points.

**Blocked by:** 11 — Upload and safely retrieve Attachments

**Status:** ready-for-agent

- [ ] An administrative command creates an online-consistent SQLite backup plus a defined snapshot of referenced Attachments.
- [ ] A restore command validates the backup and reconstructs a usable Instance with no missing or mismatched references.
- [ ] Backup taken during concurrent Message and Attachment activity represents a documented coherent boundary.
- [ ] Startup creates a pre-migration backup before applying any pending forward migration.
- [ ] Migrations are transactional where SQLite permits and startup refuses to continue after failure.
- [ ] Downgrade guidance and behavior require restoring the matching pre-upgrade backup rather than reverse migration.
- [ ] Black-box tests cover backup, mutation, restore, successful upgrade, forced migration failure, and recovery.
