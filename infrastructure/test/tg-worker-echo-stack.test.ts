import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { TgWorkerEchoStack } from '../lib/tg-worker-echo-stack.js';

describe('TgWorkerEchoStack', () => {
  const baseEnv = { account: '123456789012', region: 'us-east-1' } as const;

  const makeStack = (
    overrides?: Partial<{
      envName: string;
      lambdaName: string;
      setZipPath: boolean;
    }>
  ) => {
    const app = new cdk.App();

    if (overrides?.setZipPath) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-'));
      process.env.LAMBDA_ECHO_ZIP_PATH = tmpDir;
    } else {
      delete process.env.LAMBDA_ECHO_ZIP_PATH;
    }

    return new TgWorkerEchoStack(app, 'TestStack', {
      env: baseEnv,
      description: 'Test stack',
      environmentName: overrides?.envName ?? 'dev',
      lambdaName: overrides?.lambdaName ?? 'tg-worker-echo-dev',
      tags: { app: 'tg-worker-echo', env: overrides?.envName ?? 'dev' },
    });
  };

  test('synthesizes expected CloudFormation template (snapshot)', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev', setZipPath: true });

    // Act
    const templateJson = Template.fromStack(stack).toJSON();

    // Assert
    expect(templateJson).toMatchSnapshot();
  });

  test('creates Lambda with expected config (runtime, arch, memory, timeout, env)', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev', setZipPath: true });

    // Act
    const template = Template.fromStack(stack);

    // Assert
    template.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({
        FunctionName: 'tg-worker-echo-dev',
        Runtime: 'nodejs22.x',
        MemorySize: 256,
        Timeout: 30,
        Architectures: ['arm64'],
        Environment: Match.objectLike({
          Variables: Match.objectLike({
            NODE_ENV: 'production',
            ENVIRONMENT: 'dev',
            RESULT_QUEUE_URL: Match.anyValue(),
          }),
        }),
        Handler: 'index.handler',
      })
    );
  });

  test('imports pre-configured role from SSM instead of creating self-managed roles', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev' });
    const template = Template.fromStack(stack);

    // Assert: no self-managed IAM roles are created (role imported from SSM)
    template.resourceCountIs('AWS::IAM::Role', 0);
    template.resourceCountIs('AWS::IAM::Policy', 0);
  });

  test('configures log retention for 30 days', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev', lambdaName: 'tg-worker-echo-dev' });
    const template = Template.fromStack(stack);

    // Assert
    template.hasResourceProperties('AWS::Logs::LogGroup', {
      LogGroupName: '/aws/lambda/tg-worker-echo-dev',
      RetentionInDays: 30,
    });
  });

  test('creates SQS event source mapping with filter and batch failure reporting', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev', setZipPath: true });

    // Act
    const template = Template.fromStack(stack);

    // Assert
    template.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 5,
      MaximumBatchingWindowInSeconds: 10,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      FilterCriteria: Match.objectLike({
        Filters: Match.arrayWith([
          Match.objectLike({
            Pattern: Match.anyValue(),
          }),
        ]),
      }),
    });
  });

  test('exports function name and ARN as stack outputs', () => {
    // Arrange
    const stack = makeStack({ envName: 'dev' });
    const template = Template.fromStack(stack);

    // Assert
    template.hasOutput('EchoWorkerFunctionName', Match.anyValue());
    template.hasOutput('EchoWorkerFunctionArn', Match.anyValue());
  });
});
