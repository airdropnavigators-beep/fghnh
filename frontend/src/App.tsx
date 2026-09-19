import { ErrorBoundary } from "@/components/Shell/ErrorBoundary";
import { Demo } from "@/pages/Demo";

export function App() {
  return (
    <ErrorBoundary>
      <Demo />
    </ErrorBoundary>
  );
}
