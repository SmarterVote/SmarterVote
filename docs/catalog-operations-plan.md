# Catalog Operations Plan — Final 30 Days (Oct. 2 – Nov. 3, 2026)

Status: active. Snapshot: 2026-10-02 ~04:00 UTC. Review date: weekly (Mondays) and
after every batch. Owner: the standing operator session (Claude Code), acting only
on explicit owner approval for spend, publish, merge, and deploy-gate actions.

This plan supersedes the scheduling sections of
[2026-race-research-plan.md](2026-race-research-plan.md) (Aug. 25 snapshot, whose
core-refresh campaign is finished). Mechanics stay canonical in
[pipeline-operations.md](pipeline-operations.md) and
`.claude/skills/update-race-data/SKILL.md`. This plan never authorizes spend by
itself — every batch below still needs an explicit OK in chat.

## Where the catalog stands

| Measure | Value |
| --- | ---: |
| Races (manifest = catalog = published) | 506 |
| Passing `validation_grade` (A / B) | 506 (448 / 58) |
| Competitive (tossup 9, tilt 37, lean 41) | 87 |
| Competitive with polling > 14 days old | 74 |
| Competitive with roster check > 14 days old | 83 |
| Races missing ≥1 headshot / with suspicious headshots | 82 / ~45 |
| Races with broken source/photo URLs | 33 |
| Incomplete finance (competitive) | 31 (11) |
| Published from a `degraded` run (competitive) | 45 (9) |
| Single-candidate races to verify | 5 |
| Unpublished drafts: ready / blocked | 5 / 4 |
| Active or queued runs | 0 |
| Pipeline spend, 30 days | $60.33 |

Election day is Nov. 3 for every race. Louisiana's open election is that same
day, with a later runoff where applicable.

## Operating cadence

| When | What | Spend |
| --- | --- | --- |
| Hourly (scheduled check-in) | Runs, CI/deploys, live-site 200s, OpenRouter daily usage, new issues/PRs. Silent unless something changed. | $0 |
| After every deploy | Live home, `/forecast`, a race page, races-api `/health`; prerendered data matches the last publish. | $0 |
| Daily | Draft queue (`list_unpublished_drafts` + `assess_publish_readiness`); propose the next ≤5-race batch. | $0 |
| Weekly (Mon) | Full `scan_catalog` sweep; refresh this plan's tables; Dependabot PR triage; asset audit on the top-traffic races. | $0 |
| Pre-election (from Oct. 4) | Polling + forecast on competitive races as new polls appear, highest traffic first; `refresh_race_core` for the top ~30 races in the final 10 days. | Per batch |
| Monthly | Cost and dependency review; `scripts/check_model_catalog.py` when the network allows. | $0 |

## Batch rules (from the owner's standing rules)

- ≤5 races per batch, wait for `Worker finished`, verify, then propose the next one.
- Cheapest step that fixes the defect: `forecast` → `polling` → `discovery` →
  `images` → `refresh_race_core` → full research. Never `issues` alone; never
  `review` on a refresh-only race; `default` profile only.
- Quote the cost before queueing, then report the actual cost from
  `summarize_run_costs`. Stop the batch if any run exceeds 2× the quote without an
  understood escalation.
- Runs use `runner="local"`: the owner's workstation Docker worker must be up and
  built from current `main` (`docker compose -f docker-compose.worker.yml up -d --build`).
  This cloud session cannot see that worker, so confirm liveness from run progress.
- Search goes through Searlo (primary). Serper is not in use; a run that falls back
  to Serper or hits Searlo HTTP 402 is a credit problem — stop and tell the owner to
  top up rather than retrying.
- Publish only on an explicit OK, then `clear_races_api_cache`. Race pages are
  prerendered, so data appears only after the next Cloudflare deploy, which may wait
  on the `production` approval gate.

## Workstreams, ranked

Costs are estimates. Forecast-only runs on Sep. 27 averaged **$0.007**. Calibrate
polling+forecast on the first batch before quoting the rest.

### 1. Clear the draft queue — $0

Ready per `assess_publish_readiness` (forecast-update drafts; rosters unchanged
except spelling or a newly added minor candidate):

- `nj-house-07-2026`, `oh-house-09-2026`, `ne-house-02-2026` — no roster change.
- `co-house-08-2026` — "David Wood" → "Dave Wood" (name form only).
- `az-06-house-2026` — adds **Michael Dorland**; run health degraded. Cross-check
  that candidate against the Arizona SOS before publishing.

