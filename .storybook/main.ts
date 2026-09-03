import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../components/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs"],
  framework: {
    name: "@storybook/react-vite",
    options: {},
  },
  viteFinal: (config) => {
    // Next's tsconfig sets jsx: preserve; Storybook's esbuild transform
    // needs the automatic runtime so stories don't need React in scope.
    config.esbuild = { ...config.esbuild, jsx: "automatic" };
    return config;
  },
};

export default config;
