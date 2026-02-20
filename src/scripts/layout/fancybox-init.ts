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

        const albumImagesSelector =
            ".custom-md img, #post-cover img, .moment-images img";
        const albumLinksSelector = ".moment-images a[data-fancybox]";
        const albumPhotoSelector = `.dc-album-gallery [data-fancybox='${ALBUM_PREVIEW_GROUP}']`;
        const singleFancyboxSelector = `[data-fancybox]:not(.moment-images a):not([data-fancybox='${ALBUM_PREVIEW_GROUP}'])`;

        const hasImages =
            document.querySelector(albumImagesSelector) ||
            document.querySelector(albumLinksSelector) ||
            document.querySelector(albumPhotoSelector) ||
            document.querySelector(singleFancyboxSelector);

        if (!hasImages) {
            return;
        }

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

            fancybox.bind(albumImagesSelector, {
                ...commonConfig,
                groupAll: true,
                Carousel: {
                    transition: "slide",
                    preload: 2,
                },
            });
            fancyboxSelectors.push(albumImagesSelector);

            fancybox.bind(albumLinksSelector, {
                ...commonConfig,
                source: (el: Element) => {
                    return (
                        el.getAttribute("data-src") || el.getAttribute("href")
                    );
                },
            });
            fancyboxSelectors.push(albumLinksSelector);

            fancybox.bind(albumPhotoSelector, albumConfig);
            fancyboxSelectors.push(albumPhotoSelector);

            fancybox.bind(singleFancyboxSelector, commonConfig);
            fancyboxSelectors.push(singleFancyboxSelector);
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
