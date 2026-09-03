import type { Metadata } from "next";
import "./globals.css";

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
