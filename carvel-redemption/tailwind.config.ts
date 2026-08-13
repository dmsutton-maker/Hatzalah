import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Result-panel palette. Picked for contrast at arm's length in a bright shop.
        valid: "#0f8a3c",
        invalid: "#b81a1a",
        caution: "#b8720a",
        testing: "#1256a8",
      },
    },
  },
  plugins: [],
};

export default config;
