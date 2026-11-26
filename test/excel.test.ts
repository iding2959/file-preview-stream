/**
 * Excel 适配器：空表与 WPS DISPIMG 是真实用户踩到的场景。
 *
 * WPS 导出的 xlsx 普遍带空工作表，且单元格内嵌图用 =DISPIMG() 公式表示。
 * 这两类文件在旧实现下要么整本预览失败，要么渲染出畸形 HTML。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { JSDOM } from "jsdom";

type XlsxModule = typeof import("xlsx");

let XLSX: XlsxModule;
/** 有 xlsx 才跑：它是可选 peer 依赖 */
let ready = false;

/**
 * 先把 DOM window 挂上再加载被测模块。
 *
 * 净化器缺失时库会整条降级（不交未净化 HTML），所以想验证表格内容就必须
 * 提供 window —— 这也正是真实浏览器里的条件。dompurify 在模块求值期绑定
 * document，顺序不能反。
 */
beforeAll(async () => {
	const dom = new JSDOM("");
	const g = globalThis as unknown as { window?: unknown; document?: unknown };
	if (!g.window) {
		g.window = dom.window;
		g.document = dom.window.document;
	}
	try {
		XLSX = await import("xlsx");
		ready = true;
	} catch {
		ready = false;
	}
});

/** 把工作簿写成 xlsx 字节。xlsx 的 TS 类型不完整，这里显式收窄 write 签名 */
const toBytes = (wb: unknown): Uint8Array =>
	new Uint8Array(
		(XLSX as unknown as {
			write: (wb: unknown, o: { type: "buffer"; bookType: "xlsx" }) => ArrayBufferLike;
		}).write(wb, { type: "buffer", bookType: "xlsx" })
	);

describe("Excel 预览", () => {
	it("空工作表不拖垮整本预览", async () => {
		if (!ready) return;
		const { createPreview } = await import("../src");

		// 一张有数据 + 一张空表，模拟 WPS 导出
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["名称", "值"], ["甲", 1]]), "数据");
		XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([]), "空表");

		const res = await createPreview(toBytes(wb), { name: "含空表.xlsx" });
		// 核心断言：kind 仍是 excel，不能因为空表降级成 unsupported
		expect(res.kind).toBe("excel");
		// reason 只能描述「未净化」这类环境事实，不能是空表导致的解析失败
		expect(res.reason ?? "").not.toMatch(/indexOf|Cannot read/);
		// 有数据的表照常渲染
		expect(res.html).toContain("甲");
		// 空表给出占位说明而不是崩溃
		expect(res.html).toContain("空表");
		expect(res.html).toContain("空工作表");
	});

	it("DISPIMG 公式不再原样显示为公式文本", async () => {
		if (!ready) return;
		const { createPreview } = await import("../src");

		const ws = XLSX.utils.aoa_to_sheet([["标题"], ['=DISPIMG("ID_ABC123",1)']]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "图");

		const res = await createPreview(toBytes(wb), { name: "wps.xlsx" });
		expect(res.kind).toBe("excel");
		expect(res.html).toContain("disp-img");

		// 关键：判断的是「可见文本」，不是整段 HTML。
		// data-v 属性里保留原始公式是 SheetJS 的数据语义（用户看不见），
		// 只要它被正确转义、不影响渲染即可 —— 这点由下一个用例把关。
		const { JSDOM } = await import("jsdom");
		const dom = new JSDOM(`<div>${res.html}</div>`);
		const visible = dom.window.document.body.textContent ?? "";
		expect(visible).not.toContain("DISPIMG");
		expect(visible).toContain("图片（WPS 内嵌，请下载原文件查看）");
	});

	it("输出 HTML 不含畸形属性（data-v 里的裸双引号会被 DOM 解析成注入）", async () => {
		if (!ready) return;
		const { createPreview } = await import("../src");

		const ws = XLSX.utils.aoa_to_sheet([['=DISPIMG("ID_ABC123",1)']]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "S");

		const res = await createPreview(toBytes(wb), { name: "wps2.xlsx" });

		// 用真实 DOM 解析验证：畸形属性会多造出一个伪属性节点
		const { JSDOM } = await import("jsdom");
		const dom = new JSDOM(`<div>${res.html}</div>`);
		const tds = [...dom.window.document.querySelectorAll("td")];
		expect(tds.length).toBeGreaterThan(0);
		for (const td of tds) {
			for (const attr of td.attributes) {
				// 伪属性长这样：id_abc123",1)" —— 说明属性值里的裸引号把属性提前闭合了
				expect(attr.name).not.toMatch(/["',()]/);
			}
			// data-v 里应保留完整公式（作为数据），且不再夹带裸引号
			const dv = td.getAttribute("data-v");
			if (dv && dv.includes("DISPIMG")) {
				expect(dv).toBe('=DISPIMG("ID_ABC123",1)');
			}
		}
	});
});
/**
 * 净化路径：只有带 DOM window 的环境才走 DOMPurify。
 * 用 jsdom 环境单独跑，才能验证 unsafe: false 这个承诺是真的。
 */
