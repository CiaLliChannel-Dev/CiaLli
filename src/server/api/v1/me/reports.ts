import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import {
    createOne,
    readMany,
    readOneById,
    updateOne,
} from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { CreateReportSchema, UpdateReportSchema } from "@/server/api/schemas";

import type { AppAccess } from "../shared";
import { parseRouteId } from "../shared";

export async function handleMeReports(
    context: APIContext,
    access: AppAccess,
    segments: string[],
): Promise<Response> {
    if (segments.length === 1) {
        if (context.request.method === "GET") {
            const { page, limit, offset } = parsePagination(context.url);
            const rows = await readMany("app_content_reports", {
                filter: access.isAdmin
                    ? undefined
                    : ({
                          reporter_id: { _eq: access.user.id },
                      } as JsonObject),
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
            const body = await parseJsonBody(context.request);
            const input = validateBody(CreateReportSchema, body);

            let targetUserId = input.target_user_id ?? null;
            if (input.target_type === "article") {
                const targetArticle = await readOneById(
                    "app_articles",
                    input.target_id,
                );
                if (!targetArticle) {
                    return fail("举报目标不存在", 404);
                }
                targetUserId = targetUserId || targetArticle.author_id;
            }
            if (input.target_type === "diary") {
                const targetDiary = await readOneById(
                    "app_diaries",
                    input.target_id,
                );
                if (!targetDiary) {
                    return fail("举报目标不存在", 404);
                }
                targetUserId = targetUserId || targetDiary.author_id;
            }

            const created = await createOne("app_content_reports", {
                status: "published",
                reporter_id: access.user.id,
                target_type: input.target_type,
                target_id: input.target_id,
                target_user_id: targetUserId,
                reason: input.reason,
                detail: input.detail ?? null,
                report_status: "pending",
            });
            return ok({ item: created });
        }
    }

    if (segments.length === 2) {
        const reportId = parseRouteId(segments[1]);
        if (!reportId) {
            return fail("缺少举报记录 ID", 400);
        }
        const report = await readOneById("app_content_reports", reportId);
        if (!report) {
            return fail("举报记录不存在", 404);
        }

        if (context.request.method === "PATCH") {
            if (!access.isAdmin && report.reporter_id !== access.user.id) {
                return fail("权限不足", 403);
            }
            const body = await parseJsonBody(context.request);
            const input = validateBody(UpdateReportSchema, body);
            const payload: JsonObject = {};
            if (input.detail !== undefined) {
                payload.detail = input.detail ?? null;
            }
            if (input.report_status !== undefined) {
                payload.report_status = input.report_status;
            }
            const updated = await updateOne(
                "app_content_reports",
                reportId,
                payload,
            );
            return ok({ item: updated });
        }
    }

    return fail("未找到接口", 404);
}
