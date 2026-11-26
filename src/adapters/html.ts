import type { Adapter } from "../core/adapter";
import type { PreviewResult } from "../types";
import { loadOptional } from "../core/optional";
import { missingDependencyReason } from "../core/adapter";

interface DomPurifyModule {
	default?: { sanitize: (html: string, opts?: Record<string, unknown>) => string };
	sanitize?: (html: string, opts?: Record<string, unknown>) => string;
}

/** 生成 blob URL；Node 无 createObjectURL 时降级 */
const canCreateObjectURL = (): boolean =>
	typeof URL !== "undefined" && typeof URL.createObjectURL === "function";

/**
 * SVG 单独处理，不并进 image。
 *
 * SVG 是 XML，可内嵌 <script> 与 onload 事件：把它的 blob URL 放进
 * <iframe> / <object> / <embed> 会执行脚本，放进 <img src> 才安全。
 * 因此这里除了给出 url，还强制标 scriptable，让调用方必须显式选择渲染方式，
 * 而不是拿到 url 就随手塞进任意容器。
 */
export const svgAdapter: Adapter = async (ctx) => {
	if (!canCreateObjectURL()) {
		return { reason: "当前环境不支持 URL.createObjectURL（多见于 Node 非浏览器运行时）" };
	}

	// svg 必须声明 svg+xml，否则浏览器按纯文本打开而不是渲染成图形
	const blob = new Blob([ctx.bytes as BlobPart], { type: "image/svg+xml" });
	const url = URL.createObjectURL(blob);

	return { url, scriptable: true };
};

export interface HtmlAdapterOptions {
	/**
	 * 是否净化后当 HTML 片段返回（true）还是原样返回（false，默认）。
	 *
	 * 默认不净化：HTML 邮件/网页附件常依赖 <style>、布局与表单，
	 * 严格净化会把排版整个毁掉，反而不如让调用方用沙箱 iframe。
	 * 因此这里只负责解码与标 unsafe，隔离交给调用方的 iframe sandbox。
	 */
	sanitize?: boolean;
}

/**
 * HTML 单独处理，不并进 text。
 *
 * 当纯文本会丢失全部排版，直接显示又等于执行来源不可信的脚本，
 * 所以两条路都不对：正确做法是回传 HTML 原文 + unsafe 标记，
 * 由调用方放进 <iframe sandbox> 渲染。
 */
export const htmlAdapter =
	(options: HtmlAdapterOptions = {}): Adapter =>
	async (ctx) => {
		const { text } = decodeHtml(ctx.bytes);

		if (!options.sanitize) {
			return { html: text, unsafe: true };
		}

		const purifyMod = await loadOptional<DomPurifyModule>("dompurify");
		const sanitize = purifyMod?.default?.sanitize ?? purifyMod?.sanitize;
		// 调用方明确要求净化却拿不到净化器：这是配置错误，不能静默退回未净化内容。
		// 与「默认不净化」区分开——后者是知情选择，返回 unsafe: true 是正确的契约。
		if (!sanitize) {
			return { reason: missingDependencyReason("dompurify") };
		}

		// 保留样式与表格结构：邮件正文的排版几乎全靠内联 style
		const clean = sanitize(text, { WHOLE_DOCUMENT: true });
		return { html: clean, unsafe: false };
	};

/** HTML 里优先按声明的 charset 解码，其次 UTF-8 → GBK 回退 */
const decodeHtml = (bytes: Uint8Array): { text: string; encoding: string } => {
	// 先按 UTF-8 宽松解一段头部，读 meta charset 声明
	const head = new TextDecoder("utf-8").decode(bytes.subarray(0, 1024));
	const declared = /charset\s*=\s*["']?\s*([\w-]+)/i.exec(head)?.[1]?.toLowerCase();

	if (declared && declared !== "utf-8" && declared !== "utf8") {
		try {
			return { text: new TextDecoder(declared).decode(bytes), encoding: declared };
		} catch {
			// 运行时不支持该编码，落到下面的通用回退
		}
	}

	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
	} catch {
		try {
			return { text: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
		} catch {
			return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8-lossy" };
		}
	}
};

export type { PreviewResult };