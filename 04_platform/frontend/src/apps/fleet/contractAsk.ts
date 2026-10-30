import { useEffect, useState } from 'preact/hooks';

/**
 * A CONTRACT ASKED FOR, CARRIED FROM THE BELL TO THE CONTRACT FORM (2026-10-30): a business found the fleet in the
 * logistics directory and asked; "Record a contract with …" on that notice opens Orders with the form filled in for it.
 */
export interface ContractAsk {
  entityId: string;
  name: string;
}

let pending: ContractAsk | null = null;
const listeners = new Set<() => void>();

/** Say which business the next contract is for. */
export function recordContractFor(ask: ContractAsk): void {
  pending = ask;
  for (const l of listeners) l();
}

/** The asked-for contract waiting to be recorded, once: taking it clears it. */
export function takeContractAsk(): ContractAsk | null {
  const p = pending;
  pending = null;
  return p;
}

/** The asked-for contract, as it arrives — on opening the screen, or while it is open. */
export function useContractAsk(): ContractAsk | null {
  const [ask, setAsk] = useState<ContractAsk | null>(() => takeContractAsk());
  useEffect(() => {
    const l = () => setAsk(takeContractAsk());
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return ask;
}
