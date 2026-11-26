import type { PreviewKind, PreviewResult } from "../types";

/** 适配器上下文：主流程把已归一的输入交给适配器，避免每个适配器重复转换 */
export interface AdapterContext {
	bytes: Uint8Array;
	blob: () => Promise<Blob>;
	name: string;
	mime: string;
	size: number;
	throwOnMissingDependency: boolean;
}

/** 适配器只返回结果的一部分，revoke 由主流程统一兜底 */
export type AdapterOutput = Partial<
	Pick<PreviewResult, "url" | "text" | "html" | "unsafe" | "render" | "reason">
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