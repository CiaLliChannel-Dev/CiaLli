/**
 * 通用 Zod Schema 定义
 *
 * 全局共享的枚举、分页、可见性、社交链接等 schema。
 */
import * as z from "zod";

export type AppStatus = "draft" | "published" | "archived";
export type CommentStatus = "published" | "hidden" | "archived";
export type AlbumLayout = "grid" | "masonry";
export type AppRole = "admin" | "member";
export type Pagination = {
    page: number;
    limit: number;
};
export type SocialLink = {
    platform: string;
    url: string;
    enabled: boolean;
};
export type SocialLinks = SocialLink[] | null;
export type Tags = string[];
export type OptionalString = string | null | undefined;
export type OptionalInt = number | null | undefined;

// ── 枚举 ──

export const AppStatusSchema: z.ZodType<AppStatus> = z.enum([
    "draft",
    "published",
    "archived",
]);
export const CommentStatusSchema: z.ZodType<CommentStatus> = z.enum([
    "published",
    "hidden",
    "archived",
]);
export const AlbumLayoutSchema: z.ZodType<AlbumLayout> = z.enum([
    "grid",
    "masonry",
]);
export const AppRoleSchema: z.ZodType<AppRole> = z.enum(["admin", "member"]);

// ── 分页 ──

export const PaginationSchema: z.ZodType<Pagination> = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});

// ── 可见性 PATCH ──

// ── 社交链接 ──

export const SocialLinkSchema: z.ZodType<SocialLink> = z.object({
    platform: z.string().min(1).max(50),
    url: z
        .string()
        .max(500)
        .refine((val) => /^https?:\/\//.test(val) || /^mailto:/.test(val), {
            message: "链接仅支持 http/https/mailto 协议",
        }),
    enabled: z.boolean().default(true),
});

/**
 * PATCH 场景必须使用无默认值 schema，避免 default 在 partial() 下把缺省字段误解析成显式写入。
 */
export const SocialLinksSchema: z.ZodType<SocialLinks> = z
    .array(SocialLinkSchema)
    .max(20)
    .nullable();
export const SocialLinksDefaultSchema: z.ZodType<SocialLinks> =
    SocialLinksSchema.default(null);

// ── 标签 ──

export const TagsSchema: z.ZodType<Tags> = z.array(z.string().max(100)).max(20);
export const TagsDefaultSchema: z.ZodType<Tags> = TagsSchema.default([]);

// ── 通用字段 ──

/** 可选字符串（null 或 string） */
export const OptionalStringSchema: z.ZodType<OptionalString> = z
    .string()
    .nullable()
    .optional();

/** 正整数或 null */
export const OptionalIntSchema: z.ZodType<OptionalInt> = z
    .number()
    .int()
    .nullable()
    .optional();
