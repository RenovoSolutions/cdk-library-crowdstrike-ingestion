import {
  Stack,
  aws_iam as iam,
  aws_logs as logs,
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Properties for the CrowdStrikeLogSubscription construct.
 */
export interface CrowdStrikeLogSubscriptionProps {
  /**
   * The log group to create the subscription filter for.
   */
  readonly logGroup: logs.ILogGroup;
  /**
   * The ARN of the log destination logical resource.
   */
  readonly logDestinationArn: string;
  /**
   * The filter pattern for the subscription filter.
   *
   * @default - '%.%' (matches all log events).
   */
  readonly filterPattern?: string;
  /**
   * The IAM role that CloudWatch Logs will assume to create the subscription.
   * If not provided, a new role will be created with the necessary permissions.
   *
   * @default - a new role will be created.
   */
  readonly role?: iam.IRole;
};

/**
 * A construct that creates an CloudWatch log group filter subscription
 * for CrowdStrike data ingestion, along with an IAM role for access.
 */
export class CrowdStrikeLogSubscription extends Construct {
  /**
   * The log group for which the subscription filter is created.
   */
  public readonly logGroup: logs.ILogGroup;
  /**
   * The subscription filter for the log group.
   */
  public readonly subscriptionFilter: logs.CfnSubscriptionFilter;
  /**
   * The IAM role that CloudWatch Logs will assume to create the subscription.
   */
  public readonly role: iam.IRole;

  /**
   * Constructs a new CrowdStrikeLogSubscription.
   *
   * @param scope The scope in which this construct is defined.
   * @param id The scoped construct ID.
   * @param props The properties for the subscription.
   */
  constructor(scope: Construct, id: string, props: CrowdStrikeLogSubscriptionProps) {
    super(scope, id);

    this.logGroup = props.logGroup;

    // If a role is provided, use it; otherwise, create a new role.
    if (props.role) {
      this.role = props.role;
    } else {
      this.role = new iam.Role(this, 'Role', {
        assumedBy: new iam.ServicePrincipal(`logs.${Stack.of(this).region}.amazonaws.com`),
        inlinePolicies: {
          CrossAccountPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [
                  'logs:PutSubscriptionFilter',
                  'logs:DescribeSubscriptionFilters',
                ],
                resources: [props.logDestinationArn],
              }),
            ],
          }),
        },
      });
    }

    /**
     * Create the subscription filter for the log group.
     * The default filter will match all log events.
     */
    this.subscriptionFilter = new logs.CfnSubscriptionFilter(this, 'SubscriptionFilter', {
      logGroupName: this.logGroup.logGroupName,
      filterPattern: props.filterPattern || '%.%',
      destinationArn: props.logDestinationArn,
      roleArn: this.role.roleArn,
    });
  }
}
