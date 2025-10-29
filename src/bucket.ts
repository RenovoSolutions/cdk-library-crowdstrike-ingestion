import {
  Annotations,
  Aspects,
  CfnOutput,
  RemovalPolicy,
  Stack,
  aws_iam as iam,
  aws_kms as kms,
  aws_s3 as s3,
  aws_s3_notifications as s3n,
  aws_sqs as sqs,
  aws_ssm as ssm,
} from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';

/**
 * Properties for the CrowdStrikeBucket construct.
 */
export interface CrowdStrikeBucketProps extends s3.BucketProps {
  /**
   * Properties for the SQS queue.
   *
   * @default - enforceSSL: true, deadLetterQueue: { maxReceiveCount: 5, queue: new sqs.Queue(this, 'DLQ', { queueName: `${this.bucketName}-dlq`, enforceSSL: true, }), },
   */
  readonly queueProps?: sqs.QueueProps;
  /**
   * Whether to create a KMS key for the bucket.
   *
   * @default - false
   */
  readonly createKmsKey?: boolean;
  /**
   * Properties for the KMS key.
   *
   * @default - removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE, enableKeyRotation: false, multiRegion: true, description: `KMS Key for CrowdStrike ingestion bucket ${this.bucketName}`,
   */
  readonly keyProps?: kms.KeyProps;
  /**
   * Properties for the IAM role.
   *
   * If you provide this, you must provide the roleProps.assumedBy property,
   * and you don't need to provide the crowdStrikeRoleParameterArn and crowdStrikeExternalIdParameterArn.
   *
   * @default - none except for the assumedBy property which is set to a CrowdStrike principal.
   */
  readonly roleProps?: iam.RoleProps;
  /**
   * The CrowdStrike role ARN.
   *
   * Required unless the role principal is provided directly in the roleProps.
   */
  readonly crowdStrikeRoleArn?: string;
  /**
   * The ARN of the SSM parameter containing the CrowdStrike external ID.
   *
   * Required unless the role principal is provided directly in the roleProps.
   */
  readonly crowdStrikeExternalIdParameterArn?: string;
  /**
   * The organization ID.
   * If provided, the bucket will allow write access to all accounts in the organization.
   * If there is a KMS key, it will also allow encrypt/decrypt access to the organization.
   *
   * @default - none
   */
  readonly orgId?: string;
  /**
   * The name of the S3 bucket that will be sending S3 access logs to this bucket.
   * This is used to configure the bucket policy to allow logging from that bucket.
   *
   * @default - none
   */
  readonly loggingBucketSourceName?: string;
};

/**
 * A construct that creates an S3 bucket for CrowdStrike data ingestion,
 * along with an SQS queue for notifications, an IAM role for access,
 * and optionally a KMS key for encryption.
 */
export class CrowdStrikeBucket extends s3.Bucket {
  /**
   * The SQS queue that receives notifications for new objects in the bucket.
   */
  public readonly queue: sqs.Queue;
  /**
   * The KMS key used for encrypting data in the bucket, if created.
   * This will be undefined if createKmsKey is false.
   *
   * Note that the bucket will still be created with S3-managed encryption
   * even if this is provided. The key is used by the service writing to the bucket.
   */
  public readonly key?: kms.Key;
  /**
   * The IAM role that CrowdStrike will assume to access the data in the bucket.
   */
  public readonly role: iam.Role;

