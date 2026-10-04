/**
 * TypeScript definitions for SmarterVote RaceJSON v0.3
 */

export type ConfidenceLevel = "high" | "medium" | "low" | "unknown";

export type ContestStage =
  | "pre_primary"
  | "post_primary_general"
  | "runoff"
  | "top_two"
  | "top_four_rcv"
  | "uncontested"
  | "special"
  | "unknown";

export type RosterSourceType =
  "official" | "ballotpedia" | "fec" | "news" | "campaign" | "other";

export type SourceType =
  | "website"
  | "finance"
  | "pdf"
  | "api"
  | "social_media"
  | "news"
  | "government"
  | "fresh_search";

export type CanonicalIssue =
  | "Healthcare"
  | "Economy"
  | "Climate/Energy"
  | "Abortion & Reproductive Health"
  | "Immigration"
  | "Firearms & Second Amendment"
  | "Foreign Policy"
  | "Civil Rights & Equality"
  | "Education"
  | "Tech & AI"
  | "Election Policy"
  | "Local Issues";

/**
 * All valid issue keys — includes current canonical names plus legacy names from
 * pre-rename published data. Used for the Candidate.issues record type.
 */
export type IssueKey =
  | CanonicalIssue
  | "Reproductive Rights"
  | "Guns & Safety"
  | "Social Justice"
  | "Election Reform";

export interface Source {
  url: string;
  type: SourceType;
  title?: string | null;
  description?: string | null;
  last_accessed: string;
  published_at?: string | null;
  checksum?: string | null;
  is_fresh: boolean;
  is_official_campaign?: boolean | null;
}

export interface IssueStance {
  issue?: IssueKey | null;
  stance: string;
  confidence: ConfidenceLevel;
  sources: Source[];
  research_audit?: IssueResearchAudit | null;
}

export interface CandidateLink {
  url: string;
  title: string;
  type:
    | "finance"
    | "ballotpedia"
    | "wiki"
    | "official"
    | "legislature"
    | "votesmart"
    | "govtrack"
    | "news"
    | "other";
}

export interface CandidateRosterSource {
  url?: string | null;
  type: RosterSourceType;
  title?: string | null;
  evidence?: string | null;
  last_accessed?: string | null;
  published_at?: string | null;
  race_id?: string | null;
  evidence_tier?: 1 | 2 | 3 | null;
  retrieval_status?: "content" | "snippet" | null;
}

export interface CareerEntry {
  title: string;
  organization?: string | null;
  start_year?: number | null;
  end_year?: number | null;
  description?: string | null;
  source?: Source | null;
}

export interface EducationEntry {
  institution: string;
  degree?: string | null;
  field?: string | null;
  year?: number | null;
  source?: Source | null;
}

export interface ReviewFlag {
  field: string;
  concern: string;
  suggestion?: string | null;
  severity: "info" | "warning" | "error";
  stale: boolean;
}

export interface AgentReview {
  model: string;
  reviewed_at: string;
  verdict: "approved" | "needs_revision" | "flagged";
  score?: number | null;
  flags: ReviewFlag[];
  summary: string;
  roster_fingerprint?: string | null;
  stale: boolean;
  stale_reason?: string | null;
}

export interface ValidationGrade {
  grade: "A" | "B" | "C" | "D" | "F";
  score: number;
  passed: boolean;
  summary: string;
  /** Reviews that judged the current roster (older grades omit this). */
  current_review_count?: number | null;
  /** Reviews that judged an earlier roster; ignored for the score. */
  stale_review_count?: number | null;
}

export type ForecastRating =
  | "safe_d"
  | "likely_d"
  | "lean_d"
  | "tilt_d"
  | "tossup"
  | "tilt_r"
  | "lean_r"
  | "likely_r"
  | "safe_r"
  | "other";

export interface ForecastEvidence {
  claim: string;
  source_url: string;
  kind: "polling" | "market" | "finance" | "race_context" | "other";
  inferred: boolean;
}

export interface ForecastPanelEstimate {
  model: string;
  party_probabilities: Record<string, number>;
  /** Only in races where every candidate shares one party. */
  candidate_probabilities?: Record<string, number> | null;
  margin_estimate?: number | null;
  confidence: ConfidenceLevel;
}

