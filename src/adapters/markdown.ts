import { decodeText } from "../core/binary";
import type { Adapter } from "../core/adapter";
import { missingDependencyReason } from "../core/adapter";
import type { PreviewResult } from "../types";
import { loadOptional } from "../core/optional";

/** marked 的可选导出形状：CJS 互操作后可能挂在 default 上 */
interface MarkedModule {
	marked?: { parse: (src: string, opts?: Record<string, unknown>) => string };
	parse?: (src: string, opts?: Record<string, unknown>) => string;
}

interface DomPurifyModule {
	default?: { sanitize: (html: string) => string };
	sanitize?: (html: string) => string;
}

const pickMarkedParse = (mod: MarkedModule): ((s: string, o?: Record<string, unknown>) => string) | undefined =>
	mod.marked?.parse ?? mod.parse;

const pickSanitize = (mod: DomPurifyModule): ((html: string) => string) | undefined =>
	mod.default?.sanitize ?? mod.sanitize;

export interface MarkdownAdapterOptions {
	/** 传 false 可关闭 GFM 扩展 */
	gfm?: boolean;
	/** 单个换行是否渲染为 <br>，默认 true（附件类文档更符合直觉） */
	breaks?: boolean;
	/** 强制跳过净化，仅在内容来源完全可信时使用 */
	skipSanitize?: boolean;
}

/**
 * markdown → HTML。
 *
 * 默认启用 GFM + breaks，并对结果做 DOMPurify 净化：附件来源不可信，
 * markdown 允许内联 HTML，不净化等于把 XSS 直接递到调用方的 DOM 里。
 * 净化器缺失时不静默放行，而是把 unsafe 标出去让调用方决定。
 */
export const markdownAdapter =
	(options: MarkdownAdapterOptions = {}): Adapter =>
	async (ctx) => {
		const { text } = decodeText(ctx.bytes);
		const { gfm = true, breaks = true, skipSanitize = false } = options;

		const markedMod = await loadOptional<MarkedModule>("marked");
		const parse = markedMod ? pickMarkedParse(markedMod) : undefined;

		// marked 缺失时仍返回原文，让调用方至少能当纯文本展示
		if (!parse) {
			return { text, reason: missingDependencyReason("marked") };
		}

		const raw = parse(text, { gfm, breaks });

		if (skipSanitize) return { html: raw, unsafe: true };

		const purifyMod = await loadOptional<DomPurifyModule>("dompurify");
		const sanitize = purifyMod ? pickSanitize(purifyMod) : undefined;

		// 拿不到净化器 = 环境配置错误，不是「内容不可信」。
		// 此时绝不能把未净化的 HTML 当正常结果交出去：调用方常用
		// dangerouslySetInnerHTML 直接插入，且不会检查 unsafe。
		// 不返回 html 字段，主流程才会把 kind 降级（返回 html 会保留 kind）。
		if (!sanitize) {
			return { reason: missingDependencyReason("dompurify") };
		}

		return { html: sanitize(raw), unsafe: false };
	};

export type { PreviewResult };
export type { Adapter, AdapterContext } from "../core/adapter";