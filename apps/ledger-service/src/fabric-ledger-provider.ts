import {
  connect,
  hash,
  signers,
  type Contract,
  type Gateway,
} from "@hyperledger/fabric-gateway";
import * as grpc from "@grpc/grpc-js";
import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { getEnvironment } from "./environment.js";
import {
  LedgerProviderError,
  type LedgerProvider,
  type ProviderNeutralProofEnvelope,
  type ProviderProofRecord,
} from "./ledger-provider.js";

type FabricResponse = {
  proofId: string;
  kind: "EVIDENCE" | "DECISION";
  schemaVersion: "1.0";
  anchoredAt: string;
  transactionId: string;
  payload: ProviderNeutralProofEnvelope;
};

type FabricVerificationResponse = {
  proofId: string;
  confirmed: boolean;
  hashMatch: boolean;
  anchoredAt: string;
  transactionId: string;
};

export class FabricLedgerProvider implements LedgerProvider {
  readonly providerType = "FABRIC" as const;
  private gateway?: Gateway;
  private grpcClient?: grpc.Client;
  private contract?: Contract;
  private readonly environment = getEnvironment();

  private async getContract() {
    if (this.contract) return this.contract;
    const [tlsRootCert, identityCredentials, privateKeyPem] = await Promise.all(
      [
        readFile(this.environment.FABRIC_GATEWAY_TLS_CERT_PATH),
        readFile(this.environment.FABRIC_IDENTITY_CERT_PATH),
        readFile(this.environment.FABRIC_IDENTITY_KEY_PATH),
      ],
    );
    this.grpcClient = new grpc.Client(
      this.environment.FABRIC_GATEWAY_ENDPOINT,
      grpc.credentials.createSsl(tlsRootCert),
      {
        "grpc.ssl_target_name_override":
          this.environment.FABRIC_GATEWAY_SERVER_NAME,
        "grpc.default_authority": this.environment.FABRIC_GATEWAY_SERVER_NAME,
      },
    );
    this.gateway = connect({
      client: this.grpcClient,
      identity: {
        mspId: this.environment.FABRIC_MSP_ID,
        credentials: identityCredentials,
      },
      signer: signers.newPrivateKeySigner(createPrivateKey(privateKeyPem)),
      hash: hash.sha256,
      evaluateOptions: () => ({
        deadline: Date.now() + this.environment.FABRIC_COMMIT_TIMEOUT_MS,
      }),
      endorseOptions: () => ({
        deadline: Date.now() + this.environment.FABRIC_COMMIT_TIMEOUT_MS,
      }),
      submitOptions: () => ({
        deadline: Date.now() + this.environment.FABRIC_COMMIT_TIMEOUT_MS,
      }),
      commitStatusOptions: () => ({
        deadline: Date.now() + this.environment.FABRIC_COMMIT_TIMEOUT_MS,
      }),
    });
    this.contract = this.gateway
      .getNetwork(this.environment.FABRIC_CHANNEL_NAME)
      .getContract(this.environment.FABRIC_CHAINCODE_NAME);
    return this.contract;
  }

  async getHealth() {
    try {
      const contract = await this.getContract();
      await contract.evaluateTransaction("GetNetworkStatus");
      return {
        state: "AVAILABLE" as const,
        providerType: this.providerType,
        networkReference: this.environment.FABRIC_CHANNEL_NAME,
        contractReference: this.environment.FABRIC_CHAINCODE_NAME,
      };
    } catch {
      return {
        state: "UNAVAILABLE" as const,
        providerType: this.providerType,
        networkReference: this.environment.FABRIC_CHANNEL_NAME,
        contractReference: this.environment.FABRIC_CHAINCODE_NAME,
      };
    }
  }

  async submitProof(request: {
    envelope: ProviderNeutralProofEnvelope;
    canonicalBytes: string;
    idempotencyKey: string;
  }) {
    try {
      const contract = await this.getContract();
      const functionName =
        request.envelope.kind === "EVIDENCE"
          ? "AnchorEvidenceProof"
          : "AnchorDecisionPackageProof";
      const bytes = await contract.submitTransaction(
        functionName,
        request.canonicalBytes,
      );
      const response = JSON.parse(
        Buffer.from(bytes).toString("utf8"),
      ) as FabricResponse;
      return {
        state: "FINALIZED" as const,
        providerTransactionId: response.transactionId,
        providerProofReference: response.proofId,
        providerContractReference: this.environment.FABRIC_CHAINCODE_NAME,
        providerNetworkReference: this.environment.FABRIC_CHANNEL_NAME,
        providerMetadataSchemaVersion: "1.0" as const,
        providerMetadata: { commitStatus: "VALID" as const },
        anchoredAt: response.anchoredAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("PROOF_ID_CONFLICT"))
        throw new LedgerProviderError("PROOF_ID_CONFLICT", false, true);
      if (
        message.includes("14 UNAVAILABLE") ||
        message.includes("DEADLINE_EXCEEDED") ||
        message.includes("ECONNREFUSED")
      )
        throw new LedgerProviderError("FABRIC_UNAVAILABLE", true);
      throw new LedgerProviderError("FABRIC_SUBMISSION_REJECTED", false);
    }
  }

  async getTransaction(reference: {
    providerTransactionId: string;
    providerProofReference: string;
  }) {
    const proof = await this.queryProof(reference.providerProofReference);
    return {
      state: proof ? ("FINALIZED" as const) : ("NOT_FOUND" as const),
      providerTransactionId: reference.providerTransactionId,
    };
  }

  async queryProof(proofId: string): Promise<ProviderProofRecord | null> {
    try {
      const contract = await this.getContract();
      const bytes = await contract.evaluateTransaction("GetProof", proofId);
      const response = JSON.parse(
        Buffer.from(bytes).toString("utf8"),
      ) as FabricResponse;
      return response;
    } catch (error) {
      if (error instanceof Error && error.message.includes("PROOF_NOT_FOUND"))
        return null;
      throw new LedgerProviderError("FABRIC_QUERY_UNAVAILABLE", true);
    }
  }

  async verifyProof(request: { proofId: string; expectedHashes: string[] }) {
    const proof = await this.queryProof(request.proofId);
    if (!proof)
      return {
        state: "NOT_FOUND" as const,
        proofConfirmed: false,
        hashMatch: false,
      };
    const contract = await this.getContract();
    const functionName =
      proof.kind === "EVIDENCE"
        ? "VerifyEvidenceHash"
        : "VerifyDecisionPackage";
    const args =
      proof.kind === "EVIDENCE"
        ? [request.proofId, request.expectedHashes[0] ?? ""]
        : [request.proofId, ...request.expectedHashes];
    const bytes = await contract.evaluateTransaction(functionName, ...args);
    const result = JSON.parse(
      Buffer.from(bytes).toString("utf8"),
    ) as FabricVerificationResponse;
    return {
      state: "FINALIZED" as const,
      proofConfirmed: result.confirmed,
      hashMatch: result.hashMatch,
      anchoredAt: result.anchoredAt,
      providerTransactionId: result.transactionId,
    };
  }

  close() {
    this.gateway?.close();
    this.grpcClient?.close();
  }
}
