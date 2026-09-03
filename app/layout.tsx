import type { Metadata } from "next";
import "./globals.css";
// Design tokens for the UI primitives (spec D6–D8): pure :root custom
// properties, imported once at the app root as the module header directs.
import "@/components/ui/tokens.css";

export const metadata: Metadata = {
  title: "Sika Planner",
  description:
    "Zero-based budgeting that answers one question instantly: how much do I actually have left, right now, in every category.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
