import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button, Card } from '@chirkov/shell';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, info.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-canvas flex items-center justify-center p-6">
          <div className="max-w-md w-full">
            <Card padding="lg" elevation="raised" className="text-center space-y-4">
            <div className="text-page">⚠️</div>
            <h1 className="text-title font-bold text-fg">Что-то пошло не так</h1>
            <p className="text-body text-fg-subtle">
              Произошла непредвиденная ошибка. Попробуйте обновить страницу.
            </p>
            {this.state.error && (
              <p className="text-micro text-fg-subtle font-mono bg-canvas p-2 rounded-card text-left break-all">
                {this.state.error.message}
              </p>
            )}
            <Button
              variant="primary"
              size="md"
              fullWidth
              onClick={this.handleReload}
            >
              Обновить страницу
            </Button>
          </Card>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
