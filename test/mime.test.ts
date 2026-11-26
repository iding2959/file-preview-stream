import { describe, expect, it } from "vitest";
import { defaultMimeOf, detectKind, extOf, kindFromMime, registerKind, supportedExts } from "../src/core/mime";

describe("extOf", () => {
	it("取普通扩展名并小写化", () => {
		expect(extOf("report.PDF")).toBe("pdf");
		expect(extOf("a.b.docx")).toBe("docx");
	});

	it("去掉目录前缀", () => {
		expect(extOf("/tmp/dir/x.png")).toBe("png");
		expect(extOf("C:\\dir\\x.png")).toBe("png");
	});

	it("dotfile 不当作扩展名", () => {
		expect(extOf(".gitignore")).toBe("");
	});

	it("无扩展名或尾随 dot 返回空串", () => {
		expect(extOf("README")).toBe("");
		expect(extOf("file.")).toBe("");
		expect(extOf("")).toBe("");
	});
});

describe("kindFromMime", () => {
	it("识别常见 MIME", () => {
		expect(kindFromMime("application/pdf")).toBe("pdf");
		expect(kindFromMime("image/png")).toBe("image");
		expect(kindFromMime("video/mp4")).toBe("video");
		expect(kindFromMime("audio/mpeg")).toBe("audio");
		expect(kindFromMime("text/csv")).toBe("excel");
		expect(kindFromMime("text/markdown")).toBe("markdown");
		expect(kindFromMime("text/plain")).toBe("text");
	});

	it("剥离 MIME 参数与大小写差异", () => {
		expect(kindFromMime("application/pdf; charset=binary")).toBe("pdf");
		expect(kindFromMime("IMAGE/PNG")).toBe("image");
	});

	it("识别 Office 长 MIME", () => {
		expect(
			kindFromMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		).toBe("docx");
		expect(
			kindFromMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		).toBe("excel");
	});

	it("未知 MIME 返回 undefined", () => {
		expect(kindFromMime("application/octet-stream")).toBeUndefined();
		expect(kindFromMime("")).toBeUndefined();
	});
});

describe("detectKind", () => {
	it("扩展名优先于 MIME", () => {
		// 服务器常把 docx 一律标成 octet-stream，扩展名更可信
		expect(detectKind("a.docx", "application/octet-stream")).toBe("docx");
	});

	it("无扩展名时回落到 MIME", () => {
		expect(detectKind("noext", "video/mp4")).toBe("video");
	});

	it("都识别不出时为 unsupported", () => {
		// zip 自 0.1.0 起归为 archive，这里换用真正无处理器的后缀做反例
		expect(detectKind("a.psd", "application/x-unknown")).toBe("unsupported");
		expect(detectKind("", "")).toBe("unsupported");
	});

	it("覆盖常见附件后缀", () => {
		expect(detectKind("a.xls")).toBe("excel");
		// svg 已独立成 kind：可内嵌脚本，渲染约束与位图不同
		expect(detectKind("a.svg")).toBe("svg");
		expect(detectKind("a.png")).toBe("image");
		expect(detectKind("a.log")).toBe("text");
		expect(detectKind("a.json")).toBe("text");
		expect(detectKind("a.m4a")).toBe("audio");
	});
});

describe("registerKind", () => {
	it("可注册自定义扩展名并返回旧值", () => {
		const prev = registerKind(".mydoc", "docx");
		expect(prev).toBeUndefined();
		expect(detectKind("x.mydoc")).toBe("docx");
		expect(supportedExts()).toContain("mydoc");
	});

	it("覆盖已存在的映射会返回旧值", () => {
		const prev = registerKind("txt", "markdown");
		expect(prev).toBe("text");
		expect(detectKind("x.txt")).toBe("markdown");
		// 复原，避免影响其他用例
		registerKind("txt", "text");
	});
});

describe("defaultMimeOf", () => {
	it("返回各 kind 的默认 MIME", () => {
		expect(defaultMimeOf("pdf")).toBe("application/pdf");
		expect(defaultMimeOf("markdown")).toBe("text/markdown");
	});
});