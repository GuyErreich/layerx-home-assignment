import { Construct } from "constructs";
import { TerraformOutput, Fn } from "cdktf";
import { DataAwsCallerIdentity } from "../../.gen/providers/aws/data-aws-caller-identity";
import { AppIamRole } from "./construct";
import { Config } from "../config";
import { EksCluster } from "../../.gen/providers/aws/eks-cluster";
import { AppIamConfig, AppIamRolesOutput } from "./types";
import { getAppConfigsForCluster, createConcreteId } from "./utils";

/**
 * Creates application IAM roles for service accounts
 * @param scope The construct scope
 * @param eksCluster The EKS cluster reference
 * @returns Object containing map of app names to role ARNs
 */
export function createAppIamRoles(scope: Construct, eksCluster: EksCluster): AppIamRolesOutput {
  const callerIdentity = new DataAwsCallerIdentity(scope, "app-iam-caller-identity", {});
  const accountId = callerIdentity.accountId;

  const issuer = eksCluster.identity.get(0).oidc.get(0).issuer;
  const oidcProvider = Fn.replace(issuer, "https://", "");
  const oidcProviderArn = Fn.join("", ["arn:aws:iam::", accountId, ":oidc-provider/", oidcProvider]);

  const appConfigs = getAppConfigsForCluster(Config.cluster.name);
  const roleArns: Record<string, string> = {};
  
  appConfigs.forEach(appConfig => {
    const constructId = `app-iam-${createConcreteId(appConfig.namespace, appConfig.appName)}`;
    
    const appIamRole = new AppIamRole(scope, constructId, {
      appName: appConfig.appName,
      namespace: appConfig.namespace,
      serviceAccount: appConfig.serviceAccount,
      clusterName: Config.cluster.name,
      region: Config.region,
      accountId: accountId,
      oidcProvider: oidcProvider,
      oidcProviderArn: oidcProviderArn,
      secretsAccess: appConfig.secretsAccess,
      s3Access: appConfig.s3Access,
      sqsAccess: appConfig.sqsAccess,
      customPolicies: appConfig.customPolicies
    });
    
    roleArns[appConfig.appName] = appIamRole.roleArn;
    
    const outputId = createConcreteId(appConfig.namespace, appConfig.appName, "role-arn");
    
    new TerraformOutput(scope, outputId, {
      value: appIamRole.roleArn,
      description: Fn.join("", [
        "ARN of the IAM role for ",
        appConfig.appName,
        " in namespace ",
        appConfig.namespace
      ])
    });
  });
  
  return { roleArns };
}

// Re-export the needed types and constructs
export type { AppIamConfig, AppIamRolesOutput } from "./types";
