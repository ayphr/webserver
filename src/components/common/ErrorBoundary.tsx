import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
};

type State = {
  error: Error | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught an error', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div role="alert" style={{ padding: '1rem', color: 'var(--status-error)' }}>
          <p>Something went wrong.</p>
          <button type="button" onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;