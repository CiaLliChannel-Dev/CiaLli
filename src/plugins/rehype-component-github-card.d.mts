import type { Parent, RootContent } from "mdast";

export type GithubCardProperties = {
    repo: string;
};

export function GithubCardComponent(
    properties: GithubCardProperties,
    children: RootContent[],
): Parent;
