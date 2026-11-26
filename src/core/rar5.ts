import { MIME_BY_CONTAINER } from "./binary";
import { loadOptional } from "./optional";

/**
 * 可选的 RAR5 解码后端（node-unrar-js：官方 unrar 编译成的 WASM）。
 *
 * 为什么是「可选」而不是硬依赖：
 * - 它带 207KB wasm，且必须显式注入 wasm 才能避开 Node 内置模块（浏览器里
 *   包的工厂默认 `ENVIRONMENT_IS_NODE=true`，会直接 `require("fs")`）。
 * - RAR4 用纯 JS 的 unrar-js 已经够用，不装 WASM 也能工作。
 * 所以装了就自动启用 RAR5，没装就明确降级——不让所有人替小众格式买单。
 */

interface FileHeader {
	name: string;
	flags: { encrypted: boolean; solid: boolean; directory: boolean };
	unpSize: number;
}

interface Extractor {
	getFileList: () => { fileHeaders: Iterable<FileHeader> };
	extract: (opts?: { files?: string[] }) => {
		files: Iterable<{ fileHeader: FileHeader; extraction?: Uint8Array }>;
	};
}

type ExtractorCtor = new (unrar: unknown, data: ArrayBuffer, password?: string) => Extractor;

let cachedModule: Promise<unknown | undefined> | undefined;

/**
 * wasm 只加载一次。
 *
 * 取 wasm 的路径有两条：显式设置的 `configureRar5Wasm` / 环境里的
 * `RAR5_WASM_PATH`，或直接读包内自带的 `unrar.wasm`。
 * 浏览器端拿不到包内路径，必须由调用方通过 configureRar5Wasm 传入。
 */
let configuredWasm: ArrayBuffer | undefined;

export const configureRar5Wasm = (wasm: ArrayBuffer | Uint8Array): void => {
	configuredWasm = (
		wasm instanceof Uint8Array
			? wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
			: wasm.slice(0)
	) as ArrayBuffer;
	cachedModule = undefined;
};

const loadWasmBinary = async (): Promise<ArrayBuffer | undefined> => {
	if (configuredWasm) return configuredWasm;
	// 仅 Node：包内路径只有 Node 侧可解析。浏览器必须走 configureRar5Wasm
	if (typeof process === "undefined" || !process.versions?.node) return undefined;
	try {
		const fs = await import("node:fs/promises");
		const { createRequire } = await import("node:module");
		// 从三个基准点依次尝试：包自身位置 → 进程 cwd。
		// 只看 import.meta.url 在 pnpm/工作区软链或打包后都可能落空。
		const bases = [import.meta.url];
		if (typeof process !== "undefined" && process.cwd) {
			bases.push(`file://${process.cwd().replace(/\\/g, "/")}/`);
		}
		for (const base of bases) {
			try {
				const req = createRequire(base);
				const wasmPath = req.resolve("node-unrar-js/dist/js/unrar.wasm");
				const buf = await fs.readFile(wasmPath);
				return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
			} catch {
				// 换下一个基准点
			}
		}
		return undefined;
	} catch {
		return undefined;
	}
};

const loadModule = async (): Promise<unknown | undefined> => {
	if (cachedModule) return cachedModule;
	cachedModule = (async () => {
		try {
			const wasmBinary = await loadWasmBinary();
			if (!wasmBinary) return undefined;
			// 包入口是 CJS 工厂；用深路径避免它的 iife 包被 ESM 误解析
			const factoryMod = await loadOptional<
				| { default?: (opts: { wasmBinary: ArrayBuffer }) => Promise<unknown> }
				| ((opts: { wasmBinary: ArrayBuffer }) => Promise<unknown>)
			>("node-unrar-js/dist/js/unrar.js");
			const factory = typeof factoryMod === "function" ? factoryMod : factoryMod?.default;
			if (typeof factory !== "function") return undefined;
			// 注入 wasmBinary 后，运行时走内存分支，不会 require("fs")
			return await factory({ wasmBinary });
		} catch {
			return undefined;
		}
	})();
	return cachedModule;
};

/** RAR5 后端是否可用（供调用方判断要不要提示「装依赖可解开」） */
export const isRar5Available = async (): Promise<boolean> => (await loadModule()) !== undefined;

export interface Rar5Entry {
	name: string;
	size: number;
	isDir: boolean;
	encrypted: boolean;
	bytes?: Uint8Array;
}

/**
 * 解出 RAR5 的条目。
 *
 * `wantContent` 为 false 时只列清单（大归档不必把内容全部解进内存）；
 * 为 true 时一次性解压全部条目——RAR 是流式格式，随机访问单条代价高于整体解一遍。
 */
export const readRar5 = async (
	bytes: Uint8Array,
	wantContent: boolean
): Promise<Rar5Entry[] | undefined> => {
	const unrar = await loadModule();
	if (!unrar) return undefined;

	const extractorMod = await loadOptional<{ ExtractorData: ExtractorCtor }>(
		"node-unrar-js/dist/js/ExtractorData.js"
	);
	if (!extractorMod) return undefined;
	const { ExtractorData } = extractorMod;
	const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
	const ex = new ExtractorData(unrar, data);
	// 运行时通过 Module.extractor 回调 JS 侧的读写实现，这一步不能省
	(unrar as { extractor?: unknown }).extractor = ex;

	const list: Rar5Entry[] = [];
	for (const h of ex.getFileList().fileHeaders) {
		list.push({
			name: h.name,
			size: h.unpSize,
			isDir: h.flags.directory,
			encrypted: h.flags.encrypted,
		});
	}
	if (!wantContent) return list;

	const contents = new Map<string, Uint8Array>();
	for (const f of ex.extract().files) {
		if (f.extraction) contents.set(f.fileHeader.name, f.extraction);
	}
	for (const e of list) {
		if (e.isDir) continue;
		const c = contents.get(e.name);
		if (c) e.bytes = c;
		else if (!e.encrypted) e.encrypted = true; // 没解出来且无内容：按加密/损坏处理
	}
	return list;
};

export { MIME_BY_CONTAINER };