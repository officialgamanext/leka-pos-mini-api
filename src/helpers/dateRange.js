import {
  startOfDay, endOfDay, subDays,
  startOfWeek, endOfWeek, subWeeks,
  startOfMonth, endOfMonth, subMonths,
  startOfYear, endOfYear, subYears,
  parseISO
} from "date-fns";

/**
 * Returns { start, end } Date objects for the given range string.
 * Throws an error if the range is unknown or required custom dates are missing.
 */
export function getDateRange(range = "today", startDate, endDate) {
  const now = new Date();

  switch (range) {
    case "today":
      return { start: startOfDay(now), end: endOfDay(now) };

    case "yesterday": {
      const y = subDays(now, 1);
      return { start: startOfDay(y), end: endOfDay(y) };
    }

    case "thisWeek":
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfDay(now) };

    case "lastWeek": {
      const lw = subWeeks(now, 1);
      return { start: startOfWeek(lw, { weekStartsOn: 1 }), end: endOfWeek(lw, { weekStartsOn: 1 }) };
    }

    case "thisMonth":
      return { start: startOfMonth(now), end: endOfDay(now) };

    case "lastMonth": {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }

    case "thisYear":
      return { start: startOfYear(now), end: endOfDay(now) };

    case "lastYear": {
      const ly = subYears(now, 1);
      return { start: startOfYear(ly), end: endOfYear(ly) };
    }

    case "custom": {
      if (!startDate || !endDate) {
        throw new Error("startDate and endDate are required for custom range");
      }
      return { start: startOfDay(parseISO(startDate)), end: endOfDay(parseISO(endDate)) };
    }

    default:
      throw new Error(`Invalid range: "${range}". Valid values: today, yesterday, thisWeek, lastWeek, thisMonth, lastMonth, thisYear, lastYear, custom`);
  }
}
