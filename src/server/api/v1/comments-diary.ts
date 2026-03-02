import type { APIContext } from "astro";

import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import { readOneById, updateOne } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { cacheManager } from "@/server/cache/manager";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { UpdateCommentSchema, CreateCommentSchema } from "@/server/api/schemas";

import { DIARY_FIELDS, parseRouteId, requireAccess } from "./shared";
import {
    buildCommentUpdatePayload,
    buildDecoratedCommentTree,
    createDiaryComment,
    deleteCommentWithDescendants,
    handleCommentPreview,
    loadPaginatedComments,
    parseCommentPagination,
    renderCommentItem,
    validateReplyParent,
} from "./comments-shared";

function invalidateDiaryDetailCache(id: string, shortId?: string | null): void {
    void cacheManager.invalidate("diary-detail", id);
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        void cacheManager.invalidate("diary-detail", normalizedShortId);
    }
}

async function invalidateDiaryDetailCacheByDiaryId(
    diaryId: string,
): Promise<void> {
    const diary = await readOneById("app_diaries", diaryId, {
        fields: ["id", "short_id"],
    });
    if (!diary) {
        invalidateDiaryDetailCache(diaryId);
        return;
    }
    invalidateDiaryDetailCache(String(diary.id), diary.short_id);
}

async function handleDiaryCommentGet(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    const diary = await readOneById("app_diaries", diaryId, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary) {
        return fail("日记不存在", 404);
    }
    if (!(diary.status === "published" && diary.praviate === true)) {
        return fail("日记不可见", 404);
    }

    const pagination = parseCommentPagination(context.url);
    const pagedComments = await loadPaginatedComments(
        "app_diary_comments",
        "diary_id",
        diaryId,
        pagination,
    );

    const tree = await buildDecoratedCommentTree(
        context,
        pagedComments.comments,
        "app_diary_comment_likes",
        "diary",
    );
    return ok({
        items: tree,
        total: pagedComments.totalTopLevel,
        total_top_level: pagedComments.totalTopLevel,
        page: pagedComments.page,
        limit: pagedComments.limit,
        has_more: pagedComments.hasMore,
    });
}

async function handleDiaryCommentPost(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    assertCan(access, "can_comment_diaries");

    const diary = await readOneById("app_diaries", diaryId, {
        fields: [...DIARY_FIELDS],
    });
    if (!diary) {
        return fail("日记不存在", 404);
    }
    if (!diary.allow_comments) {
        return fail("该日记已关闭评论", 403);
    }

    const body = await parseJsonBody(context.request);
    const input = validateBody(CreateCommentSchema, body);
    if (input.parent_id) {
        const parentValidationError = await validateReplyParent(
            "app_diary_comments",
            input.parent_id,
            diaryId,
            "diary_id",
        );
        if (parentValidationError) {
            return parentValidationError;
        }
    }

    const created = await createDiaryComment(diaryId, access.user.id, input);
    invalidateDiaryDetailCache(String(diary.id), diary.short_id);
    void cacheManager.invalidateByDomain("home-feed");
    return ok({
        item: await renderCommentItem(created),
    });
}

async function handleDiaryCommentListOrCreate(
    context: APIContext,
    diaryId: string,
): Promise<Response> {
    if (context.request.method === "GET") {
        return handleDiaryCommentGet(context, diaryId);
    }
    if (context.request.method === "POST") {
        return handleDiaryCommentPost(context, diaryId);
    }
    return fail("方法不允许", 405);
}

async function handleDiaryCommentPatch(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_diary_comments", commentId);
    if (!comment) {
        return fail("评论不存在", 404);
    }
    assertOwnerOrAdmin(access, comment.author_id);

    const body = await parseJsonBody(context.request);
    const input = validateBody(UpdateCommentSchema, body);
    const payload = buildCommentUpdatePayload(input);
    const updated = await updateOne("app_diary_comments", commentId, payload);
    await invalidateDiaryDetailCacheByDiaryId(comment.diary_id);
    void cacheManager.invalidateByDomain("home-feed");
    return ok({
        item: await renderCommentItem(updated),
    });
}

async function handleDiaryCommentDelete(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;
    const comment = await readOneById("app_diary_comments", commentId);
    if (!comment) {
        return fail("评论不存在", 404);
    }
    assertOwnerOrAdmin(access, comment.author_id);

    await deleteCommentWithDescendants("app_diary_comments", commentId);
    await invalidateDiaryDetailCacheByDiaryId(comment.diary_id);
    void cacheManager.invalidateByDomain("home-feed");
    return ok({ id: commentId });
}

async function handleDiaryCommentById(
    context: APIContext,
    commentId: string,
): Promise<Response> {
    if (context.request.method === "PATCH") {
        return handleDiaryCommentPatch(context, commentId);
    }
    if (context.request.method === "DELETE") {
        return handleDiaryCommentDelete(context, commentId);
    }
    return fail("方法不允许", 405);
}

export async function handleDiaryComments(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (
        segments.length === 3 &&
        segments[1] === "comments" &&
        segments[2] === "preview"
    ) {
        return handleCommentPreview(context, "can_comment_diaries");
    }

    if (segments.length === 3 && segments[2] === "comments") {
        const diaryId = parseRouteId(segments[1]);
        if (!diaryId) {
            return fail("缺少日记 ID", 400);
        }
        return handleDiaryCommentListOrCreate(context, diaryId);
    }

    if (segments.length === 3 && segments[1] === "comments") {
        const commentId = parseRouteId(segments[2]);
        if (!commentId) {
            return fail("缺少评论 ID", 400);
        }
        return handleDiaryCommentById(context, commentId);
    }

    return fail("未找到接口", 404);
}
