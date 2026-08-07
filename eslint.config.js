import js from '@eslint/js'
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'
import pluginVue from 'eslint-plugin-vue'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  eslintPluginPrettierRecommended,
  {
    rules: {
      'prettier/prettier': ['warn', { endOfLine: 'lf', singleQuote: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
)
