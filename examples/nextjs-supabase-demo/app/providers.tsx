"use client";

import { useEffect } from "react";
import { initQueryGuard } from "queryguard";
import { ErrorLogger } from "queryguard/react";

/**
 * QueryGuard Demo — Provider
 *
 * Call initQueryGuard() once at app startup.
 * Mount <ErrorLogger /> to capture global JS errors.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initQueryGuard({
      endpoint: process.env.NEXT_PUBLIC_QUERYGUARD_ENDPOINT ?? "http://localhost:3001/api/ingest",
      environment: process.env.NODE_ENV ?? "development",
      debug: process.env.NODE_ENV === "development",
    });
  }, []);

  return (
    <>
      <ErrorLogger />
      {children}
    </>
  );
}
