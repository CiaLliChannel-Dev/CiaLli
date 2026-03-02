import { defaultSiteSettings, systemSiteConfig } from "@/config";
import { cacheManager } from "@/server/cache/manager";
import { readMany } from "@/server/directus/client";
import type {
    EditableSiteSettings,
    PublicSiteSettings,
    ResolvedSiteSettings,
    SiteSettingsPayload,
} from "@/types/site-settings";
import {
    isRecord,
    isSiteLanguageOption,
    normalizeAnnouncement,
    normalizeAnalytics,
    normalizeBannerBasic,
    normalizeBannerHomeText,
    normalizeBannerImageApi,
    normalizeBannerNavbar,
    normalizeLicense,
    normalizeMusicPlayer,
    normalizeNavBarLinks,
    normalizeNavbarTitle,
    normalizeProfile,
    normalizeSiteFavicon,
    normalizeSiteInfo,
    normalizeToc,
    normalizeUmami,
    readRawBannerSrc,
} from "./normalize-helpers";

type SiteSettingsCacheValue = {
    resolved: ResolvedSiteSettings;
    updatedAt: string | null;
};

function cloneSettings(settings: SiteSettingsPayload): SiteSettingsPayload {
    return structuredClone(settings);
}

function mergeWithDefaults<T>(defaults: T, patch: unknown): T {
    if (Array.isArray(defaults)) {
        return (Array.isArray(patch) ? patch : defaults) as T;
    }
    if (isRecord(defaults)) {
        if (!isRecord(patch)) {
            return defaults;
        }
        const defaultsRecord = defaults as Record<string, unknown>;
        const result: Record<string, unknown> = {};
        const keys = new Set<string>([
            ...Object.keys(defaultsRecord),
            ...Object.keys(patch),
        ]);
        for (const key of keys) {
            if (Object.prototype.hasOwnProperty.call(defaultsRecord, key)) {
                result[key] = mergeWithDefaults(
                    defaultsRecord[key],
                    patch[key],
                );
                continue;
            }
            result[key] = structuredClone(patch[key]);
        }
        return result as T;
    }
    switch (typeof defaults) {
        case "string":
            return (typeof patch === "string" ? patch : defaults) as T;
        case "number":
            return (typeof patch === "number" ? patch : defaults) as T;
        case "boolean":
            return (typeof patch === "boolean" ? patch : defaults) as T;
        default:
            return defaults;
    }
}

function normalizeSettings(
    raw: unknown,
    base: SiteSettingsPayload,
): SiteSettingsPayload {
    const merged = mergeWithDefaults(cloneSettings(base), raw);
    const rawBannerSrc = readRawBannerSrc(raw);

    normalizeSiteInfo(merged, base);
    normalizeSiteFavicon(merged);
    merged.auth.register_enabled = Boolean(
        merged.auth.register_enabled ?? base.auth.register_enabled,
    );
    normalizeNavbarTitle(merged, base);
    merged.wallpaperMode.defaultMode =
        merged.wallpaperMode.defaultMode === "none" ? "none" : "banner";
    normalizeBannerBasic(merged, base, rawBannerSrc);
    normalizeBannerImageApi(merged, base);
    normalizeBannerHomeText(merged, base);
    normalizeBannerNavbar(merged, base);
    normalizeToc(merged);
    normalizeNavBarLinks(merged);
    normalizeProfile(merged, base);
    normalizeLicense(merged, base);
    normalizeAnnouncement(merged);
    normalizeMusicPlayer(merged);
    merged.sakura.enable = Boolean(merged.sakura.enable);
    normalizeUmami(merged);
    normalizeAnalytics(merged, base);

    return merged;
}

function buildSystemSiteConfig(
    settings: SiteSettingsPayload,
): ResolvedSiteSettings["system"] {
    return {
        ...systemSiteConfig,
        lang: isSiteLanguageOption(settings.site.lang)
            ? settings.site.lang
            : systemSiteConfig.lang,
    };
}

function buildDefaultResolvedSettings(): ResolvedSiteSettings {
    const settings = cloneSettings(defaultSiteSettings);
    return {
        system: buildSystemSiteConfig(settings),
        settings,
    };
}

async function readSiteSettingsRow(): Promise<{
    settings: unknown;
    updatedAt: string | null;
} | null> {
    const rows = await readMany("app_site_settings", {
        filter: {
            _and: [
                { key: { _eq: "default" } },
                { status: { _eq: "published" } },
            ],
        },
        limit: 1,
        sort: ["-date_updated", "-date_created"],
        fields: ["id", "settings", "date_updated", "date_created"],
    });
    const row = rows[0];
    if (!row) {
        return null;
    }
    return {
        settings: row.settings,
        updatedAt: row.date_updated || row.date_created || null,
    };
}

export function resolveSiteSettingsPayload(
    raw: unknown,
    base: SiteSettingsPayload = defaultSiteSettings,
): SiteSettingsPayload {
    return normalizeSettings(raw, base);
}

/**
 * 执行一次站点设置拉取，失败时立即重试 1 次。
 *
 * Directus 客户端全局超时 30s/次，Vercel Serverless 执行窗口约 60s，重试上限为 1 次，避免函数执行溢出。
 */
async function fetchSiteSettingsWithRetry(): Promise<{
    settings: unknown;
    updatedAt: string | null;
} | null> {
    try {
        return await readSiteSettingsRow();
    } catch (firstError) {
        console.warn(
            "[site-settings] 首次拉取失败，立即重试一次:",
            firstError instanceof Error
                ? firstError.message
                : String(firstError),
        );
        return await readSiteSettingsRow();
    }
}

export async function getResolvedSiteSettings(): Promise<ResolvedSiteSettings> {
    const cached = await cacheManager.get<SiteSettingsCacheValue>(
        "site-settings",
        "default",
    );
    if (cached) {
        return cached.resolved;
    }

    const defaultResolved = buildDefaultResolvedSettings();
    try {
        const row = await fetchSiteSettingsWithRetry();
        if (!row) {
            const value: SiteSettingsCacheValue = {
                resolved: defaultResolved,
                updatedAt: null,
            };
            void cacheManager.set("site-settings", "default", value);
            return defaultResolved;
        }

        const settings = normalizeSettings(row.settings, defaultSiteSettings);
        const resolved: ResolvedSiteSettings = {
            system: buildSystemSiteConfig(settings),
            settings,
        };
        const value: SiteSettingsCacheValue = {
            resolved,
            updatedAt: row.updatedAt,
        };
        void cacheManager.set("site-settings", "default", value);
        return resolved;
    } catch (error) {
        // 错误路径（含重试后仍失败）：不缓存，让下次请求重新尝试 Directus
        console.error("[site-settings] 拉取设置失败（含重试）:", error);
        return defaultResolved;
    }
}

export async function getPublicSiteSettings(): Promise<{
    settings: PublicSiteSettings;
    updatedAt: string | null;
}> {
    const resolved = await getResolvedSiteSettings();
    const cached = await cacheManager.get<SiteSettingsCacheValue>(
        "site-settings",
        "default",
    );
    return {
        settings: resolved.settings,
        updatedAt: cached?.updatedAt || null,
    };
}

export function invalidateSiteSettingsCache(): void {
    void cacheManager.invalidate("site-settings", "default");
}

export async function mergeSiteSettingsPatch(
    patch: Partial<EditableSiteSettings>,
): Promise<SiteSettingsPayload> {
    const current = await getResolvedSiteSettings();
    return normalizeSettings(patch, current.settings);
}
