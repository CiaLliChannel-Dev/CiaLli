import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

import { handlePublicSiteSettings } from "./site-settings";
import { handlePublicAsset } from "./assets";
import { handlePublicArticles } from "./articles";
import { handlePublicDiaries } from "./diaries";
import { handlePublicFriends } from "./friends";
import { handlePublicAlbums } from "./albums";
import {
    handlePublicRegistrationRequests,
    handlePublicRegistrationCheck,
    handlePublicRegistrationSession,
} from "./registration";
import { handleUserHome } from "./user-home";

export async function handlePublic(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    if (segments[1] === "assets") {
        return await handlePublicAsset(context, segments);
    }
    if (segments[1] === "site-settings") {
        return await handlePublicSiteSettings(context, segments);
    }
    if (segments[1] === "registration-requests") {
        return await handlePublicRegistrationRequests(context, segments);
    }
    if (segments[1] === "registration-check") {
        return await handlePublicRegistrationCheck(context, segments);
    }
    if (segments[1] === "registration-session") {
        return await handlePublicRegistrationSession(context, segments);
    }
    if (segments[1] === "friends") {
        return await handlePublicFriends(context, segments);
    }
    if (segments[1] === "articles") {
        return await handlePublicArticles(context, segments);
    }
    if (segments[1] === "diaries") {
        return await handlePublicDiaries(context, segments);
    }
    if (segments[1] === "albums") {
        return await handlePublicAlbums(context, segments);
    }
    return fail("未找到接口", 404);
}

export { handleUserHome };
