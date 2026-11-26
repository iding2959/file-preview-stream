import { unzipSync } from "fflate";
import type { Adapter, AdapterContext } from "../core/adapter";
import type { ArchiveEntry, ArchiveEntryKind, PreviewResult } from "../types";
import { escapeHtml, formatBytes, sniffContainer } from "../core/binary";
import { readRar5 as readRar5Fn } from "../core/rar5";

/** 解压总量上限。zip bomb 是真实存在的攻击面：42KB 的 zip 可以膨胀到 4PB */
const MAX_TOTAL_UNCOMPRESSED = 256 * 1024 * 1024;
/** 条目数上限：条目表要渲染成 DOM，太多会直接把页面卡死 */
const MAX_ENTRIES = 2000;
/** 单个条目超过这个大小就只列清单不惰性解压，避免用户点一下等十秒 */
const MAX_ENTRY_PREVIEW = 64 * 1024 * 1024;
const trimSlash = (p: string): string => p.replace(/^\/+/, "");

/**
 * 惰性条目：把「取得字节」这件事推迟到调用方真正要预览时才做。
 * zip 走内存已有字节切片，rar 走 unrar-js 已解出的 fileData。
 */
const makeEntry = (
	path: string,
	size: number,
	isDir: boolean,
	getBytes: () => Uint8Array | undefined,
	ctx: AdapterContext,
	blocked?: string
): ArchiveEntry => {
	if (isDir) {
		return { path, uncompressedSize: 0, isDir: true, preview: async () => unsupported(path, "目录不是可预览的文件") };
	}
	if (blocked) {
		return {
			path,
			uncompressedSize: size,
			isDir: false,
			error: blocked,
			preview: async () => unsupported(path, blocked),
		};
	}
	return {
		path,
		uncompressedSize: size,
		isDir: false,
		preview: async (): Promise<PreviewResult> => {
			const bytes = getBytes();
			if (!bytes) return unsupported(path, "该条目内容不可用（可能已超出解压上限）");
			return ctx.preview(bytes, { ...ctx.options, name: path });
		},
	};
};

const unsupported = (name: string, reason: string): PreviewResult => ({
	kind: "unsupported",
	mime: "application/octet-stream",
	name,
	size: 0,
	reason,
	revoke: () => {},
});

/** 目录条目从文件路径推导：zip 里很多生成器不写显式目录条目，靠路径补全才能画出正确的树 */
const collectDirs = (paths: string[]): string[] => {
	const dirs = new Set<string>();
	for (const p of paths) {
		const parts = trimSlash(p).split("/");
		// 最后一段是文件名，不出目录
		for (let i = 1; i < parts.length; i++) {
			const d = parts.slice(0, i).join("/");
			if (d) dirs.add(`${d}/`);
		}
	}
	return [...dirs];
};

const entriesToHtml = (entries: ArchiveEntry[], kind: ArchiveEntryKind, total: number): string => {
	const rows = entries
		.map((e) => {
			const name = escapeHtml(e.path);
			const size = e.isDir ? "—" : escapeHtml(formatBytes(e.uncompressedSize));
			const state = e.error ? `<span class="fps-warn">${escapeHtml(e.error)}</span>` : "";
			return `<tr data-path="${name}"><td>${name}</td><td data-size>${size}</td><td>${state}</td></tr>`;
		})
		.join("");
	// 只给结构与最小样式，不引入任何 CSS 依赖：调用方的样式体系说了算
	return (
		`<div class="fps-archive" data-container="${kind}" data-count="${entries.length}" data-bytes="${total}">` +
		`<table class="fps-archive-table"><thead><tr><th>路径</th><th>大小</th><th></th></tr></thead>` +
		`<tbody>${rows}</tbody></table></div>`
	);
};

const archiveResult = (
	entries: ArchiveEntry[],
	container: ArchiveEntryKind,
	reason?: string
): { html: string; entries: ArchiveEntry[]; container: ArchiveEntryKind; unsafe: boolean; reason?: string } => {
	const total = entries.reduce((sum, e) => sum + (e.isDir ? 0 : e.uncompressedSize), 0);
	return {
		html: entriesToHtml(entries, container, total),
		entries,
		container,
		// 条目名已转义，无脚本风险
		unsafe: false,
		...(reason ? { reason } : {}),
	};
};

/**
 * zip 解析。
 *
 * 用 fflate 的 unzipSync 而不是流式：预览场景文件通常 <100MB，
 * 同步解压在浏览器主线程可接受，换来的是零 async 复杂度与浏览器/Node 同码。
 */
