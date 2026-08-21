/** Loader 传进来的是未经类型化的 YAML 值，测试里用同样的方式构造。 */

import { Config } from '../src/config.js'

/**
 * 用部分输入构造一份填好默认值的配置。
 * @param input - `cordis.yml` 里会写的那种部分配置。
 * @returns 校验并填默认值后的配置。
 */
export function makeConfig(input: unknown = {}): Config {
  return new Config(input as Config)
}
