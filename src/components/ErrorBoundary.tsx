import React, { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { fetchWithAuth } from '../lib/api.js';

interface Props {
  children?: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorEventId?: string;
}

export class ErrorBoundary extends React.Component<Props, State> {
  declare props: Readonly<Props>;
  declare setState: (state: Partial<State>) => void;

  public state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Caught UI render error:', error?.message);
    fetchWithAuth('/api/control/system/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: (error?.message || 'Client component render error').slice(0, 400),
        componentStack: (errorInfo?.componentStack || '').slice(0, 900),
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.errorEventId) {
          this.setState({ errorEventId: data.errorEventId });
        }
      })
      .catch(() => {});
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center min-h-[260px] p-8 bg-surface text-base-text border border-red-500/30 rounded-2xl m-4 text-center space-y-4">
          <div className="p-3 rounded-xl bg-red-500/10 text-red-400 border border-red-500/25">
            <AlertTriangle size={24} />
          </div>
          <div className="space-y-1 max-w-md">
            <h2 className="text-lg font-bold text-strong">View failed to render</h2>
            <p className="text-xs text-muted leading-relaxed">
              {this.state.error?.message || 'An unexpected rendering exception interrupted this panel.'}
            </p>
            {this.state.errorEventId && (
              <p className="text-[11px] font-mono text-muted pt-1">
                Correlation ID: {this.state.errorEventId}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-inverted rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
              onClick={() => this.setState({ hasError: false, error: undefined, errorEventId: undefined })}
            >
              <RotateCcw size={14} />
              <span>Retry View</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