export interface RaceForecast {
  predicted_winner_name?: string | null;
  predicted_winner_party?: string | null;
  win_probability?: number | null;
  party_probabilities: Record<string, number>;
  margin_estimate?: number | null;
  rating: ForecastRating;
  confidence: ConfidenceLevel;
  rationale: string;
  takeaway?: string | null;
  key_reasons: string[];
  uncertainty?: string | null;
  based_on_poll_count: number;
  generated_at: string;
  model: string;
  source_urls: string[];
  evidence_lineage?: ForecastEvidence[] | null;
  market_signals: ForecastMarketSignal[];
  method?: string | null;
  panel?: ForecastPanelEstimate[] | null;
  panel_spread?: number | null;
}

/**
 * The forecast as published in race summaries (summaries.json and the races
 * API list endpoints): services/races-api/schemas.py RaceForecastSummary,
 * built by shared/race_catalog.py build_forecast_summary. Unlike RaceForecast,
 * every scalar may be null. The list fields are always present from the API but
 * the forecast page's compact payload (utils/publicRaceSummaries.ts) drops them.
 */
export interface RaceForecastSummary {
  predicted_winner_name?: string | null;
  predicted_winner_party?: string | null;
  win_probability?: number | null;
  party_probabilities: Record<string, number>;
  margin_estimate?: number | null;
  rating?: ForecastRating | null;
  confidence?: ConfidenceLevel | null;
  rationale?: string | null;
  takeaway?: string | null;
  key_reasons?: string[];
  uncertainty?: string | null;
  based_on_poll_count: number;
  generated_at?: string | null;
  model?: string | null;
  source_urls?: string[];
  market_signals?: ForecastMarketSignal[];
  method?: string | null;
  panel?: ForecastPanelEstimate[] | null;
  panel_spread?: number | null;
}

export interface ForecastMarketSignal {
  provider: "kalshi";
  market_ticker: string;
  event_ticker?: string | null;
  title: string;
  matched_to: string;
  matched_party?: string | null;
  implied_probability?: number | null;
  yes_bid?: number | null;
  yes_ask?: number | null;
  last_price?: number | null;
  volume?: number | null;
  liquidity?: number | null;
  as_of: string;
  url?: string | null;
  confidence: ConfidenceLevel;
}

export interface Candidate {
  name: string;
  party?: string | null;
  incumbent: boolean;
  roster_sources: CandidateRosterSource[];
  summary: string;
  summary_sources: Source[];
  image_url?: string | null;
  issues: Partial<Record<IssueKey, IssueStance>>;
  career_history: CareerEntry[];
  education: EducationEntry[];
  voting_summary?: string | null;
  voting_source_url?: string | null;
  voting_sources: Source[];
  donor_summary?: string | null;
  donor_source_url?: string | null;
  donor_sources: Source[];
  links: CandidateLink[];
  website?: string | null;
  social_media: Record<string, string>;
  withdrawn: boolean;
  withdrawal_reason?: string | null;
}

export interface PollMatchup {
  candidates: string[];
  percentages: number[];
}

export interface PollEntry {
  pollster: string;
  date?: string | null;
  sample_size?: number | null;
  matchups: PollMatchup[];
  source_url?: string | null;
}

export interface PipelineState {
  complete: boolean;
  remaining_candidates: string[];
  remaining_steps: string[];
  completed_units: string[];
  skipped_units: string[];
  issue_attempts: Record<string, number>;
  issue_research: Record<string, IssueResearchAudit>;
  step_failures: StepFailure[];
  deterministic_cleanup: Record<string, number>;
  unresolved_review_flags: string[];
  race_identity?: RaceIdentityBrief | null;
  roster_research?: RosterResearchAudit | null;
  metadata_research?: MetadataResearchAudit | null;
  removed_source_urls: RemovedSourceUrl[];
}

export interface RemovedSourceUrl {
  candidate_name: string;
  url: string;
}

export interface RosterResearchAudit {
  finalized_at: string;
  contest_stage: ContestStage;
  summary: string;
  active_candidate_count: number;
  candidate_names: string[];
  completeness_sources: CandidateRosterSource[];
  completeness_status?: "unproven" | null;
  completeness_note?: string | null;
  completeness_reference_urls: string[];
}

export interface MetadataResearchAudit {
  finalized_at: string;
  active_candidate_count: number;
  description_sources: Source[];
  candidate_sources: Record<string, Source[]>;
}

export interface IssueResearchAudit {
  status:
    | "completed"
    | "no_verdict"
    | "insufficient_research"
    | "retry_limit"
    | "blocked_policy";
  attempts: number;
  search_calls: number;
  page_fetches: number;
  source_count: number;
  token_budget_reached: boolean;
  max_iterations_reached: boolean;
}