const readZip = async (ctx: AdapterContext): Promise<ReturnType<typeof archiveResult>> => {
	let total = 0;
	let truncated = false;
	const files: Record<string, Uint8Array> = unzipSync(ctx.bytes, {
		// filter 里累计解压后体积，超阈值直接跳过剩余条目——这是唯一能在解压前挡住 zip bomb 的钩子
		filter: (file) => {
			if (file.name.endsWith("/")) return false;
			if (truncated) return false;
			total += file.originalSize ?? 0;
			if (total > MAX_TOTAL_UNCOMPRESSED) {
				truncated = true;
				return false;
			}
			return true;
		},
	});

	const paths = Object.keys(files).map(trimSlash).filter(Boolean);
	const dirs = collectDirs(paths);
	const entries: ArchiveEntry[] = [];

	for (const d of dirs.slice(0, MAX_ENTRIES)) {
		entries.push(makeEntry(d, 0, true, () => undefined, ctx));
	}
	for (const p of paths.slice(0, Math.max(0, MAX_ENTRIES - entries.length))) {
		const data = files[p]!;
		const blocked =
			data.length > MAX_ENTRY_PREVIEW
				? `条目超过 ${formatBytes(MAX_ENTRY_PREVIEW)}，已跳过以避免卡顿`
				: undefined;
		entries.push(makeEntry(p, data.length, false, () => data, ctx, blocked));
	}

	// 目录排在文件前，符合资源管理器的阅读直觉
	entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));

	const reasons: string[] = [];
	if (truncated) reasons.push(`解压已超过 ${formatBytes(MAX_TOTAL_UNCOMPRESSED)} 上限，后续条目被跳过`);
	if (entries.length >= MAX_ENTRIES) reasons.push(`条目数超过 ${MAX_ENTRIES}，已截断`);

	return archiveResult(entries, "zip", reasons.length ? reasons.join("；") : undefined);
};

interface RarFileEntry {
	filename: string;
	header?: { flags?: { LHD_PASSWORD?: boolean }; unpackedSize?: number };
	fileData?: Uint8Array;
	isValid?: boolean;
}

/**
 * RAR5 解析：走可选的 WASM 后端。
 *
 * 分版本是因为纯 JS 的 unrar-js 只实现到 RAR 2.9 解码器，RAR5 会直接抛错。
 * RAR5 是当前主流格式，所以给它补一条 WASM 路径——但做成可选依赖：
 * 装了就自动生效，没装就明确降级，不让只预览 zip 的人背上 207KB wasm。
 */
const readRar5Archive = async (ctx: AdapterContext): Promise<ReturnType<typeof archiveResult>> => {
	// 小归档直接连内容一起解出（RAR 是流式格式，二次打开比一次解完更贵）；
	// 超限时只列清单，避免把几百 MB 全塞进内存
	const wantContent = ctx.size <= MAX_TOTAL_UNCOMPRESSED;
	let list: Awaited<ReturnType<typeof readRar5Fn>>;
	try {
		list = await readRar5Fn(ctx.bytes, wantContent);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return archiveResult([], "rar5", `RAR5 解析失败: ${message || "归档可能已加密或损坏"}`);
	}

	// undefined 表示后端不可用（没装 node-unrar-js 或取不到 wasm）
	if (!list) {
		return archiveResult(
			[],
			"rar5",
			"RAR5 需要可选依赖 node-unrar-js 才能解压。安装后自动启用：npm i node-unrar-js；或引导用户重新打包为 zip"
		);
	}

	const entries: ArchiveEntry[] = [];
	for (const item of list) {
		const path = trimSlash(item.name);
		if (!path) continue;
		if (item.isDir) {
			entries.push(makeEntry(path, 0, true, () => undefined, ctx));
			continue;
		}
		const blocked =
			item.encrypted
				? "该条目已加密，无法解压"
				: item.size > MAX_ENTRY_PREVIEW
					? `条目超过 ${formatBytes(MAX_ENTRY_PREVIEW)}，已跳过以避免卡顿`
					: item.bytes === undefined
						? "该条目内容未解出（归档过大已跳过解压，或用例不受支持）"
						: undefined;
		entries.push(makeEntry(path, item.size, false, () => item.bytes, ctx, blocked));
	}

	// 与 zip 一致：按路径补隐式目录
	const filePaths = entries.filter((e) => !e.isDir).map((e) => e.path);
	for (const d of collectDirs(filePaths)) {
		if (!entries.some((e) => e.path === d)) entries.push(makeEntry(d, 0, true, () => undefined, ctx));
	}
	entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));

	const reason = wantContent ? undefined : `归档超过 ${formatBytes(MAX_TOTAL_UNCOMPRESSED)}，仅列出清单未解压`;
	return archiveResult(entries, "rar5", reason);
};

