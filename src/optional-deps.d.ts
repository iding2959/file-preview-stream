/**
 * 可选 peer 依赖的类型垫片。
 *
 * 这些包是 optional peerDependencies：调用方不装也能用主包，但源码里的
 * `await import("xlsx")` 仍需要类型才能通过 tsc。声明成 any 的模块即可，
 * 真实形状由各适配器内部的窄接口（SheetJsModule 等）约束。
 */
declare module "marked";
declare module "xlsx";
declare module "dompurify";
declare module "docx-preview";
declare module "pptx-preview";

/**
 * node-unrar-js 是 optionalDependency（RAR5 的 WASM 后端），无类型可用；
 * 我们只用它的两个深路径，形状由 core/rar5.ts 内的窄接口约束。
 */
declare module "node-unrar-js/dist/js/unrar.js";
declare module "node-unrar-js/dist/js/ExtractorData.js";

/**
 * unrar-js 是 dependencies（不是 peer），但它没有类型定义，且真正被用的是
 * 包内部 lib/Unrar.js 而非其 fs 依赖的入口。这里只声明我们用到的那个深路径。
 */
declare module "unrar-js/lib/Unrar.js" {
	interface RarFileEntry {
		filename: string;
		header?: { flags?: { LHD_PASSWORD?: boolean }; unpackedSize?: number };
		fileData?: Uint8Array;
		isValid?: boolean;
	}
	const unrar: (data: Uint8Array) => RarFileEntry[];
	export default unrar;
}