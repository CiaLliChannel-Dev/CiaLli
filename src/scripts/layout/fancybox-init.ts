type FancyboxStatic = {
    bind: (selector: string, options?: object) => void;
    unbind: (selector: string) => void;
};

type FancyboxConfig = {
    Thumbs?: object;
    Toolbar?: object;
    animated?: boolean;
    dragToClose?: boolean;
    keyboard?: object;
    fitToView?: boolean;
    preload?: number;
    infinite?: boolean;
    Panzoom?: object;
    caption?: boolean;
    groupAll?: boolean;
    Carousel?: object;
    source?: (el: Element) => string | null;
};

const ALBUM_PREVIEW_GROUP = "album-photo-preview";

export type FancyboxController = {
    initFancybox: () => Promise<void>;
    cleanupFancybox: () => void;
};

export function createFancyboxController(): FancyboxController {
    let fancyboxSelectors: string[] = [];
    let fancyboxInitializing = false;
    let Fancybox: FancyboxStatic | undefined;

    async function initFancybox(): Promise<void> {
        if (fancyboxInitializing || fancyboxSelectors.length > 0) {
            return;
        }

        const markdownImagesSelector =
            ".custom-md img, #post-cover img, .moment-images img";
        const albumPhotoSelector = `.dc-album-gallery [data-fancybox='${ALBUM_PREVIEW_GROUP}']`;
        const genericFancyboxSelector = `[data-fancybox]:not([data-fancybox='${ALBUM_PREVIEW_GROUP}'])`;

        fancyboxInitializing = true;
        try {
            if (!Fancybox) {
                const mod = await import("@fancyapps/ui");
                Fancybox = mod.Fancybox as FancyboxStatic;
                await import("@fancyapps/ui/dist/fancybox/fancybox.css");
            }

            if (fancyboxSelectors.length > 0) {
                return;
            }

            const fancybox = Fancybox;
            if (!fancybox) {
                return;
            }

            const commonConfig: FancyboxConfig = {
                Thumbs: { autoStart: true, showOnStart: "yes" },
                Toolbar: {
                    display: {
                        left: ["infobar"],
                        middle: [
                            "zoomIn",
                            "zoomOut",
                            "toggle1to1",
                            "rotateCCW",
                            "rotateCW",
                            "flipX",
                            "flipY",
                        ],
                        right: ["slideshow", "thumbs", "close"],
                    },
                },
                animated: true,
                dragToClose: true,
                keyboard: {
                    Escape: "close",
                    Delete: "close",
                    Backspace: "close",
                    PageUp: "next",
                    PageDown: "prev",
                    ArrowUp: "next",
                    ArrowDown: "prev",
                    ArrowRight: "next",
                    ArrowLeft: "prev",
                },
                fitToView: true,
                preload: 3,
                infinite: true,
                Panzoom: { maxScale: 3, minScale: 1 },
                caption: false,
            };

            const albumConfig: FancyboxConfig = {
                ...commonConfig,
                Toolbar: {
                    display: {
                        left: ["infobar"],
                        middle: [
                            "zoomOut",
                            "zoomIn",
                            "toggle1to1",
                            "rotateCCW",
                            "rotateCW",
                        ],
                        right: ["close"],
                    },
                },
            };

            // 始终注册选择器代理，避免评论等异步渲染场景漏绑导致回退到浏览器原生预览。
            fancybox.bind(markdownImagesSelector, {
                ...commonConfig,
                groupAll: true,
                Carousel: {
                    transition: "slide",
                    preload: 2,
                },
            });
            fancyboxSelectors.push(markdownImagesSelector);

            fancybox.bind(albumPhotoSelector, albumConfig);
            fancyboxSelectors.push(albumPhotoSelector);

            fancybox.bind(genericFancyboxSelector, {
                ...commonConfig,
                source: (el: Element) => {
                    return (
                        el.getAttribute("data-src") || el.getAttribute("href")
                    );
                },
            });
            fancyboxSelectors.push(genericFancyboxSelector);
        } finally {
            fancyboxInitializing = false;
        }
    }

    function cleanupFancybox(): void {
        const fancybox = Fancybox;
        if (!fancybox) {
            return;
        }
        fancyboxSelectors.forEach((selector) => {
            fancybox.unbind(selector);
        });
        fancyboxSelectors = [];
        fancyboxInitializing = false;
    }

    return {
        initFancybox,
        cleanupFancybox,
    };
}
