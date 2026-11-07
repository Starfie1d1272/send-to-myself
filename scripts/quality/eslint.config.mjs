import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/target/**",
    "SendToMyself/**",
    "apps/api/drizzle/**",
    "apps/raycast/raycast-env.d.ts",
  ]),
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [tseslint.configs.recommended],
    rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "apps/desktop/src/**/*.ts", "apps/web/test/**/*.mjs"],
    languageOptions: { globals: globals.browser },
  },
]);
