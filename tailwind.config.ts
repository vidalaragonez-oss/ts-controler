import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        amber: {
          500: "#f5a623",
        },
        background: "#111010",
        surface: "#1a1917",
        card: "#201f1d",
        border: "#2e2c29",
        muted: "#7a7268",
        foreground: "#e8e2d8",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
      },
      borderRadius: {
        xl: "14px",
        lg: "8px",
      },
      boxShadow: {
        amber: "0 4px 20px rgba(245, 166, 35, 0.3)",
        "amber-lg": "0 6px 28px rgba(245, 166, 35, 0.5)",
        sm: "0 2px 12px rgba(0, 0, 0, 0.4)",
        DEFAULT: "0 8px 32px rgba(0, 0, 0, 0.55)",
      },
    },
  },
  plugins: [],
};

export default config;
