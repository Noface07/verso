import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home, RotateCcw, ChevronDown } from 'lucide-react';
import { reportCrash } from '../lib/crashReporter';
import { Button } from '../design/components/Button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  detailsOpen: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    detailsOpen: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    reportCrash(error, {
      componentStack: errorInfo.componentStack,
    });
  }

  public handleReset = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    this.props.onReset?.();
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleHome = (): void => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.hash = '#/';
  };

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="w-full h-full min-h-[300px] flex items-center justify-center p-6 bg-[var(--surface-base)] text-[var(--text-primary)]"
        >
          <div className="max-w-md w-full p-6 rounded-[var(--r-lg)] bg-[var(--surface-overlay)] border border-[var(--border-subtle)] shadow-xl flex flex-col gap-5 text-center items-center animate-in fade-in-50 duration-200">
            <div className="w-14 h-14 rounded-full bg-[var(--surface-subtle)] border border-[var(--border-subtle)] flex items-center justify-center text-[var(--accent)]">
              <AlertCircle className="w-8 h-8" />
            </div>

            <div className="flex flex-col gap-1.5">
              <h2 className="text-xl font-bold">
                {this.props.fallbackTitle || 'Something went wrong'}
              </h2>
              <p className="text-sm text-[var(--text-secondary)]">
                An unexpected error occurred while rendering this view. You can reload the view or
                return to your library.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 justify-center w-full mt-2">
              <Button
                variant="accent"
                onClick={this.handleReload}
                className="flex items-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Reload this view</span>
              </Button>
              <Button
                variant="standard"
                onClick={this.handleReset}
                className="flex items-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Try again</span>
              </Button>
              <Button
                variant="subtle"
                onClick={this.handleHome}
                className="flex items-center gap-2"
              >
                <Home className="w-4 h-4" />
                <span>Return to Home</span>
              </Button>
            </div>

            {this.state.error && (
              <div className="w-full text-left mt-2 border-t border-[var(--border-subtle)] pt-4">
                <button
                  type="button"
                  onClick={() => this.setState((s) => ({ detailsOpen: !s.detailsOpen }))}
                  className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer select-none"
                >
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${
                      this.state.detailsOpen ? 'rotate-180' : ''
                    }`}
                  />
                  <span>Technical details</span>
                </button>

                {this.state.detailsOpen && (
                  <div className="mt-2.5 p-3 rounded-[var(--r-sm)] bg-[var(--surface-base)] border border-[var(--border-subtle)] overflow-x-auto text-[11px] font-mono text-[var(--text-secondary)] max-h-40">
                    <p className="font-semibold text-red-400 mb-1">
                      {this.state.error.name}: {this.state.error.message}
                    </p>
                    {this.state.error.stack && (
                      <pre className="whitespace-pre-wrap">{this.state.error.stack}</pre>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
