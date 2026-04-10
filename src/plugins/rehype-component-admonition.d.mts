import type { Parent, RootContent } from "mdast";

export type AdmonitionType =
    | "tip"
    | "note"
    | "important"
    | "caution"
    | "warning";

export type AdmonitionProperties = {
    title?: string;
    "has-directive-label"?: boolean;
};

export function AdmonitionComponent(
    properties: AdmonitionProperties,
    children: RootContent[],
    type: AdmonitionType,
): Parent;
