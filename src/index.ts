import { SQSHandler, SQSBatchResponse, SQSRecord } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  OrderMessageSchema,
  SCHEMA_VERSION,
  type OrderMessage,
  type ResultMessage,
} from '@qlibin/tg-assistant-contracts';

const WORKER_VERSION = '1.0.0';

const sqs = new SQSClient({ region: process.env.AWS_REGION ?? 'eu-central-1' });

async function processRecord(record: SQSRecord): Promise<void> {
  const resultQueueUrl = process.env.RESULT_QUEUE_URL;
  if (!resultQueueUrl) {
    throw new Error('RESULT_QUEUE_URL environment variable is not set');
  }

  const body: unknown = JSON.parse(record.body);
  const order: OrderMessage = OrderMessageSchema.parse(body);

  const startTime = Date.now();

  // Simulate work if configured
  const delayMs = Number(process.env.SIMULATED_DELAY_MS ?? '0');
  if (delayMs > 0) {
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  const processingTime = Date.now() - startTime;

  const resultMessage: ResultMessage = {
    orderId: order.orderId,
    correlationId: order.correlationId ?? order.orderId,
    chatId: order.chatId,
    taskType: order.taskType,
    status: 'success',
    result: {
      data: {
        text:
          typeof order.payload.parameters?.text === 'string'
            ? order.payload.parameters.text
            : undefined,
        echoedPayload: order.payload,
        workerVersion: WORKER_VERSION,
        processedAt: new Date().toISOString(),
      },
    },
    processingTime,
    timestamp: new Date().toISOString(),
    userId: order.userId,
    followUpAction: 'notify',
    priority: order.priority,
    schemaVersion: SCHEMA_VERSION,
  };

  await sqs.send(
    new SendMessageCommand({
      QueueUrl: resultQueueUrl,
      MessageBody: JSON.stringify(resultMessage),
      MessageAttributes: {
        Status: { DataType: 'String', StringValue: resultMessage.status },
        TaskType: { DataType: 'String', StringValue: order.taskType },
        FollowUpAction: { DataType: 'String', StringValue: 'notify' },
      },
    })
  );
}

export const handler: SQSHandler = async (event): Promise<SQSBatchResponse> => {
  // eslint-disable-next-line no-console
  console.log(`Processing ${event.Records.length} record(s)`);

  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error(`Failed to process record ${record.messageId}:`, error);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};
