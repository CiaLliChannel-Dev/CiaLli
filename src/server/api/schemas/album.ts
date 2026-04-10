/**
 * 相册相关 Zod Schema
 */
import * as z from "zod";

import {
    type AlbumLayout,
    type AppStatus,
    type OptionalInt,
    type OptionalString,
    type Tags,
    AlbumLayoutSchema,
    AppStatusSchema,
    OptionalIntSchema,
    OptionalStringSchema,
    TagsDefaultSchema,
    TagsSchema,
} from "./common";

export type CreateAlbumInput = {
    title: string;
    slug?: OptionalString;
    description?: OptionalString;
    cover_file?: OptionalString;
    cover_url?: OptionalString;
    date?: OptionalString;
    location?: OptionalString;
    tags: Tags;
    category?: OptionalString;
    layout: AlbumLayout;
    columns: number;
    is_public: boolean;
};

export type UpdateAlbumInput = {
    title?: string;
    slug?: OptionalString;
    description?: OptionalString;
    cover_file?: OptionalString;
    cover_url?: OptionalString;
    date?: OptionalString;
    location?: OptionalString;
    tags?: Tags;
    category?: OptionalString;
    layout?: AlbumLayout;
    columns?: number;
    is_public?: boolean;
};

export type CreateAlbumPhotoInput = {
    file_id?: OptionalString;
    image_url?: OptionalString;
    title?: OptionalString;
    description?: OptionalString;
    tags: Tags;
    taken_at?: OptionalString;
    location?: OptionalString;
    sort?: OptionalInt;
    is_public: boolean;
    show_on_profile: boolean;
};

export type UpdateAlbumPhotoInput = {
    file_id?: OptionalString;
    image_url?: OptionalString;
    title?: OptionalString;
    description?: OptionalString;
    tags?: Tags;
    taken_at?: OptionalString;
    location?: OptionalString;
    sort?: OptionalInt;
    is_public?: boolean;
    show_on_profile?: boolean;
    status?: AppStatus;
};

// ── 相册状态（仅 draft / published） ──

// ── 创建相册 ──

export const CreateAlbumSchema: z.ZodType<CreateAlbumInput> = z.object({
    title: z.string().min(1, "相册标题必填"),
    slug: OptionalStringSchema,
    description: OptionalStringSchema,
    cover_file: OptionalStringSchema,
    cover_url: OptionalStringSchema,
    date: OptionalStringSchema,
    location: OptionalStringSchema,
    tags: TagsDefaultSchema,
    category: OptionalStringSchema,
    layout: AlbumLayoutSchema.default("grid"),
    columns: z.number().int().min(1).max(10).default(3),
    is_public: z.boolean().default(false),
});

// ── 更新相册 ──

export const UpdateAlbumSchema: z.ZodType<UpdateAlbumInput> = z
    .object({
        title: z.string().min(1),
        slug: OptionalStringSchema,
        description: OptionalStringSchema,
        cover_file: OptionalStringSchema,
        cover_url: OptionalStringSchema,
        date: OptionalStringSchema,
        location: OptionalStringSchema,
        tags: TagsSchema,
        category: OptionalStringSchema,
        layout: AlbumLayoutSchema,
        columns: z.number().int().min(1).max(10),
        is_public: z.boolean(),
    })
    .partial();

// ── 创建相册照片 ──

export const CreateAlbumPhotoSchema: z.ZodType<CreateAlbumPhotoInput> =
    z.object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        title: OptionalStringSchema,
        description: OptionalStringSchema,
        tags: TagsDefaultSchema,
        taken_at: OptionalStringSchema,
        location: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean().default(true),
        show_on_profile: z.boolean().default(true),
    });

// ── 更新相册照片 ──

export const UpdateAlbumPhotoSchema: z.ZodType<UpdateAlbumPhotoInput> = z
    .object({
        file_id: OptionalStringSchema,
        image_url: OptionalStringSchema,
        title: OptionalStringSchema,
        description: OptionalStringSchema,
        tags: TagsSchema,
        taken_at: OptionalStringSchema,
        location: OptionalStringSchema,
        sort: OptionalIntSchema,
        is_public: z.boolean(),
        show_on_profile: z.boolean(),
        status: AppStatusSchema,
    })
    .partial();
