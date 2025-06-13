import { Construct } from "constructs";
import { EksAddon } from "../.gen/providers/aws/eks-addon";

export interface EksAddonsResources {
  ebsCsiDriver?: EksAddon;
  vpcCni?: EksAddon;
}

export interface EksAddonsOptions {
  clusterName: string;
  ebsCsiDriverRoleArn?: string;
}

export function createEksAddons(scope: Construct, options: EksAddonsOptions): EksAddonsResources {
  // Install AWS EBS CSI Driver as a native EKS add-on
  const ebsCsiDriver = new EksAddon(scope, "aws-ebs-csi-driver", {
    addonName: "aws-ebs-csi-driver",
    clusterName: options.clusterName,
    serviceAccountRoleArn: options.ebsCsiDriverRoleArn,
    addonVersion: "v1.44.0-eksbuild.1", // Specify a compatible version
    // Use the recommended attributes (not the deprecated resolve_conflicts)
    resolveConflictsOnCreate: "OVERWRITE",
    resolveConflictsOnUpdate: "PRESERVE",
  });

  // Install VPC CNI add-on
  const vpcCni = new EksAddon(scope, "vpc-cni", {
    addonName: "vpc-cni",
    clusterName: options.clusterName,
    addonVersion: "v1.19.5-eksbuild.3", // Specify a compatible version 
    // Use the recommended attributes (not the deprecated resolve_conflicts)
    resolveConflictsOnCreate: "OVERWRITE",
    resolveConflictsOnUpdate: "PRESERVE",
  });

  return { ebsCsiDriver, vpcCni };
}
