import { Construct } from "constructs";
import { TerraformOutput, Fn } from "cdktf";
import { DataAwsCallerIdentity } from "../../.gen/providers/aws/data-aws-caller-identity";
import { AppIamRole } from "./construct";
import { appIamConfigs } from "./config";
import { Config } from "../config";
import { EksCluster } from "../../.gen/providers/aws/eks-cluster";
import { AppIamConfig, AppIamRolesOutput } from "./types";
import { getAppConfigsForCluster, sanitizeAppId, createResourceName, createConcreteId } from "./utils";

/**
 * Creates all application IAM roles defined in config.ts
 * 
 * @param scope The construct scope
 * @param eksCluster The EKS cluster reference
 * @returns Object containing a map of app names to role ARNs
 */
export function createAppIamRoles(scope: Construct, eksCluster: EksCluster): AppIamRolesOutput {
  // Get the AWS account ID
  const callerIdentity = new DataAwsCallerIdentity(scope, "app-iam-caller-identity", {});
  const accountId = callerIdentity.accountId;

  // Get the OIDC provider information from the cluster
  // Use Fn.replace instead of string.replace for token-aware operations
  const issuer = eksCluster.identity.get(0).oidc.get(0).issuer;
  const oidcProvider = Fn.replace(issuer, "https://", "");
  // Use Fn.join instead of template literals for token-aware string concatenation
  const oidcProviderArn = Fn.join("", ["arn:aws:iam::", accountId, ":oidc-provider/", oidcProvider]);

  // Get all app IAM configs for this cluster
  const appConfigs = getAppConfigsForCluster(Config.cluster.name);
  
  // Create a role for each app config
  const roleArns: Record<string, string> = {};
  
  appConfigs.forEach(appConfig => {
    // Create a concrete ID for the construct using our utility function
    // Construct IDs must be concrete strings at synthesis time
    const constructId = `app-iam-${createConcreteId(appConfig.namespace, appConfig.appName)}`;
    
    // Create the app IAM role with a unique ID
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
    
    // Store the role ARN in our map
    roleArns[appConfig.appName] = appIamRole.roleArn;
    
    // Create an output for this role ARN using our utility function for the construct ID
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

// Re-export the needed types and constructs for use in main.ts
export type { AppIamConfig, AppIamRolesOutput } from "./types";
// Keep the implementation details hidden from importers
