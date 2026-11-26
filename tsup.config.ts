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
	// 可选 peer 依赖保持 external，由调用方提供
	// node-unrar-js 也必须是 external：它用相对路径定位包内 wasm，
	// 一旦被内联进 chunk，__dirname 变成我方 dist 目录，wasm 就找不到了
	external: ["docx-preview", "dompurify", "marked", "xlsx", "node-unrar-js", /^node-unrar-js\//],
});