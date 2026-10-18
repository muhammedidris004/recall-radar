/** What counts as "baby gear" for the CPSC feed (title / product names). */
export const BABY_GEAR_RE =
  /\b(high ?chairs?|booster seats?|cribs?|bassinets?|strollers?|prams?|car ?seats?|playards?|play ?yards?|pack ?n ?plays?|bouncers?|infant|baby|babies|toddlers?|changing tables?|walkers?|carriers?|nursery|bath ?seats?|bath ?tubs?|nursing pillows?|play ?pens?|co-?sleepers?|sleepers?|rockers?|swings?|gates?|baby ?monitors?|pacifiers?|teethers?|diaper|children'?s|kids'?|child)\b/i;

export function isBabyGear(text: string): boolean {
  return BABY_GEAR_RE.test(text);
}
