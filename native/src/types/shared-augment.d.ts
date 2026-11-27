// Fields the Supervisor already sends on turns (`activity`) that the runtime's
// packages/shared does not type yet; the shared UI's own copy of the types has them.
import '@pockymoe/shared';
declare module '@pockymoe/shared' {
  interface ThreadTurnActivityDto {
    commands?: number; fileChanges?: number; changedFiles?: number; addedLines?: number; removedLines?: number;
    reads?: number; searches?: number; tools?: number; agents?: number; reasoning?: number; failed?: number;
    fileCount?: number; files?: ThreadTurnChangedFileDto[]; segments?: ThreadTurnActivitySegmentDto[];
  }
  type ThreadTurnActivitySegmentDto = Omit<ThreadTurnActivityDto, 'files' | 'segments' | 'fileCount'> & { before: string | null; startedAt?: string; endedAt?: string };
  interface ThreadTurnChangedFileDto { path: string; itemId: string; addedLines?: number; removedLines?: number }
  interface ThreadTurnDto { activity?: ThreadTurnActivityDto | null }
  interface ThreadHistoryItemDto { updatedAt?: string | null }
}
