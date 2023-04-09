import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import * as readline from 'readline';
import { wrapHttpError } from 'src/common/utils';
import { UploadImportFileDto } from 'src/modules/bulk-actions/dto/upload-import-file.dto';
import { DatabaseConnectionService } from 'src/modules/database/database-connection.service';
import { ClientMetadata } from 'src/common/models';
import { splitCliCommandLine } from 'src/utils/cli-helper';
import { BulkActionSummary } from 'src/modules/bulk-actions/models/bulk-action-summary';
import { IBulkActionOverview } from 'src/modules/bulk-actions/interfaces/bulk-action-overview.interface';
import { BulkActionStatus, BulkActionType } from 'src/modules/bulk-actions/constants';

const BATCH_LIMIT = 10_000;

@Injectable()
export class BulkImportService {
  private logger = new Logger('BulkImportService');

  constructor(
    private readonly databaseConnectionService: DatabaseConnectionService,
  ) {}

  private async executeBatch(client, batch: any[]): Promise<BulkActionSummary> {
    const result = new BulkActionSummary();
    result.addProcessed(batch.length);

    try {
      if (client?.isCluster) {
        await Promise.all(batch.map(async ([command, args]) => {
          try {
            await client.call(command, args);
            result.addSuccess(1);
          } catch (e) {
            result.addFailed(1);
          }
        }));
      } else {
        (await client.pipeline(batch).exec()).forEach(([err]) => {
          if (err) {
            result.addFailed(1);
          } else {
            result.addSuccess(1);
          }
        });
      }
    } catch (e) {
      this.logger.error('Unable to execute batch of commands', e);
      result.addFailed(batch.length);
    }

    return result;
  }

  /**
   * @param clientMetadata
   * @param dto
   */
  public async import(clientMetadata: ClientMetadata, dto: UploadImportFileDto): Promise<IBulkActionOverview> {
    const result: IBulkActionOverview = {
      id: 'empty',
      databaseId: clientMetadata.databaseId,
      type: BulkActionType.Import,
      summary: {
        processed: 0,
        succeed: 0,
        failed: 0,
        errors: [],
      },
      progress: null,
      filter: null,
      status: BulkActionStatus.Completed,
      duration: Date.now(),
    };

    try {
      const client = await this.databaseConnectionService.createClient(clientMetadata);

      const stream = Readable.from(dto.file.buffer);
      let batch = [];

      const batchResults: Promise<BulkActionSummary>[] = [];

      await new Promise((res) => {
        const rl = readline.createInterface(stream);
        rl.on('line', (line) => {
          const [command, ...args] = splitCliCommandLine((line));
          if (batch.length >= BATCH_LIMIT) {
            batchResults.push(this.executeBatch(client, batch));
            batch = [];
          } else {
            batch.push([command.toLowerCase(), args]);
          }
        });
        rl.on('error', (error) => {
          result.summary.errors.push(error);
          result.status = BulkActionStatus.Failed;
          res(null);
        });
        rl.on('close', () => {
          batchResults.push(this.executeBatch(client, batch));
          res(null);
        });
      });

      (await Promise.all(batchResults)).forEach((batchResult) => {
        result.summary.processed += batchResult.getOverview().processed;
        result.summary.succeed += batchResult.getOverview().succeed;
        result.summary.failed += batchResult.getOverview().failed;
      });

      result.duration = Date.now() - result.duration;

      return result;
    } catch (e) {
      this.logger.error('Unable to process an import file', e);
      throw wrapHttpError(e);
    }
  }
}
