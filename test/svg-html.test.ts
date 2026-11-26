/**
 * svg 与 html 的渲染行为。
 * 重点验证安全标记：拿不到 scriptable / unsafe 就应当视为实现缺陷。
 */
import { describe, expect, it } from "vitest";
import { createPreview } from "../src";

const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';

describe("svg 分支", () => {
	it("返回 blob URL 且强制标 scriptable", async () => {
		const r = await createPreview(svgText, { name: "a.svg" });
		expect(r.kind).toBe("svg");
		expect(r.url).toMatch(/^blob:/);
		// 少了这个标记，调用方可能把 svg 塞进 iframe 执行脚本
		expect(r.scriptable).toBe(true);
		r.revoke();
	});

	it("svgz 同样走 svg 分支", async () => {
		const r = await createPreview(svgText, { name: "a.svgz" });
		expect(r.kind).toBe("svg");
		expect(r.scriptable).toBe(true);
		r.revoke();
	});

	it("MIME 为 image/svg+xml 时也识别为 svg", async () => {
		const r = await createPreview(svgText, { mime: "image/svg+xml" });
		expect(r.kind).toBe("svg");
		expect(r.scriptable).toBe(true);
		r.revoke();
	});

	it("blob 的 type 是 image/svg+xml 而非 octet-stream", async () => {
		const r = await createPreview(svgText, { name: "a.svg" });
		const resp = await fetch(r.url!);
		// 声明成 svg+xml，浏览器才会渲染成图形；若为纯文本会被当文本打开
		expect(resp.headers.get("content-type")).toContain("image/svg+xml");
		r.revoke();
	});

	it("位图不带 scriptable 标记", async () => {
		const r = await createPreview(new Uint8Array([1, 2]), { name: "a.png" });
		expect(r.kind).toBe("image");
		expect(r.scriptable).toBeUndefined();
		r.revoke();
	});

	it("pdf 不带 scriptable 标记", async () => {
		const r = await createPreview(new Uint8Array([1]), { name: "a.pdf" });
		expect(r.scriptable).toBeUndefined();
		r.revoke();
	});
});

describe("html 分支", () => {
	it("默认返回原文并标 unsafe", async () => {
		const html = "<h1>标题</h1><p>正文</p>";
		const r = await createPreview(html, { name: "a.html" });
		expect(r.kind).toBe("html");
		expect(r.html).toBe(html);
		// 默认不净化：HTML 邮件依赖 style 与布局，严格净化会毁掉排版
		expect(r.unsafe).toBe(true);
	});

	it("htm/xhtml 同样走 html 分支", async () => {
		for (const name of ["a.htm", "a.xhtml"]) {
			const r = await createPreview("<p>x</p>", { name });
			expect(r.kind).toBe("html");
			expect(r.html).toBe("<p>x</p>");
		}
	});

	it("保留内联样式（不净化模式的必要行为）", async () => {
		const html = '<div style="color:red">红字</div>';
		const r = await createPreview(html, { name: "a.html" });
		expect(r.html).toContain("style=");
		expect(r.html).toContain("color:red");
	});

	it("声明 gbk 的页面按 gbk 解码", async () => {
		// <meta charset=gbk> + 「中文」的 GBK 字节
		const head = new TextEncoder().encode('<html><head><meta charset="gbk"></head><body>');
		const body = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
		const tail = new TextEncoder().encode("</body></html>");
		const bytes = new Uint8Array([...head, ...body, ...tail]);

		const r = await createPreview(bytes, { name: "a.html" });
		expect(r.kind).toBe("html");
		expect(r.html).toContain("中文");
	});

	it("未声明 charset 时 UTF-8 正常解码", async () => {
		const r = await createPreview("<p>中文内容</p>", { name: "a.html" });
		expect(r.html).toContain("中文内容");
	});

	it("html 归 kind html 而非 text", async () => {
		const r = await createPreview("<p>x</p>", { name: "a.html" });
		// 归 text 会让调用方用 textContent 渲染，排版全丢
		expect(r.kind).not.toBe("text");
		expect(r.text).toBeUndefined();
	});
});