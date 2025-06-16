import { Construct } from "constructs";
import { EksCluster } from "../.gen/providers/aws/eks-cluster";
import { EksNodeGroup } from "../.gen/providers/aws/eks-node-group";
import { ITerraformDependable, Fn } from "cdktf";
import { Config } from "./config";

export interface EksResources {
  cluster: EksCluster;
  nodeGroup: EksNodeGroup;
}

export interface EksOptions {
  eksRoleArn: string;
  nodeRoleArn: string;
  subnetIds: string[];
  dependsOn?: ITerraformDependable[];
}

/**
 * Creates an EKS cluster and node group
 * @param scope CDKTF construct scope
 * @param options Configuration options
 * @returns EKS cluster and node group resources
 */
export function createEks(scope: Construct, options: EksOptions): EksResources {
  const cluster = new EksCluster(scope, "eksCluster", {
    name: Config.cluster.name,
    roleArn: options.eksRoleArn,
    version: Config.cluster.version,
    dependsOn: options.dependsOn || [],
    
    accessConfig: {
      authenticationMode: "API_AND_CONFIG_MAP",
      bootstrapClusterCreatorAdminPermissions: true,
    },
    bootstrapSelfManagedAddons: true,
    
    computeConfig: {
      enabled: false,
    },
    
    storageConfig: {
      blockStorage: {
        enabled: false,
      },
    },
    
    kubernetesNetworkConfig: {
      serviceIpv4Cidr: "10.100.0.0/16",
      ipFamily: "ipv4",
      elasticLoadBalancing: {
        enabled: false,
      },
    },
    vpcConfig: {
      subnetIds: options.subnetIds,
      endpointPrivateAccess: false,
      endpointPublicAccess: true,
      publicAccessCidrs: ["0.0.0.0/0"],
    },
  });

  const nodeGroup = new EksNodeGroup(scope, "eksNodeGroup", {
    clusterName: cluster.name,
    nodeRoleArn: options.nodeRoleArn,
    subnetIds: options.subnetIds,
    version: cluster.version,
    instanceTypes: [Config.nodeGroup.instanceType],
    diskSize: Config.nodeGroup.diskSize,
    amiType: "AL2_x86_64",
    scalingConfig: {
      desiredSize: Config.nodeGroup.desiredSize,
      maxSize: Config.nodeGroup.maxSize,
      minSize: Config.nodeGroup.minSize,
    },
    dependsOn: [cluster],
    tags: {
      "Name": Fn.join("-", [Config.cluster.name, "node"]),
      [Fn.join("", ["kubernetes.io/cluster/", Config.cluster.name])]: "owned",
    },
  });
  
  return { 
    cluster, 
    nodeGroup
  };
}
