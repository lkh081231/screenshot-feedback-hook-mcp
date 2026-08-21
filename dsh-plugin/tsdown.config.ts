/**
 * 浏览器半侧的构建：产出 dsh 客户端模块系统要的 **lazy-CJS factory** 产物。
 *
 * dsh 官方产出这种产物的 `clientBundle` 预设住在 `packages/client/tsdown.client.ts`，
 * **没有发布到 npm**（官方 README 把这条列为已知限制），所以仓库外的包必须自己
 * 复刻同样的输出格式。这里复刻的就是那份契约：
 *
 * - `format: 'cjs'` + `platform: 'browser'`，产物固定叫 `lib/client.js`；
 * - banner/intro/footer 把整个 bundle 包成一个闭包工厂，注册进
 *   `window.__ModuleLoader__`：执行脚本只**注册**工厂，模块体的副作用要到
 *   首次 import 被物化时才跑；
 * - 只有模块表里那几个 specifier 保持 `require()`，其余一律内联——`require`
 *   是同步的，模块表答不上来的 specifier 就是一次必然的运行时抛错；
 * - `process.env.NODE_ENV` / `import.meta.env` 要替换掉，CJS 产物承载不了
 *   `import.meta`。
 *
 * 校对基准：dsh v0.1.0-rc.8 的 `packages/client/tsdown.client.ts` 与
 * `packages/client/web/src/platform.ts`。升级 dsh 时要跟着复核这两处。
 */

import { defineConfig } from 'tsdown'

/** 包名，要与 `package.json` 的 name 一致：它是模块表的键。 */
const ID = 'dsh-screenshot-feedback-hook-mcp'

/**
 * shell 共享进冻结模块表的 specifier（`PLATFORM_MODULES`），加上解析器在
 * shell 启动前就预载工厂的那一个（`PRELOADED_CLIENT_EXTERNALS`）。
 * 精确匹配，绝不做归一化——包声明的就是自己代码里写的那个 specifier。
 */
const MODULE_TABLE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-runtime/client',
])

const isRequested = (specifier: string): boolean => MODULE_TABLE.has(specifier)

const MODE = process.env['NODE_ENV'] ?? 'production'

export default defineConfig({
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // 与 tsc 产出的 node 半侧同一个 lib/ 目录，所以 clean 必须关掉
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2024',
  // 类型从 tsc 那边走；这里再产 dts 会把 banner/footer 卷进 .d.cts
  dts: false,
  clean: false,
  // 插件代码在 Vite 的模块图之外被取回，堆栈要靠自己这份 map 才能回到 TSX
  sourcemap: true,
  deps: {
    neverBundle: isRequested,
    alwaysBundle: (specifier: string) => !isRequested(specifier),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(MODE),
    'import.meta.env.MODE': JSON.stringify(MODE),
    'import.meta.env': JSON.stringify({ MODE }),
  },
  plugins: [{
    // 构建期的模块边规则：不在模块表里、又不是纯类型的 @deepseek-ai 值导入，
    // 要么内联出一份重复的运行时实例，要么请求一个模块表答不上来的 specifier。
    // 跨插件协作一律走 cordis 服务。
    name: 'screenshot-feedback-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (isRequested(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the dsh client module table — `
        + 'import it type-only (erased before this gate) or collaborate through a cordis service',
      )
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})
