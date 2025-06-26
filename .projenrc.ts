import { awscdk, javascript } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Renovo Solutions',
  authorAddress: 'webmaster+cdk@renovo1.com',
  cdkVersion: '2.200.1',
  defaultReleaseBranch: 'master',
  jsiiVersion: '~5.8.0',
  name: '@renovosolutions/cdk-library-crowdstrike-ingestion',
  projenrcTs: true,
  repositoryUrl: 'https://github.com/RenovoSolutions/cdk-library-crowdstrike-ingestion.git',
  description: 'A CDK library to ease repetetive construct creation for CrowdStrike data ingestion',
  keywords: [
    'cdk',
    'aws-cdk',
    'aws-cdk-construct',
    's3',
    'bucket',
    'sqs',
    'crowdstrike',
    'projen',
  ],
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflow: false,
    exclude: ['projen'],
  },
  stale: false,
  releaseToNpm: true,
  release: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  docgen: true,
  eslint: true,
  publishToPypi: {
    distName: 'renovosolutions.aws-cdk-crowdstrike-ingestion',
    module: 'crowdstrike_ingestion',
  },
  publishToNuget: {
    dotNetNamespace: 'renovosolutions',
    packageId: 'Renovo.AWSCDK.CrowdStrikeIngestion',
  },
});

new javascript.UpgradeDependencies(project, {
  include: ['projen'],
  taskName: 'upgrade-projen',
  workflow: true,
  workflowOptions: {
    schedule: javascript.UpgradeDependenciesSchedule.WEEKLY,
  },
});

project.synth();