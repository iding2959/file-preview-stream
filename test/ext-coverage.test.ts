/**
 * 扩展后缀与固定文件名的识别覆盖。
 * 这里只测识别（纯函数），渲染行为在 create-preview / render 测试里。
 */
import { describe, expect, it } from "vitest";
import {
	basenameOf,
	detectKind,
	kindFromMime,
	supportedBasenames,
	supportedExts,
} from "../src/core/mime";

describe("新增图片后缀", () => {
	it("jpeg 变体归为 image", () => {
		for (const e of ["jpe", "jfif", "pjpeg", "pjp"]) {
			expect(detectKind(`a.${e}`)).toBe("image");
		}
	});

	it("png 动图与图标变体", () => {
		for (const e of ["apng", "cur"]) {
			expect(detectKind(`a.${e}`)).toBe("image");
		}
	});

	it("svg 单独成 kind 而非 image", () => {
		expect(detectKind("a.svg")).toBe("svg");
		expect(detectKind("a.svgz")).toBe("svg");
	});
});

describe("新增音视频后缀", () => {
	it("音频变体", () => {
		for (const e of ["oga", "opus", "weba", "wma", "mid", "midi", "amr"]) {
			expect(detectKind(`a.${e}`)).toBe("audio");
		}
	});

	it("视频变体", () => {
		for (const e of ["mpg", "mpeg", "m2v", "avi", "3gp", "3g2", "mkv", "qt"]) {
			expect(detectKind(`a.${e}`)).toBe("video");
		}
	});
});

describe("表格后缀", () => {
	it("tsv 归为 excel（表格语义优先）", () => {
		expect(detectKind("a.tsv")).toBe("excel");
	});

	it("xlsm 归为 excel", () => {
		expect(detectKind("a.xlsm")).toBe("excel");
	});
});

describe("markdown 后缀", () => {
	it("各种 md 变体", () => {
		for (const e of ["mdown", "mkd", "mkdn", "mdx"]) {
			expect(detectKind(`a.${e}`)).toBe("markdown");
		}
	});
});

describe("html 独立 kind", () => {
	it("html/htm/xhtml 不再归为 text", () => {
		for (const e of ["html", "htm", "xhtml"]) {
			expect(detectKind(`a.${e}`)).toBe("html");
		}
	});

	it("text/html MIME 也映射到 html", () => {
		expect(kindFromMime("text/html")).toBe("html");
		expect(kindFromMime("text/html; charset=utf-8")).toBe("html");
	});

	it("image/svg+xml 优先于 image/* 被判为 svg", () => {
		// 顺序错了会落到 image，从而漏掉 scriptable 标记
		expect(kindFromMime("image/svg+xml")).toBe("svg");
		expect(kindFromMime("image/png")).toBe("image");
	});

	it("text/tab-separated-values 映射到 excel", () => {
		expect(kindFromMime("text/tab-separated-values")).toBe("excel");
	});
});

describe("源码与配置后缀", () => {
	it("前端框架文件", () => {
		for (const e of ["jsx", "tsx", "vue", "svelte", "mjs", "cjs", "mts", "cts"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("样式与模板", () => {
		for (const e of ["scss", "sass", "less", "styl"]) {
			// styl 未注册，应为 unsupported，验证不会误判
			const k = detectKind(`a.${e}`);
			if (e === "styl") expect(k).toBe("unsupported");
			else expect(k).toBe("text");
		}
	});

	it("系统与脚本", () => {
		for (const e of ["bash", "zsh", "fish", "bat", "cmd", "ps1", "psm1", "vbs", "asm"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("配置与基础设施", () => {
		for (const e of ["toml", "cfg", "properties", "env", "tf", "hcl", "gradle", "lock"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("多种编程语言", () => {
		for (const e of ["kt", "kts", "scala", "groovy", "cs", "swift", "rb", "php", "lua", "pl", "r", "dart", "ex", "erl", "hs", "clj", "lisp"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("C 系与低级语言", () => {
		for (const e of ["c", "h", "cc", "cpp", "cxx", "hpp", "m", "mm", "s"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("数据与协议描述", () => {
		for (const e of ["proto", "graphql", "gql", "jsonc", "json5", "xsl", "xsd", "bib", "tex", "rst"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});

	it("补丁与文本类", () => {
		for (const e of ["diff", "patch", "text", "dockerfile", "makefile", "cmake"]) {
			expect(detectKind(`a.${e}`)).toBe("text");
		}
	});
});

describe("basenameOf", () => {
	it("去目录并小写", () => {
		expect(basenameOf("/tmp/Dockerfile")).toBe("dockerfile");
		expect(basenameOf("C:\\x\\Makefile")).toBe("makefile");
	});

	it("保留前导点以便匹配 dotfile", () => {
		expect(basenameOf("/home/u/.env")).toBe(".env");
		expect(basenameOf(".gitignore")).toBe(".gitignore");
	});

	it("空名返回空串", () => {
		expect(basenameOf("")).toBe("");
	});
});

describe("固定文件名识别", () => {
	it("无扩展名的常见构建文件", () => {
		expect(detectKind("Dockerfile")).toBe("text");
		expect(detectKind("Makefile")).toBe("text");
		expect(detectKind("Jenkinsfile")).toBe("text");
		expect(detectKind("Procfile")).toBe("text");
	});

	it("大小写不敏感", () => {
		expect(detectKind("dockerfile")).toBe("text");
		expect(detectKind("DOCKERFILE")).toBe("text");
		expect(detectKind("MakeFile")).toBe("text");
	});

	it("带目录路径也能命中", () => {
		expect(detectKind("/app/Dockerfile")).toBe("text");
		expect(detectKind("src/Makefile")).toBe("text");
	});

	it("dotfile 形式", () => {
		expect(detectKind(".gitignore")).toBe("text");
		expect(detectKind(".env")).toBe("text");
		expect(detectKind(".npmrc")).toBe("text");
		expect(detectKind(".editorconfig")).toBe("text");
	});

	it("文档类固定名", () => {
		expect(detectKind("LICENSE")).toBe("text");
		expect(detectKind("README")).toBe("text");
		expect(detectKind("CHANGELOG")).toBe("text");
	});

	it("固定名优先于扩展名推断", () => {
		// CMakeLists.txt 有 .txt 扩展名，两者结果一致但验证不会互相干扰
		expect(detectKind("CMakeLists.txt")).toBe("text");
	});

	it("未登记的固定名仍为 unsupported", () => {
		expect(detectKind("unknownfile")).toBe("unsupported");
	});
});

describe("supportedExts / supportedBasenames", () => {
	it("扩展名数量已扩充", () => {
		expect(supportedExts().length).toBeGreaterThan(100);
	});

	it("固定文件名可枚举", () => {
		const list = supportedBasenames();
		expect(list).toContain("dockerfile");
		expect(list).toContain(".gitignore");
	});
});