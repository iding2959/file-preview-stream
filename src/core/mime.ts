import type { PreviewKind } from "../types";

/**
 * 扩展名 → kind 注册表。以 Map 而非对象字面量承载，
 * 是为了让 registerKind 能在运行时追加（业务侧自定义后缀不用改库）。
 */
const KIND_BY_EXT = new Map<string, PreviewKind>([
	// pdf
	["pdf", "pdf"],

	// 图片：覆盖邮件附件与截图工具常见的位图格式
	["jpg", "image"],
	["jpeg", "image"],
	["jpe", "image"],
	["jfif", "image"],
	["pjpeg", "image"],
	["pjp", "image"],
	["png", "image"],
	["apng", "image"],
	["gif", "image"],
	["webp", "image"],
	["bmp", "image"],
	["ico", "image"],
	["cur", "image"],
	["avif", "image"],
	["tif", "image"],
	["tiff", "image"],

	// svg 单列：可内嵌脚本，渲染方式与位图不同，不能混进 image
	["svg", "svg"],
	["svgz", "svg"],

	// 视频：浏览器原生支持 mp4/webm/ogv；其余识别出来也便于统一降级提示
	["mp4", "video"],
	["m4v", "video"],
	["webm", "video"],
	["ogv", "video"],
	["mov", "video"],
	["qt", "video"],
	["mpg", "video"],
	["mpeg", "video"],
	["mpe", "video"],
	["m2v", "video"],
	["avi", "video"],
	["3gp", "video"],
	["3g2", "video"],
	["mkv", "video"],

	// 音频
	["mp3", "audio"],
	["wav", "audio"],
	["ogg", "audio"],
	["oga", "audio"],
	["opus", "audio"],
	["m4a", "audio"],
	["weba", "audio"],
	["flac", "audio"],
	["aac", "audio"],
	["wma", "audio"],
	["mid", "audio"],
	["midi", "audio"],
	["amr", "audio"],

	// Office
	["docx", "docx"],
	["xlsx", "excel"],
	["xlsm", "excel"],
	["xls", "excel"],
	["csv", "excel"],
	// tsv 是表格语义：当表格预览比当纯文本有用，调用方要纯文本可自行改注册
	["tsv", "excel"],

	// pptx：与 docx 同为 OOXML，但渲染路径完全不同（无 docx-preview 等价物）
	["pptx", "pptx"],
	["potx", "pptx"],
	["ppsx", "pptx"],
	["pptm", "pptx"],

	// 归档：只做目录树与惰性解压，不做「打开即全解」
	["zip", "archive"],
	["rar", "archive"],
	["7z", "archive"],
	["tar", "archive"],
	["gz", "archive"],
	["tgz", "archive"],
	["bz2", "archive"],
	["xz", "archive"],

	// 邮件：正文可能是 HTML，附件可递归预览
	["eml", "eml"],
	["mht", "eml"],
	["mhtml", "eml"],

	// markdown
	["md", "markdown"],
	["markdown", "markdown"],
	["mdown", "markdown"],
	["mkd", "markdown"],
	["mkdn", "markdown"],
	["mdx", "markdown"],

	// html 单列：当纯文本会丢排版，当 HTML 渲染又需沙箱，所以两者都不合适
	["html", "html"],
	["htm", "html"],
	["xhtml", "html"],

	// 纯文本与源码
	["txt", "text"],
	["text", "text"],
	["log", "text"],
	["json", "text"],
	["jsonc", "text"],
	["json5", "text"],
	["xml", "text"],
	["xsl", "text"],
	["xsd", "text"],
	["yaml", "text"],
	["yml", "text"],
	["toml", "text"],
	["ini", "text"],
	["cfg", "text"],
	["conf", "text"],
	["properties", "text"],
	["env", "text"],
	["diff", "text"],
	["patch", "text"],
	["css", "text"],
	["scss", "text"],
	["sass", "text"],
	["less", "text"],
	["js", "text"],
	["mjs", "text"],
	["cjs", "text"],
	["jsx", "text"],
	["ts", "text"],
	["mts", "text"],
	["cts", "text"],
	["tsx", "text"],
	["vue", "text"],
	["svelte", "text"],
	["py", "text"],
	["pyi", "text"],
	["ipynb", "text"],
	["java", "text"],
	["kt", "text"],
	["kts", "text"],
	["scala", "text"],
	["groovy", "text"],
	["go", "text"],
	["rs", "text"],
	["c", "text"],
	["h", "text"],
	["cc", "text"],
	["cpp", "text"],
	["cxx", "text"],
	["hpp", "text"],
	["cs", "text"],
	["m", "text"],
	["mm", "text"],
	["swift", "text"],
	["rb", "text"],
	["php", "text"],
	["lua", "text"],
	["pl", "text"],
	["r", "text"],
	["dart", "text"],
	["ex", "text"],
	["exs", "text"],
	["erl", "text"],
	["hs", "text"],
	["clj", "text"],
	["scm", "text"],
	["lisp", "text"],
	["rst", "text"],
	["tex", "text"],
	["bib", "text"],
	["proto", "text"],
	["graphql", "text"],
	["gql", "text"],
	["sql", "text"],
	["sh", "text"],
	["bash", "text"],
	["zsh", "text"],
	["fish", "text"],
	["bat", "text"],
	["cmd", "text"],
	["ps1", "text"],
	["psm1", "text"],
	["vbs", "text"],
	["asm", "text"],
	["s", "text"],
	["tf", "text"],
	["hcl", "text"],
	["dockerfile", "text"],
	["makefile", "text"],
	["cmake", "text"],
	["gradle", "text"],
	["lock", "text"],
]);

