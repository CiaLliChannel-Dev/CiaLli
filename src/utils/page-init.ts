type PageInitOptions = {
    key: string;
    init: () => void;
    cleanup?: () => void;
    delay?: number;
    runOnPageShow?: boolean;
};

type PageInitWindow = Window & {
    __pageInitRegistry?: Set<string>;
    __pageInitLastRunByKey?: Map<string, string>;
};

const getRegistry = (): Set<string> => {
    const pageWindow = window as PageInitWindow;
    if (!pageWindow.__pageInitRegistry) {
        pageWindow.__pageInitRegistry = new Set<string>();
    }
    return pageWindow.__pageInitRegistry;
};

const getLastRunByKey = (): Map<string, string> => {
    const pageWindow = window as PageInitWindow;
    if (!pageWindow.__pageInitLastRunByKey) {
        pageWindow.__pageInitLastRunByKey = new Map<string, string>();
    }
    return pageWindow.__pageInitLastRunByKey;
};

const resolveNavigationSignature = (): string => {
    const historyState = history.state as {
        index?: unknown;
    } | null;
    const historyIndex =
        typeof historyState?.index === "number" ? historyState.index : "na";
    return `${window.location.pathname}${window.location.search}${window.location.hash}|${historyIndex}`;
};

export const setupPageInit = ({
    key,
    init,
    cleanup,
    delay = 0,
    runOnPageShow = false,
}: PageInitOptions): void => {
    // 仅在浏览器环境运行
    if (typeof window === "undefined" || typeof document === "undefined") {
        return;
    }

    // 同一页面 key 只注册一次，避免重复绑定事件
    const registry = getRegistry();
    if (registry.has(key)) {
        return;
    }
    registry.add(key);
    const lastRunByKey = getLastRunByKey();

    let timeoutId: number | null = null;
    const scheduleInit = (force = false) => {
        // 合并多事件触发，保证同一时段只执行一次
        if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
        }
        timeoutId = window.setTimeout(() => {
            timeoutId = null;
            const navigationSignature = resolveNavigationSignature();
            if (!force && lastRunByKey.get(key) === navigationSignature) {
                return;
            }
            lastRunByKey.set(key, navigationSignature);
            cleanup?.();
            init();
        }, delay);
    };

    const onReady = () => {
        scheduleInit();
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", onReady, { once: true });
    } else {
        onReady();
    }

    // Astro 导航事件
    document.addEventListener("astro:page-load", onReady);
    document.addEventListener("astro:after-swap", onReady);

    if (runOnPageShow) {
        // 处理 bfcache 恢复场景
        window.addEventListener("pageshow", (event) => {
            if ("persisted" in event && event.persisted) {
                scheduleInit(true);
            }
        });
    }
};
