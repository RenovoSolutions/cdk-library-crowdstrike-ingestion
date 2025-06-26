import {
  Duration,
  Stack,
  aws_iam as iam,
} from 'aws-cdk-lib';
import {
  Annotations,
  Match,
  Template,
} from 'aws-cdk-lib/assertions';
import { CrowdStrikeBucket } from '../src/bucket';

describe('CrowdStrikeBucket', () => {
  let stack: Stack;

  beforeEach(() => {
    stack = new Stack();
  });

  test('creates bucket with default properties', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify bucket creation with expected properties
    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'test-crowdstrike-bucket',
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          {
            ServerSideEncryptionByDefault: {
              SSEAlgorithm: 'AES256',
            },
          },
        ],
      },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      VersioningConfiguration: {
        Status: 'Enabled',
      },
    });

    // Verify SQS queue creation
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: {
        'Fn::Join': [
          '',
          [
            {
              Ref: Match.stringLikeRegexp('TestBucket'),
            },
            '-queue',
          ],
        ],
      },
    });

    // Verify DLQ creation
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: {
        'Fn::Join': [
          '',
          [
            {
              Ref: Match.stringLikeRegexp('TestBucket'),
            },
            '-dlq',
          ],
        ],
      },
    });

    // Verify IAM role creation
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: {
        'Fn::Join': [
          '',
          [
            {
              Ref: Match.stringLikeRegexp('TestBucket'),
            },
            '-role',
          ],
        ],
      },
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Condition: {
              StringEquals: {
                'sts:ExternalId': {
                  Ref: Match.stringLikeRegexp('TestBucketCrowdStrikeExternalIdParam'),
                },
              },
            },
            Effect: 'Allow',
            Principal: {
              AWS: {
                Ref: Match.stringLikeRegexp('TestBucketCrowdStrikeRoleParam'),
              },
            },
          },
        ],
      },
    });

    // Verify bucket notification configuration
    template.hasResourceProperties('Custom::S3BucketNotifications', {
      NotificationConfiguration: {
        QueueConfigurations: [
          {
            Events: [
              's3:ObjectCreated:*',
            ],
          },
        ],
      },
    });

    // Stack outputs
    template.hasOutput('*', {
      Value: {
        Ref: Match.stringLikeRegexp('TestBucket'),
      },
      Description: 'The Name of the S3 bucket for CrowdStrike ingestion',
    });

    template.hasOutput('*', {
      Value: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('TestBucket'),
          'Arn',
        ],
      },
      Description: 'The ARN of the S3 bucket for CrowdStrike ingestion',
    });

    template.hasOutput('*', {
      Value: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('TestBucketQueue'),
          'QueueName',
        ],
      },
      Description: 'The Name of the SQS queue for CrowdStrike ingestion',
    });

    template.hasOutput('*', {
      Value: {
        Ref: Match.stringLikeRegexp('TestBucketRole'),
      },
      Description: 'The Name of the IAM role for CrowdStrike ingestion',
    });

    // Template snapshot
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('creates bucket with KMS key', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
      createKmsKey: true,
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify KMS key creation
    template.hasResourceProperties('AWS::KMS::Key', {
      Description: {
        'Fn::Join': [
          '',
          [
            'KMS Key for CrowdStrike ingestion bucket ',
            {
              Ref: Match.stringLikeRegexp('TestBucket'),
            },
          ],
        ],
      },
      EnableKeyRotation: false,
      MultiRegion: true,
    });

    // Verify KMS alias
    template.hasResourceProperties('AWS::KMS::Alias', {
      AliasName: {
        'Fn::Join': [
          '',
          [
            'alias/',
            {
              Ref: Match.stringLikeRegexp('TestBucket'),
            },
          ],
        ],
      },
    });

    // Additional Stack output
    template.hasOutput('*', {
      Value: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('TestBucketKey'),
          'Arn',
        ],
      },
      Description: 'The ARN of the KMS key for CrowdStrike ingestion',
    });
  });

  test('creates bucket with custom queue name and properties', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
      queueProps: {
        queueName: 'custom-queue-name',
        visibilityTimeout: Duration.seconds(300),
      },
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify SQS queue with custom name and properties
    template.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: 'custom-queue-name',
      VisibilityTimeout: 300,
    });
  });

  test('creates bucket with custom role name and properties', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      roleProps: {
        roleName: 'custom-role-name',
        description: 'Custom role description',
        assumedBy: new iam.PrincipalWithConditions(new iam.ArnPrincipal('arn:aws:iam::123456789012:role/CrowdStrikeRole'), {
          StringEquals: {
            'sts:ExternalId': 'externalId123',
          },
        }),
      },
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify IAM role with custom name and properties
    template.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'custom-role-name',
      Description: 'Custom role description',
    });
  });

  test('creates bucket with custom KMS key name and properties', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
      createKmsKey: true,
      keyProps: {
        alias: 'custom-key-alias',
        description: 'Custom key description',
        enableKeyRotation: true,
      },
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify KMS key with custom properties
    template.hasResourceProperties('AWS::KMS::Key', {
      Description: 'Custom key description',
      EnableKeyRotation: true,
    });

    template.hasResourceProperties('AWS::KMS::Alias', {
      AliasName: 'alias/custom-key-alias',
    });
  });

  test('creates bucket with organization access', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
      orgIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/orgId/path',
      createKmsKey: true,
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify bucket policy allows organization access
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 's3:*',
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
            Effect: 'Deny',
            Principal: {
              AWS: '*',
            },
            Resource: [
              {
                'Fn::GetAtt': [
                  Match.stringLikeRegexp('TestBucket'),
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        Match.stringLikeRegexp('TestBucket'),
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
          },
          {
            Action: [
              's3:DeleteObject*',
              's3:PutObject',
              's3:PutObjectLegalHold',
              's3:PutObjectRetention',
              's3:PutObjectTagging',
              's3:PutObjectVersionTagging',
              's3:Abort*',
            ],
            Effect: 'Allow',
            Principal: {
              AWS: '*',
            },
            Resource: [
              {
                'Fn::GetAtt': [
                  Match.stringLikeRegexp('TestBucket'),
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        Match.stringLikeRegexp('TestBucket'),
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
            Condition: {
              StringEquals: {
                'aws:PrincipalOrgID': {
                  Ref: Match.stringLikeRegexp('TestBucketOrgIdParamParameter'),
                },
              },
            },
          },
        ],
      },
    });

    // Verify KMS key policy allows organization access
    template.hasResourceProperties('AWS::KMS::Key', {
      KeyPolicy: {
        Statement: [
          {
            Action: 'kms:*',
            Effect: 'Allow',
            Principal: {
              AWS: {
                'Fn::Join': [
                  '',
                  [
                    'arn:',
                    {
                      Ref: 'AWS::Partition',
                    },
                    ':iam::',
                    {
                      Ref: 'AWS::AccountId',
                    },
                    ':root',
                  ],
                ],
              },
            },
            Resource: '*',
          },
          {
            Action: [
              'kms:Decrypt',
              'kms:Encrypt',
              'kms:ReEncrypt*',
              'kms:GenerateDataKey*',
            ],
            Effect: 'Allow',
            Principal: {
              AWS: '*',
            },
            Resource: '*',
            Condition: {
              StringEquals: {
                'aws:PrincipalOrgID': {
                  Ref: Match.stringLikeRegexp('TestBucketOrgIdParamParameter'),
                },
              },
            },
          },
        ],
      },
    });
  });

  test('creates bucket with logging bucket source', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      loggingBucketSourceName: 'source-logging-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify bucket policy allows logging from source bucket
    template.hasResourceProperties('AWS::S3::BucketPolicy', {
      PolicyDocument: {
        Statement: [
          {
            Action: 's3:*',
            Effect: 'Deny',
            Principal: {
              AWS: '*',
            },
            Resource: [
              {
                'Fn::GetAtt': [
                  Match.stringLikeRegexp('TestBucket'),
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        Match.stringLikeRegexp('TestBucket'),
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
            Condition: {
              Bool: {
                'aws:SecureTransport': 'false',
              },
            },
          },
          {
            Action: 's3:PutObject',
            Effect: 'Allow',
            Principal: {
              Service: 'logging.s3.amazonaws.com',
            },
            Resource: {
              'Fn::Join': [
                '',
                [
                  {
                    'Fn::GetAtt': [
                      Match.stringLikeRegexp('TestBucket'),
                      'Arn',
                    ],
                  },
                  '/*',
                ],
              ],
            },
            Condition: {
              ArnLike: {
                'aws:SourceArn': 'arn:aws:s3:::source-logging-bucket',
              },
              StringEquals: {
                'aws:SourceAccount': {
                  Ref: 'AWS::AccountId',
                },
              },
            },
          },
        ],
      },
    });
  });

  test('bucket has correct removal policy', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify bucket has RETAIN removal policy
    template.hasResource('AWS::S3::Bucket', {
      DeletionPolicy: 'RetainExceptOnCreate',
      UpdateReplacePolicy: 'Retain',
    });
  });

  test('queue and role have correct permissions', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
      crowdStrikeRoleParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/role/path',
      crowdStrikeExternalIdParameterArn: 'arn:aws:ssm:us-east-1:123456789012:parameter/custom/externalId/path',
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify role has permissions to read from bucket and consume messages from SQS queue
    template.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: [
          {
            Action: [
              's3:GetObject*',
              's3:GetBucket*',
              's3:List*',
            ],
            Effect: 'Allow',
            Resource: [
              {
                'Fn::GetAtt': [
                  Match.stringLikeRegexp('TestBucket'),
                  'Arn',
                ],
              },
              {
                'Fn::Join': [
                  '',
                  [
                    {
                      'Fn::GetAtt': [
                        Match.stringLikeRegexp('TestBucket'),
                        'Arn',
                      ],
                    },
                    '/*',
                  ],
                ],
              },
            ],
          },
          {
            Action: [
              'sqs:ReceiveMessage',
              'sqs:ChangeMessageVisibility',
              'sqs:GetQueueUrl',
              'sqs:DeleteMessage',
              'sqs:GetQueueAttributes',
            ],
            Effect: 'Allow',
            Resource: {
              'Fn::GetAtt': [
                Match.stringLikeRegexp('TestBucketQueue'),
                'Arn',
              ],
            },
          },
        ],
      },
    });
  });

  test('annotates error if required parameters are missing', () => {
    // WHEN
    new CrowdStrikeBucket(stack, 'TestBucket', {
      bucketName: 'test-crowdstrike-bucket',
    });

    // THEN
    Annotations.fromStack(stack).hasError(
      '/Default/TestBucket',
      'Either roleProps or both crowdStrikeRoleParameterArn and crowdStrikeExternalIdParameterArn must be provided.',
    );
  });
});