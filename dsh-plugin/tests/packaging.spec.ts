/**
 * 打包不变式：dsh 的运行时包必须由 host 提供，绝不能出现在 `dependencies` 里。
 *
 * 这不是风格问题。`dsh plugin add` 会在 profile 目录跑 pnpm（`nodeLinker: hoisted`），
 * 我们声明的每个 `dependencies` 都会被摊平进 `~/.dsh/profiles/<name>/node_modules/`，
 * 从而**盖住** dsh 建在 `~/.dsh/profiles/node_modules/` 指向安装目录的那组符号链接。
 * 而 composed config 的裸包名是相对 `~/.dsh/profiles/<name>/cordis.yml` 解析的，
 * 于是 `ctx.tools` 会由 profile 本地那份 `dsh-tools` 造出来，`dsh-agent-loop` 却仍用
 * 安装目录那份；两份副本的 `TOOL_RUNTIME_SCHEDULER`（模块局部 `Symbol`，不是
 * `Symbol.for`）互不相等 → `ctx.tools[TOOL_RUNTIME_SCHEDULER]` 是 `undefined` →
 * **该 profile 里所有工具调用**（不只是截图）都以
 * `Cannot read properties of undefined (reading 'prepare')` 崩掉。0.1.0 就是这么发出去的。
 * @module dsh-screenshot-feedback-hook-mcp/tests/packaging
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

interface Manifest {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  peerDependenciesMeta?: Record<string, { optional?: boolean }>
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as Manifest

/** 必须由 host 提供的包：dsh 的运行时包，以及 cordis 本身。 */
function isHostProvided(name: string): boolean {
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

/**
 * Host 半侧的源码文件。`src/client/` 不算：那半侧是打进 `lib/client.js` 的浏览器
 * bundle，它的 externals 由浏览器的模块加载器兑现，从来不走 Node 的 node_modules
 * 解析，所以那些 `@deepseek-ai/dsh-client-*` 不该、也不能声明成 peer。
 */
function hostSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'client' ? [] : hostSourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

/** Host 半侧 import 过的 `@deepseek-ai/*` 包名（含 type-only import 与子路径）。 */
function importedScopedPackages(): Set<string> {
  const found = new Set<string>()
  for (const file of hostSourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(/from '(@deepseek-ai\/[^']+)'/g)) {
      const specifier = match[1] as string
      // '@scope/pkg/sub' → '@scope/pkg'
      found.add(specifier.split('/').slice(0, 2).join('/'))
    }
  }
  return found
}

describe('packaging invariants', () => {
  it('keeps every host-provided package out of dependencies', () => {
    const offenders = Object.keys(manifest.dependencies ?? {}).filter(isHostProvided)
    expect(
      offenders,
      'dsh 的运行时包放进 dependencies 会在 profile 里造出第二份副本，'
      + '让该 profile 的所有工具调用崩溃（见本文件顶部注释）。请改成 peerDependencies。',
    ).toEqual([])
  })

  it('declares every host-provided package it imports as an optional peer', () => {
    const peers = manifest.peerDependencies ?? {}
    const meta = manifest.peerDependenciesMeta ?? {}
    for (const name of importedScopedPackages()) {
      if (!isHostProvided(name)) continue
      expect(peers, `${name} 被源码 import 了，必须声明成 peerDependency`).toHaveProperty(name)
      // 非可选 peer 会被 npm 7+ 自动安装，等于把上面那个坑原样重建
      expect(meta[name]?.optional, `${name} 必须标 optional，否则 npm 会自动安装它`).toBe(true)
    }
  })

  it('provides every peer locally so typecheck and tests can resolve them', () => {
    const dev = manifest.devDependencies ?? {}
    for (const name of Object.keys(manifest.peerDependencies ?? {})) {
      expect(dev, `${name} 是 peer，本地开发要靠 devDependencies 提供`).toHaveProperty(name)
    }
  })
})
