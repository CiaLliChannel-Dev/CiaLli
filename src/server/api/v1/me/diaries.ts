import type { APIContext } from "astro";
import { performance } from "node:perf_hooks";

import type { JsonObject } from "@/types/json";
import { assertCan, assertOwnerOrAdmin } from "@/server/auth/acl";
import {
    createOne,
    deleteOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import {
    CreateDiaryImageSchema,
    CreateDiarySchema,
    DiaryPreviewSchema,
    UpdateDiaryImageSchema,
    UpdateDiarySchema,
} from "@/server/api/schemas";
import { cacheManager } from "@/server/cache/manager";
import { createWithShortId } from "@/server/utils/short-id";

import type { AppAccess } from "../shared";
import { DIARY_FIELDS, hasOwn, parseRouteId } from "../shared";
import {
    cleanupOrphanDirectusFiles,
    collectDiaryFileIds,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";
import { bindFileOwnerToUser, renderMeMarkdownPreview } from "./_helpers";

function buildDiaryFileTitle(
    shortIdValue: unknown,
    sortValue: unknown,
): string {
    const normalizedShortId = String(shortIdValue ?? "").trim() || "unknown";
    const sortNumber =
        typeof sortValue === "number" && Number.isFinite(sortValue)
            ? sortValue
            : null;
    if (sortNumber === null) {
        return `Diary ${normalizedShortId}`;
    }
    const index = Math.max(1, Math.floor(sortNumber) + 1);
    return `Diary ${normalizedShortId}-${String(index).padStart(2, "0")}`;
}

function invalidateDiaryDetailCache(id: string, shortId?: string | null): void {
    void cacheManager.invalidate("diary-detail", id);
    const normalizedShortId = String(shortId ?? "").trim();
    if (normalizedShortId) {
        void cacheManager.invalidate("diary-detail", normalizedShortId);
    }
}

type OwnedDiaryRecord = JsonObject & {
    id: string;
    author_id: string;
    short_id?: string | null;
};

function isUuidLike(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
    );
}

async function resolveOwnedDiary(
    identifier: string,
    ownerId: string,
): Promise<OwnedDiaryRecord | null> {
    const normalizedIdentifier = String(identifier ?? "").trim();
    if (!normalizedIdentifier) {
        return null;
    }

    const matchFilters: JsonObject[] = [
        { short_id: { _eq: normalizedIdentifier } as JsonObject },
    ];
    if (isUuidLike(normalizedIdentifier)) {
        matchFilters.push({ id: { _eq: normalizedIdentifier } as JsonObject });
    }

    const rows = await readMany("app_diaries", {
        filter: {
            _and: [
                { author_id: { _eq: ownerId } },
                {
                    _or: matchFilters,
                },
            ],
        } as JsonObject,
        fields: [...DIARY_FIELDS],
        limit: 1,
    });
    const first = rows[0] as JsonObject | undefined;
    if (!first) {
        return null;
    }
    return {
        ...first,
        id: String(first.id),
        author_id: String(first.author_id ?? "").trim(),
        short_id:
            first.short_id === null || first.short_id === undefined
                ? null
                : String(first.short_id),
    };
}

export async function handleMeDiaries(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 2 && segments[1] === "preview") {
        if (context.request.method !== "POST") {
            return fail("方法不允许", 405);
        }
        assertCan(access, "can_manage_diaries");
        const body = await parseJsonBody(context.request);
        const input = validateBody(DiaryPreviewSchema, body);
        const renderStart = performance.now();
        const bodyHtml = await renderMeMarkdownPreview(
            input.content,
            input.render_mode,
        );
        const renderDuration = performance.now() - renderStart;
        return ok(
            {
                content: input.content,
                body_html: bodyHtml,
            },
            {
                headers:
                    process.env.NODE_ENV === "production"
                        ? undefined
                        : {
                              "Server-Timing": `md-render;dur=${renderDuration.toFixed(2)};desc="${input.render_mode}"`,
                          },
            },
        );
    }

    if (segments.length === 1) {
        if (context.request.method === "GET") {
            const { page, limit, offset } = parsePagination(context.url);
            const rows = await readMany("app_diaries", {
                filter: {
                    author_id: { _eq: access.user.id },
                } as JsonObject,
                fields: [...DIARY_FIELDS],
                sort: ["-date_created"],
                limit,
                offset,
            });
            return ok({
                items: rows,
                page,
                limit,
                total: rows.length,
            });
        }

        if (context.request.method === "POST") {
            assertCan(access, "can_manage_diaries");
            const body = await parseJsonBody(context.request);
            const input = validateBody(CreateDiarySchema, body);

            const diaryPayload = {
                status: "published" as const,
                author_id: access.user.id,
                content: input.content,
                allow_comments: input.allow_comments,
                praviate: input.praviate,
            };

            const created = await createWithShortId(
                "app_diaries",
                diaryPayload,
                (collection, payload) =>
                    createOne(collection, payload, {
                        fields: [...DIARY_FIELDS],
                    }),
            );
            void cacheManager.invalidateByDomain("diary-list");
            void cacheManager.invalidateByDomain("home-feed");
            return ok({ item: created });
        }
    }

    if (segments.length === 2) {
        const identifier = parseRouteId(segments[1]);
        if (!identifier) {
            return fail("缺少日记 ID", 400);
        }
        const target = await resolveOwnedDiary(identifier, access.user.id);
        if (!target) {
            return fail("日记不存在", 404);
        }
        assertOwnerOrAdmin(access, target.author_id);
        const diaryId = String(target.id);

        if (context.request.method === "GET") {
            const images = await readMany("app_diary_images", {
                filter: {
                    diary_id: { _eq: diaryId },
                } as JsonObject,
                sort: ["sort", "-date_created"],
                limit: 100,
            });
            return ok({ item: target, images });
        }

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateDiarySchema, body);
            const payload: JsonObject = {};
            if (input.content !== undefined) {
                payload.content = input.content;
            }
            if (input.allow_comments !== undefined) {
                payload.allow_comments = input.allow_comments;
            }
            if (input.praviate !== undefined) {
                payload.praviate = input.praviate;
            }
            payload.status = "published";
            const updated = await updateOne("app_diaries", diaryId, payload, {
                fields: [...DIARY_FIELDS],
            });
            void cacheManager.invalidateByDomain("diary-list");
            void cacheManager.invalidateByDomain("home-feed");
            invalidateDiaryDetailCache(diaryId, updated.short_id);
            return ok({ item: updated });
        }

        if (context.request.method === "DELETE") {
            const fileIds = await collectDiaryFileIds(diaryId);
            await deleteOne("app_diaries", diaryId);
            await cleanupOrphanDirectusFiles(fileIds);
            void cacheManager.invalidateByDomain("diary-list");
            void cacheManager.invalidateByDomain("home-feed");
            invalidateDiaryDetailCache(diaryId, target.short_id);
            return ok({ id: diaryId });
        }
    }

    return fail("未找到接口", 404);
}