export interface RaceIdentityBrief {
  office?: string | null;
  state?: string | null;
  district?: string | null;
  contest_stage: ContestStage;
  election_date?: string | null;
  primary_status?: string | null;
  official_roster_source_url?: string | null;
  known_incumbent?: string | null;
  known_ineligible_or_not_running: string[];
}

export interface RunAudit {
  contest_stage: ContestStage;
  roster_source_summary?: string | null;
  candidate_changes: string[];
  forecast_changes: string[];
  remaining_uncertainty: string[];
  publish_attention: string[];
}

export interface Race {
  schema_version: string;
  id: string;
  election_date: string;
  candidates: Candidate[];
  updated_utc: string;
  generator: string[];
  title?: string | null;
  office?: string | null;
  jurisdiction?: string | null; // Full geographic scope (e.g. "Missouri's 1st Congressional District")
  state?: string | null; // US state name for map highlighting; null for national races
  district?: string | null;
  description?: string | null;
  contest_stage: ContestStage;
  polling: PollEntry[];
  polling_note?: string | null;
  forecast?: RaceForecast | null;
  reviews: AgentReview[];
  validation_grade?: ValidationGrade | null;
  pipeline_state?: PipelineState | null;
  run_audit?: RunAudit | null;
  // agent_metrics is not part of the RaceJSON schema (shared/models.py) — it is
  // merged into API responses from Firestore pipeline-run cost data. See
  // services/races-api/gcs_helpers.py / routers/races_admin.py.
  agent_metrics?: AgentMetrics;
  ballotpedia_url?: string | null;
  register_to_vote_url?: string | null;
  how_to_vote_url?: string | null;
}

export const CANONICAL_ISSUES: CanonicalIssue[] = [
  "Healthcare",
  "Economy",
  "Climate/Energy",
  "Abortion & Reproductive Health",
  "Immigration",
  "Firearms & Second Amendment",
  "Foreign Policy",
  "Civil Rights & Equality",
  "Education",
  "Tech & AI",
  "Election Policy",
  "Local Issues",
];

/**
 * Maps legacy (biased) issue names to their current neutral display names.
 * Old published JSON data uses the legacy keys; the frontend resolves them here.
 */
export const LEGACY_ISSUE_NAMES: Partial<Record<string, CanonicalIssue>> = {
  "Reproductive Rights": "Abortion & Reproductive Health",
  "Guns & Safety": "Firearms & Second Amendment",
  "Social Justice": "Civil Rights & Equality",
  "Election Reform": "Election Policy",
};

/**
 * Tooltip note shown next to renamed issues so users understand why the name
 * changed and that existing data was researched under the old terminology.
 */
export const RENAMED_ISSUE_NOTES: Partial<Record<string, string>> = {
  "Reproductive Rights":
    'Data was researched using the term "Reproductive Rights" which has been renamed to "Abortion & Reproductive Health" in an effort to reduce bias. We are working to update all of our data as quickly as possible!',
  "Guns & Safety":
    'Data was researched using the term "Guns & Safety" which has been renamed to "Firearms & Second Amendment" in an effort to reduce bias. We are working to update all of our data as quickly as possible!',
  "Social Justice":
    'Data was researched using the term "Social Justice" which has been renamed to "Civil Rights & Equality" in an effort to reduce bias. We are working to update all of our data as quickly as possible!',
  "Election Reform":
    'Data was researched using the term "Election Reform" which has been renamed to "Election Policy" in an effort to reduce bias. We are working to update all of our data as quickly as possible!',
};

/** Returns the current neutral display name for an issue (resolves legacy names). */
export function getIssueDisplayName(issue: string): string {
  return (LEGACY_ISSUE_NAMES[issue] as string) ?? issue;
}

export interface CandidateSummary {
  name: string;
  party?: string | null;
  incumbent: boolean;
  image_url?: string | null;
}

export interface RaceSummary {
  id: string;
  title?: string | null;
  office?: string | null;
  jurisdiction?: string | null;
  state?: string | null;
  contest_stage?: ContestStage | null;
  election_date: string;
  updated_utc: string;
  candidates: CandidateSummary[];
  quality_grade?: "A" | "B" | "C" | "D" | "F";
  agent_metrics?: {
    estimated_usd?: number;
    model?: string;
    total_tokens?: number;
  } | null;
  forecast?: RaceForecastSummary | null;
}

// Pipeline run types
export type RunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "continued"
  | "skipped";

