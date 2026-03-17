/**
 * 统一前端展示头像来源：优先使用用户头像，缺失时回退到站点默认头像。
 */
export function resolveDisplayAvatarUrl(
    primaryAvatarUrl: string | null | undefined,
    fallbackAvatarUrl: string | null | undefined,
): string {
    const primary = String(primaryAvatarUrl || "").trim();
    if (primary) {
        return primary;
    }

    return String(fallbackAvatarUrl || "").trim();
}
