import typography from "@tailwindcss/typography";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{html,js,svelte,ts}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        // Semantic design tokens — switch between light/dark via CSS variables
        page: "rgb(var(--sv-page) / <alpha-value>)",
        surface: "rgb(var(--sv-surface) / <alpha-value>)",
        "surface-alt": "rgb(var(--sv-surface-alt) / <alpha-value>)",
        stroke: "rgb(var(--sv-border) / <alpha-value>)",
        content: {
          DEFAULT: "rgb(var(--sv-text) / <alpha-value>)",
          muted: "rgb(var(--sv-text-muted) / <alpha-value>)",
          subtle: "rgb(var(--sv-text-subtle) / <alpha-value>)",
          faint: "rgb(var(--sv-text-faint) / <alpha-value>)",
        },
        // Fixed blue scale (matches Tailwind blue). Prefer the DEFAULT token
        // (`text-primary`) for links — it switches to blue-400 in dark mode.
        // When using a fixed shade for text, pair it with a dark: variant
        // (e.g. `text-primary-700 dark:text-primary-300`) for AA contrast.
        primary: {
          DEFAULT: "rgb(var(--sv-primary) / <alpha-value>)",
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
          950: "#172554",
        },
      },
    },
  },
  plugins: [typography],
};
