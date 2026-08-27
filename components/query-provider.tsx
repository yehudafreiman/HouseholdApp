"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  // Created once per browser session (not per render/navigation) so the
  // cache survives client-side route changes between chat/shopping/wishlist
  // — that persistence is what makes returning to a page instant.
  const [queryClient] = useState(() => new QueryClient());
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
