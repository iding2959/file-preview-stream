/**
 * 净化器缺失时必须整条降级，不能把未净化 HTML 当正常结果交出去。
 *
 * 背景：`unsafe: true` 是「内容不可信」的标记，调用方本应检查；
 * 但现实是大量调用方直接 `dangerouslySetInnerHTML={{ __html: html }}`。
 * 把「净化器拿不到」这种**环境配置错误**处理成静默降级，等于让库去赌
 * 调用方会不会检查 unsafe —— 赌输就是 XSS。
 *
 * 契约：
 * - 净化器可用 → html 已净化，unsafe: false
 * - 净化器不可用 → 不返回 html，reason 说明缺什么，kind 降级
 * - 调用方显式 skipSanitize/sanitize:false → 返回原文 + unsafe: true（知情选择，保留）
 */
import { describe, expect, it } from "vitest";

/** Node 环境默认没有 DOM window，dompurify 拿不到 sanitize —— 正好模拟净化器缺失 */
describe("净化器缺失：不交出未净化 HTML", () => {
	it("markdown 降级且不带 html", async () => {
		const { createPreview } = await import("../src");
		// marked 在 devDependencies 里，这一步能走到净化环节
		const r = await createPreview("# hi <img src=x onerror=alert(1)>", { name: "a.md" });

		const sanitizeAvailable = r.unsafe === false;
		if (sanitizeAvailable) {
			// 有 window 时正常净化
			expect(r.kind).toBe("markdown");
			expect(String(r.html)).not.toContain("onerror");
		} else {
			// 净化器缺失：绝不能把原始 HTML 交出去
			expect(r.html).toBeUndefined();
			expect(r.kind).toBe("unsupported");
			expect(String(r.reason)).toContain("dompurify");
		}
	});

	it("excel 降级且不带 html", async () => {
		const { createPreview } = await import("../src");
		const { default: XLSX } = await import("xlsx");
		const ws = XLSX.utils.aoa_to_sheet([["<img src=x onerror=alert(1)>"]]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "S");
		const buf = new Uint8Array(
			(XLSX as unknown as { write: (w: unknown, o: unknown) => ArrayBufferLike }).write(wb, {
				type: "buffer",
				bookType: "xlsx",
			})
		);

		const r = await createPreview(buf, { name: "a.xlsx" });
		if (r.unsafe === false) {
			expect(r.kind).toBe("excel");
			expect(String(r.html)).not.toContain("onerror");
		} else {
			expect(r.html).toBeUndefined();
			expect(String(r.reason)).toContain("dompurify");
		}
	});

	it("html 显式要求净化但无净化器 → 降级而非原文", async () => {
		const { createPreview, registerAdapter } = await import("../src");
		const { htmlAdapter } = await import("../src/adapters/html");
		const undo = registerAdapter("html", htmlAdapter({ sanitize: true }));
		try {
			const r = await createPreview("<img src=x onerror=alert(1)>", { name: "a.html" });
			// 无 window 时拿不到净化器
			expect(r.html).toBeUndefined();
			expect(String(r.reason)).toContain("dompurify");
		} finally {
			undo();
		}
	});

	it("html 默认不净化属于知情选择，保留 unsafe: true 与原文", async () => {
		const { createPreview } = await import("../src");
		const payload = "<p>hello</p>";
		const r = await createPreview(payload, { name: "a.html" });
		expect(r.kind).toBe("html");
		expect(r.unsafe).toBe(true);
		expect(r.html).toBe(payload);
	});

	it("markdown 显式 skipSanitize 保留原文与 unsafe 标记", async () => {
		const { createPreview, registerAdapter } = await import("../src");
		const { markdownAdapter } = await import("../src/adapters/markdown");
		const undo = registerAdapter("markdown", markdownAdapter({ skipSanitize: true }));
		try {
			const r = await createPreview("# hi", { name: "a.md" });
			expect(r.unsafe).toBe(true);
			expect(r.html).toBeTruthy();
		} finally {
			undo();
		}
	});
});
