import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Edit3,
  FileText,
  Play,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { fetchWithAuth, parseApiErrorResponse } from '../lib/api.js';
import {
  LEARNING_DIFFICULTIES,
  LEARNING_LIFECYCLE_STAGES,
  type LearningCategoryStatusDto,
  type LearningTutorialSummaryDto,
} from '../learning/types.js';
import { formatDurationLabel } from '../components/learning/TutorialVideoPlayer.js';
import { AdminTutorialModal } from '../components/learning/AdminTutorialModal.js';

interface OutletContextType {
  currentUser?: {
    id: string;
    email: string;
    role: string;
  } | null;
}

interface ProgressOverviewResponse {
  summary: {
    totalTutorials: number;
    completedCount: number;
    inProgressCount: number;
    overallCompletionPercent: number;
  };
  continueWatching: LearningTutorialSummaryDto[];
  recentlyWatched: LearningTutorialSummaryDto[];
  recommendedNext: LearningTutorialSummaryDto | null;
}

function getTutorialStatusText(tutorial: LearningTutorialSummaryDto): {
  label: string;
  toneClass: string;
} {
  if (tutorial.progress?.completed) {
    return { label: 'Completed', toneClass: 'text-emerald-700 dark:text-emerald-400 font-semibold' };
  }
  if (
    tutorial.progress &&
    (tutorial.progress.lastPositionSeconds > 0 || tutorial.progress.percentWatched > 0)
  ) {
    return {
      label: `${tutorial.progress.percentWatched}% watched · Resume at ${formatDurationLabel(tutorial.progress.lastPositionSeconds)}`,
      toneClass: 'text-primary font-semibold',
    };
  }
  if (tutorial.video.playable) {
    return { label: 'Video + Written Guide', toneClass: 'text-strong font-medium' };
  }
  return { label: 'Written Guide · Video pending', toneClass: 'text-muted' };
}

