import { Construct } from "constructs";
import { EksAddon } from "../.gen/providers/aws/eks-addon";

export interface EksAddonsResources {
  ebsCsiDriver?: EksAddon;
  // VPC CNI is now managed by bootstrapSelfManagedAddons
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

  // VPC CNI add-on will be managed by bootstrapSelfManagedAddons
  // No need to manually install it

  return { ebsCsiDriver };
}
