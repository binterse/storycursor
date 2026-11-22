import js from '@eslint/js';
import ts from 'typescript-eslint';
export default [{ ignores: ['dist/**', 'test-results/**', 'playwright-report/**'] }, ...ts.configs.recommended, { ...js.configs.recommended, files: ['apps/**/*.ts','packages/**/*.ts','tests/**/*.ts'], rules: { ...js.configs.recommended.rules, 'no-undef': 'off' } }];
