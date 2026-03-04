import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QueryGuard — Supabase Observability",
  description: "Full-stack error monitoring and observability for Supabase apps.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
