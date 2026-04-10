/**
 * 日记相关 Zod Schema
 */
import * as z from "zod";

import type { OptionalInt, OptionalString } from "./common";
import { OptionalIntSchema, OptionalStringSchema } from "./common";

type DiaryStatus = "draft" | "published";

export type CreateDiaryInput = {
    content: string;
    status: "published";
    allow_comments: boolean;
    praviate: boolean;
};

export type UpdateDiaryInput = {
    content?: string;
    allow_comments?: boolean;
    praviate?: boolean;
    status?: DiaryStatus;
};

export type UpsertDiaryWorkingDraftInput = {
    content?: string;
    allow_comments?: boolean;
    praviate?: boolean;
};

export type DiaryPreviewInput = {
    content: string;
    render_mode: "fast" | "full";
};

export type CreateDiaryImageInput = {
    file_id?: OptionalString;
    image_url?: OptionalString;
    caption?: OptionalString;
    sort?: OptionalInt;
    is_public: boolean;
    show_on_profile: boolean;
};

export type UpdateDiaryImageInput = {
    file_id?: OptionalString;
    image_url?: OptionalString;
    caption?: OptionalString;
    sort?: OptionalInt;
    is_public?: boolean;
    show_on_profile?: boolean;
    status?: DiaryStatus;
};

const DiaryStatusSchema: z.ZodType<DiaryStatus> = z.enum([
    "draft",
    "published",
]);

// ── 创建日记 ──

export const CreateDiarySchema: z.ZodType<CreateDiaryInput> = z.object({
    content: z.string().min(1, "日记内容必填"),
    status: z.literal("published").default("published"),
    allow_comments: z.boolean().default(true),
    praviate: z.boolean().default(true),
});

// ── 更新日记 ──

export const UpdateDiarySchema: z.ZodType<UpdateDiaryInput> = z
    .object({
        content: z.string().min(1),
        allow_comments: z.boolean(),
        praviate: z.boolean(),
        status: DiaryStatusSchema,
    })
    .partial();

// ── 工作草稿（允许未完成字段） ──

export const UpsertDiaryWorkingDraftSchema: z.ZodType<UpsertDiaryWorkingDraftInput> =
    z.object({
        content: z.string().optional(),
        allow_comments: z.boolean().optional(),
        praviate: z.boolean().optional(),
    });

// ── 日记预览 ──

export const DiaryPreviewSchema: z.ZodType<DiaryPreviewInput> = z.object({
    content: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});

// ── 创建日记图片 ──

export const CreateDiaryImageSchema: z.ZodType<CreateDiaryImageInput> =
    z.object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        caption: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean().default(true),
        show_on_profile: z.boolean().default(true),
    });

// ── 更新日记图片 ──

export const UpdateDiaryImageSchema: z.ZodType<UpdateDiaryImageInput> = z
    .object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        caption: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
        status: DiaryStatusSchema,
    })
    .partial();
