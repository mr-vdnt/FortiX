export const ALLOWED_ANALYTICS_EVENTS = [
  'onboarding_step_viewed',
  'onboarding_completed',
  'demo_workspace_provisioned',
  'project_created',
  'route_registered',
  'api_key_issued',
  'security_policy_saved',
  'experiment_triggered',
  'verification_run_started',
  'report_exported',
  'account_email_verified',
] as const;

export type AllowedAnalyticsEvent = (typeof ALLOWED_ANALYTICS_EVENTS)[number];

const allowedSet = new Set<string>(ALLOWED_ANALYTICS_EVENTS);

interface AnalyticsBucket {
  count: number;
  lastRecordedAt: string;
  demoCount: number;
  standardCount: number;
}

const eventCounters = new Map<AllowedAnalyticsEvent, AnalyticsBucket>();
let totalEventsRecorded = 0;

export function isAllowedAnalyticsEvent(name: unknown): name is AllowedAnalyticsEvent {
  return typeof name === 'string' && allowedSet.has(name);
}

export function recordProductAnalyticsEvent(params: {
  event: string;
  workspaceMode?: 'demo' | 'standard';
  optOut?: boolean;
}): { recorded: boolean; reason?: string } {
  if (params.optOut || process.env.DISABLE_PRODUCT_ANALYTICS === 'true') {
    return { recorded: false, reason: 'opt_out' };
  }

  if (!isAllowedAnalyticsEvent(params.event)) {
    return { recorded: false, reason: 'disallowed_event_name' };
  }

  const nowIso = new Date().toISOString();
  const mode = params.workspaceMode === 'demo' ? 'demo' : 'standard';
  const existing = eventCounters.get(params.event);

  if (existing) {
    existing.count += 1;
    existing.lastRecordedAt = nowIso;
    if (mode === 'demo') existing.demoCount += 1;
    else existing.standardCount += 1;
  } else {
    eventCounters.set(params.event, {
      count: 1,
      lastRecordedAt: nowIso,
      demoCount: mode === 'demo' ? 1 : 0,
      standardCount: mode === 'standard' ? 1 : 0,
    });
  }

  totalEventsRecorded += 1;
  return { recorded: true };
}

export function getProductAnalyticsSummary() {
  const events: Record<string, AnalyticsBucket> = {};
  const counts: Record<string, number> = {};
  for (const name of ALLOWED_ANALYTICS_EVENTS) {
    const bucket = eventCounters.get(name);
    counts[name] = bucket ? bucket.count : 0;
    if (bucket) {
      events[name] = { ...bucket };
    }
  }
  return {
    privacyPolicy: 'first-party-aggregate-only-zero-pii',
    totalEvents: totalEventsRecorded,
    allowedEvents: [...ALLOWED_ANALYTICS_EVENTS],
    counts,
    events,
  };
}

export function resetAnalyticsForTests(): void {
  eventCounters.clear();
  totalEventsRecorded = 0;
}