export async function handleMeDiaryImages(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 3 && context.request.method === "POST") {
        assertCan(access, "can_manage_diaries");
        const diaryIdentifier = parseRouteId(segments[1]);
        if (!diaryIdentifier) {
            return fail("缺少日记 ID", 400);
        }
        const diary = await resolveOwnedDiary(diaryIdentifier, access.user.id);
        if (!diary) {
            return fail("日记不存在", 404);
        }
        assertOwnerOrAdmin(access, diary.author_id);
        const diaryId = String(diary.id);
        const body = await parseJsonBody(context.request);
        const input = validateBody(CreateDiaryImageSchema, body);
        const created = await createOne("app_diary_images", {
            status: input.is_public ? "published" : "archived",
            diary_id: diaryId,
            file_id: input.file_id ?? null,
            image_url: input.image_url ?? null,
            caption: input.caption ?? null,
            sort: input.sort ?? null,
            is_public: input.is_public,
            show_on_profile: input.show_on_profile,
        });
        if (created.file_id) {
            await bindFileOwnerToUser(
                created.file_id,
                access.user.id,
                buildDiaryFileTitle(diary.short_id, created.sort),
            );
        }
        void cacheManager.invalidateByDomain("home-feed");
        invalidateDiaryDetailCache(diaryId, diary.short_id);
        return ok({ item: created });
    }

    if (segments.length === 4) {
        const imageId = parseRouteId(segments[3]);
        if (!imageId) {
            return fail("缺少图片 ID", 400);
        }
        const image = await readOneById("app_diary_images", imageId);
        if (!image) {
            return fail("图片不存在", 404);
        }
        const diary = await readOneById("app_diaries", image.diary_id, {
            fields: [...DIARY_FIELDS],
        });
        if (!diary) {
            return fail("日记不存在", 404);
        }
        assertOwnerOrAdmin(access, diary.author_id);

        if (context.request.method === "PATCH") {
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateDiaryImageSchema, body);
            const payload: JsonObject = {};
            const prevFileId = normalizeDirectusFileId(image.file_id);
            let nextFileId = prevFileId;
            if (hasOwn(body as JsonObject, "file_id")) {
                nextFileId = normalizeDirectusFileId(input.file_id);
                payload.file_id = input.file_id ?? null;
            }
            if (input.image_url !== undefined) {
                payload.image_url = input.image_url;
            }
            if (input.caption !== undefined) {
                payload.caption = input.caption;
            }
            if (input.sort !== undefined) {
                payload.sort = input.sort;
            }
            if (input.is_public !== undefined) {
                payload.is_public = input.is_public;
            }
            if (input.show_on_profile !== undefined) {
                payload.show_on_profile = input.show_on_profile;
            }
            if (input.status !== undefined) {
                payload.status = input.status;
            }
            const updated = await updateOne(
                "app_diary_images",
                imageId,
                payload,
            );
            if (hasOwn(body as JsonObject, "file_id") && nextFileId) {
                await bindFileOwnerToUser(
                    nextFileId,
                    access.user.id,
                    buildDiaryFileTitle(diary.short_id, updated.sort),
                );
            }
            if (
                hasOwn(body as JsonObject, "file_id") &&
                prevFileId &&
                prevFileId !== nextFileId
            ) {
                await cleanupOrphanDirectusFiles([prevFileId]);
            }
            void cacheManager.invalidateByDomain("home-feed");
            invalidateDiaryDetailCache(image.diary_id, diary.short_id);
            return ok({ item: updated });
        }

        if (context.request.method === "DELETE") {
            const fileId = normalizeDirectusFileId(image.file_id);
            await deleteOne("app_diary_images", imageId);
            if (fileId) {
                await cleanupOrphanDirectusFiles([fileId]);
            }
            void cacheManager.invalidateByDomain("home-feed");
            invalidateDiaryDetailCache(image.diary_id, diary.short_id);
            return ok({ id: imageId });
        }
    }

    return fail("未找到接口", 404);
}
