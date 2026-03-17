import type { APIContext } from "astro";

import type {
    AppPermissions,
    AppProfile,
    AppUserRegistrationRequest,
    RegistrationRequestStatus,
} from "@/types/app";
import type { JsonObject } from "@/types/json";

import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    countItems,
    createDirectusUser,
    createOne,
    readMany,
    updateDirectusFileMetadata,
    updateOne,
} from "@/server/directus/client";
import { badRequest, conflict, notFound } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { invalidateOfficialSidebarCache } from "../public-data";
import { normalizeDirectusFileId } from "../shared/file-cleanup";

import {
    ensureUsernameAvailable,
    normalizeAppRole,
    normalizeRegistrationRequestStatus,
    parseBodyTextField,
    parseRouteId,
    requireAdmin,
} from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";

const REGISTRATION_REASON_MAX_LENGTH = 500;

function parseOptionalRegistrationReason(raw: unknown): string | null {
    const reason = String(raw ?? "").trim() || null;
    if (!reason) {
        return null;
    }
    if (reason.length > REGISTRATION_REASON_MAX_LENGTH) {
        throw badRequest(
            "REGISTRATION_REASON_TOO_LONG",
            "注册理由最多 500 字符",
        );
    }
    return reason;
}

function parseNormalizedEmail(raw: unknown): string {
    const email = String(raw || "")
        .trim()
        .toLowerCase();
    if (!email) {
        throw badRequest("EMAIL_EMPTY", "邮箱不能为空");
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        throw badRequest("EMAIL_INVALID", "邮箱格式不正确");
    }
    return email;
}

async function assertDirectusEmailAvailable(email: string): Promise<void> {
    const rows = await readMany("directus_users", {
        filter: { email: { _eq: email } } as JsonObject,
        limit: 1,
        fields: ["id"],
    });
    if (rows.length > 0) {
        throw conflict("EMAIL_EXISTS", "邮箱已存在");
    }
}

type ManagedUserCreateInput = {
    email: string;
    password: string;
    requestedUsername: string;
    displayName: string;
    avatarFile?: string | null;
    appRole?: AppPermissions["app_role"];
};

type ManagedUserCreateResult = {
    user: { id: string };
    profile: AppProfile;
    permissions: AppPermissions;
};

async function createManagedUser(
    input: ManagedUserCreateInput,
): Promise<ManagedUserCreateResult> {
    await Promise.all([
        assertDirectusEmailAvailable(input.email),
        ensureUsernameAvailable(input.requestedUsername),
    ]);

    const createdUser = await createDirectusUser({
        email: input.email,
        password: input.password,
        first_name: input.displayName || undefined,
        status: "active",
    });

    const profile = await createOne("app_user_profiles", {
        status: "published",
        user_id: createdUser.id,
        username: input.requestedUsername,
        display_name: input.displayName,
        bio: null,
        bio_typewriter_enable: true,
        bio_typewriter_speed: 80,
        avatar_file: input.avatarFile || null,
        avatar_url: null,
        profile_public: true,
        show_articles_on_profile: true,
        show_diaries_on_profile: true,
        show_bangumi_on_profile: true,
        show_albums_on_profile: true,
        show_comments_on_profile: true,
    });

    const permissions = await createOne("app_user_permissions", {
        user_id: createdUser.id,
        app_role: normalizeAppRole(input.appRole || "member"),
        can_publish_articles: true,
        can_comment_articles: true,
        can_manage_diaries: true,
        can_comment_diaries: true,
        can_manage_anime: true,
        can_manage_albums: true,
        can_upload_files: true,
    });

    invalidateAuthorCache(createdUser.id);
    invalidateOfficialSidebarCache();
    return { user: createdUser, profile, permissions };
}

async function readRegistrationRequestById(
    requestId: string,
): Promise<AppUserRegistrationRequest | null> {
    const rows = await readMany("app_user_registration_requests", {
        filter: { id: { _eq: requestId } } as JsonObject,
        limit: 1,
        fields: [
            "id",
            "email",
            "username",
            "display_name",
            "avatar_file",
            "registration_password",
            "registration_reason",
            "request_status",
            "reviewed_by",
            "reviewed_at",
            "reject_reason",
            "approved_user_id",
            "status",
            "sort",
            "user_created",
            "date_created",
            "user_updated",
            "date_updated",
        ],
    });
    return rows[0] || null;
}

