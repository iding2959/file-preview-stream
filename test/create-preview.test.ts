import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreview, registerKind } from "../src";
import { registerAdapter } from "../src/core/adapter";

describe("createPreview - 基础元信息", () => {
	it("从 File 风格的 name/type 推断", async () => {
		const file = new File(["hello"], "a.txt", { type: "text/plain" });
		const r = await createPreview(file);
		expect(r.kind).toBe("text");
		expect(r.name).toBe("a.txt");
		expect(r.size).toBe(5);
		expect(r.text).toBe("hello");
	});

	it("options.name 覆盖输入自带的名字", async () => {
		const file = new File(["hello"], "a.txt", { type: "text/plain" });
		// 用 .json（同为 text kind，不受可选依赖缺失降级影响）验证覆盖生效
		const r = await createPreview(file, { name: "b.json" });
		expect(r.name).toBe("b.json");
		expect(r.kind).toBe("text");
		// 反证：不覆盖时应使用 File 自带 name
		const r2 = await createPreview(file);
		expect(r2.name).toBe("a.txt");
	});

	it("options.kind 跳过推断", async () => {
		const r = await createPreview("x", { name: "a.zip", kind: "text" });
		expect(r.kind).toBe("text");
	});

	it("options.mime 覆盖默认 MIME", async () => {
		const r = await createPreview("x", { name: "a.txt", mime: "text/csv" });
		expect(r.mime).toBe("text/csv");
	});

	it("无 name 无 type 时为 unsupported", async () => {
		const r = await createPreview(new Uint8Array([1, 2]));
		expect(r.kind).toBe("unsupported");
		expect(r.reason).toBeTruthy();
	});
});

describe("createPreview - 文本分支", () => {
	it("返回原文而非 HTML", async () => {
		const r = await createPreview("# t", { name: "a.txt" });
		expect(r.text).toBe("# t");
		expect(r.html).toBeUndefined();
	});

	it("中文 UTF-8 正确解码", async () => {
		const r = await createPreview("中文内容", { name: "a.log" });
		expect(r.text).toBe("中文内容");
	});

	it("GBK 字节回退正确", async () => {
		const gbk = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]);
		const r = await createPreview(gbk, { name: "a.txt" });
		expect(r.text).toBe("中文");
	});
});

describe("createPreview - 原生分支", () => {
	it("pdf 返回 blob URL", async () => {
		const r = await createPreview(new Uint8Array([1, 2, 3]), { name: "a.pdf" });
		expect(r.kind).toBe("pdf");
		expect(r.url).toMatch(/^blob:/);
		r.revoke();
	});

	it("图片与音视频同样走原生分支", async () => {
		for (const name of ["a.png", "a.mp4", "a.mp3"]) {
			const r = await createPreview(new Uint8Array([1]), { name });
			expect(r.url).toMatch(/^blob:/);
			r.revoke();
		}
	});

	it("revoke 后 URL 失效", async () => {
		const r = await createPreview(new Uint8Array([1]), { name: "a.png" });
		const url = r.url!;
		r.revoke();
		// revoke 后再次 fetch 同一个 blob URL 会失败
		await expect(fetch(url)).rejects.toThrow();
	});
});

describe("createPreview - 缺依赖降级", () => {
	// 真实环境装了 marked/dompurify，缺依赖路径只能靠 mock 复现
	beforeEach(() => {
		vi.doMock("marked", () => {
			throw new Error("Cannot find module 'marked'");
		});
	});

	afterEach(() => {
		vi.doUnmock("marked");
		vi.resetModules();
	});

	it("markdown 缺 marked 时降级为 text 并保留原文与原因", async () => {
		const { createPreview: fresh } = await import("../src");
		const r = await fresh("# hi", { name: "a.md" });
		// kind 必须降为 text：调用方按 kind 选渲染器，报 markdown 却只有原文会被塞进 HTML 容器
		expect(r.kind).toBe("text");
		expect(r.text).toBe("# hi");
		expect(r.reason).toContain("marked");
	});

	it("throwOnMissingDependency 时抛错", async () => {
		const { createPreview: fresh } = await import("../src");
		await expect(fresh("# hi", { name: "a.md", throwOnMissingDependency: true })).rejects.toThrow(
			/marked/
		);
	});
});

describe("createPreview - 其它缺依赖降级", () => {
	it("docx/xlsx 缺依赖降级为 unsupported", async () => {
		const docx = await createPreview(new Uint8Array([1]), { name: "a.docx" });
		expect(docx.kind).toBe("unsupported");
		expect(docx.reason).toContain("docx-preview");

		const xlsx = await createPreview(new Uint8Array([1]), { name: "a.xlsx" });
		expect(xlsx.kind).toBe("unsupported");
		expect(xlsx.reason).toContain("xlsx");
	});
});

describe("createPreview - 适配器异常", () => {
	it("适配器抛错时降级并保留原因", async () => {
		const unregister = registerAdapter("text", () => {
			throw new Error("boom");
		});
		const r = await createPreview("x", { name: "a.txt" });
		expect(r.kind).toBe("unsupported");
		expect(r.reason).toContain("boom");
		unregister();
	});

	it("注销后恢复内置实现", async () => {
		const r = await createPreview("x", { name: "a.txt" });
		expect(r.kind).toBe("text");
	});

	it("registerAdapter 返回的注销函数可复原旧适配器", async () => {
		const calls: string[] = [];
		const undo1 = registerAdapter("text", () => {
			calls.push("first");
			return { text: "1" };
		});
		const undo2 = registerAdapter("text", () => {
			calls.push("second");
			return { text: "2" };
		});

		expect((await createPreview("x", { name: "a.txt" })).text).toBe("2");
		undo2();
		expect((await createPreview("x", { name: "a.txt" })).text).toBe("1");
		undo1();
		expect(calls).toEqual(["second", "first"]);
	});
});

describe("createPreview - 自定义 kind", () => {
	it("注册自定义扩展名后可用", async () => {
		// 用静态导入的 registerKind：动态 import 会绕过前面 resetModules 后的实例，
		// 拿到另一份 KIND_BY_EXT，导致注册了却查不到
		registerKind("odd", "text");
		const r = await createPreview("自定义", { name: "a.odd" });
		expect(r.kind).toBe("text");
		expect(r.text).toBe("自定义");
	});
});

describe("revoke 默认实现", () => {
	it("无 url 时 revoke 不抛错", async () => {
		const r = await createPreview("x", { name: "a.txt" });
		expect(() => r.revoke()).not.toThrow();
	});
});

describe("unsupported 适配器可被覆盖", () => {
	it("覆盖 unsupported 后不再降级", async () => {
		const unregister = registerAdapter("unsupported", () => ({ text: "fallback" }));
		const r = await createPreview(new Uint8Array([1]));
		expect(r.kind).toBe("unsupported");
		expect(r.text).toBe("fallback");
		unregister();
	});
});

// 防止 vi 未使用告警
void vi;