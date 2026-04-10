/**
 * 评论相关 Zod Schema
 */
import * as z from "zod";

import type { CommentStatus, OptionalString } from "./common";
import { CommentStatusSchema, OptionalStringSchema } from "./common";

export type CreateCommentInput = {
    body: string;
    parent_id?: OptionalString;
    status: CommentStatus;
    is_public: boolean;
    show_on_profile: boolean;
};

export type UpdateCommentInput = {
    body?: string;
    status?: CommentStatus;
    is_public?: boolean;
    show_on_profile?: boolean;
};

export type CommentPreviewInput = {
    body: string;
    render_mode: "fast" | "full";
};

// ── 创建评论 ──

export const CreateCommentSchema: z.ZodType<CreateCommentInput> = z.object({
    body: z.string().min(1, "评论内容不能为空"),
    parent_id: OptionalStringSchema,
    status: CommentStatusSchema.default("published"),
    is_public: z.boolean().default(true),
    show_on_profile: z.boolean().default(true),
});

// ── 更新评论 ──

export const UpdateCommentSchema: z.ZodType<UpdateCommentInput> = z
    .object({
        body: z.string().min(1),
        status: CommentStatusSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
    })
    .partial();

// ── 评论预览 ──

export const CommentPreviewSchema: z.ZodType<CommentPreviewInput> = z.object({
    body: z.string(),
    render_mode: z.enum(["fast", "full"]).default("full"),
});
