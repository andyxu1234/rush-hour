/**
 * 架构红线在 lint 层强制：
 *   packages/core 与 packages/render 是"纯逻辑/纯绘制"层，禁止触碰平台 API。
 * 违反即 CI 失败（见 docs/02-architecture.md §3）。
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2020, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { es2020: true, browser: true, node: true },
  ignorePatterns: ['dist/**', 'node_modules/**', 'coverage/**', '*.cjs', '*.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'no-constant-condition': ['error', { checkLoops: false }],
  },
  overrides: [
    {
      files: ['packages/core/**/*.ts', 'packages/render/**/*.ts'],
      rules: {
        'no-restricted-globals': [
          'error',
          { name: 'window', message: 'core/render 禁止直接访问 window，请通过 Platform 接口' },
          { name: 'document', message: 'core/render 禁止直接访问 document，请通过 Platform 接口' },
          { name: 'wx', message: 'core/render 禁止直接访问 wx，请通过 Platform 接口' },
          { name: 'localStorage', message: 'core/render 禁止直接访问 localStorage，请通过 Platform.storage' },
          { name: 'Image', message: 'core/render 禁用位图 Image，美术全部代码绘制' },
        ],
        'no-restricted-syntax': [
          'error',
          {
            selector: "MemberExpression[object.name='window']",
            message: 'core/render 禁止 window.*，请通过 Platform 接口',
          },
          {
            selector: "MemberExpression[object.name='wx']",
            message: 'core/render 禁止 wx.*，请通过 Platform 接口',
          },
          {
            selector: "NewExpression[callee.name='Function']",
            message: '小游戏环境禁止 new Function（无 eval 权限）',
          },
          {
            selector: "CallExpression[callee.name='eval']",
            message: '小游戏环境禁止 eval',
          },
        ],
      },
    },
  ],
};
