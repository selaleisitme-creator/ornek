import "server-only";
import { buildRemovalArgs } from "../stockRules";
import { removeStockUnits } from "./stockRepository";
import { ValidationError } from "./errors";

// "Stok sil": units leave the shelf with a reason; their rows stay for the history (Faz 1 plan, section 2).
// The database refuses the whole list if any unit is no longer in stock, so nothing is half removed.
export async function removeUnits(input) {
  const built = buildRemovalArgs(input);
  if (built.error) throw new ValidationError(built.error);
  const count = await removeStockUnits(built.args);
  return { count: Number(count) || built.args.unitIds.length };
}