function ensurePendingRegistrationStatus(
    status: RegistrationRequestStatus,
): void {
    if (status !== "pending") {
        throw conflict(
            "REGISTRATION_STATUS_CONFLICT",
            "申请状态冲突，请刷新后重试",
        );
    }
}

export async function handleAdminRegistrationRequests(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    if (segments.length === 1 && context.request.method === "GET") {
        const { page, limit, offset } = parsePagination(context.url);
        const statusRaw = String(
            context.url.searchParams.get("status") || "",
        ).trim();

        let statusFilter: RegistrationRequestStatus | null = null;
        if (statusRaw && statusRaw !== "all") {
            const normalized = normalizeRegistrationRequestStatus(
                statusRaw,
                "pending",
            );
            if (normalized !== statusRaw) {
                throw badRequest(
                    "REGISTRATION_STATUS_INVALID",
                    "申请状态参数无效",
                );
            }
            statusFilter = normalized;
        }

        const filter = statusFilter
            ? ({ request_status: { _eq: statusFilter } } as JsonObject)
            : undefined;
        const [items, total] = await Promise.all([
            readMany("app_user_registration_requests", {
                filter,
                sort: ["-date_created"],
                limit,
                offset,
                fields: [
                    "id",
                    "email",
                    "username",
                    "display_name",
                    "avatar_file",
                    "registration_reason",
                    "request_status",
                    "reviewed_by",
                    "reviewed_at",
                    "reject_reason",
                    "approved_user_id",
                    "status",
                    "sort",
                    "user_created",
                    "date_created",
                    "user_updated",
                    "date_updated",
                ],
            }),
            countItems("app_user_registration_requests", filter),
        ]);

        return ok({
            items,
            page,
            limit,
            total,
        });
    }

    if (segments.length === 2 && context.request.method === "PATCH") {
        const requestId = parseRouteId(segments[1]);
        if (!requestId) {
            return fail("缺少申请 ID", 400);
        }
        const body = await parseJsonBody(context.request);
        const action = parseBodyTextField(body, "action");
        const target = await readRegistrationRequestById(requestId);
        if (!target) {
            throw notFound("REGISTRATION_NOT_FOUND", "申请不存在");
        }
        ensurePendingRegistrationStatus(
            normalizeRegistrationRequestStatus(
                target.request_status,
                "pending",
            ),
        );

        const reviewedBy = required.access.user.id;
        const reviewedAt = new Date().toISOString();

        if (action === "approve") {
            const password = String(target.registration_password || "");
            if (!password) {
                throw badRequest(
                    "REGISTRATION_PASSWORD_MISSING",
                    "申请缺少密码，请让用户重新提交申请",
                );
            }

            const created = await createManagedUser({
                email: parseNormalizedEmail(target.email),
                password,
                requestedUsername: normalizeRequestedUsername(target.username),
                displayName: validateDisplayName(target.display_name),
                avatarFile: target.avatar_file,
                appRole: "member",
            });
            const registrationAvatarFileId = normalizeDirectusFileId(
                target.avatar_file,
            );
            if (registrationAvatarFileId) {
                await updateDirectusFileMetadata(registrationAvatarFileId, {
                    uploaded_by: created.user.id,
                });
            }

            const updated = await updateOne(
                "app_user_registration_requests",
                target.id,
                {
                    request_status: "approved",
                    reviewed_by: reviewedBy,
                    reviewed_at: reviewedAt,
                    approved_user_id: created.user.id,
                    registration_password: null,
                    reject_reason: null,
                },
            );
            return ok({
                item: updated,
                user: created.user,
                profile: created.profile,
                permissions: created.permissions,
            });
        }

        if (action === "reject" || action === "cancel") {
            const reason =
                action === "reject"
                    ? parseOptionalRegistrationReason(body.reason)
                    : null;
            const updated = await updateOne(
                "app_user_registration_requests",
                target.id,
                {
                    request_status:
                        action === "reject" ? "rejected" : "cancelled",
                    reviewed_by: reviewedBy,
                    reviewed_at: reviewedAt,
                    registration_password: null,
                    reject_reason: action === "reject" ? reason : null,
                },
            );
            return ok({ item: updated });
        }

        throw badRequest("REGISTRATION_ACTION_INVALID", "不支持的申请操作");
    }

    return fail("未找到接口", 404);
}
