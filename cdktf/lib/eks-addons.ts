import { Construct } from "constructs";
import { EksAddon } from "../.gen/providers/aws/eks-addon";

export interface EksAddonsResources {
  ebsCsiDriver?: EksAddon;
}

export interface EksAddonsOptions {
  clusterName: string;
  ebsCsiDriverRoleArn?: string;
}

/**
 * Creates EKS add-ons for the cluster
 * @param scope CDKTF construct scope
 * @param options Configuration options
 * @returns EKS add-on resources
 */
export function createEksAddons(scope: Construct, options: EksAddonsOptions): EksAddonsResources {
  const ebsCsiDriver = new EksAddon(scope, "aws-ebs-csi-driver", {
    addonName: "aws-ebs-csi-driver",
    clusterName: options.clusterName,
    serviceAccountRoleArn: options.ebsCsiDriverRoleArn,
    addonVersion: "v1.44.0-eksbuild.1",
    resolveConflictsOnCreate: "OVERWRITE",
    resolveConflictsOnUpdate: "PRESERVE",
  });

  return { ebsCsiDriver };
}
