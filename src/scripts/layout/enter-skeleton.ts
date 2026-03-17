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

function detectEnterSkeletonMode(): EnterSkeletonMode {
    if (document.querySelector('[data-enter-skeleton-page="publish-page"]')) {
        return "publish-page";
    }
    if (document.querySelector('[data-enter-skeleton-target="post-detail"]')) {
        return "post-detail";
    }
    if (document.querySelector('[data-enter-skeleton-target="post-card"]')) {
        return "post-card";
    }
    if (document.querySelector('[data-enter-skeleton-page="user-home"]')) {
        return "user-home";
    }
    if (document.querySelector('[data-enter-skeleton-page="user-bangumi"]')) {
        return "user-bangumi";
    }
    if (document.querySelector('[data-enter-skeleton-page="user-albums"]')) {
        return "user-albums";
    }
    if (document.querySelector('[data-enter-skeleton-page="user-diary"]')) {
        return "user-diary";
    }
    if (
        document.querySelector('[data-enter-skeleton-page="admin-dashboard"]')
    ) {
        return "admin-dashboard";
    }
    if (document.querySelector('[data-enter-skeleton-page="admin-users"]')) {
        return "admin-users";
    }
    if (
        document.querySelector(
            '[data-enter-skeleton-page="admin-site-settings"]',
        )
    ) {
        return "admin-site-settings";
    }
    if (
        document.querySelector(
            '[data-enter-skeleton-page="admin-bulletin-settings"]',
        )
    ) {
        return "admin-bulletin-settings";
    }
    if (
        document.querySelector(
            '[data-enter-skeleton-page="admin-about-settings"]',
        )
    ) {
        return "admin-about-settings";
    }
    if (document.querySelector('[data-enter-skeleton-page="me-settings"]')) {
        return "me-settings";
    }
    if (document.querySelector('[data-enter-skeleton-page="about-page"]')) {
        return "about-page";
    }
    if (document.querySelector('[data-enter-skeleton-page="friends-page"]')) {
        return "friends-page";
    }
    if (document.querySelector('[data-enter-skeleton-page="stats-page"]')) {
        return "stats-page";
    }
    if (document.querySelector('[data-enter-skeleton-page="bulletin-page"]')) {
        return "bulletin-page";
    }
    if (document.querySelector('[data-enter-skeleton-page="auth-login"]')) {
        return "auth-login";
    }
    if (document.querySelector('[data-enter-skeleton-page="auth-register"]')) {
        return "auth-register";
    }
    if (document.querySelector('[data-enter-skeleton-page="rss-page"]')) {
        return "rss-page";
    }
    if (document.querySelector('[data-enter-skeleton-page="atom-page"]')) {
        return "atom-page";
    }
    return "fallback";
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
