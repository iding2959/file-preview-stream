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