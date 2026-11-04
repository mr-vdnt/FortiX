import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Plus, Trash2, X } from 'lucide-react';
import { fetchWithAuth, parseApiErrorResponse } from '../../lib/api.js';
import {
  LEARNING_CATEGORIES,
  LEARNING_DIFFICULTIES,
  LEARNING_LIFECYCLE_STAGES,
  VIDEO_PROVIDERS,
  type LearningCategory,
  type LearningDifficulty,
  type LearningLifecycleStage,
  type LearningTutorialDetailDto,
  type LearningTutorialSummaryDto,
  type TutorialStep,
  type VideoProvider,
} from '../../learning/types.js';

interface AdminTutorialModalProps {
  isOpen: boolean;
  editingTutorial: LearningTutorialDetailDto | LearningTutorialSummaryDto | null;
  onClose: () => void;
  onSaved: (savedSlug: string) => Promise<void> | void;
}

export function AdminTutorialModal({
  isOpen,
  editingTutorial,
  onClose,
  onSaved,
}: AdminTutorialModalProps) {
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [moduleName, setModuleName] = useState('Module 1 — Getting Started');
  const [lifecycleStage, setLifecycleStage] = useState<LearningLifecycleStage>('PROTECT');
  const [category, setCategory] = useState<LearningCategory>('Getting Started');
  const [difficulty, setDifficulty] = useState<LearningDifficulty>('Beginner');
  const [videoProvider, setVideoProvider] = useState<VideoProvider>('none');
  const [videoReference, setVideoReference] = useState('');
  const [videoSourceNote, setVideoSourceNote] = useState('');
  const [captionsUrl, setCaptionsUrl] = useState('');
  const [durationSeconds, setDurationSeconds] = useState('240');
  const [objectivesText, setObjectivesText] = useState('');
  const [warningsText, setWarningsText] = useState('');
  const [steps, setSteps] = useState<TutorialStep[]>([
    { stepNumber: 1, title: '', instruction: '', actionPath: '/', actionLabel: 'Open Workspace' },
  ]);
  const [featured, setFeatured] = useState(false);
  const [published, setPublished] = useState(true);
  const [sortOrder, setSortOrder] = useState('250');

  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setSuccessMsg('');

    if (!editingTutorial) {
      setSlug('');
      setTitle('');
      setDescription('');
      setModuleName('Module 1 — Getting Started');
      setLifecycleStage('PROTECT');
      setCategory('Getting Started');
      setDifficulty('Beginner');
      setVideoProvider('none');
      setVideoReference('');
      setVideoSourceNote('');
      setCaptionsUrl('');
      setDurationSeconds('240');
      setObjectivesText('Configure and verify the target FortiX workflow.');
      setWarningsText('');
      setSteps([
        {
          stepNumber: 1,
          title: 'Open the Target FortiX Module',
          instruction: 'Navigate to the module in the workspace sidebar and review current settings.',
          actionPath: '/',
          actionLabel: 'Open Dashboard',
        },
      ]);
      setFeatured(false);
      setPublished(true);
      setSortOrder('250');
      return;
    }

    // Hydrate full detail so objectives, steps, and warnings are preserved when editing
    setIsLoadingDetail(true);
    fetchWithAuth(`/api/learning/tutorials/${encodeURIComponent(editingTutorial.slug)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load tutorial details.');
        const detail = (await res.json()) as LearningTutorialDetailDto;
        setSlug(detail.slug);
        setTitle(detail.title);
        setDescription(detail.description);
        setModuleName(detail.moduleName);
        setLifecycleStage(detail.lifecycleStage);
        setCategory(detail.category);
        setDifficulty(detail.difficulty);
        setVideoProvider(detail.video.provider);
        if (detail.video.provider === 'youtube_nocookie' && detail.video.playbackUrl) {
          const match = detail.video.playbackUrl.match(/\/embed\/([A-Za-z0-9_-]{11})/);
          setVideoReference(match ? match[1] : '');
        } else {
          setVideoReference(detail.video.playbackUrl || '');
        }
        setVideoSourceNote(detail.video.sourceNote || '');
        setCaptionsUrl(detail.video.captionsUrl || '');
        setDurationSeconds(String(detail.durationSeconds));
        setObjectivesText(detail.learningObjectives.join('\n'));
        setWarningsText(detail.warnings.join('\n'));
        setSteps(
          detail.steps.length > 0
            ? detail.steps
            : [{ stepNumber: 1, title: '', instruction: '', actionPath: '/', actionLabel: 'Open' }]
        );
        setFeatured(detail.featured);
        setPublished(detail.published);
        setSortOrder(String(detail.sortOrder));
      })
      .catch(() => {
        setErrorMsg('Unable to load full tutorial record for editing.');
      })
      .finally(() => {
        setIsLoadingDetail(false);
      });
  }, [isOpen, editingTutorial]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleAddStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        stepNumber: prev.length + 1,
        title: '',
        instruction: '',
        actionPath: '/',
        actionLabel: 'Open Screen',
      },
    ]);
  };

  const handleRemoveStep = (idx: number) => {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, stepNumber: i + 1 }))
    );
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const parsedDuration = Number.parseInt(durationSeconds, 10);
    const parsedOrder = Number.parseInt(sortOrder, 10);
    const objectives = objectivesText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const warnings = warningsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    const normalizedSteps = steps
      .map((s, idx) => ({
        stepNumber: idx + 1,
        title: s.title.trim(),
        instruction: s.instruction.trim(),
        ...(s.actionPath?.trim() ? { actionPath: s.actionPath.trim() } : {}),
        ...(s.actionLabel?.trim() ? { actionLabel: s.actionLabel.trim() } : {}),
      }))
      .filter((s) => s.title && s.instruction);

    if (objectives.length === 0) {
      setErrorMsg('Provide at least one learning objective.');
      return;
    }
    if (normalizedSteps.length === 0) {
      setErrorMsg('Provide at least one step-by-step instruction.');
      return;
    }

    const payload = {
      slug: slug.trim().toLowerCase(),
      title: title.trim(),
      description: description.trim(),
      moduleName: moduleName.trim(),
      lifecycleStage,
      category,
      difficulty,
      videoProvider,
      videoReference: videoProvider === 'none' ? null : videoReference.trim() || null,
      videoSourceNote: videoSourceNote.trim() || null,
      captionsUrl: captionsUrl.trim() || null,
      durationSeconds: Number.isFinite(parsedDuration) ? parsedDuration : 240,
      learningObjectives: objectives,
      warnings,
      steps: normalizedSteps,
      featured,
      published,
      sortOrder: Number.isFinite(parsedOrder) ? parsedOrder : 250,
    };

    setIsSaving(true);
    try {
      const url = editingTutorial
        ? `/api/learning/admin/tutorials/${encodeURIComponent(editingTutorial.id)}`
        : '/api/learning/admin/tutorials';
      const method = editingTutorial ? 'PATCH' : 'POST';

      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const parsedErr = await parseApiErrorResponse(res, 'Could not save tutorial.');
        setErrorMsg(parsedErr.message);
        return;
      }

      const data = await res.json();
      const savedSlug = data?.tutorial?.slug || payload.slug;
      setSuccessMsg(editingTutorial ? 'Tutorial updated.' : 'Tutorial created.');
      await onSaved(savedSlug);
      onClose();
    } catch {
      setErrorMsg('Network error saving tutorial.');
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-tutorial-modal-title"
      className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/65 backdrop-blur-xs"
    >
      <div className="w-full max-w-2xl max-h-[90vh] bg-surface border border-subtle rounded-xl shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-subtle flex items-center justify-between gap-3">
          <div>
            <h2 id="admin-tutorial-modal-title" className="text-base font-bold text-strong">
              {editingTutorial ? 'Edit Learning Tutorial' : 'New Learning Tutorial'}
            </h2>
            <p className="text-xs text-muted">
              Configure validated video sources, captions, category ordering, and operational steps.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-muted hover:text-strong hover:bg-hover transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {errorMsg && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-300 flex items-center gap-2"
            >
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 size={15} className="shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {isLoadingDetail ? (
            <div className="py-10 text-center text-muted">Loading tutorial metadata…</div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-strong mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g., Enforcing Rate Limits on Store API"
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-strong mb-1">URL Slug</label>
                  <input
                    type="text"
                    required
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="enforcing-rate-limits-store-api"
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle font-mono text-strong focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-strong mb-1">Concise Description</label>
                <textarea
                  required
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-strong mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as LearningCategory)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                  >
                    {LEARNING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-strong mb-1">Difficulty</label>
                  <select
                    value={difficulty}
                    onChange={(e) => setDifficulty(e.target.value as LearningDifficulty)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                  >
                    {LEARNING_DIFFICULTIES.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-strong mb-1">Lifecycle Stage</label>
                  <select
                    value={lifecycleStage}
                    onChange={(e) => setLifecycleStage(e.target.value as LearningLifecycleStage)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                  >
                    {LEARNING_LIFECYCLE_STAGES.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-semibold text-strong mb-1">Module Heading</label>
                  <input
                    type="text"
                    required
                    value={moduleName}
                    onChange={(e) => setModuleName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-strong mb-1">Duration (seconds)</label>
                  <input
                    type="number"
                    min={5}
                    max={7200}
                    required
                    value={durationSeconds}
                    onChange={(e) => setDurationSeconds(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle font-mono tabular-nums text-strong focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-strong mb-1">Sort Order</label>
                  <input
                    type="number"
                    min={1}
                    max={10000}
                    required
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-base border border-subtle font-mono tabular-nums text-strong focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div className="p-3.5 rounded-lg border border-subtle bg-elevated/50 space-y-3">
                <div className="font-semibold text-strong">Validated Video &amp; Caption Source</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-muted mb-1">Video Provider</label>
                    <select
                      value={videoProvider}
                      onChange={(e) => setVideoProvider(e.target.value as VideoProvider)}
                      className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                    >
                      {VIDEO_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {p === 'none'
                            ? 'none (Written Guide / Recording Pending)'
                            : p === 'self_hosted'
                              ? 'self_hosted (/learning/videos/*.webm|.mp4)'
                              : p === 'https_allowlist'
                                ? 'https_allowlist (Allowlisted CDN HTTPS)'
                                : 'youtube_nocookie (11-char Video ID)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-muted mb-1">Video Reference</label>
                    <input
                      type="text"
                      disabled={videoProvider === 'none'}
                      value={videoReference}
                      onChange={(e) => setVideoReference(e.target.value)}
                      placeholder={
                        videoProvider === 'self_hosted'
                          ? '/learning/videos/my-guide.webm'
                          : videoProvider === 'youtube_nocookie'
                            ? '11-char ID'
                            : videoProvider === 'https_allowlist'
                              ? 'https://cdn.example.com/guide.mp4'
                              : 'Not applicable'
                      }
                      className="w-full px-3 py-2 rounded-lg bg-base border border-subtle font-mono text-strong disabled:opacity-50 focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-muted mb-1">WebVTT Captions Path (optional)</label>
                    <input
                      type="text"
                      value={captionsUrl}
                      onChange={(e) => setCaptionsUrl(e.target.value)}
                      placeholder="/learning/captions/my-guide.vtt"
                      className="w-full px-3 py-2 rounded-lg bg-base border border-subtle font-mono text-strong focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="block text-muted mb-1">Video Source Disclosure Note</label>
                    <input
                      type="text"
                      value={videoSourceNote}
                      onChange={(e) => setVideoSourceNote(e.target.value)}
                      placeholder="e.g., Narrated 5m walkthrough with captions"
                      className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-strong mb-1">
                  Learning Objectives (one per line)
                </label>
                <textarea
                  rows={3}
                  value={objectivesText}
                  onChange={(e) => setObjectivesText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-strong">Step-by-Step Operational Instructions</span>
                  <button
                    type="button"
                    onClick={handleAddStep}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-hover border border-subtle text-strong font-medium hover:bg-hover-strong"
                  >
                    <Plus size={12} />
                    <span>Add Step</span>
                  </button>
                </div>

                {steps.map((step, idx) => (
                  <div key={idx} className="p-3 rounded-lg border border-subtle bg-base space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-muted">Step {idx + 1}</span>
                      {steps.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveStep(idx)}
                          className="text-muted hover:text-red-500"
                          aria-label={`Remove step ${idx + 1}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Step title"
                      value={step.title}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSteps((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, title: val } : item))
                        );
                      }}
                      className="w-full px-2.5 py-1.5 rounded bg-surface border border-subtle text-strong focus:outline-none focus:border-primary"
                    />
                    <textarea
                      rows={2}
                      placeholder="Exact FortiX instruction"
                      value={step.instruction}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSteps((prev) =>
                          prev.map((item, i) => (i === idx ? { ...item, instruction: val } : item))
                        );
                      }}
                      className="w-full px-2.5 py-1.5 rounded bg-surface border border-subtle text-strong focus:outline-none focus:border-primary resize-none"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Workspace path (e.g., /security)"
                        value={step.actionPath || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSteps((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, actionPath: val } : item))
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded bg-surface border border-subtle font-mono text-strong focus:outline-none focus:border-primary"
                      />
                      <input
                        type="text"
                        placeholder="Button label (e.g., Open Security)"
                        value={step.actionLabel || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSteps((prev) =>
                            prev.map((item, i) => (i === idx ? { ...item, actionLabel: val } : item))
                          );
                        }}
                        className="w-full px-2.5 py-1.5 rounded bg-surface border border-subtle text-strong focus:outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div>
                <label className="block font-semibold text-strong mb-1">
                  Operational Warnings (optional, one per line)
                </label>
                <textarea
                  rows={2}
                  value={warningsText}
                  onChange={(e) => setWarningsText(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-base border border-subtle text-strong focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="flex flex-wrap items-center gap-6 pt-1">
                <label className="inline-flex items-center gap-2 cursor-pointer text-strong font-medium">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                    className="rounded border-subtle"
                  />
                  <span>Published to workspace users</span>
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer text-strong font-medium">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                    className="rounded border-subtle"
                  />
                  <span>Featured workflow</span>
                </label>
              </div>
            </>
          )}

          <div className="pt-4 border-t border-subtle flex items-center justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-hover border border-subtle text-strong font-semibold hover:bg-hover-strong transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isLoadingDetail}
              className="px-4 py-2 rounded-lg bg-primary text-inverted font-semibold hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {isSaving ? 'Saving…' : editingTutorial ? 'Save Changes' : 'Create Tutorial'}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
