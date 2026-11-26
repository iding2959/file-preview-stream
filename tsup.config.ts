import { defineConfig } from "tsup";

// 三个可选适配器单独打包：让只想预览 PDF/图片的调用方不必把 xlsx/marked 拖进产物
export default defineConfig({
	entry: {
		index: "src/index.ts",
		"adapters/markdown": "src/adapters/markdown.ts",
		"adapters/excel": "src/adapters/excel.ts",
		"adapters/docx": "src/adapters/docx.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	target: "es2022",
	treeshake: true,
	// 可选 peer 依赖保持 external，由调用方提供
	external: ["docx-preview", "dompurify", "marked", "xlsx"],
});