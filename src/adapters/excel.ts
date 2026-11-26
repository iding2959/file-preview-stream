import { decodeText, looksLikeCsv } from "../core/binary";
import type { Adapter, AdapterContext } from "../core/adapter";
import { missingDependencyReason } from "../core/adapter";
import type { PreviewResult } from "../types";
import { loadOptional } from "../core/optional";

interface SheetJsModule {
	read: (data: unknown, opts?: Record<string, unknown>) => Workbook;
	utils: { sheet_to_html: (sheet: unknown, opts?: Record<string, unknown>) => string };
	default?: SheetJsModule;
}

interface Workbook {
	SheetNames: string[];
	Sheets: Record<string, unknown>;
}

/** 单个工作表的最小子集：判断是否为空只需要 !ref */
type SheetLike = Record<string, unknown> & { "!ref"?: string };

type Sanitize = (html: string, opts?: Record<string, unknown>) => string;

interface DomPurifyModule {
	/** 浏览器：带 sanitize 的实例；Node：需要传 window 的工厂函数 */
	default?: { sanitize?: Sanitize } | ((window: unknown) => { sanitize?: Sanitize });
	sanitize?: Sanitize;
}

const pickXlsx = (mod: unknown): SheetJsModule | undefined => {
	const m = mod as SheetJsModule;
	if (typeof m.read === "function") return m;
	if (m.default && typeof m.default.read === "function") return m.default;
	return undefined;
};

const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const EMPTY_SHEET_NOTICE = '<div class="empty-sheet">（空工作表）</div>';
const BROKEN_SHEET_NOTICE = '<div class="empty-sheet">（该工作表无法解析）</div>';

/**
 * WPS 内嵌图公式：=DISPIMG("ID_xxx",1)。
 *
 * 只匹配**标签之间的文本**，不动属性值。原因见 repairMalformedAttributes：
 * SheetJS 会把同一段公式原样写进 data-v 属性且不转义，在整段 HTML 上做
 * 宽松正则会连属性一起吃掉，把表格结构改坏。
 */
const DISPIMG_TEXT_RE =
	/(>)(\s*)(=DISPIMG\s*\(\s*(?:&quot;|")[^)<]*(?:&quot;|")\s*,\s*1\s*\))(?=\s*<)/gi;

const replaceDispImg = (html: string): string =>
	html.replace(
		DISPIMG_TEXT_RE,
		(_m, open: string, space: string) =>
			`${open}${space}<span class="disp-img">图片（WPS 内嵌，请下载原文件查看）</span>`
	);

/**
 * 修复 SheetJS 产出的畸形属性。
 *
 * 根治点：SheetJS 的 sheet_to_html 把单元格原始值写进 `data-v` 属性时**不做属性转义**，
 * 于是 `=DISPIMG("ID_x",1)` 会输出成 `data-v="=DISPIMG("ID_x",1)"` ——
 * 双引号提前闭合属性，浏览器把它解析成多余属性（实测会造出 `id_x",1)"` 这种伪属性）。
 * 这已经不是样式问题，而是结构性损坏：属性挂到了错误节点上。
 *
 * 这里按「属性名="值"」逐对重写：把值内部的裸 `"` 转成 &quot;。
 * 用逐字符扫描而不是正则，是因为畸形值里本身就带引号，正则无法可靠界定边界。
 */
const repairMalformedAttributes = (html: string): string => {
	let out = "";
	let i = 0;
	while (i < html.length) {
		const ch = html[i];
		if (ch !== "<") {
			out += ch;
			i++;
			continue;
		}
		// 标签边界：直到 '>'（属性值内的 > 在合法 HTML 中会被转义，这里不追求完备，只修属性引号）
		out += repairTag(html, i, (end) => {
			i = end;
		});
	}
	return out;
};

/** 重写单个标签内的属性，返回修正后的片段，并通过 onEnd 推进游标 */
const repairTag = (html: string, start: number, onEnd: (end: number) => void): string => {
	const limit = Math.min(html.length, start + 8192); // 单标签超长视为异常，放弃修复
	let i = start + 1;
	let out = "<";
	while (i < limit) {
		const ch = html[i]!;
		if (ch === ">") {
			onEnd(i + 1);
			return `${out}>`;
		}
		// 属性名之间只有**空格类空白**——不能用 \s：它包含 tab，
		// 而 SheetJS 的 data-v 值里可能就带 tab（"\ttab"），
		// 用 \s 会把值内的 tab 当成属性分隔符吃掉
		if (/ |\t|\r|\n|\f/.test(ch)) {
			out += ch;
			i++;
			continue;
		}
		if (ch === "/") {
			out += ch;
			i++;
			continue;
		}
		// 属性名：读到 = 或空白或 >
		let name = "";
		while (i < limit && !/[ \t\r\n\f=>]/.test(html[i]!)) {
			name += html[i];
			i++;
		}
		out += name;
		if (html[i] !== "=") continue;

		// '='，看值是否用双引号包裹
		i++;
		out += "=";
		if (html[i] !== '"') {
			// 无引号值：原样读到空白
			while (i < limit && !/[ \t\r\n\f>]/.test(html[i]!)) {
				out += html[i];
				i++;
			}
			continue;
		}
		// 双引号值：值内允许任意字符（含 tab / 换行），只把裸引号转义后继续
		let value = "";
		i++; // 跳过起始引号
		while (i < limit) {
			const c = html[i]!;
			if (c === '"') {
				const next = html[i + 1];
				// 结束引号的判据：后面紧跟属性分隔空白、'/' 或 '>'
				if (next === undefined || next === ">" || next === "/" || / |\t|\r|\n|\f/.test(next)) {
					i++; // 跳过结束引号
					out += `"${value}"`;
					break;
				}
				// 值内部的裸引号 → 转义后继续
				value += "&quot;";
				i++;
				continue;
			}
			value += c;
			i++;
		}
	}
	onEnd(Math.min(i, html.length));
	return out;
};

