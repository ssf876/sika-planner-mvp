"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
import {
  confirmLifeEvent,
  declareLifeEvent,
  dismissLifeEvent,
} from "@/lib/repositories/life-events";
import {
  engineErrorMessage,
  RepositoryError,
} from "@/lib/repositories/errors";

export interface LifeEventFormState {
  error: string | null;
  ok: boolean;
}

const LIFE_EVENT_KINDS = [
  "HOME_PURCHASE",
  "MOVE",
  "WEDDING",
  "CHILD",
  "CUSTOM",
] as const;
type LifeEventFormKind = (typeof LIFE_EVENT_KINDS)[number];

function lifeEventKindFrom(raw: string): LifeEventFormKind | null {
  return LIFE_EVENT_KINDS.find((kind) => kind === raw) ?? null;
}

/** Shared plumbing: session → household, domain error → form state. */
async function withHousehold(
  run: (householdId: string) => Promise<unknown>,
): Promise<LifeEventFormState> {
  const user = await requireOnboardedUser();
  try {
    await run(user.householdId);
  } catch (error) {
    const message = engineErrorMessage(error);
    if (message) return { error: message, ok: false };
    if (error instanceof RepositoryError) {
      return { error: error.message, ok: false };
    }
    throw error; // unexpected failures surface, never swallow
  }
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

/** Confirm a detected season (D11 gate) — persistence lives in the repository. */
export async function confirmLifeEventAction(
  eventId: string,
): Promise<LifeEventFormState> {
  return withHousehold(async (householdId) => {
    await confirmLifeEvent(prisma, householdId, eventId);
  });
}

/** Dismiss a candidate — DISMISSED is what suppression keys off. */
export async function dismissLifeEventAction(
  eventId: string,
): Promise<LifeEventFormState> {
  return withHousehold(async (householdId) => {
    await dismissLifeEvent(prisma, householdId, eventId);
  });
}

/** Declare a season manually — works with zero history. */
export async function declareLifeEventAction(
  kind: string,
): Promise<LifeEventFormState> {
  return withHousehold(async (householdId) => {
    const parsed = lifeEventKindFrom(kind);
    if (!parsed) {
      throw new RepositoryError(
        "INVALID_KIND",
        "Pick what kind of life change this is.",
      );
    }
    await declareLifeEvent(prisma, householdId, parsed, new Date());
  });
}
