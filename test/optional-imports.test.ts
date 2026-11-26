/**
 * 可选依赖的加载必须对 Vite 的浏览器解析环境安全。
 *
 * 背景：直接写 `await import("docx-preview")` 在 Node 下没问题（运行时才解析，
 * 失败进 catch），但在 Vite 的 browser/jsdom 环境里会在**转译阶段**就把字面量
 * 解析掉，模块不存在直接抛 `Failed to resolve import` —— try/catch 压根执行不到，
 * 调用方连降级结果都拿不到。
 *
 * 这类问题在 Node 环境的单测里完全看不出来，所以必须单独把它钉住：
 * 断言源码里不存在指向可选依赖的字面量 import()。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "..", "src");

const walk = (dir: string): string[] =>
	readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []
	);

/** 去掉注释与字符串，避免把文档示例里的 import 当成真实代码 */
const stripComments = (code: string): string =>
	code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

describe("可选依赖加载方式", () => {
	it("源码中不存在指向可选依赖的字面量 import()", () => {
		const optionalPkgs = [
			"marked",
			"xlsx",
			"docx-preview",
			"pptx-preview",
			"dompurify",
			"postal-mime",
			"unrar-js",
			"node-unrar-js",
		];
		const offenders: string[] = [];

		for (const file of walk(SRC)) {
			const code = stripComments(readFileSync(file, "utf8"));
			for (const pkg of optionalPkgs) {
				// 只抓 import("pkg...") / import('pkg...') 这种字面量形式
				const re = new RegExp(`import\\(\\s*["']${pkg.replace(/[/.]/g, "\\$&")}`, "g");
				if (re.test(code)) offenders.push(`${file} -> import("${pkg}")`);
			}
		}

		expect(offenders).toEqual([]);
	});

	it("loadOptional 走变量间接（字面量会被 Vite 预解析）", () => {
		const code = stripComments(readFileSync(join(SRC, "core", "optional.ts"), "utf8"));
		// 必须有 import(name) 这种非字面量形式
		expect(code).toMatch(/import\([^"'][^)]*\)/);
	});

	it("缺依赖时返回 undefined 而不是抛出", async () => {
		const { loadOptional } = await import("../src/core/optional");
		await expect(loadOptional("definitely-not-a-real-package-xyz")).resolves.toBeUndefined();
	});
});