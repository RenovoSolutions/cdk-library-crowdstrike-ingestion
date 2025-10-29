import {
  Aspects,
  Stack,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import {
  Annotations,
  Match,
  Template,
} from 'aws-cdk-lib/assertions';
import {
  AwsSolutionsChecks,
  NIST80053R5Checks,
} from 'cdk-nag';
import { CrowdStrikeLogSubscription } from '../src/logsubscription';

describe('CrowdStrikeLogSubscription', () => {
  let stack: Stack;
  let logGroup: logs.LogGroup;
  let logDestinationArn: string;

  beforeEach(() => {
    stack = new Stack();
    logGroup = new logs.LogGroup(stack, 'TestLogGroup', {
      logGroupName: 'test-log-group',
    });
    logDestinationArn = 'arn:aws:logs:us-east-1:123456789012:destination:test-destination';
  });

  test('creates subscription filter with default properties', () => {
    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn,
    });

    // Apply cdk-nag aspects
    Aspects.of(stack).add(new AwsSolutionsChecks());
    Aspects.of(stack).add(new NIST80053R5Checks());

    // THEN
    const template = Template.fromStack(stack);

    // Check for cdk-nag errors
    const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
    if (errors.length > 0) {
      console.error('Error Annotations:');
      errors.forEach(error => {
        console.error(`  [${error.id}] ${error.entry.data}`);
      });
    }
    expect(errors).toHaveLength(0);

    // Verify subscription filter creation with expected properties
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      LogGroupName: {
        Ref: Match.stringLikeRegexp('TestLogGroup'),
      },
      FilterPattern: '%.%',
      DestinationArn: 'arn:aws:logs:us-east-1:123456789012:destination:test-destination',
    });

    // Verify IAM role creation
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: {
                'Fn::Join': [
                  '',
                  [
                    'logs.',
                    {
                      Ref: 'AWS::Region',
                    },
                    '.amazonaws.com',
                  ],
                ],
              },
            },
          },
        ],
      },
      Policies: [
        {
          PolicyDocument: {
            Statement: [
              {
                Action: [
                  'logs:PutSubscriptionFilter',
                  'logs:DescribeSubscriptionFilters',
                ],
                Effect: 'Allow',
                Resource: 'arn:aws:logs:us-east-1:123456789012:destination:test-destination',
              },
            ],
          },
        },
      ],
    });

    // Template snapshot
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('creates subscription filter with custom filter pattern', () => {
    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn,
      filterPattern: '{ $.eventType = "UserAuthentication" }',
    });

    // Apply cdk-nag aspects
    Aspects.of(stack).add(new AwsSolutionsChecks());
    Aspects.of(stack).add(new NIST80053R5Checks());

    // THEN
    const template = Template.fromStack(stack);

    // Check for cdk-nag errors
    const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
    if (errors.length > 0) {
      console.error('Error Annotations:');
      errors.forEach(error => {
        console.error(`  [${error.id}] ${error.entry.data}`);
      });
    }
    expect(errors).toHaveLength(0);

    // Verify subscription filter with custom pattern
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      FilterPattern: '{ $.eventType = "UserAuthentication" }',
    });
  });

  test('creates subscription filter with provided role', () => {
    // GIVEN
    const existingRole = new iam.Role(stack, 'ExistingRole', {
      assumedBy: new iam.ServicePrincipal('logs.amazonaws.com'),
    });

    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn,
      role: existingRole,
    });

    // Apply cdk-nag aspects
    Aspects.of(stack).add(new AwsSolutionsChecks());
    Aspects.of(stack).add(new NIST80053R5Checks());

    // THEN
    const template = Template.fromStack(stack);

    // Check for cdk-nag errors
    const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
    if (errors.length > 0) {
      console.error('Error Annotations:');
      errors.forEach(error => {
        console.error(`  [${error.id}] ${error.entry.data}`);
      });
    }
    expect(errors).toHaveLength(0);

    // Verify subscription filter uses the provided role
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      RoleArn: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('ExistingRole'),
          'Arn',
        ],
      },
    });

    // Verify no additional role was created
    template.resourceCountIs('AWS::IAM::Role', 1); // Only the ExistingRole should exist
  });

  test('links role to subscription filter correctly', () => {
    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn,
    });

    // Apply cdk-nag aspects
    Aspects.of(stack).add(new AwsSolutionsChecks());
    Aspects.of(stack).add(new NIST80053R5Checks());

    // THEN
    const template = Template.fromStack(stack);

    // Check for cdk-nag errors
    const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
    if (errors.length > 0) {
      console.error('Error Annotations:');
      errors.forEach(error => {
        console.error(`  [${error.id}] ${error.entry.data}`);
      });
    }
    expect(errors).toHaveLength(0);

    // Verify the subscription filter references the created role
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      RoleArn: {
        'Fn::GetAtt': [
          Match.stringLikeRegexp('TestSubscriptionRole'),
          'Arn',
        ],
      },
    });
  });

  test('handles cross-region log destination correctly', () => {
    // GIVEN
    const crossRegionDestination = 'arn:aws:logs:us-west-2:123456789012:destination:test-destination';

    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn: crossRegionDestination,
    });

    // Apply cdk-nag aspects
    Aspects.of(stack).add(new AwsSolutionsChecks());
    Aspects.of(stack).add(new NIST80053R5Checks());

    // THEN
    const template = Template.fromStack(stack);

    // Check for cdk-nag errors
    const errors = Annotations.fromStack(stack).findError('*', Match.anyValue());
    if (errors.length > 0) {
      console.error('Error Annotations:');
      errors.forEach(error => {
        console.error(`  [${error.id}] ${error.entry.data}`);
      });
    }
    expect(errors).toHaveLength(0);

    // Verify the destination ARN is set correctly
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      DestinationArn: crossRegionDestination,
    });

    // Verify the IAM role exists
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [
          {
            Action: 'sts:AssumeRole',
            Effect: 'Allow',
            Principal: {
              Service: {
                'Fn::Join': [
                  '',
                  [
                    'logs.',
                    { Ref: 'AWS::Region' },
                    '.amazonaws.com',
                  ],
                ],
              },
            },
          },
        ],
      },
      Policies: [
        {
          PolicyDocument: {
            Statement: [
              {
                Action: [
                  'logs:PutSubscriptionFilter',
                  'logs:DescribeSubscriptionFilters',
                ],
                Effect: 'Allow',
                Resource: 'arn:aws:logs:us-west-2:123456789012:destination:test-destination',
              },
            ],
          },
        },
      ],
    });
  });
});