// Canonical pipeline step identifiers
export type PipelineStepId =
  | "discovery"
  | "images"
  | "issues"
  | "finance"
  | "refinement"
  | "polling"
  | "forecast"
  | "voter_resources"
  | "review"
  | "iteration";

export const PIPELINE_STEPS: {
  id: PipelineStepId;
  label: string;
  weight: number;
}[] = [
  { id: "discovery", label: "Discovery", weight: 12 },
  { id: "images", label: "Image Resolution", weight: 4 },
  { id: "issues", label: "Issue Research", weight: 28 },
  { id: "finance", label: "Finance & Voting", weight: 9 },
  { id: "refinement", label: "Refinement", weight: 11 },
  { id: "polling", label: "Polling", weight: 7 },
  { id: "forecast", label: "Forecast", weight: 4 },
  { id: "voter_resources", label: "Voter Resources", weight: 5 },
  { id: "review", label: "AI Review", weight: 12 },
  { id: "iteration", label: "Review Iteration", weight: 8 },
];

const UPDATE_OPT_IN_STEPS = new Set<PipelineStepId>([
  "issues",
  "review",
  "iteration",
]);
export const DEFAULT_UPDATE_PIPELINE_STEP_IDS: PipelineStepId[] =
  PIPELINE_STEPS.filter((step) => !UPDATE_OPT_IN_STEPS.has(step.id)).map(
    (step) => step.id,
  );

export interface RunOptions {
  save_artifact?: boolean | null;
  note?: string | null;
  goal?: string | null;
  cheap_mode?: boolean | null;
  model_profile?: "default" | "premium" | "custom" | null;
  model_overrides?: {
    primary?: string;
    small?: string;
    roster?: string;
    /** Looks at a resolved candidate photo before it is stored. */
    image_vision?: string;
    review_claude?: string;
    review_gemini?: string;
    review_grok?: string;
  } | null;
  force_fresh?: boolean | null;
  allow_fast_no_change?: boolean | null;
  // baseline_source/resume_partial/runner are power-user options (set via admin tooling/MCP,
  // not the standard queue form) but are still valid wire-level fields on
  // shared.pipeline_options.PipelineRunOptions — kept here for completeness.
  baseline_source?: "latest" | "published" | null;
  resume_partial?: boolean | null;
  runner?: "cloud_run" | "local" | null;
  research_model?: string | null;
  claude_model?: string | null;
  gemini_model?: string | null;
  grok_model?: string | null;
  review_providers?: ("claude" | "gemini" | "grok")[] | null;
  enabled_steps?: string[] | null;
  max_candidates?: number | null;
  target_no_info?: boolean | null;
  candidate_names?: string[] | null;
  debug_mode?: boolean | null;
}

// Structured failure taxonomy for pipeline runs (mirrors shared/run_health.py).
// A run's `status`/`pipeline_state.complete` only tells you it finished
// without raising; `run_health` is the separate "did it actually work" verdict.
export type RunFailureReason =
  | "provider_auth_failure"
  | "provider_rate_limit"
  | "provider_timeout"
  | "step_no_data"
  | "validation_failed"
  | "placeholder_content"
  | "roster_verification_failed"
  | "roster_completeness_unproven"
  | "forecast_text_unverified"
  | "budget_exhausted"
  | "stale_worker_version"
  | "cancelled"
  | "unknown_error";

export type RunHealthStatus = "healthy" | "degraded" | "failed" | "unknown";

export interface StepFailure {
  step: string;
  reason: RunFailureReason;
  detail?: string | null;
}

export interface RunHealthVerdict {
  status: RunHealthStatus;
  reasons: RunFailureReason[];
  step_failures: StepFailure[];
  summary?: string | null;
}

export interface RunStep {
  name: string;
  label?: string;
  status: RunStatus;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
  progress_pct?: number;
  weight?: number;
  artifact_id?: string;
  error?: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  estimated_usd?: number;
  failure_reasons?: RunFailureReason[];
}

export interface RunInfo {
  run_id: string;
  race_id?: string;
  status: RunStatus;
  progress?: number;
  progress_message?: string;
  current_step?: PipelineStepId | string | null;
  current_step_progress?: number;
  remaining_steps?: string[];
  payload?: Record<string, unknown>;
  options: RunOptions;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  artifact_id?: string;
  error?: string;
  steps?: RunStep[];
  logs?: LogEntry[];
  serper_calls?: number;
  searlo_calls?: number;
  search_calls?: number;
  run_health?: RunHealthVerdict;
}

