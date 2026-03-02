import type { APIContext } from "astro";

import type { AppPermissions, AppProfile } from "@/types/app";
import type { JsonObject } from "@/types/json";
import { createUniqueUsername } from "@/server/auth/acl";
import {
    normalizeRequestedUsername,
    validateDisplayName,
} from "@/server/auth/username";
import {
    createOne,
    deleteDirectusUser,
    deleteOne,
    listDirectusUsers,
    readMany,
    updateDirectusFileMetadata,
    updateDirectusUser,
    updateOne,
} from "@/server/directus/client";
import { cacheManager } from "@/server/cache/manager";
import { badRequest } from "@/server/api/errors";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody, parsePagination } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import type { AdminUpdateUserInput } from "@/server/api/schemas";
import {
    AdminUpdateUserSchema,
    AdminResetPasswordSchema,
} from "@/server/api/schemas";
import { invalidateOfficialSidebarCache } from "../public-data";
import {
    cleanupOrphanDirectusFiles,
    collectUserOwnedFileIds,
    normalizeDirectusFileId,
} from "../shared/file-cleanup";

import {
    DEFAULT_LIST_LIMIT,
    ensureUsernameAvailable,
    hasOwn,
    parseRouteId,
    requireAdmin,
} from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";
import {
    clearBlockingUserReferences,
    loadReferencedFilesByUser,
    nullifyReferencedFileOwnership,
    nullifyRegistrationRequestAvatars,
} from "./users-helpers";

function extractPermissionPatch(input: AdminUpdateUserInput): JsonObject {
    const payload: JsonObject = {};
    if (input.app_role !== undefined) {
        payload.app_role = input.app_role;
    }
    if (input.can_publish_articles !== undefined) {
        payload.can_publish_articles = input.can_publish_articles;
    }
    if (input.can_comment_articles !== undefined) {
        payload.can_comment_articles = input.can_comment_articles;
    }
    if (input.can_manage_diaries !== undefined) {
        payload.can_manage_diaries = input.can_manage_diaries;
    }
    if (input.can_comment_diaries !== undefined) {
        payload.can_comment_diaries = input.can_comment_diaries;
    }
    if (input.can_manage_anime !== undefined) {
        payload.can_manage_anime = input.can_manage_anime;
    }
    if (input.can_manage_albums !== undefined) {
        payload.can_manage_albums = input.can_manage_albums;
    }
    if (input.can_upload_files !== undefined) {
        payload.can_upload_files = input.can_upload_files;
    }
    return payload;
}

