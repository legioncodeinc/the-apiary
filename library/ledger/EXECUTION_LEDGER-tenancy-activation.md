
## W3 SHIPPED + RELEASED (2026-07-04 20:30)

- Both PRs merged (honeycomb#232, hive#13; CI green on the merits per the ci-watcher; the lone honeycomb Aikido red is the re-keyed false-positive tracked as honeycomb#231, CodeQL + audit:sql clean).
- Fleet release 0.5.0 cut: honeycomb 0.4.0 + hive 0.5.0 published to npm; doctor 0.3.0 + nectar 0.2.0 unchanged. Superproject manifest 0.5.0, PR#10 merged, tag v0.5.0 pushed; Manifest Validate + Release Train + install-site deploy all SUCCESS. get.theapiary.sh now serves the tenancy-activation fleet.

## W4 DOGFOOD (staged, user-gated, in progress)

- Backups: ~/.dogfood-backup-20260704-202824-.deeplake and -.honeycomb (recoverable). .apiary/.nectar were absent.
- Fleet task HivenectarDaemon stopped + disabled.
- apiary_ci baseline for the zero-writes-before-bind proof: hive_graph=13, hive_graph_versions=17.
- PAUSED before the irreversible wipe+install, awaiting the user's go + the apiary-ci browser device login. Protocol: wipe the 4 dirs -> get.theapiary.sh -> device approve -> verify the tenancy step BLOCKS the dashboard + lists orgs/workspaces -> pick apiary-ci/apiary_ci -> verify counts still 13/17 (no write before bind) + header shows tenancy + honeycomb dormant until a folder is bound -> bind -> verify writes land only in apiary_ci -> restore backup or keep the fresh apiary-ci login.
