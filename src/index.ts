import { byteLengthOf, toBlob, toBytes } from "./core/binary";
import { detectKind, defaultMimeOf, extOf } from "./core/mime";
import type { AdapterContext, AdapterOutput } from "./core/adapter";
import { getAdapter, registerAdapter } from "./core/adapter";
import { nativeAdapter, releaseUrl, textAdapter, unsupportedAdapter } from "./adapters/native";
import { markdownAdapter } from "./adapters/markdown";
import { excelAdapter } from "./adapters/excel";
import { docxAdapter } from "./adapters/docx";
import type { PreviewInput, PreviewKind, PreviewOptions, PreviewResult } from "./types";

/**
 * 内置适配器注册集中在这里而非各适配器文件，是为了保证「导入主入口即完成装配」，
 * 调用方不需要额外记得调 setup()。
 */
const installDefaults = (): void => {
	registerAdapter("pdf", nativeAdapter);
	registerAdapter("image", nativeAdapter);
	registerAdapter("video", nativeAdapter);
	registerAdapter("audio", nativeAdapter);
	registerAdapter("text", textAdapter);
	registerAdapter("markdown", markdownAdapter());
	registerAdapter("excel", excelAdapter());
	registerAdapter("docx", docxAdapter());
	registerAdapter("unsupported", unsupportedAdapter);
};

installDefaults();

const resolveName = (input: PreviewInput, options: PreviewOptions): string => {
	if (options.name) return options.name;
	// 浏览器 File 对象自带 name，这是最常见也最准确的来源
	if (typeof input === "object" && input !== null && "name" in input) {
		const n = (input as { name?: unknown }).name;
		if (typeof n === "string" && n) return n;
	}
	return "";
};

const resolveMime = (input: PreviewInput, options: PreviewOptions, kind: PreviewKind): string => {
	if (options.mime) return options.mime;
	if (typeof input === "object" && input !== null && "type" in input) {
		const t = (input as { type?: unknown }).type;
		if (typeof t === "string" && t) return t;
	}
	return defaultMimeOf(kind);
};

const emptyRevoke = (): void => {};

/**
 * 把任意文件载荷转成预览结果。
 *
 * 设计取舍：不做「一步把内容插进页面」的高层 API。取数（HTTP）、UI 承载（React/Vue）、
 * 生命周期（卸载时 revoke）都是调用方的领域，混进来会让库同时绑定后端协议与前端框架。
 * 这里只保证一件事：给我字节，我告诉你它是什么、能以什么形式呈现。
 */
export const createPreview = async (
	input: PreviewInput,
	options: PreviewOptions = {}
): Promise<PreviewResult> => {
	const name = resolveName(input, options);
	const mime = options.mime ?? "";
	const kind = options.kind ?? detectKind(name, mime);
	const finalMime = resolveMime(input, options, kind);
	const size = await byteLengthOf(input);

	const base = { kind, mime: finalMime, name, size, revoke: emptyRevoke };

	const adapter = getAdapter(kind);
	// 未注册的 kind 一律降级，而不是抛错：预览失败不该中断整条附件列表
	if (!adapter) {
		return { ...base, kind: "unsupported", reason: `没有为 ${kind} 注册处理器` };
	}

	const bytes = await toBytes(input);
	const ctx: AdapterContext = {
		bytes,
		blob: () => toBlob(input, finalMime),
		name,
		mime: finalMime,
		size,
		throwOnMissingDependency: options.throwOnMissingDependency ?? false,
	};

	let output: AdapterOutput;
	try {
		output = await adapter(ctx);
	} catch (err) {
		// 解析失败降级为 unsupported 并保留原因，调用方仍能提供下载兜底
		return {
			...base,
			kind: "unsupported",
			reason: `解析 ${extOf(name) || kind} 失败: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	// 适配器声明的缺依赖降级：按调用方意愿决定是抛错还是返回原因
	if (output.reason && options.throwOnMissingDependency) {
		throw new Error(output.reason);
	}

	const result: PreviewResult = {
		...base,
		...output,
		revoke: () => releaseUrl(output.url),
	};

	// 适配器声明了降级（通常是缺可选依赖）时，kind 必须跟着改成「实际能呈现的形式」：
	// 调用方按 kind 选渲染器，若仍报 markdown 却只有原文 text，它会拿 text 去塞 HTML 容器
	if (output.reason) {
		const degraded: PreviewKind = output.url
			? kind
			: output.html || output.render
				? kind
				: output.text !== undefined
					? "text"
					: "unsupported";
		return { ...result, kind: degraded };
	}

	return result;
};

export { detectKind, extOf, kindFromMime, registerKind, supportedExts, defaultMimeOf } from "./core/mime";
export { registerAdapter } from "./core/adapter";
export type { Adapter, AdapterContext, AdapterOutput } from "./core/adapter";
export { decodeText, looksLikeCsv } from "./core/binary";
export { DOCX_OPTIONS } from "./adapters/docx";
export type { PreviewInput, PreviewKind, PreviewOptions, PreviewResult } from "./types";