/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { ink: "#17212B", brand: { 500: "#166A65", 600: "#0E5551", 50: "#EEF8F6" } },
      spacing: { 13: "3.25rem" },
      boxShadow: { card: "0 12px 30px rgba(23, 33, 43, 0.08)" },
    },
  },
  plugins: [],
};