  /**
   * Constructs a new CrowdStrikeBucket.
   *
   * @param scope The scope in which this construct is defined.
   * @param id The scoped construct ID.
   * @param props The properties for the bucket, queue, role, and optional KMS key.
   */
  constructor(scope: Construct, id: string, props: CrowdStrikeBucketProps) {
    super(scope, id, {
      encryption: s3.BucketEncryption.S3_MANAGED, // Not using KMS encryption due to complexity with CrowdStrike integration
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      ...props,
    });

    /**
     * If we have an orgId, grant bucket write access to all accounts in the organization.
     * This is useful for allowing multiple accounts in an organization to write to the same bucket.
     */
    if (props.orgId) {
      const organizationBucketPolicy = new iam.PolicyStatement({
        actions: [
          's3:PutObject',
          's3:PutObjectAcl',
          's3:DeleteObject',
          's3:AbortMultipartUpload',
        ],
        resources: [this.arnForObjects('*')],
        principals: [new iam.OrganizationPrincipal(props.orgId)],
      });
      this.addToResourcePolicy(organizationBucketPolicy);
    }

    // If a logging bucket source name is provided, add a policy to allow that bucket to write logs to this bucket.
    if (props.loggingBucketSourceName) {
      this.addToResourcePolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ['s3:PutObject'],
          resources: [this.arnForObjects('*')],
          principals: [new iam.ServicePrincipal('logging.s3.amazonaws.com')],
          conditions: {
            ArnLike: {
              'aws:SourceArn': `arn:aws:s3:::${props.loggingBucketSourceName}`,
            },
            StringEquals: {
              'aws:SourceAccount': Stack.of(this).account,
            },
          },
        }),
      );
    }

    /**
     * Create an SQS queue for notifications.
     * If a queueName is provided, use it; otherwise, generate a default name based on the bucket name.
     */
    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: props.queueProps?.queueName || `${this.bucketName}-queue`,
      enforceSSL: true,
      encryption: sqs.QueueEncryption.SQS_MANAGED, // Not using KMS encryption due to complexity with CrowdStrike integration
      deadLetterQueue: {
        maxReceiveCount: 5,
        queue: new sqs.Queue(this, 'DLQ', {
          queueName: `${this.bucketName}-dlq`,
          enforceSSL: true,
        }),
      },
      ...props.queueProps,
    });

    // Add a notification for bucket object creation events to the SQS queue.
    this.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.SqsDestination(this.queue),
    );

    /**
     * Determine the principal for CrowdStrike.
     * If roleProps are provided, use the assumedBy property from there.
     * Otherwise, create a CrowdStrike principal using the role ARN and external ID from SSM parameters.
     */
    let crowdStrikePrincipal: iam.IPrincipal;
    if (props.roleProps) {
      crowdStrikePrincipal = props.roleProps.assumedBy;
    } else if (props.crowdStrikeRoleArn && props.crowdStrikeExternalIdParameterArn) {
      const crowdStrikeRoleArn = props.crowdStrikeRoleArn;

      const crowdStrikeExternalId = ssm.StringParameter.fromStringParameterArn(
        this,
        'CrowdStrikeExternalIdParam',
        props.crowdStrikeExternalIdParameterArn,
      ).stringValue;

      crowdStrikePrincipal = new iam.PrincipalWithConditions(new iam.ArnPrincipal(crowdStrikeRoleArn), {
        StringEquals: {
          'sts:ExternalId': crowdStrikeExternalId,
        },
      });
    } else {
      Annotations.of(this).addError(
        'Either roleProps or both crowdStrikeRoleParameterArn and crowdStrikeExternalIdParameterArn must be provided.',
      );
      // This will not be used because of the error, but we need to initialize it to satisfy the type.
      crowdStrikePrincipal = new iam.AnyPrincipal();
    }

    /**
     * Create an IAM role for CrowdStrike to assume, granting it access to the resources created in this construct.
     * The role name can be provided in the props, or a default name will be generated based on the bucket name.
     */
    this.role = new iam.Role(this, 'Role', {
      roleName: props.roleProps?.roleName || `${this.bucketName}-role`,
      assumedBy: crowdStrikePrincipal,
      ...props.roleProps,
    });

    // Grant the role permissions to read from the bucket and consume messages from the SQS queue
    const bucketPolicy = new iam.ManagedPolicy(this, 'BucketAccessPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            's3:GetObject',
            's3:GetObjectVersion',
            's3:GetObjectTagging',
            's3:ListBucket',
            's3:ListBucketVersions',
            's3:GetBucketLocation',
          ],
          resources: [
            this.bucketArn,
            this.arnForObjects('*'),
          ],
        }),
      ],
    });
    this.role.addManagedPolicy(bucketPolicy);

    const queuePolicy = new iam.ManagedPolicy(this, 'QueueAccessPolicy', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            'sqs:ReceiveMessage',
            'sqs:ChangeMessageVisibility',
            'sqs:GetQueueUrl',
            'sqs:DeleteMessage',
            'sqs:GetQueueAttributes',
          ],
          resources: [this.queue.queueArn],
        }),
      ],
    });
    this.role.addManagedPolicy(queuePolicy);

    // If createKmsKey is true, create a KMS key for the data.
    if (props.createKmsKey) {
      this.key = new kms.Key(this, 'Key', {
        alias: `alias/${this.bucketName}`,
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        enableKeyRotation: true,
        multiRegion: true,
        description: `KMS Key for CrowdStrike ingestion bucket ${this.bucketName}`,
        ...props.keyProps,
      });

      // Grant the role permissions to use the KMS key for decryption.
      const keyDecryptPolicy = new iam.ManagedPolicy(this, 'KeyDecryptPolicy', {
        statements: [
          new iam.PolicyStatement({
            actions: [
              'kms:Decrypt',
              'kms:DescribeKey',
              'kms:GenerateDataKey',
            ],
            resources: [this.key.keyArn],
          }),
        ],
      });
      this.role.addManagedPolicy(keyDecryptPolicy);

      /**
       * If an orgId is provided, grant permissions to use the KMS key
       * for encryption and decryption for all accounts in the organization.
       */
      if (props.orgId) {
        const organizationKeyPolicy = new iam.PolicyStatement({
          actions: [
            'kms:Encrypt',
            'kms:Decrypt',
            'kms:ReEncryptTo',
            'kms:ReEncryptFrom',
            'kms:GenerateDataKey',
            'kms:GenerateDataKeyWithoutPlaintext',
            'kms:DescribeKey',
          ],
          resources: ['*'],
          principals: [new iam.OrganizationPrincipal(props.orgId)],
        });
        this.key.addToResourcePolicy(organizationKeyPolicy);
      }

      // Output the KMS key ARN for reference.
      new CfnOutput(this, 'KmsKeyArn', {
        value: this.key.keyArn,
        description: 'The ARN of the KMS key for CrowdStrike ingestion',
      });
    }

    NagSuppressions.addResourceSuppressions(
      this,
      [
        {
          id: 'NIST.800.53.R5-S3DefaultEncryptionKMS',
          reason: 'Not using KMS encryption due to complexity with CrowdStrike integration.',
        },
        {
          id: 'NIST.800.53.R5-S3BucketReplicationEnabled',
          reason: 'Replication is not required for CrowdStrike ingestion buckets because the data is sent directly to CrowdStrike.',
        },
        {
          id: 'NIST.800.53.R5-S3BucketLoggingEnabled',
          reason: 'Access logging is not required for CrowdStrike ingestion buckets because they are normally themselves access log destinations.',
        },
        {
          id: 'AwsSolutions-S1',
          reason: 'Access logging is not required for CrowdStrike ingestion buckets because they are normally themselves access log destinations.',
        },
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The bucket policy needs to grant access to all the objects in the bucket to be useful.',
          appliesTo: [{
            regex: '/^Resource::<.*\\.Arn>\\/\\*$/',
          }],
        },
      ],
      true,
    );

    NagSuppressions.addResourceSuppressions(
      this.role,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'The role needs access to all the objects in the bucket.',
          appliesTo: [{
            regex: '/^Resource::<.*\\.Arn>\\/\\*$/',
          }],
        },
      ],
      true,
    );

    /**
     * Suppress cdk-nag violations for the BucketNotificationsHandler Lambda
     * that CDK automatically creates for S3 event notifications.
     * Apply at stack level since the handler is created there.
     */
    Aspects.of(Stack.of(this)).add({
      visit(node: Construct) {
        // Suppress IAM4 for the BucketNotificationsHandler role
        if (node instanceof iam.CfnRole && node.node.path.includes('BucketNotificationsHandler')) {
          NagSuppressions.addResourceSuppressions(
            node,
            [
              {
                id: 'AwsSolutions-IAM4',
                reason: 'The BucketNotificationsHandler Lambda is created by CDK and uses the standard AWSLambdaBasicExecutionRole managed policy.',
                appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole'],
              },
            ],
          );
        }

        // Suppress IAMNoInlinePolicy for the BucketNotificationsHandler policy
        if (node instanceof iam.CfnPolicy && node.node.path.includes('BucketNotificationsHandler')) {
          NagSuppressions.addResourceSuppressions(
            node,
            [
              {
                id: 'NIST.800.53.R5-IAMNoInlinePolicy',
                reason: 'The BucketNotificationsHandler Lambda is created by CDK and uses inline policies for its custom resource implementation.',
              },
            ],
          );
        }
      },
    });

    /**
     * Output the bucket name, bucket ARN, queue name, and role name.
     * You will need these values to configure CrowdStrike connectors.
     */
    new CfnOutput(this, 'BucketName', {
      value: this.bucketName,
      description: 'The Name of the S3 bucket for CrowdStrike ingestion',
    });

    new CfnOutput(this, 'BucketArn', {
      value: this.bucketArn,
      description: 'The ARN of the S3 bucket for CrowdStrike ingestion',
    });

    new CfnOutput(this, 'QueueName', {
      value: this.queue.queueName,
      description: 'The Name of the SQS queue for CrowdStrike ingestion',
    });

    new CfnOutput(this, 'RoleName', {
      value: this.role.roleName,
      description: 'The Name of the IAM role for CrowdStrike ingestion',
    });
  }
}
