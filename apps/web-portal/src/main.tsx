import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./auth";
import { FeatureErrorBoundary } from "./ErrorBoundary";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <FeatureErrorBoundary>
          <App />
        </FeatureErrorBoundary>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
