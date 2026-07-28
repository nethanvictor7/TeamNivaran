import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { z } from "zod";
import {
  AuthenticationGuard,
  type AuthenticatedRequest,
  Permission,
} from "./authentication.js";
import { CaseProofReadService } from "./case-proof-read.service.js";
import { ProofService } from "./proof.service.js";

const emptyBody = z.object({}).strict();
function parseEmpty(value: unknown) {
  const parsed = emptyBody.safeParse(value ?? {});
  if (!parsed.success)
    throw new BadRequestException("This route accepts no request fields.");
}

@Controller("api/v1")
@UseGuards(AuthenticationGuard)
export class ProofController {
  constructor(
    private readonly proofs: ProofService,
    private readonly caseProofs: CaseProofReadService,
  ) {}

  @Get("cases/:caseId/ledger-summary")
  @Permission("proof:read")
  caseLedgerSummary(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.caseProofs.summary(caseId, request.identity, request.id);
  }

  @Get("cases/:caseId/proofs")
  @Permission("proof:read")
  caseProofList(
    @Param("caseId") caseId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.caseProofs.list(caseId, request.identity, request.id, query);
  }

  @Post("evidence/:evidenceId/versions/:versionId/proofs")
  @HttpCode(202)
  @Permission("proof:create")
  async createEvidence(
    @Param("evidenceId") evidenceId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    parseEmpty(body);
    return this.proofs.createEvidence(
      evidenceId,
      versionId,
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Get("evidence/:evidenceId/versions/:versionId/proofs")
  @Permission("proof:read")
  listEvidence(
    @Param("evidenceId") evidenceId: string,
    @Param("versionId") versionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.proofs.listEvidence(evidenceId, versionId, request.identity);
  }

  @Post("evidence/:evidenceId/versions/:versionId/proofs/verify")
  @HttpCode(200)
  @Permission("proof:verify")
  verifyEvidence(
    @Param("evidenceId") evidenceId: string,
    @Param("versionId") versionId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parseEmpty(body);
    return this.proofs.verifyEvidence(
      evidenceId,
      versionId,
      request.identity,
      request.id,
    );
  }

  @Post("cases/:caseId/decision-proof")
  @HttpCode(202)
  @Permission("proof:create")
  createDecision(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    parseEmpty(body);
    return this.proofs.createDecision(
      caseId,
      request.identity,
      request.id,
      key ?? "",
    );
  }

  @Get("cases/:caseId/decision-proof")
  @Permission("proof:read")
  getDecision(
    @Param("caseId") caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.proofs.getDecision(caseId, request.identity);
  }

  @Post("cases/:caseId/decision-proof/verify")
  @HttpCode(200)
  @Permission("proof:verify")
  verifyDecision(
    @Param("caseId") caseId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parseEmpty(body);
    return this.proofs.verifyDecision(caseId, request.identity, request.id);
  }

  @Get("ledger/transactions/:transactionId")
  @Permission("proof:read")
  transaction(
    @Param("transactionId") transactionId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.proofs.transaction(transactionId, request.identity);
  }

  @Post("ledger/proofs/:proofRequestId/retry")
  @Permission("proof:retry")
  retry(
    @Param("proofRequestId") id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    parseEmpty(body);
    return this.proofs.retry(id, request.identity);
  }

  @Get("ledger/network/status")
  @Permission("ledger:status:read")
  status() {
    return this.proofs.networkStatus();
  }

  @Post("ledger/reconciliation/run")
  @Permission("ledger:reconcile")
  reconcile(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    parseEmpty(body);
    return this.proofs.reconcile(request.identity);
  }
}
