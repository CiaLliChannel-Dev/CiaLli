import type { APIContext } from "astro";

import type { JsonObject } from "@/types/json";
import { updateProfileUsername } from "@/server/auth/acl";
import { validateDisplayName } from "@/server/auth/username";
import { encryptBangumiAccessToken } from "@/server/bangumi/token";
import { normalizeBangumiId } from "@/server/bangumi/username";
import { updateDirectusUser, updateOne } from "@/server/directus/client";
import { fail, ok } from "@/server/api/response";
import { parseJsonBody } from "@/server/api/utils";
import { validateBody } from "@/server/api/validate";
import { UpdateProfileSchema } from "@/server/api/schemas";

import type { AppAccess } from "../shared";
import { hasOwn, parseProfileBioField } from "../shared";
import { invalidateAuthorCache } from "../shared/author-cache";
import { invalidateOfficialSidebarCache } from "../public-data";
import { cleanupOrphanDirectusFiles } from "../shared/file-cleanup";
import { bindFileOwnerToUser } from "./_helpers";

function toProfileResponse(profile: AppAccess["profile"]): JsonObject {
    const { bangumi_access_token_encrypted, ...safeProfile } = profile;
    return {
        ...safeProfile,
        bangumi_access_token_set: Boolean(bangumi_access_token_encrypted),
    };
}

export async function handleMeProfile(
    context: APIContext,
    access: AppAccess,
): Promise<Response> {
    if (context.request.method === "GET") {
        return ok({
            profile: toProfileResponse(access.profile),
        });
    }

    if (context.request.method === "PATCH") {
        const body = await parseJsonBody(context.request);
        const input = validateBody(UpdateProfileSchema, body);
        const payload: JsonObject = {};
        const hasAvatarFilePatch = hasOwn(body, "avatar_file");
        const hasAvatarUrlPatch = hasOwn(body, "avatar_url");
        const hasHeaderFilePatch = hasOwn(body, "header_file");
        const prevAvatarFile = access.profile.avatar_file;
        const prevHeaderFile = access.profile.header_file;
        let nextAvatarFile = prevAvatarFile;
        let nextAvatarUrl = access.profile.avatar_url;
        let nextHeaderFile = prevHeaderFile;
        if (input.bio !== undefined) {
            // bio 经 Zod 校验后，还需检查 weightedCharLength 限制
            payload.bio = parseProfileBioField(input.bio);
        }
        if (input.bio_typewriter_enable !== undefined) {
            payload.bio_typewriter_enable = input.bio_typewriter_enable;
        }
        if (input.bio_typewriter_speed !== undefined) {
            payload.bio_typewriter_speed = input.bio_typewriter_speed;
        }
        if (hasAvatarFilePatch) {
            nextAvatarFile = input.avatar_file ?? null;
            payload.avatar_file = nextAvatarFile;
        }
        if (hasAvatarUrlPatch) {
            nextAvatarUrl = input.avatar_url ?? null;
            payload.avatar_url = nextAvatarUrl;
        }
        if (hasHeaderFilePatch) {
            nextHeaderFile = input.header_file ?? null;
            payload.header_file = nextHeaderFile;
        }
        if (input.profile_public !== undefined) {
            payload.profile_public = input.profile_public;
        }
        if (input.show_bangumi_on_profile !== undefined) {
            payload.show_bangumi_on_profile = input.show_bangumi_on_profile;
        }
        if (input.bangumi_username !== undefined) {
            const normalizedBangumiId = normalizeBangumiId(
                input.bangumi_username,
            );
            payload.bangumi_username = normalizedBangumiId || null;
        }
        if (input.bangumi_include_private !== undefined) {
            payload.bangumi_include_private = input.bangumi_include_private;
        }
        if (hasOwn(body, "bangumi_access_token")) {
            const token = String(input.bangumi_access_token || "").trim();
            payload.bangumi_access_token_encrypted = token
                ? encryptBangumiAccessToken(token)
                : null;
        }

        if (hasOwn(body, "home_section_order")) {
            const VALID_SECTIONS = new Set([
                "articles",
                "diaries",
                "bangumi",
                "albums",
            ]);
            const order = input.home_section_order;
            if (order !== null && order !== undefined) {
                const deduped = [
                    ...new Set(order.filter((s) => VALID_SECTIONS.has(s))),
                ];
                for (const s of VALID_SECTIONS) {
                    if (!deduped.includes(s)) {
                        deduped.push(s);
                    }
                }
                payload.home_section_order = deduped;
            } else {
                payload.home_section_order = null;
            }
        }

        if (input.username !== undefined) {
            const normalized = await updateProfileUsername(
                access.profile.id,
                input.username,
            );
            payload.username = normalized;
        }
        if (input.display_name !== undefined) {
            payload.display_name = validateDisplayName(input.display_name);
        }
        if (input.social_links !== undefined) {
            payload.social_links = input.social_links;
        }

        const updated = await updateOne(
            "app_user_profiles",
            access.profile.id,
            payload,
        );
        if (hasAvatarFilePatch && nextAvatarFile) {
            await bindFileOwnerToUser(nextAvatarFile, access.user.id);
        }
        if (hasHeaderFilePatch && nextHeaderFile) {
            await bindFileOwnerToUser(nextHeaderFile, access.user.id);
        }
        // 头像文件发生变更时，删除旧文件避免孤立资源
        if (
            hasAvatarFilePatch &&
            prevAvatarFile &&
            prevAvatarFile !== nextAvatarFile
        ) {
            await cleanupOrphanDirectusFiles([prevAvatarFile]);
        }
        // 头图文件发生变更时，删除旧文件避免孤立资源
        if (
            hasHeaderFilePatch &&
            prevHeaderFile &&
            prevHeaderFile !== nextHeaderFile
        ) {
            await cleanupOrphanDirectusFiles([prevHeaderFile]);
        }
        if (
            (hasAvatarFilePatch || hasAvatarUrlPatch) &&
            !nextAvatarFile &&
            !nextAvatarUrl
        ) {
            await updateDirectusUser(access.user.id, { avatar: null });
        }
        invalidateAuthorCache(access.user.id);
        invalidateOfficialSidebarCache();
        return ok({
            profile: toProfileResponse(updated),
        });
    }

    return fail("方法不允许", 405);
}
