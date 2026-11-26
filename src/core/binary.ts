import type { PreviewInput } from "../types";

const isBlob = (input: unknown): input is Blob =>
	typeof Blob !== "undefined" && input instanceof Blob;

/** 统一转 Uint8Array：解码与哈希都只需要字节视图 */
export const toBytes = async (input: PreviewInput): Promise<Uint8Array> => {
	if (typeof input === "string") return new TextEncoder().encode(input);
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	if (isBlob(input)) return new Uint8Array(await input.arrayBuffer());
	throw new TypeError(
		`不支持的输入类型: ${Object.prototype.toString.call(input)}，需要 Blob/ArrayBuffer/Uint8Array/string`
	);
};

/** 统一转 Blob：只有 pdf/图片/音视频分支需要，浏览器侧生成 blob URL 用 */
export const toBlob = async (input: PreviewInput, mime: string): Promise<Blob> => {
	if (isBlob(input)) return input;
	const bytes = await toBytes(input);
	return new Blob([bytes as BlobPart], { type: mime });
};

export const byteLengthOf = async (input: PreviewInput): Promise<number> => {
	if (typeof input === "string") return new TextEncoder().encode(input).byteLength;
	if (input instanceof Uint8Array) return input.byteLength;
	if (input instanceof ArrayBuffer) return input.byteLength;
	if (isBlob(input)) return input.size;
	return 0;
};

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

const hasUtf8Bom = (bytes: Uint8Array): boolean =>
	bytes.length >= 3 &&
	bytes[0] === UTF8_BOM[0] &&
	bytes[1] === UTF8_BOM[1] &&
	bytes[2] === UTF8_BOM[2];

/**
 * 文本解码：BOM 优先 → UTF-8 严格校验 → 回退 GBK。
 *
 * 回退 GBK 不是可选项：中文 Windows 导出的 CSV / TXT 绝大多数是 GBK，
 * 直接用 UTF-8 解会得到满屏 U+FFFD 而不是报错，用户看到的是乱码而非失败，
 * 所以宁可探测成本高一点也要回退。
 */
export const decodeText = (bytes: Uint8Array): { text: string; encoding: string } => {
	if (hasUtf8Bom(bytes)) {
		return { text: new TextDecoder("utf-8").decode(bytes.subarray(3)), encoding: "utf-8-bom" };
	}
	try {
		return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), encoding: "utf-8" };
	} catch {
		// 部分运行时不带 gbk 解码器（Node 未编译 full-icu），此时退回 utf-8 非严格模式
		try {
			return { text: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
		} catch {
			return { text: new TextDecoder("utf-8").decode(bytes), encoding: "utf-8-lossy" };
		}
	}
};

export const looksLikeCsv = (name = "", mime = ""): boolean =>
	/\.csv$/i.test(name) || mime.trim().toLowerCase() === "text/csv";

/**
 * 按魔数嗅探容器格式。
 *
 * 只靠扩展名/Content-Type 判不了这件事：服务器常把附件统一写成
 * application/octet-stream，而「同扩展名不同真实容器」恰恰是音视频黑屏的主因，
 * 所以嗅探必须在字节层面做。
 */
export type ContainerFormat =
	| "zip"
	| "rar4"
	| "rar5"
	| "ole"
	| "pdf"
	| "png"
	| "jpeg"
	| "gif"
	| "webp"
	| "avi"
	| "ebml-mkv"
	| "ebml-webm"
	| "mp4"
	| "ogg"
	| "wav"
	| "flac"
	| "mp3";

const startsWith = (bytes: Uint8Array, sig: readonly number[], offset = 0): boolean => {
	if (bytes.length < offset + sig.length) return false;
	for (let i = 0; i < sig.length; i++) if (bytes[offset + i] !== sig[i]) return false;
	return true;
};

/** 固定偏移处读 ASCII 串；RIFF 的四字节类型标识用这个 */
const asciiAt = (bytes: Uint8Array, from: number, to: number): string => {
	let out = "";
	const end = Math.min(to, bytes.length);
	for (let i = from; i < end; i++) {
		const b = bytes[i]!;
		if (b < 0x20 || b > 0x7e) break;
		out += String.fromCharCode(b);
	}
	return out;
};