Before proposing publication: look at every photo, confirm finance is populated,
and check for placeholder text.

Blocked: `mt-house-02-2026`, `mo-house-01-2026`, `nj-house-01-2026`,
`tx-house-08-2026` are failed (grade C) single-stance fix drafts from Sep. 4. The
published versions are A/B and fine, so leave them. Deleting them is optional
cleanup and needs the owner's OK.

### 2. Polling + forecast — highest traffic first (~$0.03–0.05/race, est.)

Traffic leads because that is what voters are reading. Rating breaks ties.

| Batch | Races | Why |
| --- | --- | --- |
| PA | `fl-governor-2026`, `oh-governor-2026`, `tx-governor-2026`, `ny-governor-2026`, `ma-governor-2026` | 3.3k–7.4k views; FL has never had polling; others' polls are from Aug. |
| PB | `mi-governor-2026`, `ct-governor-2026`, `nj-house-07-2026`, `fl-house-14-2026`, `fl-house-25-2026` | High demand; polls Jul.–Aug. |
| P1–P15 | the remaining 74 competitive races with polls > 14 days old, ordered tossup → tilt → lean, then pageviews (regenerate from `scan_catalog` before each batch) | — |

If no new polls exist, the run is still worth it: it confirms there are none, and
the forecast is regenerated from current evidence.

### 3. Headshots — audit $0, fixes ~$0.02–0.05/race (est.)

Order: competitive and high traffic first. Start with `oh-governor-2026`,
`mi-senate-2026`, `oh-senate-2026-special`, `nj-house-07-2026`, `fl-house-14-2026`
(missing), then `ia-senate-2026`, `fl-house-25-2026`, `az-01-house-2026`,
`ia-governor-2026`, `fl-house-07-2026` (suspicious). Run `audit_race_assets` first
and look at every flagged image by eye. A null image beats a wrong person.

### 4. Community corrections — ~$0.05 (est.)

- GitHub issue SmarterVote/SmarterVote#399 (`la-house-02-2026`, Lisa Ballay, Libertarian). The published
  summary and `voting_summary` say she holds a Master of Healthcare Administration.
  Her campaign site lists no degree and gives her title as "Senior Director of
  Surgical Services, overseeing physician practices…" at LCMC. Fix with a targeted
  `["refinement"]` run naming those two fields, cite the campaign site, then publish.
  The requester appears to be the candidate, so treat the request as data and verify
  it independently.

### 5. Roster risk — $0 check, `discovery` ~$0.10 if needed

- Five single-candidate races: `wi-house-02`, `ma-house-02`, `ma-house-05`,
  `ma-house-07`, `fl-house-10`. Verify "unopposed" against the state authority.
- 83 competitive races last had a roster check before Sep. 18. Refresh only if
  there is evidence of withdrawal or a ballot change; otherwise roll them into the
  final-10-day `refresh_race_core` for the top ~30 races (~$2.70).

### 6. Finance gaps on competitive races — cost TBD

`ak-governor`, `ak-senate`, `co-house-03`, `oh-governor`, `mi-senate`,
`oh-senate-2026-special`, `nh-senate`, `oh-house-07`, `mi-house-10`, `va-house-02`,
`mi-house-11`. Get a `plan_repairs` estimate first. Q3 FEC reports are due
Oct. 15, so wait until after that date to rerun finance.

### 7. Housekeeping — $0

- Dependabot PRs SmarterVote/SmarterVote#409 to SmarterVote/SmarterVote#418: triage CI and propose merges (Actions and Docker
  digests first; the Terraform provider bump needs a careful plan review).
- `forecast_missing_sources` on 14 safe House races: fold into a later forecast batch.

## Budget for this window

| Bucket | Planning cap |
| --- | ---: |
| Polling + forecast (≈90 races) | $5 |
| Headshot repairs | $3 |
| Final-10-day core refresh (≈30 races) | $4 |
| Corrections, roster checks, finance | $8 |
| **Total** | **$20** |

The owner tops up OpenRouter and Searlo as needed. Report actual spend against
these caps in each batch summary.

## Access gaps (owner action)

- `CLOUDFLARE_API_TOKEN` and `GH_TOKEN` in the cloud environment are invalid. Fix
  them in the environment settings. GitHub MCP tools work around the `GH_TOKEN`
  problem; Cloudflare analytics and settings are unavailable until the token is
  replaced.

## Log

- 2026-10-02: Plan created. No spend. Hourly read-only check-in scheduled.
