module.exports = {
  parser: "@typescript-eslint/parser",
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended", // Uses recommended rules from @typescript-eslint/eslint-plugin
    "prettier", // Uses eslint-config-prettier to disable ESLint rules that would conflict with prettier
    "plugin:prettier/recommended", // Enables eslint-plugin-prettier and displays prettier errors as ESLint errors. Make sure this is always the last configuration in the extends array.
  ],
  parserOptions: {
    ecmaVersion: 2021, // Allows for the parsing of modern ECMAScript features
    sourceType: "module", // Allows for the use of imports
  },
  env: {
    node: true, // Enable Node.js global variables and Node.js scoping.
    es2021: true,
  },
  rules: {
    // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
    // e.g. "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }], // Warn about unused vars, allowing _ prefix
  },
  ignorePatterns: ["node_modules/", "dist/", "prisma/generated/"],
};
