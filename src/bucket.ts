import {
  Annotations,
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
   * The ARN of the SSM parameter containing the CrowdStrike role ARN.
   *
   * Required unless the role principal is provided directly in the roleProps.
   */
  readonly crowdStrikeRoleParameterArn?: string;
  /**
   * The ARN of the SSM parameter containing the CrowdStrike external ID.
   *
   * Required unless the role principal is provided directly in the roleProps.
   */
  readonly crowdStrikeExternalIdParameterArn?: string;
  /**
   * The ARN of the SSM parameter containing the organization ID.
   * If provided, the bucket will allow write access to all accounts in the organization.
   * If there is a KMS key, it will also allow encrypt/decrypt access to the organization.
   *
   * @default - none
   */
  readonly orgIdParameterArn?: string;
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
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      ...props,
    });

    // If we have an orgId, grant bucket write access to all accounts in the organization.
    // This is useful for allowing multiple accounts in an organization to write to the same bucket.
    let orgId: string | undefined;
    if (props.orgIdParameterArn) {
      orgId = ssm.StringParameter.fromStringParameterArn(
        this,
        'OrgIdParam',
        props.orgIdParameterArn,
      ).stringValue;
      this.grantWrite(new iam.OrganizationPrincipal(orgId));
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

    // Create an SQS queue for notifications.
    // If a queueName is provided, use it; otherwise, generate a default name based on the bucket name.
    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: props.queueProps?.queueName || `${this.bucketName}-queue`,
      enforceSSL: true,
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

    // Determine the principal for CrowdStrike.
    // If the roleProps are provided, use the assumedBy property from there.
    // Otherwise, create a CrowdStrike principal using the role ARN and external ID from SSM parameters.
    let crowdStrikePrincipal: iam.IPrincipal;
    if (props.roleProps) {
      crowdStrikePrincipal = props.roleProps.assumedBy;
    } else if (props.crowdStrikeRoleParameterArn && props.crowdStrikeExternalIdParameterArn) {
      const crowdStrikeRoleArn = ssm.StringParameter.fromStringParameterArn(
        this,
        'CrowdStrikeRoleParam',
        props.crowdStrikeRoleParameterArn,
      ).stringValue;

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

    // Create an IAM role for CrowdStrike to assume, granting it access to the resources created in this construct.
    // The role name can be provided in the props, or a default name will be generated based on the bucket name.
    this.role = new iam.Role(this, 'Role', {
      roleName: props.roleProps?.roleName || `${this.bucketName}-role`,
      assumedBy: crowdStrikePrincipal,
      ...props.roleProps,
    });

    // Grant the role permissions to read from the bucket and consume messages from the SQS queue.
    this.grantRead(this.role);
    this.queue.grantConsumeMessages(this.role);

    // If createKmsKey is true, create a KMS key for the data.
    if (props.createKmsKey) {
      this.key = new kms.Key(this, 'Key', {
        alias: `alias/${this.bucketName}`,
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
        enableKeyRotation: false,
        multiRegion: true,
        description: `KMS Key for CrowdStrike ingestion bucket ${this.bucketName}`,
        ...props.keyProps,
      });

      // Grant the role permissions to use the KMS key for decryption.
      this.key.grantDecrypt(this.role);

      // If an orgId is provided, grant permissions to use it to encrypt/decrypt
      // for all accounts in the organization.
      if (orgId) {
        this.key.grantEncryptDecrypt(new iam.OrganizationPrincipal(orgId));
      }

      // Output the KMS key ARN for reference.
      new CfnOutput(this, 'KmsKeyArn', {
        value: this.key.keyArn,
        description: 'The ARN of the KMS key for CrowdStrike ingestion',
      });
    }

    // Output the bucket name, bucket ARN, queue name, and role name for reference.
    // You will need these values to configure CrowdStrike connectors.
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
