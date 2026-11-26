import type { Adapter } from "../core/adapter";
import { missingDependencyReason } from "../core/adapter";
import type { PreviewResult } from "../types";
import { loadOptional } from "../core/optional";

interface DocxPreviewModule {
	renderAsync?: (
		data: Blob | ArrayBuffer,
		container: HTMLElement,
		styleContainer?: HTMLElement | null,
		options?: Record<string, unknown>
	) => Promise<unknown>;
	default?: DocxPreviewModule;
}

/**
 * 关闭 A4 分页：分页模式把页面宽度固定成 794px，
 * 放进弹窗/侧栏这类窄容器会横向错位，流式渲染才符合阅读直觉。
 */
export const DOCX_OPTIONS = {
	breakPages: false,
	ignoreLastRenderedPageBreak: false,
	trimXmlDeclaration: true,
	inWrapper: true,
} as const;

export interface DocxAdapterOptions {
	/** 覆盖默认的 docx-preview 选项 */
	options?: Record<string, unknown>;
}

/**
 * docx 必须渲染进真实 DOM，所以这里不产出 HTML 字符串，
 * 而是回传 render(container)：把 DOM 生命周期交给调用方（React ref / Vue ref），
 * 库不该持有对插件容器的引用。
 */
export const docxAdapter =
	(options: DocxAdapterOptions = {}): Adapter =>
	async (ctx) => {
		const mod = await loadOptional<DocxPreviewModule>("docx-preview");
		const renderAsync = mod?.renderAsync ?? mod?.default?.renderAsync;
		if (!renderAsync) return { reason: missingDependencyReason("docx-preview") };

		const blob = await ctx.blob();
		const merged = { ...DOCX_OPTIONS, ...options.options };

		const render = async (container: HTMLElement): Promise<void> => {
			container.innerHTML = "";
			await renderAsync(blob, container, null, merged);
		};

		return { render };
	};

export type { PreviewResult };
export type { Adapter, AdapterContext } from "../core/adapter";