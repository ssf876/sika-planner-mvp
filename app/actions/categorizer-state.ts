/**
 * Form-state contract for the review queue (same split as csv-import-state:
 * Next.js server-action files may only export async functions, so the client
 * imports the initial state from here).
 */

export interface ReviewQueueFormState {
  error: string | null;
  ok: boolean;
}

export const initialReviewQueueState: ReviewQueueFormState = {
  error: null,
  ok: false,
};