async function ensureUserProfile(
    userId: string,
    fallbackName: string,
): Promise<AppProfile> {
    const rows = await readMany("app_user_profiles", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    if (rows[0]) {
        return rows[0];
    }

    const normalizedUsername = await createUniqueUsername(fallbackName);
    const created = await createOne("app_user_profiles", {
        status: "published",
        user_id: userId,
        username: normalizedUsername,
        display_name: normalizedUsername,
        bio: null,
        bio_typewriter_enable: true,
        bio_typewriter_speed: 80,
        avatar_file: null,
        avatar_url: null,
        profile_public: true,
        show_articles_on_profile: true,
        show_diaries_on_profile: true,
        show_bangumi_on_profile: true,
        show_albums_on_profile: true,
        show_comments_on_profile: true,
    });
    invalidateAuthorCache(userId);
    return created;
}

async function ensureUserPermissions(userId: string): Promise<AppPermissions> {
    const rows = await readMany("app_user_permissions", {
        filter: { user_id: { _eq: userId } } as JsonObject,
        limit: 1,
    });
    if (rows[0]) {
        return rows[0];
    }

    return await createOne("app_user_permissions", {
        user_id: userId,
        app_role: "member",
        can_publish_articles: true,
        can_comment_articles: true,
        can_manage_diaries: true,
        can_comment_diaries: true,
        can_manage_anime: true,
        can_manage_albums: true,
        can_upload_files: true,
    });
}

async function handleUsersList(context: APIContext): Promise<Response> {
    const { page, limit, offset } = parsePagination(context.url);
    const users = await listDirectusUsers({
        limit,
        offset,
        search: context.url.searchParams.get("q") || undefined,
    });
    const userIds = users.map((user) => user.id);
    const filterByIds =
        userIds.length > 0
            ? ({ user_id: { _in: userIds } } as JsonObject)
            : ({ id: { _null: true } } as JsonObject);
    const [profiles, permissions] = await Promise.all([
        readMany("app_user_profiles", {
            filter: filterByIds,
            limit: Math.max(userIds.length, DEFAULT_LIST_LIMIT),
        }),
        readMany("app_user_permissions", {
            filter: filterByIds,
            limit: Math.max(userIds.length, DEFAULT_LIST_LIMIT),
        }),
    ]);

    const profileMap = new Map<string, AppProfile>();
    for (const profile of profiles) {
        profileMap.set(profile.user_id, profile);
    }
    const permissionMap = new Map<string, AppPermissions>();
    for (const permission of permissions) {
        permissionMap.set(permission.user_id, permission);
    }

    return ok({
        items: users.map((user) => ({
            user,
            profile: profileMap.get(user.id) || null,
            permissions: permissionMap.get(user.id) || null,
        })),
        page,
        limit,
        total: users.length,
    });
}

function buildDirectusPayload(input: AdminUpdateUserInput): JsonObject {
    const payload: JsonObject = {};
    if (input.email !== undefined) payload.email = input.email;
    if (input.first_name !== undefined) payload.first_name = input.first_name;
    if (input.last_name !== undefined) payload.last_name = input.last_name;
    if (input.role !== undefined) payload.role = input.role;
    if (input.password !== undefined) payload.password = input.password;
    return payload;
}

function buildProfileVisibilityPayload(
    input: AdminUpdateUserInput,
): JsonObject {
    const payload: JsonObject = {};
    if (input.profile_public !== undefined)
        payload.profile_public = input.profile_public;
    if (input.show_articles_on_profile !== undefined) {
        payload.show_articles_on_profile = input.show_articles_on_profile;
    }
    if (input.show_diaries_on_profile !== undefined) {
        payload.show_diaries_on_profile = input.show_diaries_on_profile;
    }
    if (input.show_bangumi_on_profile !== undefined) {
        payload.show_bangumi_on_profile = input.show_bangumi_on_profile;
    }
    if (input.show_albums_on_profile !== undefined) {
        payload.show_albums_on_profile = input.show_albums_on_profile;
    }
    if (input.show_comments_on_profile !== undefined) {
        payload.show_comments_on_profile = input.show_comments_on_profile;
    }
    return payload;
}

function buildProfilePayload(
    input: AdminUpdateUserInput,
    body: JsonObject,
): JsonObject {
    const payload: JsonObject = {};
    if (input.display_name !== undefined) {
        payload.display_name = validateDisplayName(input.display_name);
    }
    if (input.social_links !== undefined)
        payload.social_links = input.social_links;
    if (input.bio !== undefined) payload.bio = input.bio;
    if (input.bio_typewriter_enable !== undefined) {
        payload.bio_typewriter_enable = input.bio_typewriter_enable;
    }
    if (input.bio_typewriter_speed !== undefined) {
        payload.bio_typewriter_speed = input.bio_typewriter_speed;
    }
    if (hasOwn(body, "avatar_file")) {
        payload.avatar_file = input.avatar_file ?? null;
    }
    if (input.avatar_url !== undefined) payload.avatar_url = input.avatar_url;
    return { ...payload, ...buildProfileVisibilityPayload(input) };
}

async function applyAvatarFileChange(
    body: JsonObject,
    input: AdminUpdateUserInput,
    userId: string,
    prevAvatarFile: string | null,
    nextAvatarFile: string | null,
): Promise<void> {
    if (!hasOwn(body, "avatar_file")) return;
    if (nextAvatarFile) {
        await updateDirectusFileMetadata(nextAvatarFile, {
            uploaded_by: userId,
        });
    }
    if (prevAvatarFile && prevAvatarFile !== nextAvatarFile) {
        await cleanupOrphanDirectusFiles([prevAvatarFile]);
    }
    void input;
}

async function handleUserPatch(
    context: APIContext,
    userId: string,
): Promise<Response> {
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminUpdateUserSchema, body);

    const directusPayload = buildDirectusPayload(input);
    if (Object.keys(directusPayload).length > 0) {
        await updateDirectusUser(userId, directusPayload);
    }

    const profile = await ensureUserProfile(userId, input.username || "Member");
    const permissions = await ensureUserPermissions(userId);
    const prevAvatarFile = normalizeDirectusFileId(profile.avatar_file);
    const nextAvatarFile = hasOwn(body as JsonObject, "avatar_file")
        ? normalizeDirectusFileId(input.avatar_file)
        : prevAvatarFile;

    const profilePayload = buildProfilePayload(input, body as JsonObject);
    if (input.username !== undefined) {
        const normalized = normalizeRequestedUsername(input.username);
        await ensureUsernameAvailable(normalized, profile.id);
        profilePayload.username = normalized;
    }

    const permissionsPayload = extractPermissionPatch(input);
    const [updatedProfile, updatedPermissions] = await Promise.all([
        Object.keys(profilePayload).length > 0
            ? updateOne("app_user_profiles", profile.id, profilePayload)
            : Promise.resolve(profile),
        Object.keys(permissionsPayload).length > 0
            ? updateOne(
                  "app_user_permissions",
                  permissions.id,
                  permissionsPayload,
              )
            : Promise.resolve(permissions),
    ]);

    invalidateAuthorCache(userId);
    void cacheManager.invalidateByDomain("profile-viewer");
    invalidateOfficialSidebarCache();
    await applyAvatarFileChange(
        body as JsonObject,
        input,
        userId,
        prevAvatarFile,
        nextAvatarFile,
    );
    return ok({
        id: userId,
        profile: updatedProfile,
        permissions: updatedPermissions,
    });
}

