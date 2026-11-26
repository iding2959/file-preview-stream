import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/**", "node_modules/**", "coverage/**", "*.tgz"],
	},
	...tseslint.configs.recommended,
	{
		files: ["**/*.ts"],
		languageOptions: {
			parserOptions: { ecmaVersion: 2022, sourceType: "module" },
		},
		rules: {
			// 显式 any 是有意的兜底（可选依赖的模块形状无法静态确定），但要求写明原因
			"@typescript-eslint/no-explicit-any": "warn",
			// 允许 _ 前缀表示"故意不用"
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
		},
	}
);