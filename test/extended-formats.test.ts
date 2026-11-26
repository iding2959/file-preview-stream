/**
 * 新增格式：archive / eml / pptx / 音视频可播性。
 *
 * fixture 都是真实产物（zip 由 fflate 生成、rar 由 rarlab CLI 生成、
 * pptx 是最小 OOXML），不用 mock 去模拟解析器——这类测试的价值就在于
 * 验证「真实字节能不能过」。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPreview, detectKind, sniffContainer, checkPlayability, isRar5Available } from "../src";

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, "fixtures", name)));

describe("格式识别扩展", () => {
	it("pptx 家族归为 pptx", () => {
		for (const e of ["pptx", "potx", "ppsx", "pptm"]) {
			expect(detectKind(`a.${e}`)).toBe("pptx");
		}
	});

	it("归档后缀归为 archive", () => {
		for (const e of ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz"]) {
			expect(detectKind(`a.${e}`)).toBe("archive");
		}
	});

	it("邮件后缀归为 eml", () => {
		for (const e of ["eml", "mht", "mhtml"]) {
			expect(detectKind(`a.${e}`)).toBe("eml");
		}
	});

	it("pptx 的 MIME 不会被误判成 docx/excel", () => {
		const mime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
		expect(detectKind("", mime)).toBe("pptx");
	});
});

describe("魔数嗅探", () => {
	it("区分 RAR4 与 RAR5", () => {
		expect(sniffContainer(fixture("simple-rar4.rar"))).toBe("rar4");
		expect(sniffContainer(fixture("simple-rar5.rar"))).toBe("rar5");
	});

	it("zip / pptx 都是 zip 容器", () => {
		expect(sniffContainer(fixture("simple.zip"))).toBe("zip");
		expect(sniffContainer(fixture("simple.pptx"))).toBe("zip");
	});

	it("无法识别时返回 undefined", () => {
		expect(sniffContainer(new Uint8Array([1, 2, 3, 4]))).toBeUndefined();
	});
});

describe("zip 归档预览", () => {
	it("列出目录与文件，目录排在前面", async () => {
		const r = await createPreview(fixture("simple.zip"), { name: "simple.zip" });
		expect(r.kind).toBe("archive");
		expect(r.container).toBe("zip");
		const paths = r.entries!.map((e) => e.path);
		expect(paths).toContain("readme.txt");
		expect(paths).toContain("docs/说明.md");
		// 隐式目录要按路径补出来，否则画不出树
		expect(paths).toContain("docs/");
		expect(paths).toContain("docs/img/");
		const firstFileIdx = r.entries!.findIndex((e) => !e.isDir);
		const lastDirIdx = r.entries!.map((e) => e.isDir).lastIndexOf(true);
		expect(firstFileIdx).toBeGreaterThan(lastDirIdx);
	});

	it("条目惰性预览，中文文件名透传", async () => {
		const r = await createPreview(fixture("simple.zip"), { name: "simple.zip" });
		const entry = r.entries!.find((e) => e.path === "docs/说明.md")!;
		const sub = await entry.preview();
		// 文件名透传是稳定契约
		expect(sub.name).toBe("docs/说明.md");
		// kind 取决于净化器是否可用：无 window 时 markdown 会整条降级并不产出
		// 任何内容（不交未净化 HTML），这是刻意行为，见 sanitizer-required.test.ts
		if (sub.kind === "unsupported") {
			expect(String(sub.reason)).toContain("dompurify");
		} else {
			expect(sub.text ?? sub.html).toBeTruthy();
		}
	});

	it("清单 HTML 已转义条目名", async () => {
		const { zipSync, strToU8 } = await import("fflate");
		const nasty = zipSync({ "<img src=x onerror=alert(1)>.txt": strToU8("x") });
		const r = await createPreview(nasty, { name: "nasty.zip" });
		expect(r.html).not.toContain("<img src=x");
		expect(r.html).toContain("&lt;img");
		expect(r.unsafe).toBe(false);
	});
});

describe("rar 归档预览", () => {
	it("RAR4 能列出条目", async () => {
		const r = await createPreview(fixture("simple-rar4.rar"), { name: "a.rar" });
		expect(r.kind).toBe("archive");
		expect(r.container).toBe("rar4");
		expect(r.entries!.map((e) => e.path)).toContain("a.txt");
	});

	it("RAR5 由可选 WASM 后端解出（装了 node-unrar-js 时）", async () => {
		const available = await isRar5Available();
		const r = await createPreview(fixture("simple-rar5.rar"), { name: "a.rar" });
		expect(r.container).toBe("rar5");

		if (available) {
			expect(r.entries!.map((e) => e.path)).toContain("b.txt");
			const sub = await r.entries!.find((e) => e.path === "b.txt")!.preview();
			expect(sub.kind).toBe("text");
			expect(sub.text).toContain("hello rar5");
		} else {
			// 没装后端时必须明确降级并说清怎么修，而不是抛错
			expect(r.reason).toContain("node-unrar-js");
			expect(r.entries).toEqual([]);
		}
	});
});

describe("eml 邮件预览", () => {
	it("解析头、正文与附件", async () => {
		const r = await createPreview(fixture("simple.eml"), { name: "mail.eml" });
		expect(r.kind).toBe("eml");
		expect(r.mail!.subject).toContain("月度报告");
		expect(r.mail!.from?.address).toBe("zhangsan@example.com");
		expect(r.mail!.to?.length).toBe(2);
		expect(r.mail!.cc?.[0]?.address).toBe("boss@example.com");
		expect(r.mail!.text).toContain("营收达成");
		expect(r.mail!.attachments.length).toBe(1);
		expect(r.mail!.attachments[0]!.filename).toBe("notes.txt");
	});

	it("正文 HTML 标记为 unsafe（来源不可信）", async () => {
		const r = await createPreview(fixture("simple.eml"), { name: "mail.eml" });
		expect(r.html).toContain("fps-mail");
		expect(r.unsafe).toBe(true);
	});

	it("附件可递归预览", async () => {
		const r = await createPreview(fixture("simple.eml"), { name: "mail.eml" });
		const sub = await r.mail!.attachments[0]!.preview();
		expect(sub.kind).toBe("text");
		expect(sub.text).toContain("attachment payload");
	});
});

describe("pptx 文本大纲", () => {
	it("逐页抽取文本、图片与备注", async () => {
		const r = await createPreview(fixture("simple.pptx"), { name: "deck.pptx" });
		expect(r.kind).toBe("pptx");
		const slides = r.slides!;
		expect(slides.length).toBe(2);
		expect(slides[0]!.lines).toEqual(["季度业绩汇报", "2026 Q3"]);
		expect(slides[0]!.images.length).toBe(1);
		expect(slides[0]!.images[0]).toMatch(/^data:image\/png;base64,/);
		expect(slides[0]!.notes).toEqual(["讲这一页时强调成本下降"]);
		// XML 实体必须解码，否则页面显示 &amp;
		expect(slides[1]!.lines[0]).toBe("结论 & 下一步");
	});

	it("非 zip 内容给出针对 .ppt 的明确提示", async () => {
		const r = await createPreview(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]), { name: "old.pptx" });
		expect(r.reason).toContain(".ppt");
	});
});

describe("音视频可播性", () => {
	const fakeMkv = (docType: string): Uint8Array => {
		// EBML 头：签名 + 版本/长度 + docType 字符串，模拟真实 MKV/WebM 的头部形态
		const head = [0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81, 0x04];
		const bytes = [...head];
		for (const ch of docType) bytes.push(ch.charCodeAt(0));
		return new Uint8Array(bytes);
	};

	it("同容器不同 DocType 分别识别为 mkv / webm", () => {
		expect(sniffContainer(fakeMkv("matroska"))).toBe("ebml-mkv");
		expect(sniffContainer(fakeMkv("webm"))).toBe("ebml-webm");
	});

	it("AVI 与 MKV 判定为不可播并说明原因", () => {
		// RIFF + 4 字节块大小 + 类型标识 "AVI "，偏移必须精确到 8-11
		const avi = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0x20, 0x00, 0x00, 0x00,
			0x41, 0x56, 0x49, 0x20,
		]);
		const r = checkPlayability(avi, "video/x-msvideo");
		expect(r.playable).toBe(false);
		expect(r.playableReason).toContain("AVI");
		const mkv = checkPlayability(fakeMkv("matroska"), "video/x-matroska");
		expect(mkv.playable).toBe(false);
		expect(mkv.playableReason).toContain("MKV");
	});

	it("声明的 MIME 与实际容器矛盾时以嗅探为准", () => {
		// 把 rar 改名成 .avi 是构造得出来的：声明 MIME 不可信，嗅探才是真相
		const r = checkPlayability(fixture("simple-rar5.rar"), "video/x-msvideo");
		expect(r.playable).toBe(false);
		expect(r.playableReason).toContain("rar5");
	});

	it("WebM 在 Node 下无法判定", () => {
		const r = checkPlayability(fakeMkv("webm"), "video/webm");
		expect(r.playable).toBeUndefined();
	});

	it("MP4 在 Node 下无法判定，返回 undefined 而非误判", () => {
		// ftyp box：4 字节长度 + "ftyp" + brand
		const mp4 = new TextEncoder().encode("\u0000\u0000\u0000\u0020ftypisom\u0000\u0000\u0000\u0000");
		const r = checkPlayability(mp4, "video/mp4");
		expect(r.playable).toBeUndefined();
	});

	it("视频预览结果带上 playable 字段", async () => {
		const mkv = fakeMkv("matroska");
		const r = await createPreview(mkv, { name: "a.mkv" });
		// 关键：不能播不等于降级，kind 必须仍是 video
		expect(r.kind).toBe("video");
		expect(r.playable).toBe(false);
		expect(r.playableReason).toContain("转码");
		expect(r.reason).toBeUndefined();
	});
});