/**
 * 无扩展名但文件名固定已知的文件。
 *
 * 这类文件在真实附件里很常见（Dockerfile、Makefile、.env），
 * 光靠扩展名会全部落到 unsupported，而它们本质就是纯文本。
 */
const KIND_BY_BASENAME = new Map<string, PreviewKind>([
	["dockerfile", "text"],
	["makefile", "text"],
	["gemfile", "text"],
	["rakefile", "text"],
	["procfile", "text"],
	["vagrantfile", "text"],
	["jenkinsfile", "text"],
	["cmakelists.txt", "text"],
	["license", "text"],
	["licence", "text"],
	["readme", "text"],
	["changelog", "text"],
	["authors", "text"],
	["contributors", "text"],
	["notice", "text"],
	["copying", "text"],
	["todo", "text"],
	[".gitignore", "text"],
	[".gitattributes", "text"],
	[".gitmodules", "text"],
	[".dockerignore", "text"],
	[".npmignore", "text"],
	[".npmrc", "text"],
	[".editorconfig", "text"],
	[".env", "text"],
	[".babelrc", "text"],
	[".eslintrc", "text"],
	[".prettierrc", "text"],
]);

const MIME_BY_KIND: Record<PreviewKind, string> = {
	pdf: "application/pdf",
	image: "application/octet-stream",
	svg: "image/svg+xml",
	video: "application/octet-stream",
	audio: "application/octet-stream",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	excel: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	archive: "application/zip",
	eml: "message/rfc822",
	markdown: "text/markdown",
	html: "text/html",
	text: "text/plain",
	unsupported: "application/octet-stream",
};

/** 取 basename（去掉目录部分），保留前导点以便匹配 .gitignore 这类文件 */
export const basenameOf = (name = ""): string => (name.split(/[\\/]/).pop() ?? "").toLowerCase();

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
	// svg 必须在 image/* 之前判断，否则会被当成位图
	if (value === "image/svg+xml") return "svg";
	if (value.startsWith("image/")) return "image";
	if (value.startsWith("video/")) return "video";
	if (value.startsWith("audio/")) return "audio";
	if (value.includes("wordprocessingml.document")) return "docx";
	if (value.includes("spreadsheetml.sheet")) return "excel";
	// presentationml 先于通用 ooxml 判断，否则会被当成 docx/excel
	if (value.includes("presentationml")) return "pptx";
	if (value === "message/rfc822") return "eml";
	// 压缩包类：服务器常给 octet-stream，靠扩展名兜底；这里覆盖给了正确 MIME 的情形
	if (
		value === "application/zip" ||
		value === "application/x-zip-compressed" ||
		value === "application/vnd.rar" ||
		value === "application/x-rar-compressed" ||
		value === "application/x-7z-compressed" ||
		value === "application/x-tar" ||
		value === "application/gzip"
	) {
		return "archive";
	}
	if (value === "text/csv") return "excel";
	if (value === "text/tab-separated-values") return "excel";
	if (value === "text/markdown") return "markdown";
	if (value === "text/html") return "html";
	if (value.startsWith("text/")) return "text";
	if (value.includes("json")) return "text";
	return undefined;
};

/**
 * 识别优先级：显式 kind > 固定文件名 > 扩展名 > MIME。
 *
 * 扩展名优先于 MIME 是因为压缩包类附件的 Content-Type 常被服务器统一写成
 * application/octet-stream，而扩展名携带的信息更可信。
 * 固定文件名排在扩展名之前，是为了让 Makefile 这类无后缀文件也能命中。
 */
export const detectKind = (name = "", mime = ""): PreviewKind => {
	const byBasename = KIND_BY_BASENAME.get(basenameOf(name));
	if (byBasename) return byBasename;
	const byExt = KIND_BY_EXT.get(extOf(name));
	if (byExt) return byExt;
	return kindFromMime(mime) ?? "unsupported";
};

export const defaultMimeOf = (kind: PreviewKind): string => MIME_BY_KIND[kind] ?? "application/octet-stream";

/** 支持的全部扩展名，用于文档与校验 */
export const supportedExts = (): string[] => [...KIND_BY_EXT.keys()].sort();

/** 支持的无扩展名文件名 */
export const supportedBasenames = (): string[] => [...KIND_BY_BASENAME.keys()].sort();