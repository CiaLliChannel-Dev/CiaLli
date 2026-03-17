import type { APIContext } from "astro";

import type { BangumiCollectionStatus } from "@/server/bangumi/types";
import { getSessionUser } from "@/server/auth/session";
import { fail, ok } from "@/server/api/response";
import { parsePagination } from "@/server/api/utils";

import {
    loadUserAlbumDetail,
    loadUserAlbumList,
    loadUserBangumiList,
    loadUserDiaryDetail,
    loadUserDiaryList,
    loadUserHomeData,
    type ContentLoadResult,
} from "../public-data";
import { parseRouteId } from "../shared";

function statusFromQuery(value: string): BangumiCollectionStatus | undefined {
    switch (value) {
        case "planned":
        case "completed":
        case "watching":
        case "onhold":
        case "dropped":
            return value;
        default:
            return undefined;
    }
}

function failFromLoadResult(result: ContentLoadResult<unknown>): Response {
    if (result.status === "not_found") {
        return fail("用户主页不存在", 404);
    }
    if (
        result.status === "permission_denied" &&
        result.reason === "profile_not_public"
    ) {
        return fail("用户主页不存在", 404);
    }
    return fail("内容未公开", 403);
}

export async function handleUserHome(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "GET") {
        return fail("方法不允许", 405);
    }
    if (segments.length < 3 || segments.length > 4) {
        return fail("未找到接口", 404);
    }

    const username = parseRouteId(segments[1]);
    if (!username) {
        return fail("缺少用户名", 400);
    }

    const moduleKey = segments[2];
    if (
        moduleKey !== "home" &&
        moduleKey !== "bangumi" &&
        moduleKey !== "diary" &&
        moduleKey !== "albums"
    ) {
        return fail("未找到接口", 404);
    }

    if (moduleKey === "home" && segments.length !== 3) {
        return fail("未找到接口", 404);
    }

    const sessionUser = await getSessionUser(context);
    const viewerId = sessionUser?.id ?? null;

    if (moduleKey === "home") {
        const result = await loadUserHomeData(username, { viewerId });
        if (result.status !== "ok") {
            return failFromLoadResult(result);
        }
        return ok(result.data);
    }

    const detailId = segments.length === 4 ? parseRouteId(segments[3]) : "";
    if (segments.length === 4 && !detailId) {
        return fail("缺少内容 ID", 400);
    }

    if (moduleKey === "bangumi") {
        if (detailId) {
            return fail("未找到接口", 404);
        }
        const { page, limit } = parsePagination(context.url);
        const status = statusFromQuery(
            context.url.searchParams.get("status")?.trim() || "",
        );
        const result = await loadUserBangumiList(username, {
            page,
            limit,
            status,
            viewerId,
        });
        if (result.status !== "ok") {
            return failFromLoadResult(result);
        }
        return ok(result.data);
    }

    if (moduleKey === "diary") {
        if (detailId) {
            const result = await loadUserDiaryDetail(username, detailId, {
                viewerId,
            });
            if (result.status !== "ok") {
                return failFromLoadResult(result);
            }
            return ok({ item: result.data });
        }

        const { page, limit } = parsePagination(context.url);
        const result = await loadUserDiaryList(username, {
            page,
            limit,
            viewerId,
        });
        if (result.status !== "ok") {
            return failFromLoadResult(result);
        }
        return ok(result.data);
    }

    if (detailId) {
        const result = await loadUserAlbumDetail(username, detailId, {
            viewerId,
        });
        if (result.status !== "ok") {
            return failFromLoadResult(result);
        }
        return ok({ item: result.data });
    }

    const { page, limit } = parsePagination(context.url);
    const result = await loadUserAlbumList(username, {
        page,
        limit,
        viewerId,
    });
    if (result.status !== "ok") {
        return failFromLoadResult(result);
    }
    return ok(result.data);
}