export default function LearningCenter() {
  const outlet = useOutletContext<OutletContextType>() || {};
  const isAdmin = outlet.currentUser?.role === 'ADMIN';
  const [searchParams, setSearchParams] = useSearchParams();

  const [tutorials, setTutorials] = useState<LearningTutorialSummaryDto[]>([]);
  const [categories, setCategories] = useState<LearningCategoryStatusDto[]>([]);
  const [progressOverview, setProgressOverview] = useState<ProgressOverviewResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  // Search & Filter state synced cleanly with URL params when navigated
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedCategory, setSelectedCategory] = useState<string>(
    searchParams.get('category') || 'all'
  );
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>(
    searchParams.get('difficulty') || 'all'
  );
  const [selectedStage, setSelectedStage] = useState<string>(
    searchParams.get('stage') || 'all'
  );
  const [selectedStatus, setSelectedStatus] = useState<string>(
    searchParams.get('status') || 'all'
  );
  const [includeUnpublished, setIncludeUnpublished] = useState<boolean>(false);

  // Admin modal state
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [editingTutorial, setEditingTutorial] = useState<LearningTutorialSummaryDto | null>(null);

  const loadLearningCenter = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg('');
    try {
      const tutQuery = includeUnpublished && isAdmin ? '?includeUnpublished=true' : '';
      const [tutRes, catRes, progRes] = await Promise.all([
        fetchWithAuth(`/api/learning/tutorials${tutQuery}`),
        fetchWithAuth('/api/learning/categories'),
        fetchWithAuth('/api/learning/progress'),
      ]);

      if (!tutRes.ok) {
        const parsed = await parseApiErrorResponse(tutRes, 'Unable to load tutorials catalog.');
        setErrorMsg(parsed.message);
        return;
      }

      const tutData = await tutRes.json();
      setTutorials(Array.isArray(tutData?.tutorials) ? tutData.tutorials : []);

      if (catRes.ok) {
        const catData = await catRes.json();
        setCategories(Array.isArray(catData?.categories) ? catData.categories : []);
      }
      if (progRes.ok) {
        const progData = await progRes.json();
        setProgressOverview(progData);
      }
    } catch {
      setErrorMsg('Network error loading FortiX Learning Center. Check connection and retry.');
    } finally {
      setIsLoading(false);
    }
  }, [includeUnpublished, isAdmin]);

  useEffect(() => {
    void loadLearningCenter();
  }, [loadLearningCenter]);

  const syncFilterParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') {
      next.delete(key);
    } else {
      next.set(key, value);
    }
    setSearchParams(next, { replace: true });
  };

  const hasActiveFilter =
    Boolean(searchQuery.trim()) ||
    selectedCategory !== 'all' ||
    selectedDifficulty !== 'all' ||
    selectedStage !== 'all' ||
    selectedStatus !== 'all';

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedDifficulty('all');
    setSelectedStage('all');
    setSelectedStatus('all');
    setSearchParams({}, { replace: true });
  };

  const filteredTutorials = useMemo(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    const tokens = trimmed ? trimmed.split(/\s+/).filter(Boolean) : [];

    return tutorials.filter((item) => {
      if (selectedCategory !== 'all' && item.category !== selectedCategory) return false;
      if (selectedDifficulty !== 'all' && item.difficulty !== selectedDifficulty) return false;
      if (selectedStage !== 'all' && item.lifecycleStage !== selectedStage) return false;
      if (selectedStatus === 'recorded' && !item.video.playable) return false;
      if (selectedStatus === 'completed' && !item.progress?.completed) return false;
      if (
        selectedStatus === 'in_progress' &&
        (!item.progress ||
          item.progress.completed ||
          (item.progress.lastPositionSeconds === 0 && item.progress.maxWatchedSeconds === 0))
      ) {
        return false;
      }

      if (tokens.length > 0) {
        const hay = `${item.title} ${item.description} ${item.category} ${item.moduleName} ${item.difficulty} ${item.lifecycleStage}`.toLowerCase();
        if (!tokens.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
  }, [
    tutorials,
    searchQuery,
    selectedCategory,
    selectedDifficulty,
    selectedStage,
    selectedStatus,
  ]);

  const featuredWalkthroughs = useMemo(
    () => tutorials.filter((t) => t.featured && t.published),
    [tutorials]
  );

  const groupedByModule = useMemo(() => {
    const map = new Map<string, LearningTutorialSummaryDto[]>();
    for (const item of filteredTutorials) {
      const existing = map.get(item.moduleName) || [];
      existing.push(item);
      map.set(item.moduleName, existing);
    }
    return Array.from(map.entries());
  }, [filteredTutorials]);

  const selectedCategoryInfo = useMemo(
    () => categories.find((c) => c.name === selectedCategory) || null,
    [categories, selectedCategory]
  );

  const totalCount = progressOverview?.summary.totalTutorials ?? tutorials.filter((t) => t.published).length;
  const completedCount = progressOverview?.summary.completedCount ?? 0;
  const inProgressCount = progressOverview?.summary.inProgressCount ?? 0;
  const completionPct = progressOverview?.summary.overallCompletionPercent ?? 0;
  const recordedCount = useMemo(
    () => tutorials.filter((t) => t.published && t.video.playable).length,
    [tutorials]
  );

  return (
    <div className="max-w-6xl mx-auto w-full space-y-6 pb-10">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-strong">
            Learn FortiX
          </h1>
          <p className="text-xs sm:text-sm text-muted mt-1 max-w-2xl">
            Master API security and resilience, one workflow at a time. Follow guided walkthroughs across{' '}
            <span className="font-mono font-semibold text-strong">
              PROTECT → BREAK → OBSERVE → PROVE → IMPROVE
            </span>
            .
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => void loadLearningCenter()}
            title="Refresh catalog and progress"
            aria-label="Refresh Learning Center"
            className="p-2 rounded-lg bg-surface hover:bg-hover border border-subtle text-muted hover:text-strong transition-colors cursor-pointer"
          >
            <RefreshCw size={15} />
          </button>

          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                setEditingTutorial(null);
                setIsAdminModalOpen(true);
              }}
              data-testid="admin-new-tutorial-btn"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors whitespace-nowrap cursor-pointer"
            >
              <Plus size={14} />
              <span>Add Tutorial</span>
            </button>
          )}
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-between gap-3 text-xs text-red-600 dark:text-red-300"
        >
          <div className="flex items-center gap-2">
            <AlertCircle size={15} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => void loadLearningCenter()}
            className="px-3 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 font-semibold whitespace-nowrap"
          >
            Retry
          </button>
        </div>
      )}

      {/* Single-Elevation Progress & Curriculum Summary Bar */}
      <div
        data-testid="learning-summary-strip"
        className="rounded-xl border border-subtle bg-surface grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-[var(--border-subtle)] overflow-hidden"
      >
        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-muted">Curriculum Completion</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span
              data-testid="summary-completion-pct"
              className="text-2xl font-bold font-mono tabular-nums text-strong"
            >
              {completionPct}%
            </span>
            <span className="text-xs text-muted font-mono tabular-nums">
              {completedCount} / {totalCount} completed
            </span>
          </div>
          <div className="mt-2.5 h-1.5 w-full rounded-full bg-hover overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${Math.min(100, Math.max(0, completionPct))}%` }}
            />
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-muted">In Progress</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-strong">
              {inProgressCount}
            </span>
            <span className="text-xs text-muted">saved playback sessions</span>
          </div>
          <div className="mt-2 text-xs text-muted">
            Automatic resume across browser sessions
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="text-xs font-medium text-muted">Recorded Video Walkthroughs</div>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold font-mono tabular-nums text-primary">
              {recordedCount}
            </span>
            <span className="text-xs text-muted font-mono tabular-nums">
              of {totalCount} modules
            </span>
          </div>
          <div className="mt-2 text-xs text-muted">
            Self-hosted WebM with WebVTT captions
          </div>
        </div>

        <div className="p-4 sm:p-5 flex flex-col justify-between">
          <div className="text-xs font-medium text-muted">Recommended Next Step</div>
          {progressOverview?.recommendedNext ? (
            <div className="mt-1.5">
              <Link
                to={`/learning-center/${progressOverview.recommendedNext.slug}`}
                data-testid="recommended-next-link"
                className="text-xs sm:text-sm font-semibold text-strong hover:text-primary transition-colors line-clamp-1 flex items-center gap-1"
              >
                <span className="truncate">{progressOverview.recommendedNext.title}</span>
                <ArrowRight size={13} className="shrink-0 text-primary" />
              </Link>
              <div className="mt-1 text-[11px] text-muted font-mono tabular-nums">
                {formatDurationLabel(progressOverview.recommendedNext.durationSeconds)} ·{' '}
                {progressOverview.recommendedNext.difficulty}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
              All published tutorials completed
            </div>
          )}
        </div>
      </div>

      {/* Continue Watching / Recently Active Section (only when user has active progress and not filtering) */}
      {!hasActiveFilter &&
        progressOverview &&
        progressOverview.continueWatching.length > 0 && (
          <section aria-labelledby="continue-learning-heading" className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 id="continue-learning-heading" className="text-sm font-bold text-strong">
                Continue Learning
              </h2>
              <span className="text-xs text-muted">
                Pick up right where you paused
              </span>
            </div>

            <div className="rounded-xl border border-subtle bg-surface divide-y divide-[var(--border-subtle)]">
              {progressOverview.continueWatching.map((item) => (
                <div
                  key={item.id}
                  data-testid={`continue-watching-${item.slug}`}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-hover transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <Link
                      to={`/learning-center/${item.slug}`}
                      className="text-sm font-semibold text-strong hover:text-primary transition-colors block truncate"
                    >
                      {item.title}
                    </Link>
                    <div className="text-xs text-muted font-mono tabular-nums">
                      {formatDurationLabel(item.durationSeconds)} · {item.difficulty} ·{' '}
                      {item.category} · Resumes at{' '}
                      {formatDurationLabel(item.progress?.lastPositionSeconds || 0)} (
                      {item.progress?.percentWatched || 0}%)
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="w-24 h-1.5 rounded-full bg-hover overflow-hidden hidden md:block">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${item.progress?.percentWatched || 0}%` }}
                      />
                    </div>
                    <Link
                      to={`/learning-center/${item.slug}`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors whitespace-nowrap"
                    >
                      <Play size={12} className="fill-current" />
                      <span>Resume</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

      {/* Featured Core Workflows (shown when unfiltered) */}
      {!hasActiveFilter && featuredWalkthroughs.length > 0 && (
        <section aria-labelledby="featured-workflows-heading" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h2 id="featured-workflows-heading" className="text-sm font-bold text-strong">
                Essential First-Release Video Walkthroughs
              </h2>
              <p className="text-xs text-muted">
                Five end-to-end FortiX workflows with embedded WebM UI captures, WebVTT captions, and step-by-step execution links.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {featuredWalkthroughs.map((item, idx) => {
              const status = getTutorialStatusText(item);
              return (
                <Link
                  key={item.id}
                  to={`/learning-center/${item.slug}`}
                  data-testid={`featured-tutorial-${item.slug}`}
                  className="group rounded-xl border border-subtle bg-surface hover:border-strong transition-colors flex flex-col overflow-hidden"
                >
                  {/* Clean Schematic Preview Frame (zero broken images) */}
                  <div className="h-28 px-4 py-3 bg-elevated border-b border-subtle flex flex-col justify-between relative overflow-hidden">
                    <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-muted">
                      <span>
                        0{idx + 1} · {item.lifecycleStage}
                      </span>
                      <span>{formatDurationLabel(item.durationSeconds)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-strong truncate">
                        {item.category}
                      </span>
                      <span className="w-8 h-8 rounded-full bg-primary/15 text-primary group-hover:bg-primary group-hover:text-inverted flex items-center justify-center transition-colors shrink-0">
                        <Play size={14} className="ml-0.5 fill-current" />
                      </span>
                    </div>
                  </div>

                  <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                    <div className="space-y-1.5">
                      <h3 className="text-sm font-bold text-strong group-hover:text-primary transition-colors line-clamp-2">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>
                    </div>

                    <div className="pt-2 border-t border-subtle text-[11px] font-mono tabular-nums text-muted flex items-center justify-between gap-2">
                      <span>{item.difficulty}</span>
                      <span className={status.toneClass}>
                        {item.progress?.completed
                          ? 'Completed'
                          : item.progress && item.progress.percentWatched > 0
                            ? `${item.progress.percentWatched}% watched`
                            : 'Watch guide'}
                      </span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Search, Lifecycle Stage & Category Controls */}
      <section aria-label="Filter tutorials" className="rounded-xl border border-subtle bg-surface p-4 space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="relative flex-1">
            <Search
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                syncFilterParam('q', e.target.value);
              }}
              placeholder="Search tutorials by workflow, topic, or stage (e.g., API Studio, WAF, INCONCLUSIVE, rate limit)…"
              aria-label="Search tutorials"
              data-testid="learning-search-input"
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-base border border-subtle text-xs sm:text-sm text-strong focus:outline-none focus:border-primary"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  syncFilterParam('q', '');
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-strong"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filter by difficulty"
              data-testid="learning-difficulty-select"
              value={selectedDifficulty}
              onChange={(e) => {
                setSelectedDifficulty(e.target.value);
                syncFilterParam('difficulty', e.target.value);
              }}
              className="px-3 py-2 rounded-lg bg-base border border-subtle text-xs font-medium text-strong focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="all">All Difficulties</option>
              {LEARNING_DIFFICULTIES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by completion or video availability"
              data-testid="learning-status-select"
              value={selectedStatus}
              onChange={(e) => {
                setSelectedStatus(e.target.value);
                syncFilterParam('status', e.target.value);
              }}
              className="px-3 py-2 rounded-lg bg-base border border-subtle text-xs font-medium text-strong focus:outline-none focus:border-primary cursor-pointer"
            >
              <option value="all">All Formats &amp; States</option>
              <option value="recorded">With Recorded Video</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>

            {isAdmin && (
              <label className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-base border border-subtle text-xs text-strong cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeUnpublished}
                  onChange={(e) => setIncludeUnpublished(e.target.checked)}
                  className="rounded border-subtle"
                />
                <span>Show Drafts</span>
              </label>
            )}

            {hasActiveFilter && (
              <button
                type="button"
                onClick={resetAllFilters}
                data-testid="learning-reset-filters-btn"
                className="px-3 py-2 rounded-lg bg-hover hover:bg-hover-strong border border-subtle text-xs font-semibold text-strong transition-colors cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Lifecycle Path Filter Buttons */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-subtle">
          <span className="text-[11px] font-semibold text-muted mr-1.5">Lifecycle:</span>
          <button
            type="button"
            onClick={() => {
              setSelectedStage('all');
              syncFilterParam('stage', 'all');
            }}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              selectedStage === 'all'
                ? 'bg-primary text-inverted font-semibold'
                : 'text-muted hover:text-strong hover:bg-hover'
            }`}
          >
            All Stages
          </button>
          {LEARNING_LIFECYCLE_STAGES.map((stage) => (
            <button
              key={stage}
              type="button"
              onClick={() => {
                setSelectedStage(stage);
                syncFilterParam('stage', stage);
              }}
              data-testid={`lifecycle-filter-${stage}`}
              className={`px-2.5 py-1 rounded-lg text-xs font-mono transition-colors cursor-pointer ${
                selectedStage === stage
                  ? 'bg-primary text-inverted font-semibold'
                  : 'text-muted hover:text-strong hover:bg-hover'
              }`}
            >
              {stage}
            </button>
          ))}
        </div>

        {/* Category Filter Tabs */}
        {categories.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-subtle">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                syncFilterParam('category', 'all');
              }}
              data-testid="category-filter-all"
              className={`px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-strong text-base font-semibold bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                  : 'text-muted hover:text-strong hover:bg-hover'
              }`}
            >
              All Categories ({tutorials.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat.name}
                type="button"
                onClick={() => {
                  setSelectedCategory(cat.name);
                  syncFilterParam('category', cat.name);
                }}
                data-testid={`category-filter-${cat.name}`}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors cursor-pointer font-normal ${
                  selectedCategory === cat.name
                    ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 font-semibold'
                    : cat.comingSoon
                      ? 'text-muted/70 hover:text-muted hover:bg-hover'
                      : 'text-muted hover:text-strong hover:bg-hover'
                }`}
              >
                {cat.name}{' '}
                <span className="font-mono tabular-nums text-[11px]">
                  {cat.comingSoon ? '· Soon' : `(${cat.publishedCount})`}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Curriculum Modules List */}
      {isLoading ? (
        <div className="rounded-xl border border-subtle bg-surface divide-y divide-[var(--border-subtle)]">
          {[1, 2, 3, 4, 5].map((n) => (
            <div key={n} className="p-4 sm:p-5 space-y-2 animate-pulse">
              <div className="h-4 w-64 rounded bg-hover" />
              <div className="h-3 w-96 max-w-full rounded bg-hover" />
            </div>
          ))}
        </div>
      ) : selectedCategoryInfo?.comingSoon ? (
        <div className="rounded-xl border border-subtle bg-surface p-10 text-center space-y-3">
          <BookOpen size={24} className="mx-auto text-muted" />
          <h3 className="text-base font-semibold text-strong">
            {selectedCategoryInfo.name} tutorials are coming soon
          </h3>
          <p className="text-xs sm:text-sm text-muted max-w-md mx-auto">
            No published tutorials are currently assigned to this category yet. Browse all active FortiX modules or add one as an administrator.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="px-4 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors"
          >
            View All Tutorials
          </button>
        </div>
      ) : groupedByModule.length === 0 ? (
        <div
          data-testid="learning-empty-results"
          className="rounded-xl border border-subtle bg-surface p-10 text-center space-y-3"
        >
          <Search size={22} className="mx-auto text-muted" />
          <h3 className="text-base font-semibold text-strong">
            No tutorials match your current filters
          </h3>
          <p className="text-xs sm:text-sm text-muted max-w-md mx-auto">
            Try clearing your search query or switching back to All Categories and All Difficulties.
          </p>
          <button
            type="button"
            onClick={resetAllFilters}
            className="px-4 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {groupedByModule.map(([moduleTitle, items]) => (
            <section key={moduleTitle} className="space-y-2.5">
              <div className="flex items-baseline justify-between px-1">
                <h2 className="text-sm font-bold text-strong">{moduleTitle}</h2>
                <span className="text-xs text-muted font-mono tabular-nums">
                  {items.filter((i) => i.progress?.completed).length} / {items.length} completed
                </span>
              </div>

              <div className="rounded-xl border border-subtle bg-surface divide-y divide-[var(--border-subtle)] overflow-hidden">
                {items.map((item) => {
                  const status = getTutorialStatusText(item);
                  return (
                    <div
                      key={item.id}
                      data-testid={`catalog-row-${item.slug}`}
                      className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-hover/70 transition-colors"
                    >
                      <div className="flex items-start gap-3.5 min-w-0 flex-1">
                        <div
                          className={`mt-0.5 w-8 h-8 rounded-lg border border-subtle flex items-center justify-center shrink-0 ${
                            item.progress?.completed
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                              : item.video.playable
                                ? 'bg-primary/10 text-primary'
                                : 'bg-elevated text-muted'
                          }`}
                        >
                          {item.progress?.completed ? (
                            <CheckCircle2 size={16} />
                          ) : item.video.playable ? (
                            <Play size={14} className="ml-0.5 fill-current" />
                          ) : (
                            <FileText size={15} />
                          )}
                        </div>

                        <div className="min-w-0 space-y-1 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              to={`/learning-center/${item.slug}`}
                              className="text-sm font-semibold text-strong hover:text-primary transition-colors"
                            >
                              {item.title}
                            </Link>
                            {!item.published && (
                              <span className="text-[11px] font-mono font-semibold text-amber-600 dark:text-amber-400">
                                · Draft (Unpublished)
                              </span>
                            )}
                          </div>

                          <p className="text-xs text-muted line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>

                          {/* Unboxed inline metadata discipline */}
                          <div className="pt-0.5 text-[11px] font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                            <span>{formatDurationLabel(item.durationSeconds)}</span>
                            <span>·</span>
                            <span>{item.difficulty}</span>
                            <span>·</span>
                            <span>{item.category}</span>
                            <span>·</span>
                            <span>{item.lifecycleStage}</span>
                            <span>·</span>
                            <span className={status.toneClass}>{status.label}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 sm:pl-3">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTutorial(item);
                              setIsAdminModalOpen(true);
                            }}
                            aria-label={`Edit ${item.title}`}
                            data-testid={`admin-edit-${item.slug}`}
                            className="p-2 rounded-lg bg-elevated hover:bg-hover border border-subtle text-muted hover:text-strong transition-colors cursor-pointer"
                          >
                            <Edit3 size={14} />
                          </button>
                        )}

                        <Link
                          to={`/learning-center/${item.slug}`}
                          data-testid={`open-tutorial-${item.slug}`}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-elevated hover:bg-hover-strong border border-subtle text-xs font-semibold text-strong transition-colors whitespace-nowrap"
                        >
                          <span>
                            {item.progress &&
                            !item.progress.completed &&
                            item.progress.lastPositionSeconds > 0
                              ? 'Resume'
                              : item.progress?.completed
                                ? 'Review'
                                : 'Open Guide'}
                          </span>
                          <ArrowRight size={13} />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Recently Watched Footer Section */}
      {!hasActiveFilter &&
        progressOverview &&
        progressOverview.recentlyWatched.length > 0 && (
          <section className="pt-2 space-y-2.5">
            <h2 className="text-xs font-semibold text-muted px-1">Recently Viewed</h2>
            <div className="rounded-xl border border-subtle bg-surface divide-y divide-[var(--border-subtle)]">
              {progressOverview.recentlyWatched.slice(0, 4).map((item) => (
                <Link
                  key={item.id}
                  to={`/learning-center/${item.slug}`}
                  className="px-4 py-3 flex items-center justify-between gap-3 hover:bg-hover transition-colors text-xs"
                >
                  <span className="font-medium text-strong truncate">{item.title}</span>
                  <span className="font-mono tabular-nums text-muted shrink-0">
                    {item.progress?.completed
                      ? 'Completed'
                      : `${item.progress?.percentWatched || 0}% watched`}
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

      {isAdmin && (
        <AdminTutorialModal
          isOpen={isAdminModalOpen}
          editingTutorial={editingTutorial}
          onClose={() => setIsAdminModalOpen(false)}
          onSaved={async () => {
            await loadLearningCenter();
          }}
        />
      )}
    </div>
  );
}
