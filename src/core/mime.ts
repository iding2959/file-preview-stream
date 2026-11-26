import type { PreviewKind } from "../types";

/**
 * 扩展名 → kind 注册表。以 Map 而非对象字面量承载，
 * 是为了让 registerKind 能在运行时追加（业务侧自定义后缀不用改库）。
 */
const KIND_BY_EXT = new Map<string, PreviewKind>([
	// pdf
	["pdf", "pdf"],
	// 图片：覆盖邮件附件里常见的位图格式
	["jpg", "image"],
	["jpeg", "image"],
	["png", "image"],
	["gif", "image"],
	["webp", "image"],
	["bmp", "image"],
	["ico", "image"],
	["svg", "image"],
	["avif", "image"],
	["tif", "image"],
	["tiff", "image"],
	// 视频
	["mp4", "video"],
	["webm", "video"],
	["mov", "video"],
	["m4v", "video"],
	["ogv", "video"],
	// 音频
	["mp3", "audio"],
	["wav", "audio"],
	["ogg", "audio"],
	["m4a", "audio"],
	["flac", "audio"],
	["aac", "audio"],
	// Office
	["docx", "docx"],
	["xlsx", "excel"],
	["xls", "excel"],
	["csv", "excel"],
	// 文本类
	["md", "markdown"],
	["markdown", "markdown"],
	["txt", "text"],
	["log", "text"],
	["json", "text"],
	["xml", "text"],
	["yaml", "text"],
	["yml", "text"],
	["ini", "text"],
	["conf", "text"],
	["html", "text"],
	["htm", "text"],
	["css", "text"],
	["js", "text"],
	["ts", "text"],
	["py", "text"],
	["java", "text"],
	["go", "text"],
	["rs", "text"],
	["sql", "text"],
	["sh", "text"],
]);

const MIME_BY_KIND: Record<PreviewKind, string> = {
	pdf: "application/pdf",
	image: "application/octet-stream",
	video: "application/octet-stream",
	audio: "application/octet-stream",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	markdown: "text/markdown",
	text: "text/plain",
	unsupported: "application/octet-stream",
};

/** 取小写扩展名；无扩展名或路径无 dot 时返回空串 */
export const extOf = (name = ""): string => {
	const base = name.split(/[\\/]/).pop() ?? "";
	const idx = base.lastIndexOf(".");
	// 开头即 dot 的文件（.gitignore）不当作扩展名
	if (idx <= 0 || idx === base.length - 1) return "";
	return base.slice(idx + 1).toLowerCase();
};

/** 注册或覆盖扩展名映射，返回旧值（便于调用方做撤销） */
export const registerKind = (ext: string, kind: PreviewKind): PreviewKind | undefined => {
	const key = ext.replace(/^\./, "").toLowerCase();
	const prev = KIND_BY_EXT.get(key);
	KIND_BY_EXT.set(key, kind);
	return prev;
};

/** 从 MIME 反推 kind，用于没有文件名但服务器给了 Content-Type 的场景 */
export const kindFromMime = (mime = ""): PreviewKind | undefined => {
	const value = mime.split(";")[0]?.trim().toLowerCase() ?? "";
	if (!value) return undefined;
	if (value === "application/pdf") return "pdf";
	if (value.startsWith("image/")) return "image";
	if (value.startsWith("video/")) return "video";
	if (value.startsWith("audio/")) return "audio";
	if (value.includes("wordprocessingml.document")) return "docx";
	if (value.includes("spreadsheetml.sheet")) return "excel";
	if (value === "text/csv") return "excel";
	if (value === "text/markdown") return "markdown";
	if (value.startsWith("text/")) return "text";
	if (value.includes("json")) return "text";
	return undefined;
};

/**
 * 识别优先级：显式 kind > 扩展名 > MIME。
 * 扩展名优先于 MIME 是因为压缩包类附件的 Content-Type 常被服务器统一写成
 * application/octet-stream，而扩展名携带的信息更可信。
 */
export const detectKind = (name = "", mime = ""): PreviewKind => {
	const byExt = KIND_BY_EXT.get(extOf(name));
	if (byExt) return byExt;
	return kindFromMime(mime) ?? "unsupported";
};

export const defaultMimeOf = (kind: PreviewKind): string => MIME_BY_KIND[kind] ?? "application/octet-stream";

/** 支持的全部扩展名，用于文档与校验 */
export const supportedExts = (): string[] => [...KIND_BY_EXT.keys()].sort();