import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  fallback: (error: Error, retry: () => void) => ReactNode;
  resetKey?: string | number;
};

type State = { error?: Error; resetKey?: string | number };

export default class AsyncBoundary extends Component<Props, State> {
  state: State = { resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): State | null {
    if (props.resetKey !== state.resetKey) return { resetKey: props.resetKey, error: undefined };
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Deferred interface failed", error, info.componentStack);
  }

  private retry = () => this.setState({ error: undefined });

  render() {
    if (this.state.error) return this.props.fallback(this.state.error, this.retry);
    return this.props.children;
  }
}
