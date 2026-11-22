import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [
  { ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] },
  { ...js.configs.recommended, files: ['**/*.ts'], rules: { ...js.configs.recommended.rules, 'no-undef': 'off', 'no-control-regex': 'off' } },
  ...ts.configs.recommended,
];
