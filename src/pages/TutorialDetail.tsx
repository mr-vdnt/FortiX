import React, { useCallback, useEffect, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Edit3,
  ExternalLink,
} from 'lucide-react';
import { fetchWithAuth, parseApiErrorResponse } from '../lib/api.js';
import type { LearningTutorialDetailDto, UserTutorialProgressDto } from '../learning/types.js';
import {
  formatDurationLabel,
  TutorialVideoPlayer,
} from '../components/learning/TutorialVideoPlayer.js';
import { AdminTutorialModal } from '../components/learning/AdminTutorialModal.js';

interface OutletContextType {
  currentUser?: {
    id: string;
    email: string;
    role: string;
  } | null;
}

export default function TutorialDetail() {
  const { tutorialSlug = '' } = useParams<{ tutorialSlug: string }>();
  const outlet = useOutletContext<OutletContextType>() || {};
  const isAdmin = outlet.currentUser?.role === 'ADMIN';

  const [tutorial, setTutorial] = useState<LearningTutorialDetailDto | null>(null);
  const [progress, setProgress] = useState<UserTutorialProgressDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [isMarkingComplete, setIsMarkingComplete] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);

  const loadTutorial = useCallback(async () => {
    if (!tutorialSlug) return;
    setIsLoading(true);
    setErrorMsg('');
    try {
      const res = await fetchWithAuth(`/api/learning/tutorials/${encodeURIComponent(tutorialSlug)}`);
      if (!res.ok) {
        const parsed = await parseApiErrorResponse(res, 'Unable to load requested tutorial.');
        setErrorMsg(parsed.message);
        setTutorial(null);
        return;
      }
      const data = (await res.json()) as LearningTutorialDetailDto;
      setTutorial(data);
      setProgress(data.progress);
    } catch {
      setErrorMsg('Network error loading tutorial details.');
    } finally {
      setIsLoading(false);
    }
  }, [tutorialSlug]);

  useEffect(() => {
    void loadTutorial();
  }, [loadTutorial]);

  const handleSaveProgress = useCallback(
    async (payload: { lastPositionSeconds: number; watchedSeconds: number }) => {
      if (!tutorial) return;
      try {
        const res = await fetchWithAuth(
          `/api/learning/progress/${encodeURIComponent(tutorial.id)}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.progress) {
            setProgress(data.progress);
          }
        }
      } catch {
        // Non-fatal transient network hiccup; next playback checkpoint or unmount retries
      }
    },
    [tutorial]
  );

  const handleMarkCompleted = async () => {
    if (!tutorial || isMarkingComplete) return;
    setIsMarkingComplete(true);
    try {
      const res = await fetchWithAuth(
        `/api/learning/progress/${encodeURIComponent(tutorial.id)}/complete`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      if (res.ok) {
        const data = await res.json();
        if (data?.progress) {
          setProgress(data.progress);
        }
      }
    } finally {
      setIsMarkingComplete(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-5xl mx-auto w-full space-y-6 pb-10 animate-pulse">
        <div className="h-4 w-48 rounded bg-hover" />
        <div className="h-8 w-2/3 rounded bg-hover" />
        <div className="aspect-video w-full rounded-xl bg-hover" />
      </div>
    );
  }

  if (errorMsg || !tutorial) {
    return (
      <div className="max-w-3xl mx-auto w-full py-12 space-y-4">
        <div
          role="alert"
          className="p-6 rounded-xl border border-subtle bg-surface space-y-3 text-center"
        >
          <AlertCircle size={24} className="mx-auto text-red-500" />
          <h1 className="text-lg font-bold text-strong">Tutorial Unavailable</h1>
          <p className="text-xs sm:text-sm text-muted">
            {errorMsg || 'The requested tutorial does not exist or is not published.'}
          </p>
          <div className="pt-2">
            <Link
              to="/learning-center"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover transition-colors"
            >
              <ArrowLeft size={14} />
              <span>Back to Learning Center</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isCompleted = Boolean(progress?.completed);
  const firstStep = tutorial.steps[0];

  return (
    <div className="max-w-5xl mx-auto w-full space-y-6 pb-12">
      {/* Breadcrumb & Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Link
            to="/learning-center"
            data-testid="back-to-learning-center"
            className="inline-flex items-center gap-1.5 font-medium text-muted hover:text-strong transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Learning Center</span>
          </Link>
          <span>/</span>
          <span>{tutorial.moduleName}</span>
        </div>

        <div className="flex items-center gap-2.5">
          {isAdmin && (
            <button
              type="button"
              onClick={() => setIsAdminModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface hover:bg-hover border border-subtle text-xs font-semibold text-strong transition-colors cursor-pointer"
            >
              <Edit3 size={13} />
              <span>Edit Tutorial</span>
            </button>
          )}

          {isCompleted ? (
            <span
              data-testid="tutorial-completed-indicator"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-semibold"
            >
              <CheckCircle2 size={14} />
              <span>Completed</span>
            </span>
          ) : (
            <button
              type="button"
              disabled={isMarkingComplete}
              onClick={handleMarkCompleted}
              data-testid="mark-tutorial-complete-btn"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-primary text-inverted text-xs font-semibold hover:bg-primary-hover disabled:opacity-50 transition-colors cursor-pointer"
            >
              <CheckCircle2 size={14} />
              <span>{isMarkingComplete ? 'Saving…' : 'Mark as Completed'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Title & Unboxed Metadata Header */}
      <header className="space-y-2">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-strong">
          {tutorial.title}
        </h1>
        <p className="text-xs sm:text-sm text-muted max-w-3xl leading-relaxed">
          {tutorial.description}
        </p>

        <div
          data-testid="tutorial-detail-metadata"
          className="pt-1 text-xs font-mono tabular-nums text-muted flex flex-wrap items-center gap-x-2 gap-y-1"
        >
          <span>{formatDurationLabel(tutorial.durationSeconds)}</span>
          <span>·</span>
          <span>{tutorial.difficulty}</span>
          <span>·</span>
          <span>{tutorial.category}</span>
          <span>·</span>
          <span>Stage: {tutorial.lifecycleStage}</span>
          {progress && !isCompleted && progress.percentWatched > 0 && (
            <>
              <span>·</span>
              <span className="text-primary font-semibold">
                {progress.percentWatched}% watched
              </span>
            </>
          )}
          {!tutorial.published && (
            <>
              <span>·</span>
              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                Draft (Unpublished)
              </span>
            </>
          )}
        </div>
      </header>

      {/* Video Player Section */}
      <section aria-label="Video Walkthrough" className="space-y-2">
        <TutorialVideoPlayer
          tutorialId={tutorial.id}
          tutorialTitle={tutorial.title}
          catalogDurationSeconds={tutorial.durationSeconds}
          video={tutorial.video}
          initialPositionSeconds={progress?.lastPositionSeconds ?? 0}
          initialMaxWatchedSeconds={progress?.maxWatchedSeconds ?? 0}
          isCompleted={isCompleted}
          firstActionPath={firstStep?.actionPath}
          firstActionLabel={firstStep?.actionLabel}
          onSaveProgress={handleSaveProgress}
        />

        {tutorial.video.playable && tutorial.video.sourceNote && (
          <div className="px-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
            <span>Video Walkthrough: {tutorial.video.sourceNote}</span>
            <span className="font-mono">
              Shortcuts: Space/K Play · J/L or Arrows ±5s · M Mute · C Captions · F Fullscreen
            </span>
          </div>
        )}
      </section>

      {/* Main Content Grid: Operational Steps vs Objectives & Context */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Left / Primary Column (2/3): Live FortiX Execution Steps & Warnings */}
        <div className="lg:col-span-2 space-y-6">
          <section
            aria-labelledby="operational-steps-heading"
            className="rounded-xl border border-subtle bg-surface overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-subtle flex items-center justify-between gap-2">
              <div>
                <h2 id="operational-steps-heading" className="text-sm font-bold text-strong">
                  Live FortiX Operational Steps
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  Execute each step directly inside your active FortiX workspace.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-muted">
                {tutorial.steps.length} steps
              </span>
            </div>

            <ol className="divide-y divide-[var(--border-subtle)]">
              {tutorial.steps.map((step) => (
                <li key={step.stepNumber} className="p-5 flex items-start gap-4">
                  <span className="w-6 h-6 rounded-md bg-elevated border border-subtle font-mono tabular-nums text-xs font-bold text-strong flex items-center justify-center shrink-0 mt-0.5">
                    {step.stepNumber}
                  </span>

                  <div className="min-w-0 flex-1 space-y-2">
                    <h3 className="text-sm font-semibold text-strong">{step.title}</h3>
                    <p className="text-xs sm:text-sm text-base-text leading-relaxed">
                      {step.instruction}
                    </p>
                    {step.actionPath && (
                      <div className="pt-1">
                        <Link
                          to={step.actionPath}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                        >
                          <span>{step.actionLabel || `Open ${step.actionPath}`}</span>
                          <ArrowUpRight size={13} />
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {tutorial.warnings.length > 0 && (
            <section
              aria-labelledby="warnings-heading"
              className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-3"
            >
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                <AlertTriangle size={16} className="shrink-0" />
                <h2 id="warnings-heading" className="text-xs font-bold">
                  Operational &amp; Safety Notes
                </h2>
              </div>
              <ul className="space-y-2 text-xs text-base-text">
                {tutorial.warnings.map((warn, idx) => (
                  <li key={idx} className="leading-relaxed">
                    • {warn}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Right / Secondary Column (1/3): Objectives, Prerequisites, Docs & Related */}
        <aside className="space-y-5">
          <section className="rounded-xl border border-subtle bg-surface p-5 space-y-3">
            <h2 className="text-xs font-bold text-strong">Learning Objectives</h2>
            <ul className="space-y-2 text-xs text-base-text">
              {tutorial.learningObjectives.map((obj, idx) => (
                <li key={idx} className="flex items-start gap-2 leading-relaxed">
                  <CheckCircle2 size={14} className="text-primary shrink-0 mt-0.5" />
                  <span>{obj}</span>
                </li>
              ))}
            </ul>
          </section>

          {tutorial.prerequisites.length > 0 && (
            <section className="rounded-xl border border-subtle bg-surface p-5 space-y-2.5">
              <h2 className="text-xs font-bold text-strong">Prerequisites</h2>
              <ul className="space-y-1.5 text-xs text-muted">
                {tutorial.prerequisites.map((pre, idx) => (
                  <li key={idx} className="leading-relaxed">
                    • {pre}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {tutorial.docLinks.length > 0 && (
            <section className="rounded-xl border border-subtle bg-surface p-5 space-y-2.5">
              <h2 className="text-xs font-bold text-strong">Relevant FortiX Screens &amp; Specs</h2>
              <div className="space-y-1.5">
                {tutorial.docLinks.map((doc, idx) =>
                  doc.kind === 'openapi' ? (
                    <a
                      key={idx}
                      href={doc.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-elevated hover:bg-hover border border-subtle text-xs font-medium text-strong transition-colors"
                    >
                      <span className="truncate">{doc.title}</span>
                      <ExternalLink size={13} className="text-muted shrink-0" />
                    </a>
                  ) : (
                    <Link
                      key={idx}
                      to={doc.href}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-elevated hover:bg-hover border border-subtle text-xs font-medium text-strong transition-colors"
                    >
                      <span className="truncate">{doc.title}</span>
                      <ArrowUpRight size={13} className="text-muted shrink-0" />
                    </Link>
                  )
                )}
              </div>
            </section>
          )}

          {tutorial.relatedTutorials.length > 0 && (
            <section className="rounded-xl border border-subtle bg-surface p-5 space-y-3">
              <h2 className="text-xs font-bold text-strong">Related Tutorials</h2>
              <div className="divide-y divide-[var(--border-subtle)] -mx-2">
                {tutorial.relatedTutorials.map((rel) => (
                  <Link
                    key={rel.id}
                    to={`/learning-center/${rel.slug}`}
                    className="block px-2 py-2.5 rounded-lg hover:bg-hover transition-colors space-y-0.5"
                  >
                    <div className="text-xs font-semibold text-strong line-clamp-1">
                      {rel.title}
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-muted">
                      {formatDurationLabel(rel.durationSeconds)} · {rel.difficulty}
                      {rel.completed ? ' · Completed' : ''}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </aside>
      </div>

      {/* Linear Curriculum Sequence Footer: Previous / Next */}
      <nav
        aria-label="Tutorial sequence navigation"
        className="pt-4 border-t border-subtle grid grid-cols-1 sm:grid-cols-2 gap-3"
      >
        {tutorial.previousTutorial ? (
          <Link
            to={`/learning-center/${tutorial.previousTutorial.slug}`}
            data-testid="prev-tutorial-link"
            className="p-4 rounded-xl border border-subtle bg-surface hover:bg-hover transition-colors flex items-center gap-3"
          >
            <ArrowLeft size={16} className="text-muted shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] text-muted">Previous Tutorial</div>
              <div className="text-xs sm:text-sm font-semibold text-strong truncate">
                {tutorial.previousTutorial.title}
              </div>
            </div>
          </Link>
        ) : (
          <div />
        )}

        {tutorial.nextTutorial && (
          <Link
            to={`/learning-center/${tutorial.nextTutorial.slug}`}
            data-testid="next-tutorial-link"
            className="p-4 rounded-xl border border-subtle bg-surface hover:bg-hover transition-colors flex items-center justify-between gap-3 sm:text-right"
          >
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-muted">Next Tutorial</div>
              <div className="text-xs sm:text-sm font-semibold text-strong truncate">
                {tutorial.nextTutorial.title}
              </div>
            </div>
            <ArrowRight size={16} className="text-primary shrink-0" />
          </Link>
        )}
      </nav>

      {isAdmin && (
        <AdminTutorialModal
          isOpen={isAdminModalOpen}
          editingTutorial={tutorial}
          onClose={() => setIsAdminModalOpen(false)}
          onSaved={async () => {
            await loadTutorial();
          }}
        />
      )}
    </div>
  );
}
