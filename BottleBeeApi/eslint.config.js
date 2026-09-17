'use strict';

const js = require('@eslint/js');
const globals = require('globals');

/**
 * ESLint configuration.
 *
 * Deliberately weighted towards rules that catch mistakes, not rules that
 * enforce a house style. The codebase is already consistent, and turning on a
 * full stylistic ruleset over twenty controllers would produce thousands of
 * findings that nobody reads — which is how linting ends up permanently
 * disabled. Formatting opinions are left to review; this file is for the things
 * that are actually wrong.
 *
 * Flat config, because ESLint 9 no longer reads `.eslintrc`.
 */
module.exports = [
  {
    // Nothing here is ours to lint.
    ignores: [
      'node_modules/**',
      'coverage/**',
      'logs/**',
      'uploads/**',
      'Documents/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
        ...globals.es2023,
      },
    },
    rules: {
      /* ------------------------- likely to be a bug ------------------------ */

      // An awaited value that is not a promise usually means a missing call.
      'no-return-await': 'error',
      // `await` inside a loop is sometimes right — sequential API calls, ordered
      // migrations — so it warns rather than errors, and the places that mean it
      // already carry an eslint-disable comment.
      'require-atomic-updates': 'error',
      'no-unsafe-optional-chaining': 'error',
      'no-constant-binary-expression': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'array-callback-return': 'error',
      'no-unmodified-loop-condition': 'error',
      'no-promise-executor-return': 'error',
      'no-await-in-loop': 'off',

      // Catch a variable that is assigned and never read — often a forgotten
      // rename. Function arguments are exempt: Express handlers legitimately
      // take `next` without using it.
      'no-unused-vars': ['error', {
        args: 'none',
        caughtErrors: 'none',
        ignoreRestSiblings: true,
      }],

      /* --------------------------- correctness ---------------------------- */

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'no-throw-literal': 'error',
      'no-implicit-coercion': ['error', { allow: ['!!'] }],
      'consistent-return': 'error',
      'default-param-last': 'error',
      'no-param-reassign': ['error', { props: false }],

      /* ----------------------- security-adjacent -------------------------- */

      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-buffer-constructor': 'error',

      /* ------------------------- light formatting ------------------------- */
      // Only the two that affect diffs and merges rather than taste.
      'eol-last': ['error', 'always'],
      'no-trailing-spaces': 'error',
    },
  },

  {
    // Tests may reach for things application code should not.
    files: ['tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
    },
    rules: {
      'consistent-return': 'off',
    },
  },

  {
    // Migrations and seeders are sequelize-cli's shape, not ours: they export
    // `up`/`down` pairs where one side is often intentionally a no-op.
    files: ['migrations/**/*.js', 'seeders/**/*.js'],
    rules: {
      'consistent-return': 'off',
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
    },
  },

  {
    // Scripts talk to a human on stdout.
    files: ['scripts/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    /**
     * `require-atomic-updates` cannot know that Express gives every request its
     * own `req`, so it flags the entirely correct pattern of awaiting a lookup
     * and then attaching the result — which is what authentication middleware
     * is for. Two concurrent requests never share a `req`, and middleware runs
     * sequentially within one, so there is no interleaving to guard against.
     *
     * Left on everywhere else, where an await-then-assign against a
     * longer-lived object could be a real race.
     */
    files: ['middlewares/**/*.js'],
    rules: {
      'require-atomic-updates': 'off',
    },
  },
];