export interface Artifact {
  id: string;
  path: string;
  size: number;
  modified: number;
}

export interface LogEntry {
  /** Firestore log document id; stable across polls, used to dedupe lines. */
  id?: string;
  timestamp: string;
  level: string;
  message: string;
  step?: string;
  run_id?: string;
  race_id?: string;
  duration_ms?: number;
  extra?: Record<string, unknown>;
}

export interface RunHistoryItem extends RunInfo {
  display_id: number;
  updated_at: string;
  last_step?: string;
}

// ---------------------------------------------------------------------------
// Analytics (admin dashboard)
// ---------------------------------------------------------------------------

export interface TimeseriesBucket {
  time: string; // HH:MM
  requests: number;
}

export interface AnalyticsOverview {
  total_requests: number;
  unique_visitors: number;
  avg_latency_ms: number;
  error_rate: number; // percentage 0-100
  error_count: number;
  timeseries: TimeseriesBucket[];
  hours: number;
}

export interface TrafficDimension {
  name: string;
  pageviews: number;
  visits: number;
}

export interface TrafficTimeseriesBucket {
  time: string;
  pageviews: number;
  visits: number;
}

export interface TrafficAnalytics {
  configured: boolean;
  provider: "cloudflare";
  hours: number;
  pageviews: number;
  visits: number;
  pages_per_visit: number;
  timeseries: TrafficTimeseriesBucket[];
  top_pages: TrafficDimension[];
  top_referrers: TrafficDimension[];
  countries: TrafficDimension[];
  devices: TrafficDimension[];
  fetched_at: string | null;
  error: string | null;
}

export interface RaceAnalytics {
  race_id: string;
  requests_24h: number;
  last_accessed?: string;
  updated_utc?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Pipeline cost metrics
// ---------------------------------------------------------------------------

export interface AgentMetrics {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_usd: number;
  cost_usd?: number | null;
  cost_source?: "provider" | "estimated";
  serper_calls?: number;
  searlo_calls?: number;
  search_calls?: number;
  model_breakdown: Record<
    string,
    { prompt_tokens: number; completion_tokens: number }
  >;
  duration_s: number;
}

export interface PipelineRunRecord {
  run_id: string;
  race_id: string;
  status: string;
  timestamp: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_usd: number;
  cost_usd?: number | null;
  cost_source?: "provider" | "estimated";
  serper_calls?: number;
  searlo_calls?: number;
  search_calls?: number;
  model_breakdown: Record<
    string,
    { prompt_tokens: number; completion_tokens: number }
  >;
  duration_s: number;
  candidate_count: number;
  cheap_mode: boolean;
  enabled_steps?: string[] | null;
  workflow?:
    "discovery" | "refresh_core" | "issues" | "targeted" | "full" | "unknown";
}

export interface PipelineMetricsSummary {
  total_runs: number;
  total_usd: number;
  avg_usd: number;
  recent_30d_usd: number;
  success_rate: number;
  cheap_runs: number;
  avg_cheap_usd: number;
  full_runs: number;
  avg_full_usd: number;
  avg_usd_per_candidate: number;
}

export interface GcpCostServiceLine {
  service: string;
  net_usd: number;
  gross_usd: number;
  credits_usd: number;
}

export interface GcpCostSummary {
  configured: boolean;
  reason?: string;
  detail?: string;
  days?: number;
  currency?: string;
  total_net_usd?: number;
  total_gross_usd?: number;
  total_credits_usd?: number;
  by_service?: GcpCostServiceLine[];
  table?: string;
  as_of?: string;
}

// ---------------------------------------------------------------------------
// 2026 research program status
// ---------------------------------------------------------------------------

export type ResearchResultState =
  "waiting" | "stabilizing" | "stable" | "runoff_pending" | "manual_review";

export interface ResearchManifestEntry {
  race_id: string;
  state: string;
  office: "us_house" | "us_senate" | "governor" | "state_supreme_court";
  event_type: string;
  primary_date?: string | null;
  runoff_date?: string | null;
  general_election_date: string;
  schedule_source_url: string;
}

export interface ResearchCheckpoint {
  race_id?: string;
  result_state: ResearchResultState;
  official_result_url?: string;
  first_checked_at?: string;
  second_checked_at?: string;
  advancing_names?: string[];
  event_type?: string;
  event_date?: string;
  operator: string;
  blocker?: string;
  result_fingerprint?: string | null;
  last_reviewed_discovery_fingerprint?: string;
  updated_at?: string;
}

export interface ResearchArtifactStatus {
  source: "published" | "draft";
  exists: boolean;
  updated_utc?: string | null;
  contest_stage: string;
  candidate_count?: number | null;
  quality_grade?: string | null;
  health?: { missing_issue_count?: number; [key: string]: unknown } | null;
}

export interface ResearchProgramRow {
  race_id: string;
  manifest: ResearchManifestEntry;
  checkpoint?: ResearchCheckpoint | null;
  catalog: {
    source: "catalog";
    status?: string | null;
    current_run_id?: string | null;
    last_run_status?: string | null;
  };
  published: ResearchArtifactStatus;
  draft: ResearchArtifactStatus;
  latest: ResearchArtifactStatus;
  latest_source: "published" | "draft";
  discovery_state: string;
  issue_state: string;
  cost: {
    run_count: number;
    total_usd: number;
    by_workflow: Record<string, number>;
    last_run_at?: string | null;
  };
}

export interface ResearchProgramStatus {
  rows: ResearchProgramRow[];
  summary: {
    coverage_count: number;
    catalog_present_count: number;
    checkpoint_count: number;
    orphaned_catalog_count: number;
    result_states: Record<string, number>;
    discovery_states: Record<string, number>;
    issue_states: Record<string, number>;
    workflow_spend_usd: Record<string, number>;
    total_pipeline_spend_usd: number;
  };
  orphaned_catalog_race_ids: string[];
  generated_at: string;
}

export interface ResearchCheckpointInput {
  result_state: ResearchResultState;
  operator: string;
  official_result_url?: string;
  first_checked_at?: string;
  second_checked_at?: string;
  advancing_names?: string[];
  event_type?: string;
  event_date?: string;
  blocker?: string;
  last_reviewed_discovery_fingerprint?: string;
}

// ---------------------------------------------------------------------------
// Unified Race Record (mirrors Python RaceRecord)
// ---------------------------------------------------------------------------

export type RaceStatusType =
  | "empty"
  | "queued"
  | "running"
  | "draft"
  | "published"
  | "failed"
  // Written by races-api when queued/running work is cancelled
  // (routers/queue.py, routers/races_admin/records.py).
  | "cancelled"
  // Written when a pending queue item is cancelled before it started.
  | "idle";

export interface RaceRecord {
  race_id: string;
  title?: string;
  office?: string;
  jurisdiction?: string;
  election_date?: string;

