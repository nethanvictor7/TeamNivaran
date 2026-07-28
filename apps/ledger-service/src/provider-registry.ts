import { Injectable } from "@nestjs/common";
import { getEnvironment } from "./environment.js";
import { FabricLedgerProvider } from "./fabric-ledger-provider.js";
import type { LedgerProvider } from "./ledger-provider.js";

export const LEDGER_PROVIDER = Symbol("LEDGER_PROVIDER");

@Injectable()
export class ProviderRegistry {
  readonly active: LedgerProvider;
  constructor() {
    const environment = getEnvironment();
    if (environment.LEDGER_PROVIDER !== "FABRIC")
      throw new Error(
        `Ledger provider '${environment.LEDGER_PROVIDER}' is not installed.`,
      );
    this.active = new FabricLedgerProvider();
  }
  forType(providerType: string) {
    if (providerType !== this.active.providerType)
      throw new Error(
        `Historical ledger provider '${providerType}' is not installed in this deployment.`,
      );
    return this.active;
  }
}
