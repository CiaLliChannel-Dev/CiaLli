export const LIGHT_MODE = "light" as const;
export const DARK_MODE = "dark" as const;
export const DEFAULT_THEME: typeof LIGHT_MODE | typeof DARK_MODE = LIGHT_MODE;

// Banner height unit: vh
export const BANNER_HEIGHT = 35;
export const BANNER_HEIGHT_EXTEND = 30;
export const BANNER_HEIGHT_HOME: number = BANNER_HEIGHT + BANNER_HEIGHT_EXTEND;

// Page width: rem
export const PAGE_WIDTH = 90;
