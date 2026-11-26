import { describe, expect, it } from "vitest";
import { byteLengthOf, decodeText, looksLikeCsv, toBlob, toBytes } from "../src/core/binary";

const utf8 = (s: string) => new TextEncoder().encode(s);

describe("toBytes", () => {
	it("支持 string", async () => {
		expect([...(await toBytes("abc"))]).toEqual([97, 98, 99]);
	});

	it("中文按 UTF-8 编码", async () => {
		const bytes = await toBytes("中");
		// U+4E2D 的 UTF-8 是 E4 B8 AD
		expect([...bytes]).toEqual([0xe4, 0xb8, 0xad]);
	});

	it("支持 ArrayBuffer", async () => {
		const ab = new Uint8Array([1, 2, 3]).buffer;
		expect([...(await toBytes(ab))]).toEqual([1, 2, 3]);
	});

	it("支持 Uint8Array", async () => {
		const u8 = new Uint8Array([4, 5]);
		expect([...(await toBytes(u8))]).toEqual([4, 5]);
	});

	it("支持 Blob", async () => {
		const blob = new Blob([new Uint8Array([7, 8, 9])]);
		expect([...(await toBytes(blob))]).toEqual([7, 8, 9]);
	});

	it("不支持的类型抛 TypeError", async () => {
		// @ts-expect-error 故意传入非法类型
		await expect(toBytes(123)).rejects.toThrow(TypeError);
	});
});

describe("toBlob", () => {
	it("Blob 原样返回", async () => {
		const blob = new Blob(["x"], { type: "text/plain" });
		expect(await toBlob(blob, "text/plain")).toBe(blob);
	});

	it("非 Blob 转换后带上 MIME", async () => {
		const blob = await toBlob("hi", "text/plain");
		expect(blob.type).toBe("text/plain");
		expect(await blob.text()).toBe("hi");
	});
});

describe("byteLengthOf", () => {
	it("按字节而非字符计数", async () => {
		expect(await byteLengthOf("中")).toBe(3);
		expect(await byteLengthOf("abc")).toBe(3);
	});

	it("支持二进制类型", async () => {
		expect(await byteLengthOf(new Uint8Array([1, 2]))).toBe(2);
		expect(await byteLengthOf(new Blob(["abc"]))).toBe(3);
	});
});

describe("decodeText", () => {
	it("解 UTF-8", () => {
		expect(decodeText(utf8("hello")).text).toBe("hello");
		expect(decodeText(utf8("中文")).text).toBe("中文");
	});

	it("剥掉 UTF-8 BOM", () => {
		const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("abc")]);
		const r = decodeText(withBom);
		expect(r.text).toBe("abc");
		expect(r.encoding).toBe("utf-8-bom");
	});

	it("UTF-8 非法字节回退 GBK", () => {
		// 「中文」的 GBK 编码是 D6 D0 CE C4，在 UTF-8 视角下非法
		const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
		const r = decodeText(gbk);
		expect(r.encoding).toBe("gbk");
		expect(r.text).toBe("中文");
	});

	it("纯 ASCII 走 UTF-8 分支", () => {
		expect(decodeText(utf8("a,b,c")).encoding).toBe("utf-8");
	});

	it("空输入返回空串", () => {
		expect(decodeText(new Uint8Array([])).text).toBe("");
	});
});

describe("looksLikeCsv", () => {
	it("按扩展名识别", () => {
		expect(looksLikeCsv("a.csv")).toBe(true);
		expect(looksLikeCsv("A.CSV")).toBe(true);
		expect(looksLikeCsv("a.xlsx")).toBe(false);
	});

	it("按 MIME 识别", () => {
		expect(looksLikeCsv("noext", "text/csv")).toBe(true);
		expect(looksLikeCsv("", "TEXT/CSV")).toBe(true);
	});

	it("都没有则为 false", () => {
		expect(looksLikeCsv("a.txt")).toBe(false);
	});
});