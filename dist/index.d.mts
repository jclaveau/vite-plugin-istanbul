import { Plugin } from "vite";
import "source-map";
import { GeneratorOptions } from "@babel/generator";
//#region src/source-map.d.ts
type RawSourceMap = {
  version: number;
  sources: string[];
  names: string[];
  sourceRoot?: string;
  sourcesContent?: string[];
  mappings: string;
  file: string;
};
//#endregion
//#region src/index.d.ts
declare global {
  var __coverage__: any;
}
/**
 * Custom instrumenter interface. Matches the subset of istanbul-lib-instrument's
 * Instrumenter that this plugin uses. Implement this to use a faster instrumenter
 * (e.g., oxc-coverage-instrument) while keeping the Istanbul coverage format.
 */
interface CustomInstrumenter {
  instrumentSync(code: string, filename: string, inputSourceMap?: RawSourceMap): string;
  lastSourceMap(): RawSourceMap | null;
  fileCoverage: object;
}
interface IstanbulPluginOptions {
  include?: string | string[];
  exclude?: string | string[];
  extension?: string | string[];
  requireEnv?: boolean;
  cypress?: boolean;
  checkProd?: boolean;
  forceBuildInstrument?: boolean;
  cwd?: string;
  nycrcPath?: string;
  generatorOpts?: GeneratorOptions;
  onCover?: (fileName: string, fileCoverage: object) => void;
  /**
   * Custom instrumenter to use instead of istanbul-lib-instrument.
   * Must implement `instrumentSync`, `lastSourceMap`, and `fileCoverage`.
   *
   * @example
   * ```ts
   * import { createOxcInstrumenter } from 'oxc-coverage-instrument/vitest';
   *
   * istanbul({
   *   instrumenter: createOxcInstrumenter(),
   * })
   * ```
   */
  instrumenter?: CustomInstrumenter;
}
declare function istanbulPlugin(opts?: IstanbulPluginOptions): Plugin;
//#endregion
export { CustomInstrumenter, IstanbulPluginOptions, istanbulPlugin as default };
//# sourceMappingURL=index.d.mts.map