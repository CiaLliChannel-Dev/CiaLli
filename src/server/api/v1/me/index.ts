import type { APIContext } from "astro";

import { fail } from "@/server/api/response";

import { requireAccess } from "../shared";
import { handleMeProfile } from "./profile";
import { handleMePrivacy, handleMePermissions } from "./privacy";
import { handleMeBlocks } from "./blocks";
import {
    handleMeArticleCommentLikes,
    handleMeArticleLikes,
    handleMeDiaryCommentLikes,
    handleMeDiaryLikes,
} from "./likes";
import { handleMeArticles } from "./articles";
import { handleMeDiaries, handleMeDiaryImages } from "./diaries";
import { handleMeAlbums, handleMeAlbumPhotos } from "./albums";

export async function handleMe(
    context: APIContext,
    segments: string[],
): Promise<Response> {
    const required = await requireAccess(context);
    if ("response" in required) {
        return required.response;
    }
    const access = required.access;

    if (segments.length >= 1 && segments[0] === "profile") {
        return await handleMeProfile(context, access);
    }
    if (segments.length >= 1 && segments[0] === "privacy") {
        return await handleMePrivacy(context, access);
    }
    if (segments.length >= 1 && segments[0] === "permissions") {
        return await handleMePermissions(context, access);
    }
    if (segments.length >= 1 && segments[0] === "blocks") {
        return await handleMeBlocks(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "article-likes") {
        return await handleMeArticleLikes(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "diary-likes") {
        return await handleMeDiaryLikes(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "article-comment-likes") {
        return await handleMeArticleCommentLikes(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "diary-comment-likes") {
        return await handleMeDiaryCommentLikes(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "articles") {
        return await handleMeArticles(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "diaries") {
        if (segments.length >= 3 && segments[2] === "images") {
            return await handleMeDiaryImages(context, access, segments);
        }
        if (segments.length >= 3 && segments[1] === "images") {
            return await handleMeDiaryImages(context, access, segments);
        }
        return await handleMeDiaries(context, access, segments);
    }
    if (segments.length >= 1 && segments[0] === "albums") {
        if (segments.length >= 3 && segments[2] === "photos") {
            return await handleMeAlbumPhotos(context, access, segments);
        }
        if (segments.length >= 3 && segments[1] === "photos") {
            return await handleMeAlbumPhotos(context, access, segments);
        }
        return await handleMeAlbums(context, access, segments);
    }

    return fail("未找到接口", 404);
}
