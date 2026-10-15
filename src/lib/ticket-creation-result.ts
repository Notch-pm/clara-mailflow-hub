export interface TicketCreationResult {
  irisReference?: string | null;
  irisError?: string | null;
  /** Pièce réclamée par la démarche restée dans Clara — la demande est incomplète. */
  attachmentsRefused?: string | null;
}

export interface TicketCreationNotice {
  level: "success" | "warning";
  message: string;
}

/** Le dépôt dans Iris se raconte dans le toast de fin de création. */
export function describeTicketCreation(result: TicketCreationResult): TicketCreationNotice {
  if (result.irisError) {
    return { level: "warning", message: `Action créée, non transmise à Iris : ${result.irisError}` };
  }
  if (result.irisReference && result.attachmentsRefused) {
    // Déposée, mais sans une pièce que la démarche réclame : l'agent doit
    // le savoir tout de suite — la ligne du ticket le redira ensuite.
    return {
      level: "warning",
      message: `Demande ${result.irisReference} déposée dans Iris — ${result.attachmentsRefused}`,
    };
  }
  if (result.irisReference) {
    return {
      level: "success",
      message: `Action créée — demande ${result.irisReference} déposée dans Iris`,
    };
  }
  return { level: "success", message: "Demande créée" };
}
