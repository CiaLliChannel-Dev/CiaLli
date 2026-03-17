import type {
    AppRole,
    AppStatus,
    CommentStatus,
    ContentReportReason,
    ContentReportTargetType,
    RegistrationRequestStatus,
} from "@/types/app";

export function normalizeStatus(
    input: string,
    fallback: AppStatus = "draft",
): AppStatus {
    if (input === "published" || input === "draft" || input === "archived") {
        return input;
    }
    return fallback;
}

export function normalizeAppRole(input: string): AppRole {
    return input === "admin" ? "admin" : "member";
}

export function normalizeWatchStatus(
    input: string,
): "watching" | "completed" | "planned" | "onhold" | "dropped" {
    if (
        input === "watching" ||
        input === "completed" ||
        input === "planned" ||
        input === "onhold" ||
        input === "dropped"
    ) {
        return input;
    }
    return "planned";
}

export function normalizeAlbumLayout(input: string): "grid" | "masonry" {
    return input === "masonry" ? "masonry" : "grid";
}

export function normalizeCommentStatus(
    input: string,
    fallback: CommentStatus = "published",
): CommentStatus {
    if (input === "published" || input === "hidden" || input === "archived") {
        return input;
    }
    return fallback;
}

export function normalizeReportTargetType(
    input: string,
): ContentReportTargetType | null {
    if (
        input === "article" ||
        input === "diary" ||
        input === "article_comment" ||
        input === "diary_comment"
    ) {
        return input;
    }
    return null;
}

export function normalizeReportReason(input: string): ContentReportReason {
    if (
        input === "spam" ||
        input === "abuse" ||
        input === "hate" ||
        input === "violence" ||
        input === "copyright" ||
        input === "other"
    ) {
        return input;
    }
    return "other";
}

export function normalizeRegistrationRequestStatus(
    input: string,
    fallback: RegistrationRequestStatus = "pending",
): RegistrationRequestStatus {
    if (
        input === "pending" ||
        input === "approved" ||
        input === "rejected" ||
        input === "cancelled"
    ) {
        return input;
    }
    return fallback;
}
