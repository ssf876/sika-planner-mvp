import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import "./globals.css";
// Design tokens for the whole app (v1.1 warm-editorial system): pure :root
// custom properties, imported once at the app root as the module header
// directs.
import "@/components/ui/tokens.css";

/* Display face — hero financial values, page titles, editorial headings. */
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

/* Interface face — navigation, forms, tables, and all dense UI. */
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

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
    <html lang="en" className={`${fraunces.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
