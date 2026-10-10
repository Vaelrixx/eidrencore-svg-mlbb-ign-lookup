import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

const jsxFiles = ["**/*.{jsx,tsx}"];

export default defineConfig([
  ...tseslint.configs.recommended,
  {
    ...react.configs.flat.recommended,
    files: jsxFiles,
    settings: { react: { version: "detect" } },
  },
  {
    ...react.configs.flat["jsx-runtime"],
    files: jsxFiles,
  },
  {
    ...reactHooks.configs.flat.recommended,
    files: jsxFiles,
  },
  {
    ...jsxA11y.flatConfigs.recommended,
    files: jsxFiles,
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
