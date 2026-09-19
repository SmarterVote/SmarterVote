---
name: update-race-data
description: Decide what race-data work the SmarterVote catalog needs and run it safely — reading catalog state without flooding context, picking the cheapest pipeline step that fixes the defect, queuing runs, verifying drafts, and publishing. Use whenever asked to refresh, update, repair, or research race data, or to spend a pipeline budget.
---

# Updating race data

Pipeline runs cost real money and publish to a live public site. The default is to
spend the **least** that fixes the defect, verify, then publish.

## 0. Preflight (always)

```bash
docker ps -a --format "{{.Names}}\t{{.Status}}"          # worker alive?
docker logs --tail 20 smartervote-pipeline-worker-1      # "Worker built from commit <sha>"
git log --oneline -1                                     # does that sha match HEAD?
```

The local Docker worker **does not auto-update**. If a fix to `pipeline_client/agent/`
or `pipeline_client/backend/` was merged after the worker's build commit, rebuild from a
clean checkout of the merged SHA before trusting any run:

```bash
docker compose -f docker-compose.worker.yml up -d --build
```

Budget, authoritative (includes in-flight runs that `summarize_run_costs` misses):

```bash
key=$(grep -h '^OPENROUTER_API_KEY=' .env | head -1 | cut -d= -f2- | tr -d '"'\''\r')
curl -s -H "Authorization: Bearer $key" https://openrouter.ai/api/v1/key
```

`usage_daily`/`usage_weekly` reset at 00:00 UTC (weekly Monday) — never compare a
cross-midnight session total against `usage_daily`.

## 1. Read catalog state without flooding context

Several MCP tools return megabytes and will blow the token limit. They still *save to a
file* — parse that file locally instead of reading it back.

| Want | Use | Note |
| ---- | --- | ---- |
| Ranked defect list | `scan_catalog` | Paged; `state`/`office`/`competitive_only` filters |
| Every race's `contest_stage`, roster, forecast | `list_admin_races` | ~7 MB — **always** parse the saved file with Python |
| Drafts awaiting review | `list_unpublished_drafts` | |
| Draft vs published rosters | `audit_draft_vs_published` | Takes `race_ids` (plural) |
| What a run is doing | `docker logs` | **Not** `get_queue`/`list_active_runs` — they echo full goal text |

There is no `jq` on this workstation. Use `python -c`.

## 2. Match the step to the defect

Cost scales with the step list, not with how little is broken.

| Defect | Steps | ~Cost/race |
| ------ | ----- | ---------- |
| State's primary has been held; roster lists losers | `["discovery","forecast"]`, `baseline_source="published"` | $0.10 |
| Roster wrong/contaminated, no primary involved | `refresh_race_core` | $0.09–0.12 |
| Forecast stale or pre-panel (no `method` field) | `["forecast"]` | cheap |
| Polls out of date | `["polling","forecast"]` | cheap |
| 1–2 bad stances or fields | `["refinement"]` + name the field | cheap |
| Genuinely no issue research | `["issues","finance","refinement","polling","forecast","voter_resources","review","iteration"]` | $0.44–0.85 |

Rules that keep costing money when ignored:

- **"Refresh" always means `refresh_race_core`** (discovery/images/polling/forecast/voter_resources). It never means issues or a full run.
- **Never queue `steps=["issues"]` alone** — unreviewed stances never publish. Combine with `review`/`iteration` in one run.
- **Never run `review` on a refresh-only race** — it costs $0.24–0.53 and an ungraded race publishes while a C-graded one is blocked.
- **`force_fresh=true` wipes existing evidence** and can trip the "lacks qualifying evidence" safety check. For a targeted repair use `baseline_source="published"`.
- **`baseline_source="latest"` over a complete draft can silently no-op** and republish identical output.
- Verify the roster *before* buying issue research on it.
- Queue small batches (~5–8), verify, then continue. Never batch dozens autonomously.

## 3. Post-primary correction (the highest-value routine work)