/**
 * RAR4 解析：纯 JS 解码器。
 *
 * 加密归档在这里解不了（unrar-js 会抛 undefined），翻译成人话再返回。
 */
const readRar4 = async (ctx: AdapterContext): Promise<ReturnType<typeof archiveResult>> => {

	let files: RarFileEntry[] = [];
	try {
		// unrar-js 的包入口依赖 fs/child_process，浏览器不可用；
		// 真正可移植的是它内部的 lib/Unrar.js（纯 Uint8Array + EventEmitter）。
		// CJS 互操作下默认导出可能挂在 .default 上，两种形状都兼容。
		const mod = (await import("unrar-js/lib/Unrar.js")) as unknown as
			| { default?: (data: Uint8Array) => RarFileEntry[] }
			| ((data: Uint8Array) => RarFileEntry[]);
		const unrar = typeof mod === "function" ? mod : mod.default;
		if (typeof unrar !== "function") throw new Error("unrar-js 解码器不可用");
		files = unrar(ctx.bytes) ?? [];
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		// 加密归档的失败信息不友好（undefined），这里翻成人话
		return archiveResult([], "rar4", `RAR 解析失败: ${message || "归档可能已加密或损坏"}`);
	}

	let total = 0;
	let truncated = false;
	const entries: ArchiveEntry[] = [];
	const paths: string[] = [];
	for (const f of files) {
		const path = trimSlash(f.filename);
		if (!path) continue;
		if (path.endsWith("/")) {
			entries.push(makeEntry(path, 0, true, () => undefined, ctx));
			continue;
		}
		paths.push(path);
	}
	// RAR4 的目录条目也不一定完整，同样按路径补
	for (const d of collectDirs(paths)) {
		if (!entries.some((e) => e.path === d)) entries.push(makeEntry(d, 0, true, () => undefined, ctx));
	}

	for (const f of files) {
		const path = trimSlash(f.filename);
		if (!path || path.endsWith("/")) continue;
		if (entries.filter((e) => !e.isDir).length >= MAX_ENTRIES) break;
		const size = f.header?.unpackedSize ?? f.fileData?.length ?? 0;
		total += size;
		if (total > MAX_TOTAL_UNCOMPRESSED) {
			truncated = true;
			break;
		}
		const encrypted = f.header?.flags?.LHD_PASSWORD === true;
		const blocked = encrypted
			? "该条目已加密，无法解压"
			: size > MAX_ENTRY_PREVIEW
				? `条目超过 ${formatBytes(MAX_ENTRY_PREVIEW)}，已跳过以避免卡顿`
				: undefined;
		entries.push(makeEntry(path, size, false, () => f.fileData, ctx, blocked));
	}

	entries.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.path.localeCompare(b.path));
	const reason = truncated ? `解压已超过 ${formatBytes(MAX_TOTAL_UNCOMPRESSED)} 上限，后续条目被跳过` : undefined;
	return archiveResult(entries, "rar4", reason);
};

/**
 * 归档处理：只出清单 + 惰性条目，不预先解压全部内容。
 *
 * 7z / tar / gz / bz2 / xz 目前没有「小依赖」级方案，识别成 archive 后
 * 明确说明不支持，比归到 unsupported 更有信息量（调用方知道该提示什么）。
 */
export const archiveAdapter: Adapter = async (ctx) => {
	const container = sniffContainer(ctx.bytes);

	if (container === "zip") return readZip(ctx);
	if (container === "rar4") return readRar4(ctx);
	if (container === "rar5") return readRar5Archive(ctx);

	return {
		html: entriesToHtml([], "zip", 0),
		entries: [],
		container: "zip",
		unsafe: false,
		reason: "该归档格式暂不支持解析（目前支持 zip 与 RAR4 的目录浏览）",
	};
};

/** 给测试与自定义适配器用：把字节按容器类型分派 */
export const readArchive = async (
	bytes: Uint8Array,
	ctx: AdapterContext
): Promise<ReturnType<typeof archiveResult>> => {
	const container = sniffContainer(bytes);
	if (container === "rar4") return readRar4({ ...ctx, bytes });
	if (container === "rar5") return readRar5Archive({ ...ctx, bytes });
	return readZip({ ...ctx, bytes });
};

export type { ArchiveEntry, ArchiveEntryKind };