  status: RaceStatusType;
  published_at?: string;
  draft_updated_at?: string;
  draft_exists?: boolean;
  published_exists?: boolean;
  draft_quality_grade?: "A" | "B" | "C" | "D" | "F";
  published_quality_grade?: "A" | "B" | "C" | "D" | "F";
  draft_candidate_count?: number;
  published_candidate_count?: number;
  draft_updated_utc?: string;
  published_updated_utc?: string;
  draft_contest_stage?: string;
  published_contest_stage?: string;
  contest_stage?: string;
  catalog_view?: "draft" | "published";
  public_updated_utc?: string;
  has_unpublished_changes?: boolean;

  candidate_count: number;
  quality_grade?: "A" | "B" | "C" | "D" | "F";
  freshness?: string;

  queue_position?: number;
  queue_options?: Record<string, unknown>;
  last_run_options?: Record<string, unknown>;
  current_run_id?: string;
  last_run_id?: string;
  last_run_at?: string;
  last_run_status?: string;
  total_runs: number;

  requests_24h: number;
  last_accessed?: string;

  created_at: string;
  updated_at: string;
}

export interface ChamberForecastDetails {
  narrative: string;
  control_party: "Democratic" | "Republican" | "Other";
  control_probability: number;
  outcome_probabilities: Record<string, number>;
  projected_seats: Record<string, number>;
  expected_seats: Record<string, number>;
  threshold: number;
  total_seats: number;
  tossup_count: number;
  /** Seats with no forecast party and no holder evidence; left out of projected_seats. */
  uncounted_seats?: number;
  competitive_race_count?: number;
  competitive_races: string[];
  method: string;
  vp_tiebreak_party?: string;
  seat_distribution?: Record<string, number>;
  bottom_line?: string;
  why_party_favored?: string;
  opposing_party_path?: string;
  key_uncertainty?: string;
}

export interface ChamberForecasts {
  house: string;
  senate: string;
  governors: string;
  schema_version?: string;
  chambers?: Partial<
    Record<"house" | "senate" | "governors", ChamberForecastDetails>
  >;
  updated_at?: string;
}
