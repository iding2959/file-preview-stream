import type { PreviewKind, PreviewOptions, PreviewResult } from "../types";

/** 适配器上下文：主流程把已归一的输入交给适配器，避免每个适配器重复转换 */
export interface AdapterContext {
	bytes: Uint8Array;
	blob: () => Promise<Blob>;
	name: string;
	mime: string;
	size: number;
	throwOnMissingDependency: boolean;
	/**
	 * 递归深度（顶层为 0）。
	 *
	 * archive / eml 会把自己的部件再喂回 createPreview，无限嵌套的 zip
	 * （zip 里套 zip）必须有硬上限，否则一次预览就能把调用方拖死。
	 */
	depth: number;
	/** 调用方原始选项，递归子项时需要透传 deep 等开关 */
	options: PreviewOptions;
	/** 递归解析子项用；由主流程注入，避免适配器反向 import 主入口造成循环依赖 */
	preview: (input: Uint8Array | string, options: PreviewOptions) => Promise<PreviewResult>;
}

/** 适配器只返回结果的一部分，revoke 由主流程统一兜底 */
export type AdapterOutput = Partial<
	Pick<
		PreviewResult,
		| "url"
		| "text"
		| "html"
		| "unsafe"
		| "scriptable"
		| "render"
		| "reason"
		| "container"
		| "entries"
		| "mail"
		| "slides"
		| "hiFi"
		| "playable"
		| "playableReason"
	>
>;

export type Adapter = (ctx: AdapterContext) => Promise<AdapterOutput> | AdapterOutput;

const registry = new Map<PreviewKind, Adapter>();

/**
 * 注册某类文件的处理函数，返回注销函数。
 * 抽成注册表是为了让业务侧覆盖内置行为（比如换成企业内部的 docx 渲染器）
 * 而不必 fork 整个库。
 */
export const registerAdapter = (kind: PreviewKind, adapter: Adapter): (() => void) => {
	const prev = registry.get(kind);
	registry.set(kind, adapter);
	return () => {
		if (prev) registry.set(kind, prev);
		else registry.delete(kind);
	};
};

export const getAdapter = (kind: PreviewKind): Adapter | undefined => registry.get(kind);

/**
 * 缺可选依赖时的统一提示。写成"可执行的修复命令"而非"模块未找到"，
 * 是因为调用方拿到 reason 后会直接展示给用户，用户需要知道该怎么办。
 */
export const missingDependencyReason = (pkg: string): string =>
	`预览该类型需要安装可选依赖 ${pkg}，例如: npm i ${pkg}`;