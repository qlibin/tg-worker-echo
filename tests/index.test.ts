import { SQSEvent, SQSRecord, SQSBatchResponse } from 'aws-lambda';

// Must declare mockSend before jest.mock since factories are hoisted
// but the arrow wrapper defers access until runtime
let mockSend: jest.Mock;

jest.mock('@aws-sdk/client-sqs', () => {
  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]): unknown => mockSend(...args),
    })),
    SendMessageCommand: jest.fn().mockImplementation((input: unknown) => input),
  };
});

jest.mock('@qlibin/tg-assistant-contracts', () => {
  const parse = (data: unknown) => {
    const obj = data as Record<string, unknown>;
    if (!obj || typeof obj !== 'object') {
      throw new Error('Invalid input');
    }
    if (
      !obj.orderId ||
      !obj.taskType ||
      !obj.payload ||
      !obj.userId ||
      !obj.timestamp ||
      !obj.schemaVersion
    ) {
      throw new Error('Missing required fields');
    }
    return obj;
  };

  return {
    OrderMessageSchema: { parse },
    SCHEMA_VERSION: '1.0.0',
  };
});

// Import handler AFTER mocks are set up
import { handler } from '../src/index';

function makeValidOrderMessage(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    orderId: '550e8400-e29b-41d4-a716-446655440000',
    taskType: 'echo',
    payload: { parameters: { message: 'hello world' } },
    userId: '12345',
    timestamp: '2026-03-28T12:00:00.000Z',
    schemaVersion: '1.0.0',
    ...overrides,
  };
}

function makeSqsRecord(body: string, messageId = 'msg-001'): SQSRecord {
  return {
    messageId,
    receiptHandle: 'receipt-handle',
    body,
    attributes: {
      ApproximateReceiveCount: '1',
      SentTimestamp: '1711612800000',
      SenderId: 'sender-id',
      ApproximateFirstReceiveTimestamp: '1711612800000',
    },
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:eu-central-1:123456789012:order-queue',
    awsRegion: 'eu-central-1',
  };
}

function makeSqsEvent(records: SQSRecord[]): SQSEvent {
  return { Records: records };
}

