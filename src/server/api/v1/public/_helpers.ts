import type { AppProfile } from "@/types/app";
import { loadProfileByUsernameFromRepository } from "@/server/repositories/profile/profile.repository";

export function toAuthorFallback(userId: string): {
    id: string;
    name: string;
    username?: string;
} {
    const normalized = String(userId || "").trim();
    const shortId = (normalized || "user").slice(0, 8);
    return {
        id: normalized,
        name: `user-${shortId}`,
        username: `user-${shortId}`,
    };
}

export function readAuthor(
    authorMap: Map<
        string,
        { id: string; name: string; username?: string; avatar_url?: string }
    >,
    userId: string,
): { id: string; name: string; username?: string; avatar_url?: string } {
    return authorMap.get(userId) || toAuthorFallback(userId);
}

export function normalizeAuthorHandle(value: string): string {
    return value.trim().replace(/^@+/, "").toLowerCase();
}

export async function loadProfileByUsername(
    username: string,
): Promise<AppProfile | null> {
    return await loadProfileByUsernameFromRepository(username);
}
