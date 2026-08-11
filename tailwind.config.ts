import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Neutral surface ramp. Swap these for Revibe brand values when the
        // app is embedded into the training hub.
        ink: {
          DEFAULT: "#111827",
          muted: "#6b7280",
          faint: "#9ca3af",
        },
        edge: "#e5e7eb",
      },
    },
  },
  plugins: [],
} satisfies Config;