describe("Excel 净化（需要 DOM window）", () => {
	it("有 window 时返回已净化的 HTML", async () => {
		if (!ready) return;
		const { createPreview } = await import("../src");

		const ws = XLSX.utils.aoa_to_sheet([["<b>x</b>"], ['=DISPIMG("ID_ABC123",1)']]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "S");

		const res = await createPreview(toBytes(wb), { name: "s.xlsx" });
		expect(res.kind).toBe("excel");
		// 无 window 时会标记 unsafe 并说明原因；有 window 时应净化成功
		if (res.unsafe === false) {
			// 净化后仍是合法表格结构，且不再有裸引号属性
			const { JSDOM } = await import("jsdom");
			const dom = new JSDOM(`<div>${res.html}</div>`);
			const tds = [...dom.window.document.querySelectorAll("td")];
			expect(tds.length).toBeGreaterThan(0);
			for (const td of tds) {
				for (const attr of td.attributes) {
					expect(attr.name).not.toMatch(/["',()]/);
				}
			}
		} else {
			// 没有 window 时必须是「环境不支持」而非「缺依赖」
			expect(res.reason ?? "").toContain("DOMPurify");
			expect(res.reason ?? "").not.toContain("npm i");
		}
	});
});

/**
 * 净化主路径：dompurify 在 window 存在时导出「自身带 .sanitize 的函数」，
 * 这条路径跑不到就会让 unsafe 永远为 true —— 把浏览器行为钉死在测试里。
 */
describe("Excel 净化主路径（模拟浏览器 window）", () => {
	it("有 window 时 unsafe 为 false，且表格结构完好", async () => {
		if (!ready) return;
		const { JSDOM } = await import("jsdom");
		const dom = new JSDOM("");
		const g = globalThis as unknown as { window?: unknown; document?: unknown };
		const prevWindow = g.window;
		const prevDocument = g.document;
		g.window = dom.window;
		g.document = dom.window.document;

		try {
			// 必须在 window 就位后再 import：dompurify 在模块求值期绑定 document
			const { createPreview } = await import("../src");
			const ws = XLSX.utils.aoa_to_sheet([["标题"], ['=DISPIMG("ID_ABC123",1)']]);
			const wb = XLSX.utils.book_new();
			XLSX.utils.book_append_sheet(wb, ws, "S");

			const res = await createPreview(toBytes(wb), { name: "s.xlsx" });
			expect(res.kind).toBe("excel");
			expect(res.unsafe).toBe(false);
			expect(res.reason).toBeUndefined();

			const parsed = new JSDOM(`<div>${String(res.html)}</div>`);
			const tds = [...parsed.window.document.querySelectorAll("td")];
			expect(tds.length).toBeGreaterThan(0);
			for (const td of tds) {
				for (const attr of td.attributes) {
					expect(attr.name).not.toMatch(/["',()]/);
				}
			}
			// 内嵌图仍被替换为占位，不显示裸公式
			expect(parsed.window.document.body.textContent ?? "").not.toContain("DISPIMG");
		} finally {
			g.window = prevWindow;
			g.document = prevDocument;
		}
	});

	it("修复属性时不吞值内的 tab（不能把 \\s 当属性分隔符）", async () => {
		if (!ready) return;
		// 走 skipSanitize：DOMPurify 本身会把属性值里的 tab 规范成空格，
		// 那是净化器的既定行为；这里要验的是**我的属性修复**有没有额外吃字符
		const { excelAdapter } = await import("../src/adapters/excel");
		const ws = XLSX.utils.aoa_to_sheet([["\ttab", "正常"]]);
		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(wb, ws, "S");

		const adapter = excelAdapter({ skipSanitize: true });
		const out = await adapter({
			bytes: toBytes(wb),
			blob: async () => new Blob([]),
			name: "tab.xlsx",
			mime: "",
			size: 1,
			throwOnMissingDependency: false,
			depth: 0,
			options: {},
			preview: async () => ({}) as never,
		});
		const { JSDOM } = await import("jsdom");
		const parsed = new JSDOM(`<div>${String(out.html)}</div>`).window.document;
		const values = [...parsed.querySelectorAll("td")].map((td) => td.getAttribute("data-v"));
		// SheetJS 原生输出保留了 tab，修复逻辑不该把前导 tab 吃掉
		expect(values).toContain("\ttab");
	});
});
