import type { DiaryInteractionSnapshot } from "@/server/repositories/diary/interaction.repository";

export type { DiaryInteractionSnapshot } from "@/server/repositories/diary/interaction.repository";

import {
    invalidateDiaryInteractionAggregateFromRepository,
    invalidateDiaryInteractionViewerStateFromRepository,
    loadDiaryInteractionSnapshotFromRepository,
} from "@/server/repositories/diary/interaction.repository";

export async function loadDiaryInteractionSnapshot(input: {
    diaryId: string;
    viewerId?: string | null;
}): Promise<DiaryInteractionSnapshot> {
    return await loadDiaryInteractionSnapshotFromRepository(input);
}

export async function invalidateDiaryInteractionAggregate(
    diaryId: string,
): Promise<void> {
    await invalidateDiaryInteractionAggregateFromRepository(diaryId);
}

export async function invalidateDiaryInteractionViewerState(
    diaryId: string,
    viewerId: string,
): Promise<void> {
    await invalidateDiaryInteractionViewerStateFromRepository(
        diaryId,
        viewerId,
    );
}
