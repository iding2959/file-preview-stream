/**
 * 可选 peer 依赖的类型垫片。
 *
 * 这些包是 optional peerDependencies：调用方不装也能用主包，但源码里的
 * `await import("xlsx")` 仍需要类型才能通过 tsc。声明成 any 的模块即可，
 * 真实形状由各适配器内部的窄接口（SheetJsModule 等）约束。
 */
declare module "marked";
declare module "xlsx";
declare module "dompurify";
declare module "docx-preview";