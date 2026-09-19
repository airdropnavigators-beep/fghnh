/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f6f8",
        surface: "#ffffff",
        line: { DEFAULT: "#e6e8ee", strong: "#d3d7df" },
        ink: {
          950: "#0a0f1c",
          900: "#121a2b",
          700: "#3b4457",
          500: "#6c7687",
          400: "#98a1b1",
          300: "#c5cbd6",
        },
        brand: {
          50: "#e9f8f6",
          100: "#c8eee9",
          200: "#95dfd6",
          500: "#12a08f",
          600: "#0d857a",
          700: "#0a6a62",
        },
        ok: { 50: "#eefbf3", 100: "#d6f5e2", 500: "#16a34a", 600: "#15803d" },
        warn: { 50: "#fff8eb", 100: "#feefc7", 500: "#e0910a", 600: "#b87400" },
        err: { 50: "#fef2f2", 100: "#fde3e3", 500: "#dc2626", 600: "#b91c1c" },
      },
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Instrument Serif'", "Georgia", "'Times New Roman'", "serif"],
        mono: ["'JetBrains Mono Variable'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.05)",
        raised: "0 4px 12px -2px rgba(16,24,40,0.08), 0 2px 4px rgba(16,24,40,0.04)",
        pop: "0 24px 60px -20px rgba(16,24,40,0.28), 0 8px 20px -10px rgba(16,24,40,0.12)",
        focus: "0 0 0 4px rgba(18,160,143,0.18)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgba(18,160,143,0.35)" },
          "70%": { boxShadow: "0 0 0 10px rgba(18,160,143,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(18,160,143,0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "overlay-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "overlay-out": { from: { opacity: "1" }, to: { opacity: "0" } },
        "dialog-in": {
          from: { opacity: "0", transform: "translate(-50%, -48%) scale(0.96)" },
          to: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
        },
        "dialog-out": {
          from: { opacity: "1", transform: "translate(-50%, -50%) scale(1)" },
          to: { opacity: "0", transform: "translate(-50%, -49%) scale(0.98)" },
        },
        "sheet-in": {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "sheet-out": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(24px)" },
        },
        "sheet-left-in": {
          from: { opacity: "0", transform: "translateX(-24px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        "sheet-left-out": {
          from: { opacity: "1", transform: "translateX(0)" },
          to: { opacity: "0", transform: "translateX(-24px)" },
        },
        "ff-dash": { to: { strokeDashoffset: "-24" } },
      },
      animation: {
        "fade-up": "fade-up 0.35s ease-out both",
        "pulse-ring": "pulse-ring 1.8s ease-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "overlay-in": "overlay-in 180ms ease-out",
        "overlay-out": "overlay-out 150ms ease-in forwards",
        "dialog-in": "dialog-in 220ms cubic-bezier(0.22, 1, 0.36, 1)",
        "dialog-out": "dialog-out 150ms ease-in forwards",
        "sheet-in": "sheet-in 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        "sheet-out": "sheet-out 180ms ease-in forwards",
        "sheet-left-in": "sheet-left-in 260ms cubic-bezier(0.22, 1, 0.36, 1)",
        "sheet-left-out": "sheet-left-out 180ms ease-in forwards",
      },
    },
  },
  plugins: [],
};