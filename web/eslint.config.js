import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import svelte from "eslint-plugin-svelte";
import globals from "globals";
import tseslint from "typescript-eslint";

import svelteConfig from "./svelte.config.js";

const unusedVarsOptions = { argsIgnorePattern: "^_", varsIgnorePattern: "^_" };

export default tseslint.config(
  {
    ignores: ["build/**", ".svelte-kit/**", "node_modules/**", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2020,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", unusedVarsOptions],
      "no-useless-escape": "warn",
      // New in eslint-plugin-svelte 3's recommended set. Its suggestion fixer
      // calls sourceCode.isSpaceBetweenTokens(), which ESLint 10 removed, so
      // any report crashes the whole lint run. The one current hit
      // (USMap.svelte `$: getFill`) is an intentional reactive function, and
      // v2 never enabled this rule, so keeping it off preserves prior behavior.
      "svelte/no-reactive-functions": "off",
      // Rules that newly joined the recommended sets in ESLint 10
      // (eslint:recommended) and eslint-plugin-svelte 3 (svelte/recommended).
      // They were not enforced under the previous ESLint 8 / plugin v2 setup;
      // keep them off so this migration preserves behavior, and adopt them
      // individually in follow-up changes.
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "svelte/infinite-reactive-loop": "off",
      "svelte/no-immutable-reactive-statements": "off",
      "svelte/no-navigation-without-resolve": "off",
      "svelte/prefer-svelte-reactivity": "off",
      "svelte/require-each-key": "off",
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    files: ["**/*.svelte"],
    rules: {
      "@typescript-eslint/no-unused-expressions": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { ...unusedVarsOptions, caughtErrors: "none" },
      ],
    },
  },
  {
    files: ["**/*.d.ts", "**/*.test.ts", "**/*.test.js"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
