/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18151f",
        brand: {
          50: "#f4f1ff",
          100: "#e9e2ff",
          500: "#8b5cf6",
          600: "#7546e8",
          700: "#6035c8",
        },
      },
      spacing: { 13: "3.25rem" },
      boxShadow: { card: "0 14px 36px rgba(24, 21, 31, 0.08)" },
    },
  },
  plugins: [],
};
