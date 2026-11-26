/**
 * 可选依赖的加载。
 *
 * 这类依赖（marked / xlsx / docx-preview / pptx-preview / dompurify …）允许调用方不装，
 * 库必须做到「没装就降级，而不是让整条附件列表崩掉」。但「加载」这件事在四种
 * 环境里的最优解互相冲突，必须显式取舍：
 *
 * | 环境 | 字面量 `import("xlsx")` | 变量 `import(name)` |
 * |---|---|---|
 * | Node 直接运行 | ✅ 运行时解析，失败进 catch | ✅ 同左 |
 * | Vite dev / vitest(jsdom) | ❌ 转译期就硬解析，缺包直接崩 | ✅ 不静态解析 |
 * | 业务方打包后跑浏览器 | ✅ 依赖被一起打包 | ❌ 裸说明符无 import map，运行时失败 |
 *
 * 没有任何一种写法能同时满足「未装依赖不阻断构建」和「装了依赖自动可用」：
 * 字面量让打包器看到依赖才能打包，但也让它在依赖缺失时直接报错中止。
 *
 * **本库的取舍：默认走变量形式 + 提供注入接口。**
 * - 保证「缺可选依赖绝不阻断调用方构建」，这是库最不该给用户制造麻烦的地方
 * - 依赖由调用方通过 `configureDependencies()` 显式交给库，或自行实现
 *   `setDependencyLoader()`（如用 `import.meta.glob` / 动态 CDN 地址）
 *
 * 想回到「字面量自动打包」的旧行为，用 `setDependencyLoader()` 自行提供加载器即可。
 */

/** 支持的注入键。名字对应 peerDependencies，避免调用方猜 */
export interface DependencyOverrides {
	marked?: unknown;
	xlsx?: unknown;
	dompurify?: unknown;
	docxPreview?: unknown;
	pptxPreview?: unknown;
	postalMime?: unknown;
	unrarJs?: unknown;
}

/** 调用方提供的加载器：收到包名，返回模块或 undefined */
export type DependencyLoader = (name: string) => Promise<unknown> | unknown;

const overrides = new Map<string, unknown>();
let customLoader: DependencyLoader | undefined;

/**
 * 注入依赖实例，优先于任何加载方式。
 *
 * 适用：打包器无法静态解析、想换成企业内实现、或完全离线环境。
 * 返回注销函数，便于测试隔离与热更新。
 */
export const configureDependencies = (deps: DependencyOverrides): (() => void) => {
	const prev: [string, unknown][] = [];
	const map: Record<keyof DependencyOverrides, string> = {
		marked: "marked",
		xlsx: "xlsx",
		dompurify: "dompurify",
		docxPreview: "docx-preview",
		pptxPreview: "pptx-preview",
		postalMime: "postal-mime",
		unrarJs: "unrar-js/lib/Unrar.js",
	};
	for (const [key, value] of Object.entries(deps) as [keyof DependencyOverrides, unknown][]) {
		if (value === undefined) continue;
		const name = map[key];
		prev.push([name, overrides.get(name)]);
		overrides.set(name, value);
	}
	return () => {
		for (const [name, old] of prev) {
			if (old === undefined) overrides.delete(name);
			else overrides.set(name, old);
		}
	};
};

/**
 * 自定义加载器，比逐个注入更灵活。
 *
 * 典型用法（Vite 项目里让打包器参与）：
 * ```ts
 * const modules = import.meta.glob("../../node_modules/{xlsx,marked}/**");  // 视构建而定
 * setDependencyLoader((name) => modules[name]?.());
 * ```
 * 或返回 CDN 动态地址：
 * ```ts
 * setDependencyLoader((name) =>
 *   import(/* @vite-ignore *\/ `https://cdn.jsdelivr.net/npm/${name}/+esm`));
 * ```
 */
export const setDependencyLoader = (loader: DependencyLoader | undefined): void => {
	customLoader = loader;
};

/** 供测试与文档校验：当前已知的可选依赖名 */
export const SUPPORTED_OPTIONAL_DEPS = Object.freeze([
	"marked",
	"xlsx",
	"dompurify",
	"docx-preview",
	"pptx-preview",
	"postal-mime",
	"unrar-js/lib/Unrar.js",
	"node-unrar-js/dist/js/unrar.js",
	"node-unrar-js/dist/js/ExtractorData.js",
]);

/**
 * 加载可选依赖。优先级：注入实例 → 自定义加载器 → 变量形式动态 import。
 *
 * 最后一步必须是**变量**：字面量会让 Vite 在转译期硬解析，把「可选依赖」
 * 变成「必须安装」，与本库的设计前提直接矛盾。
 *
 * 未装 / 加载失败 / 环境不支持，一律返回 undefined，调用方据此降级。
 */
export const loadOptional = async <T>(name: string): Promise<T | undefined> => {
	const injected = overrides.get(name);
	if (injected !== undefined) return injected as T;

	if (customLoader) {
		try {
			const loaded = await customLoader(name);
			if (loaded !== undefined) return loaded as T;
		} catch {
			// 自定义加载器失败也继续往下尝试
		}
	}

	try {
		// 变量形式：不要让打包器做静态解析
		return (await import(/* @vite-ignore */ name)) as T;
	} catch {
		return undefined;
	}
};