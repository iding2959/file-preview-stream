import { unzipSync } from "fflate";
import type { Adapter, AdapterContext } from "../core/adapter";
import type { PptxSlide } from "../types";
import { escapeHtml, sniffContainer } from "../core/binary";
import { loadOptional } from "../core/optional";

/** 解压总量上限，与 archive 同口径：pptx 也是 zip，同样存在膨胀风险 */
const MAX_UNCOMPRESSED = 128 * 1024 * 1024;

interface PptxPreviewModule {
	init?: (
		el: HTMLElement,
		options: Record<string, unknown>
	) => { preview: (data: ArrayBuffer | Uint8Array) => Promise<unknown> };
	default?: PptxPreviewModule;
}

/**
 * 可选的 pptx-preview 高保真适配器。
 *
 * 它不在 dependencies 里：硬依赖 echarts（打包后数 MB）且源码闭源，
 * 不能压在核心包里。装了的人通过 registerAdapter("pptx", pptxAdapter({ hiFi: true }))
 * 覆盖成「视觉接近 PowerPoint」的渲染，没装的人走下面的自研大纲，两条路径都不崩。
 */
export const pptxAdapter =
	(options: { hiFi?: boolean } = {}): Adapter =>
	async (ctx) => {
		if (options.hiFi) {
			const hiFi = await loadHiFi(ctx);
			if (hiFi) return hiFi;
			// 声明要 hiFi 但没装：不要静默降级成大纲，调用方需要知道差别
			const outline = await buildOutline(ctx);
			return { ...outline, reason: "未安装 pptx-preview，已降级为文本大纲预览（npm i pptx-preview 可启用高保真渲染）" };
		}
		return buildOutline(ctx);
	};

/** 高保真渲染器只产出 render(container)，与 docx 同一种契约：DOM 由调用方持有 */
const loadHiFi = async (ctx: AdapterContext): Promise<{ render: (c: HTMLElement) => Promise<void>; hiFi: boolean; slides: PptxSlide[] } | undefined> => {
	const mod = await loadOptional<PptxPreviewModule>("pptx-preview");
	if (!mod) return undefined;
	const init = mod.init ?? mod.default?.init;
	if (!init) return undefined;

	const slides = await buildOutline(ctx).then((r) => r.slides ?? []);
	const bytes = ctx.bytes;
	const render = async (container: HTMLElement): Promise<void> => {
		// pptx-preview 自己会清空并挂载节点；这里只负责把宿主容器准备好
		container.innerHTML = "";
		const rect = container.getBoundingClientRect?.();
		const width = Math.max(320, Math.round(rect?.width || container.clientWidth || 960));
		// 16:9 是 PowerPoint 默认版式；保持比例避免拉伸
		const viewer = init(container, { width, height: Math.round((width * 9) / 16), renderMode: "list" });
		await viewer.preview(bytes);
	};

	return { render, hiFi: true, slides };
};

/** 取出 XML 里所有 <a:t> 文本节点，保持文档顺序 */
const extractTextRuns = (xml: string): string[] => {
	const out: string[] = [];
	const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) {
		const raw = decodeXmlEntities(m[1] ?? "").trim();
		if (raw) out.push(raw);
	}
	return out;
};

const decodeXmlEntities = (s: string): string =>
	s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
		// &amp; 必须最后替换，否则 &amp;lt; 会被拆成 < 
		.replace(/&amp;/g, "&");

/** 幻灯片页内引用的图片关系：r:embed="rId2" → ppt/media/image1.png */
const extractImageRefs = (xml: string): string[] => {
	const ids = new Set<string>();
	const re = /r:embed="([^"]+)"/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(xml)) !== null) if (m[1]) ids.add(m[1]);
	return [...ids];
};

const MIME_BY_EXT: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	bmp: "image/bmp",
	svg: "image/svg+xml",
	emf: "image/emf",
	wmf: "image/wmf",
	tif: "image/tiff",
	tiff: "image/tiff",
};

const bytesToDataUrl = (bytes: Uint8Array, mime: string): string => {
	// Node 与浏览器都有 Buffer 语义的 base64 入口差异，用 btoa 兜底
	const g = globalThis as { Buffer?: { from: (b: Uint8Array) => { toString: (enc: string) => string } } };
	const base64 =
		g.Buffer !== undefined
			? g.Buffer.from(bytes).toString("base64")
			: btoa(String.fromCharCode(...bytes));
	return `data:${mime};base64,${base64}`;
};

/** slideN.xml → 第 N 页序号；用文件名里的数字排序而不是字典序（slide10 必须在 slide2 之后） */
const slideIndexOf = (path: string): number => {
	const m = /slide(\d+)\.xml$/.exec(path);
	return m?.[1] ? Number(m[1]) : 0;
};

