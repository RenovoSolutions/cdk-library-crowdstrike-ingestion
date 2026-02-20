import { awscdk, javascript } from 'projen';
const project = new awscdk.AwsCdkConstructLibrary({
  author: 'Renovo Solutions',
  authorAddress: 'webmaster+cdk@renovo1.com',
  cdkVersion: '2.239.0',
  constructsVersion: '10.5.1',
  defaultReleaseBranch: 'master',
  jsiiVersion: '~5.9',
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
  buildWorkflow: false,
  releaseWorkflow: false,
  deps: [
    'cdk-nag@2.37.55',
  ],
  depsUpgrade: true,
  depsUpgradeOptions: {
    workflow: false,
    exclude: ['projen'],
  },
  githubOptions: {
    pullRequestLint: false,
    pullRequestLintOptions: {
      semanticTitle: true,
      semanticTitleOptions: {
        types: [
          'chore',
          'docs',
          'feat',
          'fix',
          'ci',
          'refactor',
        ],
      },
    },
  },
  stale: false,
  releaseToNpm: true,
  release: true,
  npmAccess: javascript.NpmAccess.PUBLIC,
  docgen: true,
  eslint: true,
  tsconfigDev: {
    compilerOptions: {
      isolatedModules: true,
    },
  },
  publishToPypi: {
    distName: 'renovosolutions.aws-cdk-crowdstrike-ingestion',
    module: 'renovosolutions_crowdstrike_ingestion',
  },
  publishToNuget: {
    dotNetNamespace: 'renovosolutions',
    packageId: 'Renovo.AWSCDK.CrowdStrikeIngestion',
  },
});

// Ignore the release workflow file so it's not committed to git
project.gitignore.exclude('!/.github/workflows/release.yml');
project.gitignore.addPatterns('.github/workflows/release.yml');

new javascript.UpgradeDependencies(project, {
  include: ['projen'],
  taskName: 'upgrade-projen',
  workflow: false,
  workflowOptions: {
    schedule: javascript.UpgradeDependenciesSchedule.WEEKLY,
  },
});

project.synth();