/**
 * markdown 真实渲染用例。依赖 marked + dompurify 与 jsdom 提供的 window，
 * 这些包在 devDependencies 里，仅测试用——主包不依赖它们。
 */
import { describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

// DOMPurify 需要一个 window 才能工作：在导入适配器之前把全局补上
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const g = globalThis as unknown as { window: unknown; Document: unknown };
if (!g.window) {
	g.window = dom.window;
	g.Document = dom.window.Document;
}

const { createPreview } = await import("../src");
const { markdownAdapter } = await import("../src/adapters/markdown");
const { registerAdapter } = await import("../src/core/adapter");

describe("markdown 渲染", () => {
	it("渲染标题为 h1", async () => {
		const r = await createPreview("# 标题", { name: "a.md" });
		expect(r.kind).toBe("markdown");
		expect(r.html).toContain("<h1>");
		expect(r.unsafe).toBe(false);
	});

	it("剥掉 XSS 载荷", async () => {
		const r = await createPreview('- <img src=x onerror="alert(1)">\n- <script>alert(2)</script>', {
			name: "b.md",
		});
		expect(r.html).toBeTruthy();
		expect(r.html).not.toContain("onerror");
		expect(r.html).not.toContain("<script");
	});

	it("GFM 表格生效", async () => {
		const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
		const r = await createPreview(md, { name: "c.md" });
		expect(r.html).toContain("<table>");
	});

	it("breaks=true 时单换行变 br", async () => {
		const r = await createPreview("a\nb", { name: "d.md" });
		expect(r.html).toContain("<br");
	});

	it("skipSanitize 时标记 unsafe", async () => {
		const undo = registerAdapter("markdown", markdownAdapter({ skipSanitize: true }));
		const r = await createPreview('<img src=x onerror="alert(1)">', { name: "e.md" });
		expect(r.unsafe).toBe(true);
		expect(r.html).toContain("onerror");
		undo();
	});

	it("breaks=false 时单换行不产生 br", async () => {
		const undo = registerAdapter("markdown", markdownAdapter({ breaks: false }));
		const r = await createPreview("a\nb", { name: "f.md" });
		expect(r.html).not.toContain("<br");
		undo();
	});
});