const notesIndexOf = (path: string): number => {
	const m = /notesSlide(\d+)\.xml$/.exec(path);
	return m?.[1] ? Number(m[1]) : 0;
};

const buildOutline = async (
	ctx: AdapterContext
): Promise<{ html: string; slides: PptxSlide[]; unsafe: boolean; reason?: string }> => {
	if (sniffContainer(ctx.bytes) !== "zip") {
		// .ppt（97-2003 二进制）与损坏文件都落在这里，明确区分比笼统报错有用
		return {
			html: "",
			slides: [],
			unsafe: false,
			reason: "不是有效的 pptx（OOXML）文件：旧版 .ppt 二进制格式不支持预览，请另存为 .pptx",
		};
	}

	let files: Record<string, Uint8Array>;
	try {
		let total = 0;
		files = unzipSync(ctx.bytes, {
			filter: (f) => {
				total += f.originalSize ?? 0;
				return total <= MAX_UNCOMPRESSED;
			},
		});
	} catch (err) {
		return {
			html: "",
			slides: [],
			unsafe: false,
			reason: `pptx 解包失败: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const decoder = new TextDecoder("utf-8");
	const slidePaths = Object.keys(files)
		.filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
		.sort((a, b) => slideIndexOf(a) - slideIndexOf(b));
	if (!slidePaths.length) {
		return { html: "", slides: [], unsafe: false, reason: "pptx 内未找到幻灯片（可能已损坏或非标准 OOXML）" };
	}

	const notesPaths = Object.keys(files).filter((p) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(p));
	const notesByIndex = new Map<number, string[]>();
	for (const p of notesPaths) {
		const xml = decoder.decode(files[p]!);
		const lines = extractTextRuns(xml);
		// 备注页第一段通常是页码占位，去掉只剩数字的行
		const cleaned = lines.filter((l) => !/^\d+$/.test(l));
		if (cleaned.length) notesByIndex.set(notesIndexOf(p), cleaned);
	}

	const slides: PptxSlide[] = slidePaths.map((p, i) => {
		const xml = decoder.decode(files[p]!);
		const lines = extractTextRuns(xml);
		const refs = extractImageRefs(xml);
		// 关系 id 与文件名的映射在 rels 里，这里按 rels 解析；缺失时退化为按页序取媒体
		const relsPath = `ppt/slides/_rels/slide${slideIndexOf(p)}.xml.rels`;
		const relsXml = files[relsPath] ? decoder.decode(files[relsPath]!) : "";
		const targetByRel = new Map<string, string>();
		const relRe = /Id="([^"]+)"[^>]*Target="([^"]+)"/g;
		let rm: RegExpExecArray | null;
		while ((rm = relRe.exec(relsXml)) !== null) {
			if (rm[1] && rm[2]) targetByRel.set(rm[1], rm[2]);
		}

		const images: string[] = [];
		for (const ref of refs) {
			const target = targetByRel.get(ref);
			if (!target) continue;
			// Target 可能是 ../media/image1.png 形式，归一到包内绝对路径
			const normalized = target.startsWith("/")
				? target.slice(1)
				: `ppt/${target.replace(/^\.\.\//, "")}`;
			const data = files[normalized];
			if (!data) continue;
			const ext = normalized.split(".").pop()?.toLowerCase() ?? "";
			const mime = MIME_BY_EXT[ext];
			// EMF/WMF 浏览器不渲染，直接跳过而不是塞个坏图
			if (!mime || mime === "image/emf" || mime === "image/wmf") continue;
			images.push(bytesToDataUrl(data, mime));
		}

		return { index: i + 1, lines, images, notes: notesByIndex.get(slideIndexOf(p)) };
	});

	return { html: slidesToHtml(slides), slides, unsafe: false };
};

const slidesToHtml = (slides: PptxSlide[]): string =>
	`<div class="fps-pptx" data-slides="${slides.length}">` +
	slides
		.map((s) => {
			const body = s.lines.length
				? s.lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")
				: `<p class="fps-empty">（本页无文字）</p>`;
			const imgs = s.images.map((src, i) => `<img src="${src}" alt="第${i + 1}张图" loading="lazy" />`).join("");
			const notes = s.notes?.length
				? `<aside class="fps-notes">${s.notes.map((n) => escapeHtml(n)).join(" ")}</aside>`
				: "";
			return (
				`<section class="fps-slide" data-index="${s.index}">` +
				`<header>第 ${s.index} 页</header><div class="fps-slide-body">${body}${imgs}</div>${notes}</section>`
			);
		})
		.join("") +
	`</div>`;

export { buildOutline };