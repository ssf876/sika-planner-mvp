import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Projects do not inherit root resolve.alias — share it explicitly.
const alias = { "@": path.resolve(import.meta.dirname) };

export default defineConfig({
  test: {
    // Two projects: pure unit tests stay on the node environment, while
    // UI component tests render through jsdom (RTL + jest-dom matchers).
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/ui/**"],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./tests/ui/setup.ts"],
          include: ["tests/ui/**/*.test.{ts,tsx}"],
          // Keep authored class names so component tests can assert them.
          css: { modules: { classNameStrategy: "non-scoped" } },
        },
      },
    ],
  },
});
