export const LEARNING_CATEGORIES = [
  'Getting Started',
  'API Management',
  'API Gateway',
  'Authentication and Authorization',
  'Security Policies',
  'Rate Limiting',
  'Resilience Experiments',
  'Telemetry and Monitoring',
  'Verification and Evidence',
  'API Studio',
  'Reports and Analysis',
  'Troubleshooting',
] as const;

export type LearningCategory = (typeof LEARNING_CATEGORIES)[number];

export const LEARNING_DIFFICULTIES = ['Beginner', 'Intermediate', 'Advanced'] as const;
export type LearningDifficulty = (typeof LEARNING_DIFFICULTIES)[number];

export const LEARNING_LIFECYCLE_STAGES = [
  'PROTECT',
  'BREAK',
  'OBSERVE',
  'PROVE',
  'IMPROVE',
] as const;
export type LearningLifecycleStage = (typeof LEARNING_LIFECYCLE_STAGES)[number];

export const VIDEO_PROVIDERS = [
  'self_hosted',
  'https_allowlist',
  'youtube_nocookie',
  'none',
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

export interface TutorialStep {
  stepNumber: number;
  title: string;
  instruction: string;
  actionPath?: string;
  actionLabel?: string;
}

export interface TutorialDocLink {
  title: string;
  href: string;
  kind: 'workspace' | 'openapi' | 'guide';
}

export interface ResolvedVideoPlayback {
  playable: boolean;
  renderMode: 'html5_video' | 'trusted_embed' | 'unavailable';
  playbackUrl: string | null;
  captionsUrl: string | null;
  thumbnailUrl: string | null;
  provider: VideoProvider;
  sourceNote: string | null;
}

export interface UserTutorialProgressDto {
  tutorialId: string;
  lastPositionSeconds: number;
  maxWatchedSeconds: number;
  percentWatched: number;
  completed: boolean;
  completedAt: string | null;
  lastWatchedAt: string | null;
}

export interface LearningTutorialSummaryDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  moduleName: string;
  lifecycleStage: LearningLifecycleStage;
  category: LearningCategory;
  difficulty: LearningDifficulty;
  durationSeconds: number;
  featured: boolean;
  published: boolean;
  sortOrder: number;
  video: ResolvedVideoPlayback;
  progress: UserTutorialProgressDto | null;
}

export interface LearningTutorialDetailDto extends LearningTutorialSummaryDto {
  learningObjectives: string[];
  prerequisites: string[];
  steps: TutorialStep[];
  warnings: string[];
  relatedSlugs: string[];
  relatedTutorials: Array<{
    id: string;
    slug: string;
    title: string;
    category: LearningCategory;
    difficulty: LearningDifficulty;
    durationSeconds: number;
    hasVideo: boolean;
    completed: boolean;
  }>;
  docLinks: TutorialDocLink[];
  previousTutorial: { slug: string; title: string; moduleName: string } | null;
  nextTutorial: { slug: string; title: string; moduleName: string } | null;
}

export interface LearningCategoryStatusDto {
  name: LearningCategory;
  publishedCount: number;
  recordedVideoCount: number;
  completedCount: number;
  comingSoon: boolean;
}
