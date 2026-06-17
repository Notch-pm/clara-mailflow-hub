import { useEffect, useState } from "react";

/**
 * Retourne `value` avec un délai de `delayMs`, pour éviter de déclencher
 * une recherche (ex. API BAN) à chaque frappe.
 */
export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
