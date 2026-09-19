import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Last line of defence: a render crash shows a recoverable screen instead of a blank page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("FlowForge UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-canvas p-6">
        <div className="panel max-w-md p-6 text-center" role="alert">
          <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-err-50 text-err-600">
            <AlertOctagon size={18} />
          </span>
          <h1 className="mt-3 font-display text-2xl text-ink-950">Something broke in the interface.</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            The workflow itself is safe on the server. Reload to pick up where you left off.
          </p>
          <pre className="mt-3 max-h-24 overflow-auto rounded-lg bg-canvas p-2 text-left font-mono text-[11px] text-ink-700">
            {this.state.error.message}
          </pre>
          <Button variant="dark" className="mt-4" onClick={() => window.location.reload()}>
            <RotateCcw size={14} /> Reload
          </Button>
        </div>
      </div>
    );
  }
}
