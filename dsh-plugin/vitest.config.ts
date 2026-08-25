import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
    alias: {
      // 真身是浏览器 bundle（模块体第一行就碰 window.__ModuleLoader__），Node 下
      // 根本 import 不了。别名到替身，好让浏览器半侧与 DOM 无关的纯逻辑能被测到。
      // 只影响测试运行；tsc 与 tsdown 都照旧解析到真身。
      '@deepseek-ai/dsh-client-runtime/client': fileURLToPath(new URL('./tests/stubs/client-runtime.ts', import.meta.url)),
    },
  },
})
