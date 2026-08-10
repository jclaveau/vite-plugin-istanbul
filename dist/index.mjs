import { createRequire } from "node:module";
import { loadNycConfig } from "@istanbuljs/load-nyc-config";
import { createInstrumenter } from "istanbul-lib-instrument";
import picocolors from "picocolors";
import TestExclude from "test-exclude";
import { createLogger } from "vite";
import * as espree from "espree";
import { SourceMapGenerator } from "source-map";
//#region src/source-map.ts
function createIdentitySourceMap(file, source, option) {
	const gen = new SourceMapGenerator(option);
	espree.tokenize(source, {
		loc: true,
		ecmaVersion: "latest"
	}).forEach((token) => {
		const loc = token.loc.start;
		gen.addMapping({
			source: file,
			original: loc,
			generated: loc
		});
	});
	return JSON.parse(gen.toString());
}
function createCompleteSourceMap(file, source, originalSource, option, originalLineOffset = 0) {
	const gen = new SourceMapGenerator(option);
	const lines = source.split("\n");
	const originalLines = originalSource ? originalSource.split("\n").length : lines.length;
	lines.forEach((line, lineIndex) => {
		const tokens = [];
		try {
			tokens.push(...espree.tokenize(line, {
				loc: true,
				ecmaVersion: "latest"
			}));
		} catch {
			tokens.push({ loc: { start: {
				line: 1,
				column: 0
			} } });
		}
		tokens.forEach((token) => {
			const originalLine = Math.min(lineIndex + 1 + originalLineOffset, originalLines);
			gen.addMapping({
				source: file,
				original: {
					line: originalLine,
					column: 0
				},
				generated: {
					line: lineIndex + 1,
					column: token.loc.start.column
				}
			});
		});
	});
	if (originalSource) gen.setSourceContent(file, originalSource);
	return JSON.parse(gen.toString());
}
//#endregion
//#region src/vue-sfc.ts
const require = createRequire(import.meta.url);
function getScriptBlockLineOffset(originalSource, filename) {
	let parse;
	try {
		({parse} = require("@vue/compiler-sfc"));
	} catch {
		return 0;
	}
	const { descriptor } = parse(originalSource, { filename });
	const blocks = [descriptor.script, descriptor.scriptSetup].filter((block) => Boolean(block));
	if (blocks.length === 0) return 0;
	const first = blocks.reduce((earliest, block) => block.loc.start.line < earliest.loc.start.line ? block : earliest);
	return first.content.startsWith("\n") ? first.loc.start.line : first.loc.start.line - 1;
}
function canInstrumentChunk(id, srcCode) {
	const is1stChunk = id.endsWith(".vue");
	const is2ndChunk = /\?vue&type=style/.test(id);
	const is3rdChunk = /\?vue&type=script/.test(id);
	const isCompositionAPI = /import _sfc_main from/.test(srcCode);
	if (is2ndChunk) return false;
	if (is3rdChunk) return true;
	if (is1stChunk) return !isCompositionAPI;
	return true;
}
//#endregion
//#region src/index.ts
const { yellow } = picocolors;
const DEFAULT_EXTENSION = [
	".js",
	".cjs",
	".mjs",
	".ts",
	".tsx",
	".jsx",
	".vue"
];
const COVERAGE_PUBLIC_PATH = "/__coverage__";
const PLUGIN_NAME = "vite:istanbul";
const MODULE_PREFIX = "/@modules/";
const NULL_STRING = "\0";
function sanitizeSourceMap(rawSourceMap) {
	const { sourcesContent, ...sourceMap } = rawSourceMap;
	return JSON.parse(JSON.stringify(sourceMap));
}
function getEnvVariable(key, prefix, env) {
	if (Array.isArray(prefix)) prefix = prefix.find((pre) => {
		return env[`${pre}${key}`] != null;
	}) ?? "";
	return env[`${prefix}${key}`];
}
async function createTestExclude(opts) {
	const { nycrcPath, include, exclude, extension } = opts;
	const cwd = opts.cwd ?? process.cwd();
	const nycConfig = await loadNycConfig({
		cwd,
		nycrcPath
	});
	return new TestExclude({
		cwd,
		include: include ?? nycConfig.include,
		exclude: exclude ?? nycConfig.exclude,
		extension: extension ?? nycConfig.extension ?? DEFAULT_EXTENSION,
		excludeNodeModules: true
	});
}
function resolveFilename(id) {
	const [filename] = id.split("?vue");
	return filename;
}
function istanbulPlugin(opts = {}) {
	const requireEnv = opts?.requireEnv ?? false;
	const checkProd = opts?.checkProd ?? true;
	const forceBuildInstrument = opts?.forceBuildInstrument ?? false;
	const logger = createLogger("warn", { prefix: "vite-plugin-istanbul" });
	let testExclude;
	const instrumenter = opts.instrumenter ?? createInstrumenter({
		coverageGlobalScopeFunc: false,
		coverageGlobalScope: "globalThis",
		preserveComments: true,
		produceSourceMap: true,
		autoWrap: true,
		esModules: true,
		compact: false,
		generatorOpts: { ...opts?.generatorOpts }
	});
	let enabled = true;
	return {
		name: PLUGIN_NAME,
		apply(_, env) {
			return forceBuildInstrument ? true : env.command == "serve";
		},
		enforce: "post",
		async config(config) {
			if (!config.build?.sourcemap) {
				logger.warn(`${PLUGIN_NAME}> ${yellow(`Sourcemaps was automatically enabled for code coverage to be accurate.
To hide this message set build.sourcemap to true, 'inline' or 'hidden'.`)}`);
				config.build ??= {};
				config.build.sourcemap = true;
			}
			testExclude = await createTestExclude(opts);
		},
		configResolved(config) {
			const { isProduction, env } = config;
			const { CYPRESS_COVERAGE } = process.env;
			const envPrefix = config.envPrefix ?? "VITE_";
			const envVar = (opts.cypress ? CYPRESS_COVERAGE : getEnvVariable("COVERAGE", envPrefix, env))?.toLowerCase() ?? "";
			if (checkProd && isProduction && !forceBuildInstrument || !requireEnv && envVar === "false" || requireEnv && envVar !== "true") enabled = false;
		},
		configureServer({ middlewares }) {
			if (!enabled) return;
			middlewares.use((req, res, next) => {
				if (req.url !== COVERAGE_PUBLIC_PATH) return next();
				const coverage = global.__coverage__ ?? null;
				let data;
				try {
					data = JSON.stringify(coverage, null, 4);
				} catch (ex) {
					return next(ex);
				}
				res.setHeader("Content-Type", "application/json");
				res.statusCode = 200;
				res.end(data);
			});
		},
		transform(srcCode, id, options) {
			if (!enabled || options?.ssr || id.startsWith(MODULE_PREFIX) || id.startsWith(NULL_STRING)) return;
			if (!canInstrumentChunk(id, srcCode)) return;
			const filename = resolveFilename(id);
			if (testExclude.shouldInstrument(filename)) {
				const rawCombinedSourceMap = this.getCombinedSourcemap();
				const combinedSourceMap = sanitizeSourceMap(rawCombinedSourceMap);
				if (id.endsWith(".vue") || /\?vue&type=script/.test(id)) {
					let originalSource = null;
					if (rawCombinedSourceMap.sourcesContent && rawCombinedSourceMap.sourcesContent[0]) originalSource = rawCombinedSourceMap.sourcesContent[0];
					const originalLineOffset = originalSource && /\?vue&type=script/.test(id) ? getScriptBlockLineOffset(originalSource, filename) : 0;
					const completeSourceMap = sanitizeSourceMap(createCompleteSourceMap(filename, srcCode, originalSource, {
						file: combinedSourceMap.file,
						sourceRoot: combinedSourceMap.sourceRoot
					}, originalLineOffset));
					const code = instrumenter.instrumentSync(srcCode, filename, completeSourceMap);
					const map = instrumenter.lastSourceMap();
					const fileCoverage = instrumenter.fileCoverage;
					if (opts.onCover) opts.onCover(filename, fileCoverage);
					return {
						code,
						map
					};
				}
				const code = instrumenter.instrumentSync(srcCode, filename, combinedSourceMap);
				const identitySourceMap = sanitizeSourceMap(createIdentitySourceMap(filename, srcCode, {
					file: combinedSourceMap.file,
					sourceRoot: combinedSourceMap.sourceRoot
				}));
				instrumenter.instrumentSync(srcCode, filename, identitySourceMap);
				const map = instrumenter.lastSourceMap();
				const fileCoverage = instrumenter.fileCoverage;
				if (opts.onCover) opts.onCover(filename, fileCoverage);
				return {
					code,
					map
				};
			}
		}
	};
}
//#endregion
export { istanbulPlugin as default };

//# sourceMappingURL=index.mjs.map