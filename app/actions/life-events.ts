"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireOnboardedUser } from "@/lib/auth/session";
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

/**
 * Confirm a detected season (D11 gate): the candidate becomes CONFIRMED and
 * the season template can be proposed against it (D12). Household-scoped:
 * an id from another household updates nothing and reports not found.
 */
export async function confirmLifeEventAction(
  eventId: string,
): Promise<LifeEventFormState> {
  return withHousehold(async (householdId) => {
    const updated = await prisma.lifeEvent.updateMany({
      where: { id: eventId, householdId, status: "CANDIDATE" },
      data: { status: "CONFIRMED" },
    });
    if (updated.count === 0) {
      throw new RepositoryError(
        "NOT_FOUND",
        "That life event no longer needs a decision — refresh the dashboard.",
      );
    }
  });
}

/**
 * Dismiss a candidate: persists DISMISSED so the detection rule stays
 * suppressed for this household (spec: "dismiss → rule suppressed").
 */
export async function dismissLifeEventAction(
  eventId: string,
): Promise<LifeEventFormState> {
  return withHousehold(async (householdId) => {
    const updated = await prisma.lifeEvent.updateMany({
      where: { id: eventId, householdId, status: "CANDIDATE" },
      data: { status: "DISMISSED" },
    });
    if (updated.count === 0) {
      throw new RepositoryError(
        "NOT_FOUND",
        "That life event no longer needs a decision — refresh the dashboard.",
      );
    }
  });
}

/**
 * Declare a season manually — the cold-start path that works with zero
 * history ("I'm moving"). A declaration is the user's own confirmation, so
 * it persists as CONFIRMED straight away.
 */
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
    await prisma.lifeEvent.create({
      data: {
        householdId,
        kind: parsed,
        status: "CONFIRMED",
        evidence: "Declared by you",
        seasonStart: new Date(),
      },
    });
  });
}
