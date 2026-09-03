import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without globals, so RTL's auto-cleanup never fires on its own.
afterEach(() => {
  cleanup();
});