async function collectCandidateFileIds(userId: string): Promise<string[]> {
    try {
        return await collectUserOwnedFileIds(userId);
    } catch (error) {
        const message = String(error);
        if (/forbidden|permission/i.test(message)) {
            console.warn(
                "[admin/users] skip collectUserOwnedFileIds due to permission:",
                message,
            );
            return [];
        }
        throw error;
    }
}

async function handleUserDelete(
    userId: string,
    adminUserId: string,
): Promise<Response> {
    if (adminUserId === userId) {
        throw badRequest("USER_DELETE_SELF_FORBIDDEN", "不能删除当前登录账号");
    }
    const candidateFileIds = await collectCandidateFileIds(userId);
    const referencedFilesPromise = loadReferencedFilesByUser(userId);

    const [profiles, permissions, registrationRequests, referencedFiles] =
        await Promise.all([
            readMany("app_user_profiles", {
                filter: { user_id: { _eq: userId } } as JsonObject,
                limit: 10,
                fields: ["id"],
            }),
            readMany("app_user_permissions", {
                filter: { user_id: { _eq: userId } } as JsonObject,
                limit: 10,
                fields: ["id"],
            }),
            readMany("app_user_registration_requests", {
                filter: { approved_user_id: { _eq: userId } } as JsonObject,
                limit: 200,
                fields: ["id", "avatar_file"],
            }),
            referencedFilesPromise,
        ]);

    for (const profile of profiles) {
        await deleteOne("app_user_profiles", profile.id);
    }
    for (const permission of permissions) {
        await deleteOne("app_user_permissions", permission.id);
    }
    await nullifyRegistrationRequestAvatars(registrationRequests);
    await nullifyReferencedFileOwnership(referencedFiles, userId);
    await clearBlockingUserReferences(userId);
    await deleteDirectusUser(userId);
    await cleanupOrphanDirectusFiles(candidateFileIds);
    invalidateAuthorCache(userId);
    invalidateOfficialSidebarCache();
    return ok({ id: userId, deleted: true });
}

async function handleResetPassword(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (context.request.method !== "POST") {
        return fail("方法不允许", 405);
    }
    const userId = parseRouteId(segments[1]);
    if (!userId) {
        return fail("缺少用户 ID", 400);
    }
    const body = await parseJsonBody(context.request);
    const input = validateBody(AdminResetPasswordSchema, body);
    await updateDirectusUser(userId, {
        password: input.new_password,
    });
    return ok({ id: userId, reset: true });
}

export async function handleAdminUsers(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAdmin(context);
    if ("response" in required) {
        return required.response;
    }

    if (segments.length === 1) {
        if (context.request.method === "GET") {
            return handleUsersList(context);
        }
        if (context.request.method === "POST") {
            return fail("接口不存在", 404, "LEGACY_ENDPOINT_DISABLED");
        }
    }

    if (segments.length === 2) {
        const userId = parseRouteId(segments[1]);
        if (!userId) {
            return fail("缺少用户 ID", 400);
        }
        if (context.request.method === "PATCH") {
            return handleUserPatch(context, userId);
        }
        if (context.request.method === "DELETE") {
            return handleUserDelete(userId, required.access.user.id);
        }
    }

    if (segments.length === 3 && segments[2] === "reset-password") {
        return handleResetPassword(context, segments);
    }

    return fail("未找到接口", 404);
}
