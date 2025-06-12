import { Construct } from "constructs";
import { Vpc, Subnet, DataAwsRegion } from "@cdktf/provider-aws";

export interface VpcResources {
  vpc: Vpc;
  subnet1: Subnet;
  subnet2: Subnet;
}

export function createVpc(scope: Construct): VpcResources {
  // Get current AWS region from profile
  const region = new DataAwsRegion(scope, "current-region");

  const vpc = new Vpc(scope, "vpc", {
    cidrBlock: "10.0.0.0/16",
    enableDnsHostnames: true,
    enableDnsSupport: true,
    tags: { Name: "layerx-eks-vpc" },
  });

  const subnet1 = new Subnet(scope, "subnet1", {
    vpcId: vpc.id,
    cidrBlock: "10.0.1.0/24",
    availabilityZone: `${region.name}a`,
    tags: { Name: "layerx-eks-subnet-1" },
  });
  const subnet2 = new Subnet(scope, "subnet2", {
    vpcId: vpc.id,
    cidrBlock: "10.0.2.0/24",
    availabilityZone: `${region.name}b`,
    tags: { Name: "layerx-eks-subnet-2" },
  });

  return { vpc, subnet1, subnet2 };
}
