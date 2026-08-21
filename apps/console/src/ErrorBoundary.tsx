/**
 * ErrorBoundary —— React 错误边界：组件树崩溃时显示可恢复的错误页而非白屏。
 * 演控台的容错底线：UI 渲染 bug 不得让操作员失去对机器人的控制界面。
 * （multi-DS 是独立进程,UI 崩溃不影响心跳/看门狗——但 UI 要能自恢复。）
 */
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error): void {
    console.error('[GHPaths] UI 组件崩溃:', error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="app error-page">
          <h1>⚠ UI 渲染异常</h1>
          <p className="error-detail">{this.state.error?.message ?? String(this.state.error)}</p>
          <p className="error-hint">
            multi-DS 与机器人不受影响（独立进程）。点击下方恢复,或刷新页面。
          </p>
          <button onClick={() => this.setState({ hasError: false, error: null })}>
            恢复界面
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
