import { defineConfig } from "tsup";

// 三个可选适配器单独打包：让只想预览 PDF/图片的调用方不必把 xlsx/marked 拖进产物
export default defineConfig({
	entry: {
		index: "src/index.ts",
		"adapters/markdown": "src/adapters/markdown.ts",
		"adapters/excel": "src/adapters/excel.ts",
		"adapters/docx": "src/adapters/docx.ts",
		"adapters/html": "src/adapters/html.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	treeshake: true,
	// 可选依赖一律 external：它们由调用方提供，且列表里包含未安装的包
	// （如 pptx-preview），不标 external 会让 esbuild 在构建期解析失败。
	//
	// 为什么要保持"字面量 import"而不是变量间接：
	// 变量形式在产物里会变成运行时 import("xlsx")，浏览器没有 import map，
	// 裸说明符无法解析；字面量才能让业务方的打包器把它们一起打进去。
	external: [
		"docx-preview",
		"dompurify",
		"marked",
		"xlsx",
		"pptx-preview",
		"postal-mime",
		"unrar-js",
		/^unrar-js\//,
		"node-unrar-js",
		/^node-unrar-js\//,
	],
});