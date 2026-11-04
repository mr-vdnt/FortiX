import React from 'react';
import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';

interface ContextualHelpLinkProps {
  slug: string;
  label?: string;
  className?: string;
}

export function ContextualHelpLink({
  slug,
  label = 'Watch workflow guide',
  className = '',
}: ContextualHelpLinkProps) {
  return (
    <Link
      to={`/learning-center/${slug}`}
      data-testid={`contextual-help-${slug}`}
      className={`inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary transition-colors whitespace-nowrap ${className}`}
    >
      <PlayCircle size={13} className="text-primary shrink-0" />
      <span className="underline decoration-dotted underline-offset-4">{label}</span>
    </Link>
  );
}
