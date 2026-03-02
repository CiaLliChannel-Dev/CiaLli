type EnterSkeletonMode =
    | "post-card"
    | "post-detail"
    | "publish-page"
    | "user-home"
    | "user-bangumi"
    | "user-albums"
    | "user-diary"
    | "admin-dashboard"
    | "admin-users"
    | "admin-site-settings"
    | "admin-bulletin-settings"
    | "admin-about-settings"
    | "me-settings"
    | "about-page"
    | "friends-page"
    | "stats-page"
    | "bulletin-page"
    | "auth-login"
    | "auth-register"
    | "rss-page"
    | "atom-page"
    | "fallback";

const ACTIVE_CLASS = "enter-skeleton-active";
const MODE_ATTR = "data-enter-skeleton-mode";
const MIN_VISIBLE_MS = 120;

let activatedAt = 0;
let deactivationTimer: number | null = null;
let activationToken = 0;

function getRoot(): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }
    return document.documentElement;
}

function clearDeactivationTimer(): void {
    if (deactivationTimer !== null) {
        window.clearTimeout(deactivationTimer);
        deactivationTimer = null;
    }
}

type SkeletonDetectRule = {
    selector: string;
    mode: EnterSkeletonMode;
};

const SKELETON_TARGET_RULES: SkeletonDetectRule[] = [
    {
        selector: '[data-enter-skeleton-page="publish-page"]',
        mode: "publish-page",
    },
    {
        selector: '[data-enter-skeleton-target="post-detail"]',
        mode: "post-detail",
    },
    {
        selector: '[data-enter-skeleton-target="post-card"]',
        mode: "post-card",
    },
];

const SKELETON_PAGE_RULES: SkeletonDetectRule[] = [
    { selector: '[data-enter-skeleton-page="user-home"]', mode: "user-home" },
    {
        selector: '[data-enter-skeleton-page="user-bangumi"]',
        mode: "user-bangumi",
    },
    {
        selector: '[data-enter-skeleton-page="user-albums"]',
        mode: "user-albums",
    },
    {
        selector: '[data-enter-skeleton-page="user-diary"]',
        mode: "user-diary",
    },
    {
        selector: '[data-enter-skeleton-page="admin-dashboard"]',
        mode: "admin-dashboard",
    },
    {
        selector: '[data-enter-skeleton-page="admin-users"]',
        mode: "admin-users",
    },
    {
        selector: '[data-enter-skeleton-page="admin-site-settings"]',
        mode: "admin-site-settings",
    },
    {
        selector: '[data-enter-skeleton-page="admin-bulletin-settings"]',
        mode: "admin-bulletin-settings",
    },
    {
        selector: '[data-enter-skeleton-page="admin-about-settings"]',
        mode: "admin-about-settings",
    },
    {
        selector: '[data-enter-skeleton-page="me-settings"]',
        mode: "me-settings",
    },
    {
        selector: '[data-enter-skeleton-page="about-page"]',
        mode: "about-page",
    },
    {
        selector: '[data-enter-skeleton-page="friends-page"]',
        mode: "friends-page",
    },
    {
        selector: '[data-enter-skeleton-page="stats-page"]',
        mode: "stats-page",
    },
    {
        selector: '[data-enter-skeleton-page="bulletin-page"]',
        mode: "bulletin-page",
    },
    {
        selector: '[data-enter-skeleton-page="auth-login"]',
        mode: "auth-login",
    },
    {
        selector: '[data-enter-skeleton-page="auth-register"]',
        mode: "auth-register",
    },
    { selector: '[data-enter-skeleton-page="rss-page"]', mode: "rss-page" },
    { selector: '[data-enter-skeleton-page="atom-page"]', mode: "atom-page" },
];

function matchSkeletonRule(
    rules: SkeletonDetectRule[],
): EnterSkeletonMode | null {
    for (const rule of rules) {
        if (document.querySelector(rule.selector)) {
            return rule.mode;
        }
    }
    return null;
}

function detectEnterSkeletonMode(): EnterSkeletonMode {
    return (
        matchSkeletonRule(SKELETON_TARGET_RULES) ??
        matchSkeletonRule(SKELETON_PAGE_RULES) ??
        "fallback"
    );
}

function applyMode(mode: EnterSkeletonMode): void {
    const root = getRoot();
    if (!root) {
        return;
    }

    root.classList.add(ACTIVE_CLASS);
    root.setAttribute(MODE_ATTR, mode);
}

function clearMode(): void {
    const root = getRoot();
    if (!root) {
        return;
    }

    root.classList.remove(ACTIVE_CLASS);
    root.removeAttribute(MODE_ATTR);
}

export function activateEnterSkeleton(): void {
    if (typeof window === "undefined") {
        return;
    }

    activationToken += 1;
    clearDeactivationTimer();

    const mode = detectEnterSkeletonMode();
    activatedAt = performance.now();
    applyMode(mode);
}

export function deactivateEnterSkeleton(): void {
    const root = getRoot();
    if (!root || typeof window === "undefined") {
        return;
    }
    if (!root.classList.contains(ACTIVE_CLASS)) {
        return;
    }

    const elapsed = performance.now() - activatedAt;
    const remainingMs = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const currentToken = activationToken;
    const finish = (): void => {
        if (currentToken !== activationToken) {
            return;
        }
        clearDeactivationTimer();
        clearMode();
        activatedAt = 0;
    };

    if (remainingMs <= 0) {
        finish();
        return;
    }

    clearDeactivationTimer();
    deactivationTimer = window.setTimeout(finish, Math.ceil(remainingMs));
}

export function forceResetEnterSkeleton(): void {
    activationToken += 1;
    clearDeactivationTimer();
    activatedAt = 0;
    clearMode();
}