describe('Echo Worker Handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend = jest.fn().mockResolvedValue({ MessageId: 'result-msg-001' });
    process.env = {
      ...originalEnv,
      RESULT_QUEUE_URL: 'https://sqs.eu-central-1.amazonaws.com/123456789012/result-queue',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test('returns empty batchItemFailures for empty event', async () => {
    // Arrange
    const event = makeSqsEvent([]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([]);
  });

  test('echoes valid OrderMessage as ResultMessage to Result Queue', async () => {
    // Arrange
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([]);
    expect(mockSend).toHaveBeenCalledTimes(1);

    const sentCommand = (mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(sentCommand).toMatchObject({
      QueueUrl: 'https://sqs.eu-central-1.amazonaws.com/123456789012/result-queue',
    });

    const sentBody = JSON.parse(sentCommand.MessageBody as string) as Record<string, unknown>;
    expect(sentBody).toMatchObject({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      taskType: 'echo',
      status: 'success',
      userId: '12345',
      followUpAction: 'notify',
      schemaVersion: '1.0.0',
    });

    // Verify echoed payload is in result
    const resultData = (sentBody.result as Record<string, unknown>).data as Record<string, unknown>;
    expect(resultData.echoedPayload).toEqual(order.payload);
    expect(resultData.workerVersion).toBe('1.0.0');
    expect(resultData.processedAt).toBeDefined();
  });

  test('sets correct SQS message attributes', async () => {
    // Arrange
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentCommand = (mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>;
    expect(sentCommand).toMatchObject({
      MessageAttributes: {
        Status: { DataType: 'String', StringValue: 'success' },
        TaskType: { DataType: 'String', StringValue: 'echo' },
        FollowUpAction: { DataType: 'String', StringValue: 'notify' },
      },
    });
  });

  test('preserves correlationId from order to result', async () => {
    // Arrange
    const order = makeValidOrderMessage({ correlationId: 'corr-123' });
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.correlationId).toBe('corr-123');
  });

  test('uses orderId as correlationId when not provided', async () => {
    // Arrange
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.correlationId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  test('returns batchItemFailure for invalid JSON', async () => {
    // Arrange
    const record = makeSqsRecord('not-json', 'bad-msg-001');
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'bad-msg-001' }]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns batchItemFailure for invalid OrderMessage', async () => {
    // Arrange — missing required fields
    const record = makeSqsRecord(JSON.stringify({ foo: 'bar' }), 'invalid-msg-001');
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'invalid-msg-001' }]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns batchItemFailure when SQS send fails', async () => {
    // Arrange
    mockSend.mockRejectedValueOnce(new Error('SQS send failed'));
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order), 'fail-msg-001');
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'fail-msg-001' }]);
  });

  test('returns batchItemFailure when RESULT_QUEUE_URL is missing', async () => {
    // Arrange
    delete process.env.RESULT_QUEUE_URL;
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order), 'no-url-msg-001');
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'no-url-msg-001' }]);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('handles partial batch failure correctly', async () => {
    // Arrange — first record valid, second record invalid
    const validOrder = makeValidOrderMessage();
    const validRecord = makeSqsRecord(JSON.stringify(validOrder), 'good-msg');
    const invalidRecord = makeSqsRecord('not-json', 'bad-msg');
    const event = makeSqsEvent([validRecord, invalidRecord]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert — only the bad record should fail
    expect(result.batchItemFailures).toEqual([{ itemIdentifier: 'bad-msg' }]);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('preserves priority from order to result', async () => {
    // Arrange
    const order = makeValidOrderMessage({ priority: 'high' });
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.priority).toBe('high');
  });

  test('applies simulated delay when SIMULATED_DELAY_MS is set', async () => {
    // Arrange
    process.env.SIMULATED_DELAY_MS = '50';
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    const start = Date.now();
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;
    const elapsed = Date.now() - start;

    // Assert
    expect(result.batchItemFailures).toEqual([]);
    expect(elapsed).toBeGreaterThanOrEqual(40); // Allow small timing tolerance

    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.processingTime).toBeGreaterThanOrEqual(40);
  });

  test('propagates chatId and text when both are present', async () => {
    // Arrange
    const order = makeValidOrderMessage({
      chatId: 12345,
      payload: { parameters: { text: 'hello' } },
    });
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.chatId).toBe(12345);
    const resultData = (sentBody.result as Record<string, unknown>).data as Record<string, unknown>;
    expect(resultData.text).toBe('hello');
  });

  test('omits chatId from result when order has no chatId', async () => {
    // Arrange — no chatId field
    const order = makeValidOrderMessage();
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    const result = (await handler(event, {} as never, () => {})) as SQSBatchResponse;

    // Assert
    expect(result.batchItemFailures).toEqual([]);
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    expect(sentBody.chatId).toBeUndefined();
  });

  test('sets text to undefined when parameters.text is a non-string', async () => {
    // Arrange
    const order = makeValidOrderMessage({
      payload: { parameters: { text: 42 } },
    });
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    const resultData = (sentBody.result as Record<string, unknown>).data as Record<string, unknown>;
    expect(resultData.text).toBeUndefined();
  });

  test('sets text to undefined when payload has no parameters', async () => {
    // Arrange
    const order = makeValidOrderMessage({
      payload: {},
    });
    const record = makeSqsRecord(JSON.stringify(order));
    const event = makeSqsEvent([record]);

    // Act
    await handler(event, {} as never, () => {});

    // Assert
    const sentBody = JSON.parse(
      ((mockSend.mock.calls as unknown[][])[0][0] as Record<string, unknown>).MessageBody as string
    ) as Record<string, unknown>;
    const resultData = (sentBody.result as Record<string, unknown>).data as Record<string, unknown>;
    expect(resultData.text).toBeUndefined();
  });
});
