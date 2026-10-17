import { badRequest } from "../lib/errors.js";

/** Validates a numeric route parameter such as a ticket ID. */
export function idParam(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^\d{1,10}$/.test(raw)) throw badRequest("Invalid ID in URL");
  return Number(raw);
}
