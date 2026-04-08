import * as path from 'path';
import { fileURLToPath } from 'url';
import * as cdk from 'aws-cdk-lib';
import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { FilterCriteria, FilterRule } from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface TgWorkerEchoStackProps extends StackProps {
  environmentName: string;
  lambdaName: string;
  tags?: Record<string, string>;
}

export class TgWorkerEchoStack extends Stack {
  constructor(scope: Construct, id: string, props: TgWorkerEchoStackProps) {
    super(scope, id, props);

    const { environmentName, lambdaName } = props;

    // Import pre-configured worker role from SSM (provisioned by tg-assistant-infra)
    // This role already has Order Queue receive + Result Queue send + KMS permissions
    const workerRoleArn = StringParameter.valueForStringParameter(
      this,
      `/automation/${environmentName}/roles/worker/arn`
    );

    const workerExecRole = iam.Role.fromRoleArn(this, 'ImportedWorkerRole', workerRoleArn, {
      mutable: false,
    });

    // Import Order Queue ARN from SSM (for event source mapping)
    const orderQueueArn = StringParameter.valueForStringParameter(
      this,
      `/automation/${environmentName}/queues/order/arn`
    );

    // Import Result Queue URL from SSM (Lambda env var for sending results)
    const resultQueueUrl = StringParameter.valueForStringParameter(
      this,
      `/automation/${environmentName}/queues/result/url`
    );

    // Choose code source: use pre-built ZIP when provided by CI, otherwise fallback to test fixture
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const zipPath = process.env.LAMBDA_ECHO_ZIP_PATH || path.join(__dirname, '../test/fixtures');
    const code = lambda.Code.fromAsset(zipPath);

    const echoFn = new lambda.Function(this, 'EchoWorkerFunction', {
      functionName: lambdaName,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(30),
      role: workerExecRole,
      code,
      handler: 'index.handler',
      environment: {
        NODE_ENV: 'production',
        ENVIRONMENT: environmentName,
        RESULT_QUEUE_URL: resultQueueUrl,
      },
      logGroup: new logs.LogGroup(this, 'EchoWorkerLogGroup', {
        logGroupName: `/aws/lambda/${lambdaName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      }),
    });

    // SQS event source mapping with filter for taskType: "echo"
    const orderQueue = sqs.Queue.fromQueueArn(this, 'OrderQueue', orderQueueArn);

    echoFn.addEventSource(
      new SqsEventSource(orderQueue, {
        batchSize: 5,
        maxBatchingWindow: Duration.seconds(10),
        reportBatchItemFailures: true,
        filters: [
          FilterCriteria.filter({
            body: {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- FilterRule.isEqual returns `any` per aws-cdk-lib type defs; safe here as FilterCriteria.filter also accepts `any`
              taskType: FilterRule.isEqual('echo'),
            },
          }),
        ],
      })
    );

    // Outputs
    new CfnOutput(this, 'EchoWorkerFunctionName', { value: echoFn.functionName });
    new CfnOutput(this, 'EchoWorkerFunctionArn', { value: echoFn.functionArn });
  }
}