/**
 * 在头部范围内找可见 ASCII 串（可跨过二进制字段）。
 *
 * EBML 的 DocType 跟在一堆二进制 element 之后，不能从偏移 0 连续读，
 * 必须跳过不可见字节继续扫——MKV 与 WebM 的区分全靠这一段。
 */
const scanAsciiRuns = (bytes: Uint8Array, limit: number): string[] => {
	const runs: string[] = [];
	let cur = "";
	const end = Math.min(limit, bytes.length);
	for (let i = 0; i < end; i++) {
		const b = bytes[i]!;
		if (b >= 0x20 && b <= 0x7e) {
			cur += String.fromCharCode(b);
		} else if (cur) {
			runs.push(cur);
			cur = "";
		}
	}
	if (cur) runs.push(cur);
	return runs;
};

export const sniffContainer = (bytes: Uint8Array): ContainerFormat | undefined => {
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWith(bytes, [0x50, 0x4b, 0x05, 0x06])) {
		return "zip";
	}
	// RAR 签名是 Rar!\x1a\x07，第 7 字节区分版本：0x00=RAR4，0x01 0x00=RAR5
	if (startsWith(bytes, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) {
		if (bytes[6] === 0x00) return "rar4";
		if (bytes[6] === 0x01) return "rar5";
	}
	if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return "ole";
	if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf";
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
	if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
	// RIFF 容器：第 8-11 字节是类型，WEBP 是图片、AVI 是视频、WAVE 是音频
	if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46])) {
		const t = asciiAt(bytes, 8, 12);
		if (t === "WEBP") return "webp";
		if (t === "AVI ") return "avi";
		if (t === "WAVE") return "wav";
	}
	if (startsWith(bytes, [0x4f, 0x67, 0x67, 0x53])) return "ogg";
	if (startsWith(bytes, [0x66, 0x4c, 0x61, 0x43])) return "flac";
	if (startsWith(bytes, [0x49, 0x44, 0x33])) return "mp3";
	// EBML：MKV 与 WebM 共用同一容器签名，靠 DocType 区分——这正是能否播的关键分界
	if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
		const runs = scanAsciiRuns(bytes, 128);
		if (runs.includes("webm")) return "ebml-webm";
		// DocType 是 "matroska"；不确定时按 mkv 处理（保守：明确告知不可播）
		return "ebml-mkv";
	}
	// MP4 系：第 4-7 字节是 ftyp
	if (bytes.length >= 12 && asciiAt(bytes, 4, 8) === "ftyp") return "mp4";
	return undefined;
};

/**
 * 逐个魔数对应的 MIME。
 *
 * 与扩展名推断出的 MIME 分开命名，是为了让调用方看出「这是嗅探结果」，
 * 服务器给的 Content-Type 往往不可信（附件一律 octet-stream）。
 */
export const MIME_BY_CONTAINER: Record<ContainerFormat, string> = {
	zip: "application/zip",
	rar4: "application/vnd.rar",
	rar5: "application/vnd.rar",
	ole: "application/x-ole-storage",
	pdf: "application/pdf",
	png: "image/png",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	avi: "video/x-msvideo",
	"ebml-mkv": "video/x-matroska",
	"ebml-webm": "video/webm",
	mp4: "video/mp4",
	ogg: "application/ogg",
	wav: "audio/wav",
	flac: "audio/flac",
	mp3: "audio/mpeg",
};

/** 字节 → 人类可读大小。放在核心里是因为 archive 条目表与 eml 附件表都要用 */
export const formatBytes = (size: number): string => {
	if (!Number.isFinite(size) || size < 0) return "";
	if (size < 1024) return `${size} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = size / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
};

/** HTML 转义。archive 条目名与 eml 主题都可能来自不可信附件，必须转义后拼 HTML */
export const escapeHtml = (s: string): string =>
	s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);