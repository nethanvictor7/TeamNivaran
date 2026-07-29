import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { IntegrationService } from "./integration.service.js";

@Injectable()
export class ConnectorScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly integration: IntegrationService) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), 5_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.integration.runDueConnectors();
    } catch (error) {
      this.logger.error(
        "SQL polling scheduler tick failed",
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
