import type { SiteConfig } from "./types/config";
import type { Translation } from "./i18n/translation";
import type { ResolvedSiteSettings } from "./types/site-settings";
import type { ProgressOverlayApi } from "./scripts/progress-overlay-manager";

export {};

type SwupVisit = { to: { url: string } };

type UmamiWebsiteStats = {
    pageviews?: number;
    visits?: number;
    visitors?: number;
    bounces?: number;
    totaltime?: number;
};

interface SwupHooks {
    on(
        event: "visit:start" | "visit:end",
        callback: (visit: SwupVisit) => void,
    ): void;
    on(event: string, callback: () => void): void;
    off(event: string, callback?: () => void): void;
}

interface SwupInstance {
    hooks: SwupHooks;
    navigate: (url: string, options?: { history?: boolean }) => void;
    preload?: (url: string) => void;
}

declare global {
    interface HTMLElementTagNameMap {
        "iconify-icon": HTMLElement;
        spoiler: HTMLElement;
        "table-of-contents": HTMLElement & {
            init?: () => void;
            regenerateTOC?: (retryCount?: number) => void;
        };
    }

    interface Window {
        // Define swup type directly since @swup/astro doesn't export AstroIntegration
        swup?: SwupInstance;
        closeAnnouncement: () => void;

        __bannerCarouselController?: {
            setPaused: (paused: boolean) => void;
        };
        __updateBannerCarouselState?: () => void;
        sakuraInitialized?: boolean;
        _calendarFilterListenerAttached?: boolean;

        panelManager?: typeof import("./utils/panel-manager").panelManager;

        getUmamiWebsiteStats?: (
            baseUrl: string,
            apiKey: string,
            websiteId: string,
        ) => Promise<UmamiWebsiteStats>;
        getUmamiPageStats?: (
            baseUrl: string,
            apiKey: string,
            websiteId: string,
            urlPath: string,
            startAt?: number,
            endAt?: number,
        ) => Promise<{ pageviews?: number; visitors?: number }>;
        clearUmamiShareCache?: () => void;

        floatingTOCInit?: () => void;
        iconifyLoaded?: boolean;
        __iconifyLoader?: {
            load: () => Promise<void>;
            addToPreloadQueue: (icons: string[]) => void;
            onLoad: (callback: () => void) => void;
            isLoaded: boolean;
        };
        __CIALLI_RUNTIME_SETTINGS__?: ResolvedSiteSettings;
        __CIALLI_I18N__?: Partial<Record<keyof Translation, string>>;
        __CIALLI_PROGRESS_OVERLAY__?: ProgressOverlayApi;
        siteConfig?: SiteConfig;
    }
}