/** 多 sheet 拼 HTML 时给每张表加标题，否则用户看不出分了几张表 */
const workbookToHtml = (xlsx: SheetJsModule, wb: Workbook): string =>
	wb.SheetNames.map((name) => {
		const sheet = wb.Sheets[name] as SheetLike | undefined;
		const head = `<section data-sheet="${escapeHtml(name)}"><h4>${escapeHtml(name)}</h4>`;

		// 空表的 !ref 是 undefined，sheet_to_html 会抛
		// TypeError: Cannot read properties of undefined (reading 'indexOf')。
		// 一个空表就让整本工作簿预览失败 —— WPS 导出的 xlsx 普遍带空表，必须先挡掉
		if (!sheet || !sheet["!ref"]) {
			return `${head}${EMPTY_SHEET_NOTICE}</section>`;
		}

		let table: string;
		try {
			table = xlsx.utils.sheet_to_html(sheet, { header: "", footer: "" });
		} catch {
			// 单表异常不牵连其他表：一张坏表不该让整本工作簿变成 unsupported
			table = BROKEN_SHEET_NOTICE;
		}
		return `${head}${table}</section>`;
	}).join("");

/**
 * 取一个可用的净化函数。
 *
 * dompurify 的导出有两种形态，**必须靠「有没有 window」来区分，不能靠 typeof**：
 * - 浏览器：模块求值时已绑定 document，导出的是带 sanitize 的实例
 * - Node：导出的是工厂函数 `root => createDOMPurify(root)`，要传 window 才有实例
 *   且该工厂函数自身没有 sanitize 属性
 * 之前按 `typeof candidate === "function"` 就当作 sanitize 函数，导致把工厂函数
 * 直接当净化器调用，输出的是函数源码字符串——整个单元格内容被替换掉。
 */
const resolveSanitizer = async (): Promise<Sanitize | undefined> => {
	const mod = await loadOptional<DomPurifyModule>("dompurify");
	if (!mod) return undefined;

	/**
	 * 从任意导出里取 sanitize。
	 *
	 * 注意：**函数也要认**。dompurify 在浏览器环境下导出的是个函数，
	 * 它自己挂着已绑定 document 的 `.sanitize`；只认 object 会漏掉这条主路径。
	 */
	const asInstance = (v: unknown): Sanitize | undefined => {
		const holder = v as { sanitize?: unknown } | null | undefined;
		if (holder && (typeof v === "function" || typeof v === "object") && typeof holder.sanitize === "function") {
			return holder.sanitize as Sanitize;
		}
		return undefined;
	};

	// 形态一：具名导出直接是 sanitize 函数（非默认导出的构建）
	if (typeof mod.sanitize === "function") return mod.sanitize;
	// 形态二：默认导出是实例对象
	const fromDefaultInstance = asInstance(mod.default);
	if (fromDefaultInstance) return fromDefaultInstance;

	// 形态三：默认导出是工厂，需要 window
	const win = (globalThis as { window?: unknown }).window;
	if (typeof mod.default === "function" && win) {
		try {
			return asInstance((mod.default as (w: unknown) => unknown)(win));
		} catch {
			return undefined;
		}
	}
	return undefined;
};

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
		const xlsx = pickXlsx(await loadOptional<unknown>("xlsx"));
		if (!xlsx) return { reason: missingDependencyReason("xlsx") };

		const isCsv = looksLikeCsv(ctx.name, ctx.mime);
		let wb: Workbook;
		try {
			wb = isCsv
				? xlsx.read(decodeText(ctx.bytes).text, { type: "string" })
				: xlsx.read(ctx.bytes, { type: "array" });
		} catch (err) {
			// 读不出来才真的失败，这时 reason 要能说明是文件问题而不是内部错误
			const message = err instanceof Error ? err.message : String(err);
			return { reason: `无法解析该文件为表格：${message}` };
		}

		// 先修 SheetJS 的属性转义缺陷，再处理内嵌图公式：
		// 顺序不能反 —— 属性修好之后，data-v 已不再含裸引号，
		// 后续正则才不会被属性内容干扰
		const raw = replaceDispImg(repairMalformedAttributes(workbookToHtml(xlsx, wb)));

		if (options.skipSanitize) return { html: raw, unsafe: true };

		const sanitize = await resolveSanitizer();
		if (!sanitize) {
			// 分不清「没装」与「装了但无 window」会误导调用方：
			// Node 侧缺 window 是环境事实，不该让用户去 npm i 一个已经装好的包
			return {
				html: raw,
				unsafe: true,
				reason: "未净化：当前环境没有 DOM window，无法运行 DOMPurify。浏览器端会自动净化",
			};
		}

		return { html: sanitize(raw), unsafe: false };
	};

export type { PreviewResult };
export type { Adapter, AdapterContext } from "../core/adapter";