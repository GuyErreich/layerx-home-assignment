import { Construct } from "constructs";
import { EksCluster, EksNodeGroup } from "@cdktf/provider-aws";
import { Namespace } from "@cdktf/provider-kubernetes";

export interface EksResources {
  cluster: EksCluster;
  nodeGroup: EksNodeGroup;
}

export function createEks(scope: Construct, eksRoleArn: string, nodeRoleArn: string, subnetIds: string[]): EksResources {
  const cluster = new EksCluster(scope, "eksCluster", {
    name: "layerx-eks",
    roleArn: eksRoleArn,
    vpcConfig: {
      subnetIds,
    },
  });

  const nodeGroup = new EksNodeGroup(scope, "eksNodeGroup", {
    clusterName: cluster.name,
    nodeRoleArn: nodeRoleArn,
    subnetIds,
    scalingConfig: {
      desiredSize: 2,
      maxSize: 3,
      minSize: 1,
    },
    dependsOn: [cluster],
  });

  // Namespaces as part of EKS
  new Namespace(scope, "argocd-ns", {
    metadata: { name: "argocd" },
  });
  new Namespace(scope, "monitoring-ns", {
    metadata: { name: "monitoring" },
  });

  return { cluster, nodeGroup };
}
