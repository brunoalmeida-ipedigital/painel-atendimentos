// Horário comercial: 09:00 às 18:00 — fora desse intervalo o cronômetro pausa.
const START_HOUR = 9;
const END_HOUR = 18;

/** Retorna o tempo decorrido (ms) considerando apenas o horário comercial 09h-18h. */
export function businessElapsed(startMs: number, nowMs: number): number {
  if (!startMs || nowMs <= startMs) return 0;
  let total = 0;
  const cursor = new Date(startMs);
  const end = new Date(nowMs);

  while (cursor < end) {
    const dayStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), START_HOUR, 0, 0, 0);
    const dayEnd = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), END_HOUR, 0, 0, 0);
    const segStart = cursor > dayStart ? cursor : dayStart;
    const segEnd = end < dayEnd ? end : dayEnd;
    if (segEnd > segStart) total += segEnd.getTime() - segStart.getTime();
    // próximo dia 00:00
    cursor.setDate(cursor.getDate() + 1);
    cursor.setHours(0, 0, 0, 0);
  }
  return total;
}

/** Tempo restante (ms) do SLA, descontando pausas fora do horário comercial. */
export function businessRemaining(startMs: number, nowMs: number, limitMs: number): number {
  return limitMs - businessElapsed(startMs, nowMs);
}
