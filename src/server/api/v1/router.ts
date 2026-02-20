import type { APIContext } from "astro";

import { fail, ok } from "@/server/api/response";
import { getClientIp } from "@/server/directus-auth";
import { withErrorHandler } from "@/server/middleware/error-handler";
import { assertCsrfToken } from "@/server/security/csrf";
import {
    applyRateLimit,
    rateLimitResponse,
    type RateLimitCategory,
} from "@/server/security/rate-limit";

import {
    handleAdminContent,
    handleAdminRegistrationRequests,
    handleAdminSettings,
    handleAdminUsers,
} from "./admin";
import { handleArticleComments, handleDiaryComments } from "./comments";
import { handleMe } from "./me";
import { handlePublic, handleUserHome } from "./public";
import { assertSameOrigin, isWriteMethod, parseSegments } from "./shared";
import { handleUploads } from "./uploads";

/** 根据路由前缀和方法映射限流分类 */
function resolveRateLimitCategory(
    segments: string[],
    _method: string,
): RateLimitCategory {
    const first = segments[0] ?? "";

    if (first === "uploads") return "upload";

    if (first === "articles" || first === "diaries") {
        const last = segments[segments.length - 1] ?? "";
        if (last === "comments") return "comment";
    }

    if (first === "admin") return "admin-write";

    return "write";
}

async function handleV1Inner(context: APIContext): Promise<Response> {
    if (isWriteMethod(context.request.method)) {
        const denied = assertSameOrigin(context);
        if (denied) {
            return denied;
        }

        // CSRF 双提交校验
        const csrfDenied = assertCsrfToken(context);
        if (csrfDenied) return csrfDenied;

        // 分级限流
        const ip = getClientIp(context.request.headers);
        const segments = parseSegments(context);
        const category = resolveRateLimitCategory(
            segments,
            context.request.method,
        );
        const rl = await applyRateLimit(ip, category);
        if (!rl.ok) return rateLimitResponse(rl);
    }

    const segments = parseSegments(context);
    if (segments.length === 0) {
        return ok({ message: "ok" });
    }

    if (segments[0] === "public") {
        return await handlePublic(context, segments);
    }

    if (segments[0] === "users") {
        return await handleUserHome(context, segments);
    }

    if (segments[0] === "me") {
        return await handleMe(context, segments.slice(1));
    }

    if (segments[0] === "articles") {
        return await handleArticleComments(context, segments);
    }

    if (segments[0] === "diaries") {
        return await handleDiaryComments(context, segments);
    }

    if (segments[0] === "uploads") {
        return await handleUploads(context);
    }

    if (segments[0] === "admin") {
        if (segments[1] === "users") {
            return await handleAdminUsers(context, segments.slice(1));
        }
        if (segments[1] === "registration-requests") {
            return await handleAdminRegistrationRequests(
                context,
                segments.slice(1),
            );
        }
        if (segments[1] === "content") {
            return await handleAdminContent(context, segments.slice(1));
        }
        if (segments[1] === "settings") {
            return await handleAdminSettings(context, segments.slice(1));
        }
    }

    return fail("未找到接口", 404);
}

export const handleV1 = withErrorHandler(handleV1Inner);