A state that has voted leaves rosters affirmatively wrong, not merely thin. Check
catalog-wide for races still `contest_stage: pre_primary` whose state has voted.

**Louisiana is the exception** — it has no party primary; its jungle primary *is*
election day, so `pre_primary` is correct there and same-party multiples are normal.
Alaska's `top_four_rcv` is likewise not a defect.

Confirm results at the state's own election authority before queuing — a primary *date*
is not a results date, and close races get recounted (RI's 2026 GOP governor primary was
decided by 259 votes and confirmed six days later). Wikipedia "Declared" means announced,
not on the ballot.

Then queue `["discovery","forecast"]` with `baseline_source="published"` and this goal —
the description clause is what makes the result publishable:

> This state's primary has been held and the results are final. Verify the exact-contest
> GENERAL ELECTION roster from current-cycle official results and set `contest_stage` to
> `post_primary_general`. Every candidate you remove must be added to
> `known_ineligible_or_not_running` with a sourced reason naming the primary result that
> eliminated them. **Rewrite the race `description` so that it does not describe any
> removed candidate as running** — naming them as defeated primary candidates, with vote
> shares, is correct; describing them as candidates in the general election is not. The
> `description`, the roster, and `roster_sources[].evidence` must all agree. Retain every
> candidate who advanced, preserving their existing issue research. Then regenerate the
> evidence-backed forecast for the settled general-election field.

Stale prose naming a removed candidate makes reviewers flag a contradiction that **no
later run can fix** — that is how one race became permanently unpublishable.

## 4. Verify before publishing

Never pull a draft before the worker logs `Worker finished` for it — drafts are written
per-step and a partial read looks complete.

1. `docker logs` → confirm `Worker finished <run> (race <id>)`, and check the
   **`Run health verdict`** line. A run can log `status: completed` while health is
   `degraded`.
2. `get_race_data(draft=true)` → check `validation_grade.passed` is **true**, not merely
   that a grade exists.
3. `audit_draft_vs_published` → diff rosters. A shrink is often correct post-primary, but
   confirm each removal against the primary result. Review/iteration can also drop
   candidates with no discovery step.
4. Spot-check for literal placeholder text (a stance that is just `"DRAFT"`), and confirm
   `finance` populated `donor_summary`/`voting_summary` — that step fails silently.
5. **Look at every candidate photo.** Roughly 1 in 3 refreshes has stored a wrong-person
   or non-portrait image that passed every automated check. Read the candidate's own
   summary first — it often explains an image that looks wrong. Ballotpedia's votebox
   sometimes serves the wrong person under correct alt text; check the filename.
6. Cross-check any added candidate against an independent source. Drafts do invent
   plausible-looking candidates and forecast lineage URLs.

Then `assess_publish_readiness` → `publish_race` → `clear_races_api_cache`.

Race pages are prerendered (`VITE_PRERENDER_RACES: "true"`), so published data does not
appear publicly until a Cloudflare Pages deploy runs. That deploy may sit waiting on a
manual approval of the `production` GitHub environment — check
`gh api repos/SmarterVote/SmarterVote/actions/runs/<id>/pending_deployments` rather than
assuming it is still running.

## 5. Signals worth acting on

- **>1 incumbent in a race**, or a forecast party that disagrees with the roster → merged
  or wrong-contest roster. Free to detect, always a real defect.
- **A single-candidate race** → sometimes genuine (unopposed), sometimes truncation.
  Verify against the state authority.
- **Runs finishing far too fast** → OpenRouter credit exhaustion burning the queue, not
  success. Check the balance immediately.
- **Frozen `progress_updated_at`** → the workstation slept. Confirm liveness with
  `docker logs`, never with elapsed wall time.
- **Missing issue stances are not a defect.** Empty stances are legitimate. Trigger issue
  research on traffic and competitiveness, never on `missing_issue_count`.
- **A missing incumbent is not a defect** — many 2026 seats are open.
