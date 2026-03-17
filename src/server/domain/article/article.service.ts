/**
 * Article Service — 业务编排层
 *
 * 协调 Rules（纯函数）、Repository（数据访问）和副作用（缓存、文件清理）。
 * API Handler 调用 Service 完成业务逻辑，自身只负责请求解析和响应格式化。
 */

import type { AppArticle } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { forbidden, badRequest } from "@/server/api/errors";
import {
    cleanupOrphanDirectusFiles,
    normalizeDirectusFileId,
} from "@/server/api/v1/shared/file-cleanup";

import {
    canUserModifyArticle,
    resolvePublishedAt,
    isArticlePubliclyVisible,
    isArticleCommentable,
    canTransitionArticleStatus,
} from "./article.rules";
import * as articleRepo from "./article.repository";
import type { CreateArticleInput, UpdateArticleInput } from "./article.types";

// ── 辅助 ──

function nowIso(): string {
    return new Date().toISOString();
}

// ── 创建 ──

export async function createArticle(
    input: CreateArticleInput,
    authorId: string,
): Promise<AppArticle> {
    const status = input.status ?? "draft";
    const publishedAt = resolvePublishedAt(
        status,
        input.published_at,
        nowIso(),
    );

    return await articleRepo.create({
        author_id: authorId,
        status,
        title: input.title,
        slug: input.slug ?? null,
        summary: input.summary ?? null,
        body_markdown: input.body_markdown,
        cover_file: input.cover_file ?? null,
        cover_url: input.cover_url ?? null,
        tags: input.tags ?? null,
        category: input.category ?? null,
        allow_comments: input.allow_comments ?? true,
        is_public: input.is_public ?? true,
        published_at: publishedAt,
    } as Partial<AppArticle>);
}

// ── 更新 ──

export async function updateArticle(
    articleId: string,
    input: UpdateArticleInput,
    userId: string,
    isAdmin: boolean,
    /** 原始 body 对象，用于检测文件字段是否被显式传入 */
    rawBody?: JsonObject,
): Promise<AppArticle> {
    const article = await articleRepo.findById(articleId);
    if (!article) {
        throw badRequest("ARTICLE_NOT_FOUND", "文章不存在");
    }
    if (!canUserModifyArticle(userId, article.author_id, isAdmin)) {
        throw forbidden();
    }

    // 状态转换校验
    if (input.status !== undefined && input.status !== article.status) {
        if (!canTransitionArticleStatus(article.status, input.status)) {
            throw badRequest(
                "INVALID_STATUS_TRANSITION",
                `不允许从 ${article.status} 转换到 ${input.status}`,
            );
        }
    }

    const payload: JsonObject = {};
    const prevCoverFile = normalizeDirectusFileId(article.cover_file);
    let nextCoverFile = prevCoverFile;

    if (input.title !== undefined) payload.title = input.title;
    if (input.slug !== undefined) payload.slug = input.slug;
    if (input.summary !== undefined) payload.summary = input.summary;
    if (input.body_markdown !== undefined)
        payload.body_markdown = input.body_markdown;
    if (input.cover_url !== undefined) payload.cover_url = input.cover_url;
    if (input.tags !== undefined) payload.tags = input.tags;
    if (input.category !== undefined) payload.category = input.category;
    if (input.allow_comments !== undefined)
        payload.allow_comments = input.allow_comments;
    if (input.is_public !== undefined) payload.is_public = input.is_public;
    if (input.status !== undefined) payload.status = input.status;
    if (input.published_at !== undefined)
        payload.published_at = input.published_at;

    // 文件字段需要检测原始 body 是否包含该键
    if (rawBody && Object.hasOwn(rawBody, "cover_file")) {
        nextCoverFile = normalizeDirectusFileId(input.cover_file);
        payload.cover_file = input.cover_file ?? null;
    }

    const updated = await articleRepo.update(articleId, payload);

    // 清理旧封面文件
    if (
        rawBody &&
        Object.hasOwn(rawBody, "cover_file") &&
        prevCoverFile &&
        prevCoverFile !== nextCoverFile
    ) {
        await cleanupOrphanDirectusFiles([prevCoverFile]);
    }

    return updated;
}

// ── 删除 ──

export async function deleteArticle(
    articleId: string,
    userId: string,
    isAdmin: boolean,
): Promise<void> {
    const article = await articleRepo.findById(articleId);
    if (!article) {
        throw badRequest("ARTICLE_NOT_FOUND", "文章不存在");
    }
    if (!canUserModifyArticle(userId, article.author_id, isAdmin)) {
        throw forbidden();
    }

    const coverFileId = normalizeDirectusFileId(article.cover_file);
    await articleRepo.remove(articleId);
    if (coverFileId) {
        await cleanupOrphanDirectusFiles([coverFileId]);
    }
}

// ── 查询 ──

export async function getPublicArticle(id: string): Promise<AppArticle | null> {
    return await articleRepo.findPublicById(id);
}

export async function getPublicArticleBySlug(
    slug: string,
): Promise<AppArticle | null> {
    return await articleRepo.findPublicBySlug(slug);
}

export async function getPublicArticleByShortId(
    shortId: string,
): Promise<AppArticle | null> {
    return await articleRepo.findPublicByShortId(shortId);
}

/** 检查文章是否可见（用于评论等场景） */
export function checkArticleVisible(
    article: Pick<AppArticle, "status" | "is_public">,
): boolean {
    return isArticlePubliclyVisible(article);
}

/** 检查文章是否允许评论 */
export function checkArticleCommentable(
    article: Pick<AppArticle, "allow_comments" | "status" | "is_public">,
): boolean {
    return isArticleCommentable(article);
}
