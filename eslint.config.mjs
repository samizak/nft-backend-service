import globals from "globals";
import tseslint from "typescript-eslint";
import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // Global ignores
  {
    ignores: ["node_modules/", "dist/", "prisma/generated/"],
  },

  // Base configuration: ESLint recommended + TypeScript recommended
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Customizations for the project
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        ...globals.node, // Enable Node.js global variables
      },
      // Parser is automatically set by tseslint.config
    },
    rules: {
      // Your custom rules (equivalent to rules in .eslintrc.js)
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      // Add any other specific rules you had or want here
      // Example: "no-console": "warn", 
    },
  },

  // Prettier config *must* be last to override other formatting rules
  eslintConfigPrettier
); 