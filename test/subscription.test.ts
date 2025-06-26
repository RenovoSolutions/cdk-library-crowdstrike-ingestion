import { crowdStrikeLogDestinations } from '@renovolive/cdk-library-renovo-constants';
import {
  Stack,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import {
  Match,
  Template,
} from 'aws-cdk-lib/assertions';
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
    logDestinationArn = crowdStrikeLogDestinations.CLOUDWATCH_US_EAST_1;
  });

  test('creates subscription filter with default properties', () => {
    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn,
    });

    // THEN
    const template = Template.fromStack(stack);

    // Verify subscription filter creation with expected properties
    template.hasResourceProperties('AWS::Logs::SubscriptionFilter', {
      LogGroupName: {
        Ref: Match.stringLikeRegexp('TestLogGroup'),
      },
      FilterPattern: '%.%',
      DestinationArn: crowdStrikeLogDestinations.CLOUDWATCH_US_EAST_1,
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
                Resource: crowdStrikeLogDestinations.CLOUDWATCH_US_EAST_1,
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

    // THEN
    const template = Template.fromStack(stack);

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

    // THEN
    const template = Template.fromStack(stack);

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

    // THEN
    const template = Template.fromStack(stack);

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
    const crossRegionDestination = crowdStrikeLogDestinations.CLOUDWATCH_US_WEST_2;

    // WHEN
    new CrowdStrikeLogSubscription(stack, 'TestSubscription', {
      logGroup,
      logDestinationArn: crossRegionDestination,
    });

    // THEN
    const template = Template.fromStack(stack);

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
                Resource: crowdStrikeLogDestinations.CLOUDWATCH_US_WEST_2,
              },
            ],
          },
        },
      ],
    });
  });
});