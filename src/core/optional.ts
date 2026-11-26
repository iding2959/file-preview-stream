/**
 * 可选依赖的安全加载。
 *
 * 为什么需要这一层：可选 peer 依赖（marked / xlsx / docx-preview / pptx-preview …）
 * 允许调用方不装。直接写 `await import("xlsx")` 在 Node 下没问题（运行时才解析，
 * 失败进 catch），但在 **Vite 的浏览器解析环境**（jsdom / happy-dom）里，
 * Vite 会在转译阶段就把 import() 的**静态字面量**解析掉，模块不存在直接抛
 * `Failed to resolve import`，`try/catch` 根本没机会执行。
 *
 * 实测结论（vite 6 + vitest 3）：
 * - `import(/* @vite-ignore *\/ "pkg")` **无效**——报错发生在 ignore 生效之前
 * - `const name = "pkg"; import(name)` **有效**——非字面量，Vite 不做静态解析
 * 所以这里统一走变量间接，把「缺依赖降级」从"碰运气"变成确定行为。
 *
 * 注意：不要把这个变量再折叠回字面量。tsup 已验证会保留变量形式，
 * 但如果有人改成 `import("xlsx")`，Vite 用户会立刻复现该崩溃。
 */
export const loadOptional = async <T>(name: string): Promise<T | undefined> => {
	try {
		// 变量间接是关键：字面量会被 Vite 预解析
		return (await import(/* @vite-ignore */ name)) as T;
	} catch {
		// 未安装、模块内部抛错、环境不支持，统统按「不可用」处理——
		// 预览失败不该中断整条附件列表
		return undefined;
	}
};