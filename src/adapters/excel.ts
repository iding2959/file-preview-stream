import { decodeText, looksLikeCsv } from "../core/binary";
import type { Adapter, AdapterContext } from "../core/adapter";
import { missingDependencyReason } from "../core/adapter";
import type { PreviewResult } from "../types";

interface SheetJsModule {
	read: (data: unknown, opts?: Record<string, unknown>) => Workbook;
	utils: { sheet_to_html: (sheet: unknown, opts?: Record<string, unknown>) => string };
	default?: SheetJsModule;
}

interface Workbook {
	SheetNames: string[];
	Sheets: Record<string, unknown>;
}

interface DomPurifyModule {
	default?: { sanitize: (html: string) => string };
	sanitize?: (html: string) => string;
}

const pickXlsx = (mod: unknown): SheetJsModule | undefined => {
	const m = mod as SheetJsModule;
	if (typeof m.read === "function") return m;
	if (m.default && typeof m.default.read === "function") return m.default;
	return undefined;
};

const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

/** 多 sheet 拼 HTML 时给每张表加标题，否则用户看不出分了几张表 */
const workbookToHtml = (xlsx: SheetJsModule, wb: Workbook): string =>
	wb.SheetNames.map((name) => {
		const table = xlsx.utils.sheet_to_html(wb.Sheets[name], { header: "", footer: "" });
		return `<section data-sheet="${escapeHtml(name)}"><h4>${escapeHtml(name)}</h4>${table}</section>`;
	}).join("");

export interface ExcelAdapterOptions {
	/** 强制跳过 DOMPurify 净化，仅内容完全可信时使用 */
	skipSanitize?: boolean;
}

/**
 * Excel / CSV → HTML 表格。
 *
 * CSV 不走 SheetJS 的二进制路径：中文 CSV 多为 GBK，先解码成字符串再交给
 * type:"string" 解析，才能避开 SheetJS 内部的编码猜测失误。
 */
export const excelAdapter =
	(options: ExcelAdapterOptions = {}): Adapter =>
	async (ctx: AdapterContext) => {
		let xlsx: SheetJsModule | undefined;
		try {
			xlsx = pickXlsx(await import("xlsx"));
		} catch {
			xlsx = undefined;
		}
		if (!xlsx) return { reason: missingDependencyReason("xlsx") };

		const isCsv = looksLikeCsv(ctx.name, ctx.mime);
		const wb = isCsv
			? xlsx.read(decodeText(ctx.bytes).text, { type: "string" })
			: xlsx.read(ctx.bytes, { type: "array" });

		const raw = workbookToHtml(xlsx, wb);

		if (options.skipSanitize) return { html: raw, unsafe: true };

		let purifyMod: DomPurifyModule | undefined;
		try {
			purifyMod = (await import("dompurify")) as DomPurifyModule;
		} catch {
			purifyMod = undefined;
		}
		const sanitize = purifyMod?.default?.sanitize ?? purifyMod?.sanitize;
		if (!sanitize) return { html: raw, unsafe: true, reason: missingDependencyReason("dompurify") };

		return { html: sanitize(raw), unsafe: false };
	};

export type { PreviewResult };
export type { Adapter, AdapterContext } from "../core/adapter";