import { defineConfig, globalIgnores } from "eslint/config";
import eslintJs from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig([
  eslintJs.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.{jsx,tsx}"],
    extends: [eslintReact.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.nodeBuiltin,
      },
    },
    settings: {
      react: { version: "detect" },
    },
  },
  {
    files: ["**/*.tsx"],
    extends: [eslintReact.configs["recommended-typescript"]],
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
